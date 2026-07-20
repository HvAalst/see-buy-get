import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { TrackingService } from './tracking.service';
import { TrackingContextService } from './tracking-context.service';
import { EtaService } from './eta.service';
import { geocode, haversineKm } from './geo';
import { CaseStatus, ExceptionCase, ExceptionType, Severity } from './exception.types';

const DEVIATION_KM = 200; // off-route threshold
const STATIONARY_RADIUS_KM = 2;
const STATIONARY_H = 6;
const TEMP_MAX_C = 8; // cold-chain ceiling
const SHOCK_G = 5;

/**
 * ExceptionService (VTT-040/041/042/044, VTT-013). Real-time rule engine: route deviation, prolonged
 * stationary, temperature/shock breach (IoT), delivery-without-acceptance, missed window. Each hit
 * becomes a persistent, severity-classified case (open→…→resolved) with an immutable action log,
 * anchored on the ledger, and emits `tracking.exception_raised` (which SSE/M3/M7 consume). Ops can
 * acknowledge, resolve, override severity, or mark a false alarm — every change reason-logged.
 */
@Injectable()
export class ExceptionService implements OnModuleInit {
  private readonly cases = new Map<string, ExceptionCase>();
  private readonly openByKey = new Map<string, string>(); // `${shipmentId}:${type}` → caseId
  private readonly lastSeen = new Map<string, { pos: { lat: number; lng: number }; at: number }>();

  constructor(
    private readonly tracking: TrackingService,
    private readonly context: TrackingContextService,
    private readonly eta: EtaService,
    private readonly events: EventBus,
    private readonly ledger: LedgerService,
  ) {}

  onModuleInit(): void {
    // Delivery recorded without a proof-of-delivery is an exception (VTT-040).
    this.events.subscribe<{ glosShipmentId: string; pod?: unknown }>(GlosEvent.Tracking.Delivered, (e) => {
      if (!e.payload.pod) this.raise(e.payload.glosShipmentId, 'delivery_without_acceptance', 'high', 'Delivered without a recorded proof-of-delivery', { affected: ['DELIVERY'] });
    });
  }

  /** Evaluate a GPS position for route-deviation + prolonged-stationary (VTT-040). */
  evaluatePosition(glosShipmentId: string, position: { lat: number; lng: number }): ExceptionCase[] {
    const raised: ExceptionCase[] = [];
    const state = this.tracking.snapshot(glosShipmentId)?.state;
    if (state === 'DELIVERED') return raised;

    const planned = this.plannedPoints(glosShipmentId);
    if (planned.length) {
      const nearestKm = Math.min(...planned.map((p) => haversineKm(position, p)));
      if (nearestKm > DEVIATION_KM) {
        raised.push(this.raise(glosShipmentId, 'route_deviation', nearestKm > 1000 ? 'critical' : nearestKm > 500 ? 'high' : 'medium', `Off planned route by ${Math.round(nearestKm)}km`, { metrics: { deviationKm: Math.round(nearestKm) } }));
      }
    }

    const prev = this.lastSeen.get(glosShipmentId);
    if (prev && haversineKm(prev.pos, position) < STATIONARY_RADIUS_KM) {
      const stillH = (Date.now() - prev.at) / 3_600_000;
      if (stillH > STATIONARY_H) raised.push(this.raise(glosShipmentId, 'prolonged_stationary', stillH > 24 ? 'high' : 'medium', `Stationary for ${Math.round(stillH)}h`, { metrics: { stationaryHours: Math.round(stillH) } }));
    } else {
      this.lastSeen.set(glosShipmentId, { pos: position, at: Date.now() });
    }
    return raised;
  }

  /** IoT sensor reading → temperature/shock breach (VTT-013/040). */
  recordSensor(glosShipmentId: string, metric: 'temperature' | 'shock', value: number): ExceptionCase | null {
    if (metric === 'temperature' && value > TEMP_MAX_C) {
      const over = value - TEMP_MAX_C;
      return this.raise(glosShipmentId, 'temperature_breach', over > 5 ? 'critical' : over > 2 ? 'high' : 'medium', `Temperature ${value}°C exceeds ${TEMP_MAX_C}°C`, { metrics: { temperatureC: value } });
    }
    if (metric === 'shock' && value > SHOCK_G) {
      return this.raise(glosShipmentId, 'shock_breach', value > 15 ? 'critical' : value > 8 ? 'high' : 'medium', `Shock ${value}g exceeds ${SHOCK_G}g`, { metrics: { shockG: value } });
    }
    return null;
  }

