import { Injectable } from '@nestjs/common';
import { AgentService } from './agent.service';
import { ParcelService } from './parcel.service';
import { CorridorService } from './corridor.service';
import { WalletGateService } from './wallet-gate.service';
import { DispatchService } from './dispatch.service';
import { AGENT_ONLINE_H, CONNECTIVITY_LOSS_H, GHOST_BUS_H, MDP_DWELL_H, STAGNANT_INVENTORY_H , NEVER_DROPPED_H, UNCOLLECTED_H} from './pudo.config';

export interface PudoFlag {
  type: 'Stagnant_Inventory' | 'Ghost_Bus' | 'Stuck_At_MDP' | 'Uncollected' | 'Never_Dropped_Off' | 'Connectivity_Loss' | 'Blocked_Corridor' | 'Buyer_Dispute' | 'Short_Shipped' | 'Temp_Breach';
  subject: string;
  detail: string;
  ageHours?: number;
}

const hoursSince = (iso?: string): number => (iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : 0);

/**
 * MonitorService (P-006, ↔ M7/M4/SSE light). The exception-management half of the Control Tower done
 * with time windows instead of AI: Stagnant Inventory (> 48 h At_PUDO), Ghost Bus (> 6 h On_Bus),
 * Connectivity Loss (agent no-ping > 2 h), Blocked Corridor. Also serves the operator dashboard KPIs,
 * the finance health roll-up, and the User/Support parcel timeline.
 */
@Injectable()
export class MonitorService {
  constructor(
    private readonly agents: AgentService,
    private readonly parcels: ParcelService,
    private readonly corridors: CorridorService,
    private readonly gate: WalletGateService,
    private readonly dispatch: DispatchService,
  ) {}

