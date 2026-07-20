import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { MatchingService } from '../m3/matching.service';
import { DigitalTwinService } from './digital-twin.service';
import { DisruptionService } from './disruption.service';
import { EtaService } from './eta.service';
import { AutonomousAction, OrchestrationPolicy, PrescriptiveOption } from './twin.types';

interface PolicyInput {
  shipperDid: string;
  ifDelayHoursGt: number;
  ifExtraCostLt: number;
  thenAction: PrescriptiveOption['action'];
}

/** Above this added cost an autonomous action needs a human approve/reject (M7-050). */
const APPROVAL_THRESHOLD = 1000;
/** Above this the action is anomalous — frozen, never auto-executed (M7-053). */
const ANOMALY_THRESHOLD = 50_000;
/** One-click undo window after execution (M7-052). */
const ROLLBACK_WINDOW_MS = 60 * 60 * 1000;
/** Auto-reject a pending approval after this long (M7-050). */
const APPROVAL_TIMEOUT_MS = 30 * 60 * 1000;

/**
 * OrchestrationService (M7-030/031/050/051/052/053). Turns a disruption into ranked prescriptive
 * options, evaluates shipper if-then policies, and executes autonomously behind a human-in-the-loop
 * gate. Every action is anchored (immutable audit) and reversible inside a time-bound window; an
 * executed reroute/rebook re-matches through M3.
 */
@Injectable()
export class OrchestrationService {
  private readonly policies = new Map<string, OrchestrationPolicy>();
  private readonly actions = new Map<string, AutonomousAction>();

  constructor(
    private readonly twin: DigitalTwinService,
    private readonly eta: EtaService,
    private readonly disruption: DisruptionService,
    private readonly matching: MatchingService,
    private readonly ledger: LedgerService,
    private readonly events: EventBus,
  ) {}

  /** Build the ranked option set for a given delay magnitude (pure; no events). */
  private buildOptions(delayHours: number): PrescriptiveOption[] {
    const options: PrescriptiveOption[] = [
      { id: opt(), action: 'wait', label: 'Hold and wait for the disruption to clear', deltaCost: 0, deltaHours: delayHours, reliability: 0.6, justification: `No spend; absorbs ~${delayHours}h delay if the disruption clears on its own.` },
      { id: opt(), action: 'reroute', label: 'Reroute around the affected zone', deltaCost: 250, deltaHours: Math.max(2, Math.round(delayHours * 0.3)), reliability: 0.82, justification: 'Avoids the zone via the next-best carrier; modest cost, recovers most of the delay.' },
      { id: opt(), action: 'rebook_fastest', label: 'Rebook the fastest available carrier', deltaCost: 600, deltaHours: Math.max(1, Math.round(delayHours * 0.15)), reliability: 0.9, justification: 'Highest reliability; re-matches via M3 on the shortest remaining route.' },
      { id: opt(), action: 'split_air', label: 'Split the critical portion to air freight', deltaCost: 1800, deltaHours: 1, reliability: 0.95, justification: 'Fastest recovery for time-critical cargo; highest cost, needs approval.' },
    ];
    // Rank by a balanced cost function (lower = better): added hours + cost penalty − reliability
    // reward. This trades speed, spend and confidence rather than optimising any single axis.
    const cost = (o: PrescriptiveOption) => o.deltaHours + o.deltaCost / 30 - o.reliability * 12;
    return options.sort((a, b) => cost(a) - cost(b) || b.reliability - a.reliability);
  }

  /** M7-030: ranked prescriptive options with cost/time/reliability trade-offs + justification. */
  recommend(glosShipmentId: string, disruptionId?: string): PrescriptiveOption[] {
    if (!this.twin.shipment(glosShipmentId)) throw new NotFoundException(`Shipment not in twin: ${glosShipmentId}`);
    const delayHours = disruptionId && this.disruption.isImpacted(glosShipmentId) ? Math.max(6, Math.round(this.eta.predict(glosShipmentId).hoursRemaining * 0.5)) : 0;
    const ranked = this.buildOptions(delayHours);
    void this.events.publish(GlosEvent.Orchestration.RecommendationGenerated, { glosShipmentId, disruptionId, options: ranked.length, top: ranked[0]?.action }, { source: 'm7' }).catch(() => undefined);
    return ranked;
  }