  /** Missed-window check against a supplied SLA deadline (VTT-040). */
  checkDeadline(glosShipmentId: string, deadlineIso: string): ExceptionCase | null {
    if (this.tracking.snapshot(glosShipmentId)?.state === 'DELIVERED') return null;
    const predicted = new Date(this.eta.predict(glosShipmentId).eta).getTime();
    const lateH = (predicted - new Date(deadlineIso).getTime()) / 3_600_000;
    if (lateH <= 0) return null;
    return this.raise(glosShipmentId, 'missed_window', lateH > 24 ? 'critical' : lateH > 6 ? 'high' : 'medium', `Predicted ${Math.round(lateH)}h past the delivery window`, { metrics: { lateHours: Math.round(lateH) }, affected: ['DELIVERY'] });
  }

  list(glosShipmentId?: string): ExceptionCase[] {
    const all = [...this.cases.values()];
    return (glosShipmentId ? all.filter((c) => c.glosShipmentId === glosShipmentId) : all).sort((a, b) => b.detectedAt.localeCompare(a.detectedAt));
  }

  get(caseId: string): ExceptionCase {
    return this.require(caseId);
  }

  // --- lifecycle (VTT-042/044) ---

  acknowledge(caseId: string, by?: string): ExceptionCase {
    return this.transition(caseId, 'acknowledged', 'acknowledged', by);
  }

  resolve(caseId: string, by?: string): ExceptionCase {
    const c = this.transition(caseId, 'resolved', 'resolved', by);
    this.openByKey.delete(`${c.glosShipmentId}:${c.type}`);
    return c;
  }

  falseAlarm(caseId: string, reason: string, by?: string): ExceptionCase {
    if (!reason?.trim()) throw new BadRequestException('A reason is required to mark a false alarm');
    const c = this.transition(caseId, 'false_alarm', 'marked_false_alarm', by, reason);
    this.openByKey.delete(`${c.glosShipmentId}:${c.type}`);
    return c;
  }

  override(caseId: string, severity: Severity, reason: string, by?: string): ExceptionCase {
    if (!reason?.trim()) throw new BadRequestException('A reason is required to override severity');
    const c = this.require(caseId);
    c.severity = severity;
    c.actions.push({ at: new Date().toISOString(), action: 'override_severity', by, detail: `${severity}: ${reason}` });
    return c;
  }

  // --- internals ---

  private raise(glosShipmentId: string, type: ExceptionType, severity: Severity, reason: string, opts: { metrics?: Record<string, number>; affected?: string[] } = {}): ExceptionCase {
    const key = `${glosShipmentId}:${type}`;
    const existingId = this.openByKey.get(key);
    if (existingId) {
      const existing = this.cases.get(existingId);
      if (existing && existing.status !== 'resolved' && existing.status !== 'false_alarm') {
        existing.actions.push({ at: new Date().toISOString(), action: 're_observed', detail: reason });
        return existing; // don't duplicate an already-open case of the same type
      }
    }

    const now = new Date().toISOString();
    const record: ExceptionCase = { id: `exc_${randomBytes(8).toString('hex')}`, glosShipmentId, type, severity, status: 'open', detectedAt: now, reason, affectedMilestones: opts.affected ?? [], metrics: opts.metrics ?? {}, actions: [{ at: now, action: 'detected', detail: reason }] };
    record.anchorTxId = this.ledger.anchor({ id: record.id, s: glosShipmentId, t: type, sev: severity, at: now }).txId;
    this.cases.set(record.id, record);
    this.openByKey.set(key, record.id);

    void this.events
      .publish(GlosEvent.Tracking.ExceptionRaised, { glosShipmentId, exceptionType: type, severity, reason, caseId: record.id }, { source: 'm4' })
      .catch(() => undefined);
    return record;
  }

  private transition(caseId: string, status: CaseStatus, action: string, by?: string, detail?: string): ExceptionCase {
    const c = this.require(caseId);
    c.status = status;
    c.actions.push({ at: new Date().toISOString(), action, by, detail });
    return c;
  }

  private plannedPoints(glosShipmentId: string): Array<{ lat: number; lng: number }> {
    const ctx = this.context.get(glosShipmentId);
    if (!ctx) return [];
    return ctx.legs.flatMap((leg) => [leg.handover?.geofence?.center, geocode(leg.origin), geocode(leg.destination)].filter((p): p is { lat: number; lng: number } => !!p));
  }

  private require(caseId: string): ExceptionCase {
    const c = this.cases.get(caseId);
    if (!c) throw new NotFoundException(`Exception case not found: ${caseId}`);
    return c;
  }
}