  /** Time-window auto-flags — 'what's on fire' (Ch 14). */
  flags(): PudoFlag[] {
    const flags: PudoFlag[] = [];

    for (const p of this.parcels.list({ status: 'At_PUDO' })) {
      const age = hoursSince(p.acceptedAt);
      if (age > STAGNANT_INVENTORY_H) flags.push({ type: 'Stagnant_Inventory', subject: p.parcelId, detail: `At_PUDO ${Math.round(age)}h`, ageHours: Math.round(age) });
      // S25: a parcel a bus knowingly left behind — surfaced the instant it happens, not after 48 h.
      if (p.shortShippedAt) flags.push({ type: 'Short_Shipped', subject: p.parcelId, detail: `left behind at handover · ${p.shortShipReason ?? 'not loaded'}`, ageHours: Math.round(hoursSince(p.shortShippedAt)) });
    }
    for (const p of this.parcels.list({ status: 'On_Bus' })) {
      const age = hoursSince(p.handedToBusAt);
      if (age > GHOST_BUS_H) flags.push({ type: 'Ghost_Bus', subject: p.parcelId, detail: `On_Bus ${Math.round(age)}h`, ageHours: Math.round(age) });
    }
    /**
     * The state nothing watched.
     *
     * Every state a parcel passes THROUGH had a window — 48 h at a shop, 6 h on a bus, 12 h at a hub —
     * and the one state it can sit in for ever had none. A parcel nobody collects holds a shelf slot
     * indefinitely, and the shelf is what decides whether a shop can take anything new at all, so each
     * one quietly costs the network a slot in a shop that has six or nine.
     *
     * Aged from the ARRIVAL scan rather than from `acceptedAt`: a parcel that took a week to cross the
     * country has not been uncollected for a week, and dating it from the mint would flag the network's
     * own slowness as the receiver's.
     */
    // 'Unclaimed' is the fact now, so the flag reads it instead of recomputing it. Ready_For_Pickup is
    // still scanned beside it, because a parcel is only unclaimed once the sweep has reached it and an
    // operator must not be blind to one in the gap between two ticks.
    for (const p of [...this.parcels.list({ status: 'Ready_For_Pickup' }), ...this.parcels.list({ status: 'Unclaimed' })]) {
      const age = hoursSince(p.readyAt ?? p.scans[p.scans.length - 1]?.at);
      if (age > UNCOLLECTED_H) {
        flags.push({ type: 'Uncollected', subject: p.parcelId, detail: `waiting at ${p.destZone ?? 'the shop'} ${Math.round(age / 24)}d · shelf ${p.binSlot ?? '—'}`, ageHours: Math.round(age) });
      }
    }
    /**
     * Minted, billed, and never handed over.
     *
     * The vendor's money is taken at mint, so a shipment that never starts is a merchant paying for
     * nothing — and `Created` was the other state with no watch on it. The way out already existed
     * (`cancel` accepts Created and reverses the charge); what was missing was anybody noticing.
     */
    for (const p of this.parcels.list({ status: 'Created' })) {
      const age = hoursSince(p.acceptedAt);
      if (age > NEVER_DROPPED_H) {
        flags.push({ type: 'Never_Dropped_Off', subject: p.parcelId, detail: `minted ${Math.round(age)}h ago and never dropped off${p.vendorId ? ' · the store has been billed' : ''}`, ageHours: Math.round(age) });
      }
    }
    for (const p of this.parcels.list({ status: 'At_MDP' })) {
      const age = hoursSince(p.scans[p.scans.length - 1]?.at); // since the drop/sort scan at the hub
      if (age > MDP_DWELL_H) flags.push({ type: 'Stuck_At_MDP', subject: p.parcelId, detail: `At_MDP ${Math.round(age)}h`, ageHours: Math.round(age) });
    }
    for (const a of this.agents.list()) {
      const age = hoursSince(a.lastPingAt);
      if (age > CONNECTIVITY_LOSS_H && a.status !== 'DRAFT' && a.status !== 'KYC_PENDING') flags.push({ type: 'Connectivity_Loss', subject: a.shopName, detail: `No ping ${Math.round(age)}h`, ageHours: Math.round(age) });
    }
    for (const c of this.corridors.listCorridors()) {
      if (c.status === 'blocked') flags.push({ type: 'Blocked_Corridor', subject: c.name, detail: `${c.originZone} → ${c.destZone} blocked` });
    }
    // S23 (O3): every dispute — vendor order OR peer send — surfaces to the control tower here. The
    // vendor is additionally notified out-of-band via the S15 callback; a peer send lands only here + on
    // the sender's own parcel list, so this flag is the ops-side catch-all a buyer dispute routes to.
    for (const p of this.parcels.list({ status: 'Disputed' })) {
      flags.push({ type: 'Buyer_Dispute', subject: p.parcelId, detail: `${p.vendorId ? 'vendor order' : 'peer send'} · ${p.buyerDisputeReason ?? p.disputeReason ?? 'disputed'}` });
    }
    // S33b: a cold-chain freight whose temperature left the safe band in transit — the chain is broken, the
    // cargo suspect. Surfaced while it is still moving so an operator can act (reroute, alert the shipper).
    for (const f of this.dispatch.listFreight({ status: 'in_transit' })) {
      if (f.tempBreached) flags.push({ type: 'Temp_Breach', subject: f.code, detail: `cold-chain freight to ${f.destLabel} broke its temperature band` });
    }
    return flags;
  }

  /**
   * REP3 — a hub's DERIVED operational scorecard (MDPs aren't star-rated; they earn a reputation by moving
   * parcels through fast). `handling` is its current inbound queue, `stuck` the parcels that have dwelt past
   * the hub SLA (MDP_DWELL_H — the very signal the Stuck_At_MDP flag uses, so no new tracking), and
   * `onTimeRate` the share still within SLA. An empty queue reads a clean 1.0.
   */
  mdpScorecard(mdpId: string): { handling: number; stuck: number; onTimeRate: number } {
    const atMdp = this.parcels.list({ status: 'At_MDP' }).filter((p) => p.atMdpId === mdpId);
    const stuck = atMdp.filter((p) => hoursSince(p.scans[p.scans.length - 1]?.at) > MDP_DWELL_H).length;
    const handling = atMdp.length;
    return { handling, stuck, onTimeRate: handling ? Math.round((1 - stuck / handling) * 100) / 100 : 1 };
  }