  /** Silent recommendation for an explicit delay magnitude — used by the what-if simulator. */
  recommendForDelay(glosShipmentId: string, delayHours: number): PrescriptiveOption[] {
    if (!this.twin.shipment(glosShipmentId)) throw new NotFoundException(`Shipment not in twin: ${glosShipmentId}`);
    return this.buildOptions(Math.max(0, Math.round(delayHours)));
  }

  /**
   * Would a shipper policy fire for this shipment, given these options and projected delay? Pure —
   * no execution, no events. Returns the firing option + how it would be gated (used by simulation).
   */
  simulateDisposition(glosShipmentId: string, options: PrescriptiveOption[], estDelayHours: number): { fires: boolean; action?: PrescriptiveOption['action']; disposition?: 'auto' | 'approval' | 'frozen'; option?: PrescriptiveOption } {
    const node = this.twin.shipment(glosShipmentId);
    const shipperDid = String(node?.props.payerDid ?? '');
    for (const policy of this.policiesFor(shipperDid)) {
      const option = options.find((o) => o.action === policy.thenAction);
      if (!option) continue;
      if (estDelayHours > policy.ifDelayHoursGt && option.deltaCost < policy.ifExtraCostLt) {
        const disposition = option.deltaCost > ANOMALY_THRESHOLD ? 'frozen' : option.deltaCost > APPROVAL_THRESHOLD ? 'approval' : 'auto';
        return { fires: true, action: option.action, disposition, option };
      }
    }
    return { fires: false };
  }

  /** M7-031: register a shipper if-then orchestration policy. */
  registerPolicy(input: PolicyInput): OrchestrationPolicy {
    const policy: OrchestrationPolicy = { id: `pol_${randomBytes(6).toString('hex')}`, ...input };
    this.policies.set(policy.id, policy);
    return policy;
  }

  policiesFor(shipperDid: string): OrchestrationPolicy[] {
    return [...this.policies.values()].filter((p) => p.shipperDid === shipperDid);
  }

  /**
   * M7-031: evaluate the shipper's policies for a disrupted shipment and, if a rule fires,
   * execute its action autonomously (behind the human gate / anomaly freeze). Returns the
   * action taken, or null if no policy matched.
   */
  evaluate(glosShipmentId: string, disruptionId: string): AutonomousAction | null {
    const node = this.twin.shipment(glosShipmentId);
    if (!node) throw new NotFoundException(`Shipment not in twin: ${glosShipmentId}`);
    if (!this.disruption.isImpacted(glosShipmentId)) return null;

    const options = this.recommend(glosShipmentId, disruptionId);
    const estDelayHours = this.eta.predict(glosShipmentId).hoursRemaining;
    return this.applyPolicies(glosShipmentId, options, estDelayHours);
  }

  /**
   * Exception-driven autonomy: a critical/high M4 tracking exception is treated as a delay shock,
   * so the shipper's policies are evaluated and may execute behind the gate — the same loop, fed by
   * real telemetry instead of a zone disruption. `estDelayHours` is derived from the severity.
   */
  evaluateException(glosShipmentId: string, estDelayHours: number): AutonomousAction | null {
    if (!this.twin.shipment(glosShipmentId)) return null;
    const options = this.recommendForDelay(glosShipmentId, estDelayHours);
    return this.applyPolicies(glosShipmentId, options, estDelayHours);
  }

  /** Shared policy loop: fire the first matching shipper policy, executing behind the gate. */
  private applyPolicies(glosShipmentId: string, options: PrescriptiveOption[], estDelayHours: number): AutonomousAction | null {
    const shipperDid = String(this.twin.shipment(glosShipmentId)?.props.payerDid ?? '');
    for (const policy of this.policiesFor(shipperDid)) {
      const option = options.find((o) => o.action === policy.thenAction);
      if (!option) continue;
      if (estDelayHours > policy.ifDelayHoursGt && option.deltaCost < policy.ifExtraCostLt) {
        return this.execute(glosShipmentId, option, policy.id);
      }
    }
    return null;
  }