  /** Operator dashboard — answers 'is the network moving / are agents online / is money flowing / what's on fire' in 5s. */
  dashboard() {
    const allAgents = this.agents.list();
    const online = allAgents.filter((a) => hoursSince(a.lastPingAt) <= AGENT_ONLINE_H).length;
    const active = allAgents.filter((a) => a.status === 'ACTIVE').length;
    const inTransit = this.parcels.list({ status: 'On_Bus' }).length;
    const statusMix: Record<string, number> = {};
    for (const p of this.parcels.list()) statusMix[p.status] = (statusMix[p.status] ?? 0) + 1;
    const flags = this.flags();
    return {
      parcelsInTransit: inTransit,
      agentsOnline: online,
      agentsTotal: allAgents.length,
      agentRetention: allAgents.length ? Math.round((active / allAgents.length) * 100) / 100 : 0,
      systemFloat: this.gate.float(),
      criticalAlerts: flags.length,
      statusMix,
      flags,
      at: new Date().toISOString(),
    };
  }

  /** Finance health — float, today's revenue (FEE), and the typed ledger roll-up. */
  finance() {
    const today = new Date().toISOString().slice(0, 10);
    const fees = this.gate.entries({ type: 'FEE' }).filter((e) => e.at.startsWith(today));
    const todayRevenue = Math.round(fees.reduce((s, e) => s + e.amount, 0) * 100) / 100;
    return { systemFloat: this.gate.float(), todayRevenue, feeCount: fees.length, recentLedger: this.gate.entries().slice(0, 20), at: new Date().toISOString() };
  }

  /** PUDO coverage heatmap (Ch 14 Map): every registered node + its operational state, plus density
   *  cells — the spatial picture that feeds journey-leg planning. */
  heatmap() {
    const points = this.agents.list().filter((a) => a.location).map((a) => {
      const offline = hoursSince(a.lastPingAt) > CONNECTIVITY_LOSS_H;
      const state = a.status !== 'ACTIVE' ? 'inactive' : a.openState === 'closed' ? 'closed' : offline ? 'inactive' : 'open';
      return { lat: a.location.lat, lng: a.location.lng, shopName: a.shopName, zone: a.zone, state, status: a.status };
    });
    const cellMap = new Map<string, number>();
    for (const p of points) { const key = `${p.lat.toFixed(1)},${p.lng.toFixed(1)}`; cellMap.set(key, (cellMap.get(key) ?? 0) + 1); }
    const counts = {
      registered: points.length,
      open: points.filter((p) => p.state === 'open').length,
      closed: points.filter((p) => p.state === 'closed').length,
      inactive: points.filter((p) => p.state === 'inactive').length,
    };
    return { points, cells: [...cellMap.entries()].map(([cell, count]) => ({ cell, count })), counts, at: new Date().toISOString() };
  }

  /** User/Support — the parcel audit timeline ('where is my package', 'it was damaged'). */
  parcelTimeline(parcelId: string) {
    const p = this.parcels.get(parcelId);
    // `releaseLockedAt` (never the secret itself) so the support desk can SEE why a customer at the
    // counter cannot collect, and reissue — the whole point of a lockout that a human can recover from.
    return { parcelId: p.parcelId, status: p.status, size: p.size, origin: p.originZone, destination: p.destZone, dropoffPhotoRef: p.dropoffPhotoRef, deliveredPhotoRef: p.deliveredPhotoRef, releaseLockedAt: p.otpLockedAt, scans: p.scans };
  }
}