  /** M7-050/051/053: gate → anchor → execute (or freeze / await approval). */
  execute(glosShipmentId: string, option: PrescriptiveOption, policyId?: string): AutonomousAction {
    if (!this.twin.shipment(glosShipmentId)) throw new NotFoundException(`Shipment not in twin: ${glosShipmentId}`);
    const action: AutonomousAction = {
      id: `act_${randomBytes(8).toString('hex')}`,
      glosShipmentId,
      option,
      policyId,
      status: 'executed',
      at: new Date().toISOString(),
    };

    // M7-053: anomaly freeze — wildly expensive actions never run autonomously.
    if (option.deltaCost > ANOMALY_THRESHOLD) {
      action.status = 'frozen';
      this.anchor(action);
      this.actions.set(action.id, action);
      return action;
    }

    // M7-050: human-in-the-loop gate for above-threshold cost.
    if (option.deltaCost > APPROVAL_THRESHOLD) {
      action.status = 'pending_approval';
      action.approvalDeadline = new Date(Date.now() + APPROVAL_TIMEOUT_MS).toISOString();
      this.anchor(action);
      this.actions.set(action.id, action);
      void this.events.publish(GlosEvent.Orchestration.ApprovalRequested, { actionId: action.id, glosShipmentId, action: option.action, deltaCost: option.deltaCost }, { source: 'm7' }).catch(() => undefined);
      return action;
    }

    return this.commit(action);
  }

  /** M7-050: approve a pending action → executes now. */
  approve(actionId: string): AutonomousAction {
    const action = this.require(actionId);
    if (action.status !== 'pending_approval') throw new BadRequestException(`Action is ${action.status}, not pending_approval`);
    if (action.approvalDeadline && Date.now() > new Date(action.approvalDeadline).getTime()) return this.reject(actionId);
    return this.commit(action);
  }

  /** M7-050: reject (or auto-reject on timeout) a pending action. */
  reject(actionId: string): AutonomousAction {
    const action = this.require(actionId);
    if (action.status !== 'pending_approval') throw new BadRequestException(`Action is ${action.status}, not pending_approval`);
    action.status = 'rejected';
    this.anchor(action);
    return action;
  }

  /** M7-052: one-click undo inside the rollback window. */
  rollback(actionId: string): AutonomousAction {
    const action = this.require(actionId);
    if (action.status !== 'executed') throw new BadRequestException(`Action is ${action.status}, not executed`);
    if (!action.rollbackUntil || Date.now() > new Date(action.rollbackUntil).getTime()) throw new BadRequestException('Rollback window has expired');
    action.status = 'rolled_back';
    this.anchor(action);
    void this.events.publish(GlosEvent.Orchestration.ActionRolledBack, { actionId, glosShipmentId: action.glosShipmentId }, { source: 'm7' }).catch(() => undefined);
    return action;
  }

  getAction(actionId: string): AutonomousAction {
    return this.require(actionId);
  }

  auditTrail(glosShipmentId?: string): AutonomousAction[] {
    const all = [...this.actions.values()];
    return glosShipmentId ? all.filter((a) => a.glosShipmentId === glosShipmentId) : all;
  }

  // --- internals ---

  /** Commit an action: anchor, set the undo window, and re-match via M3 for reroute/rebook (A-108). */
  private commit(action: AutonomousAction): AutonomousAction {
    action.status = 'executed';
    action.rollbackUntil = new Date(Date.now() + ROLLBACK_WINDOW_MS).toISOString();

    if (action.option.action === 'reroute' || action.option.action === 'rebook_fastest' || action.option.action === 'split_air') {
      const node = this.twin.shipment(action.glosShipmentId);
      const payerDid = String(node?.props.payerDid ?? '');
      if (payerDid) {
        try {
          const rematch = this.matching.match({ glosShipmentId: action.glosShipmentId, payerDid });
          action.rematchId = rematch.matchId;
        } catch {
          // No eligible carrier right now — the action still stands; rematch can be retried.
        }
      }
    }

    this.anchor(action);
    this.actions.set(action.id, action);
    void this.events
      .publish(GlosEvent.Orchestration.AutonomousActionExecuted, { actionId: action.id, glosShipmentId: action.glosShipmentId, action: action.option.action, deltaCost: action.option.deltaCost, rematchId: action.rematchId, policyId: action.policyId }, { source: 'm7' })
      .catch(() => undefined);
    return action;
  }

  private anchor(action: AutonomousAction): void {
    action.anchorTxId = this.ledger.anchor({ id: action.id, glosShipmentId: action.glosShipmentId, action: action.option.action, status: action.status, at: action.at }).txId;
  }

  private require(actionId: string): AutonomousAction {
    const action = this.actions.get(actionId);
    if (!action) throw new NotFoundException(`Action not found: ${actionId}`);
    return action;
  }
}

function opt(): string {
  return `o_${randomBytes(4).toString('hex')}`;
}
