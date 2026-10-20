import { Injectable } from '@nestjs/common';
import { AgentService } from './agent.service';
import { ParcelService } from './parcel.service';
import { CorridorService } from './corridor.service';
import { WalletGateService } from './wallet-gate.service';
import { DispatchService } from './dispatch.service';
import { ToteService } from './tote.service';
import { FINDING_WORDS } from './tamper.types';
import { HELD_BY_WORDS } from './load-detention.types';
import { AGENT_ONLINE_H, CONNECTIVITY_LOSS_H, GHOST_BUS_H, MDP_DWELL_H, NETWORK_CURRENCY, NOT_SEEN_H, STAGNANT_INVENTORY_H , NEVER_DROPPED_H, UNCOLLECTED_H} from './pudo.config';

export interface PudoFlag {
  type: 'Stagnant_Inventory' | 'Ghost_Bus' | 'Stuck_At_MDP' | 'Uncollected' | 'Never_Dropped_Off' | 'Connectivity_Loss' | 'Blocked_Corridor' | 'Buyer_Dispute' | 'Short_Shipped' | 'Temp_Breach' | 'Not_Seen' | 'Pilot_Off_Target' | 'Tamper_Hold' | 'Held_By_Authority';
  subject: string;
  detail: string;
  ageHours?: number;
}

const hoursSince = (iso?: string): number => (iso ? (Date.now() - new Date(iso).getTime()) / 3_600_000 : 0);

/** A moment as the flags say it: the day and the time, in UTC. */
const utc = (iso: string): string => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

/**
 * The reading that broke the band, said with its own time — and, where it was read with no signal (round 24), that we
 * heard of it later: a breach learned of late is not a load too warm right now.
 */
function breachWords(r: { celsius: number; at: string; receivedAt?: string } | undefined): string {
  if (!r) return '';
  return `: ${r.celsius} °C at ${utc(r.at)}${r.receivedAt ? ` — read with no signal; reached us ${utc(r.receivedAt)}` : ''}`;
}

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
    private readonly totes: ToteService,
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
     * NOT SEEN FOR A WEEK (the user, 2026-10-18): a parcel on its way — at a shop, on a bus, at a hub — with no scan for
     * `NOT_SEEN_H`. The case is the search; staff declare it lost from it, or note where it is. Read from the LAST SCAN,
     * whatever the status: the windows above are each one state's, and a parcel can pass between states and then stop.
     * A parcel on a collection shelf is not here: it is where the shop put it, waiting for its owner (Uncollected).
     */
    for (const status of ['At_PUDO', 'On_Bus', 'At_MDP'] as const) {
      for (const p of this.parcels.list({ status })) {
        const last = p.scans[p.scans.length - 1];
        const age = hoursSince(last?.at ?? p.acceptedAt);
        if (age <= NOT_SEEN_H) continue;
        // Where it was last seen, in words: a shop by its name, a hub by its own (its scans carry it); never a DID.
        const by = last?.by?.startsWith('did:') ? this.agents.find(last.by)?.shopName : last?.by;
        const step = !last || last.status === 'CREATED' ? 'taken in' : last.status;
        flags.push({ type: 'Not_Seen', subject: p.parcelId, detail: `no scan for ${Math.floor(age / 24)} days · last ${step}${by ? ` at ${by}` : ''}`, ageHours: Math.round(age) });
      }
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
      if (f.tempBreached) flags.push({ type: 'Temp_Breach', subject: f.code, detail: `cold-chain freight to ${f.destLabel} broke its temperature band${breachWords(f.tempReadings?.find((r) => r.breach))}` });
    }
    // Round 35 — a unit held under the tamper protocol: operations is told before anybody takes custody of it, and the
    // case stays until operations releases it (TamperService.release closes it with the reason).
    for (const f of this.dispatch.listFreight()) {
      if (f.held) flags.push({ type: 'Tamper_Hold', subject: f.code, detail: `load to ${f.destLabel} · ${FINDING_WORDS[f.held.finding]} · ${f.held.where}`, ageHours: Math.round(hoursSince(f.held.since)) });
    }
    // A load held by the police, customs or another authority, as its driver said: operations calls the driver. The case
    // clears itself when the driver says it was let go.
    for (const f of this.dispatch.listFreight({ status: 'in_transit' })) {
      const h = this.dispatch.heldByAuthority(f);
      if (h) flags.push({ type: 'Held_By_Authority', subject: f.code, detail: `load to ${f.destLabel} · held by ${HELD_BY_WORDS[h.by]}${h.who ? ` (${h.who})` : ''}${h.note ? ` · “${h.note}”` : ''}`, ageHours: Math.round(hoursSince(h.since)) });
    }
    for (const t of this.totes.list()) {
      if (t.held) flags.push({ type: 'Tamper_Hold', subject: t.code, detail: `bag of ${t.parcels.length} · ${FINDING_WORDS[t.held.finding]} · ${t.held.where}`, ageHours: Math.round(hoursSince(t.held.since)) });
    }
    for (const p of this.parcels.list()) {
      if (p.held) flags.push({ type: 'Tamper_Hold', subject: p.parcelId, detail: `parcel${p.sscc ? ` ${p.sscc}` : ''} · ${FINDING_WORDS[p.held.finding]} · ${p.held.where}`, ageHours: Math.round(hoursSince(p.held.since)) });
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
    return {
      // The home currency's float, and every currency's — see WalletGateService.floats(). A screen that
      // can show more than one number shows `floats`; `systemFloat` is the single figure for the one
      // that cannot, and it is one currency rather than a total across them.
      systemFloat: this.gate.float(),
      floats: this.gate.floats(),
      currency: NETWORK_CURRENCY,
      todayRevenue,
      feeCount: fees.length,
      recentLedger: this.gate.entries().slice(0, 20),
      at: new Date().toISOString(),
    };
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
    // WHOSE PROMISE travels with it. A support desk answering the phone about a parcel has to know
    // whether it is ours to answer for or a carrier's, because that decides what they may offer the
    // person on the line — and a projection that drops the field turns this screen into a confident liar.
    return {
      parcelId: p.parcelId,
      status: p.status,
      size: p.size,
      origin: p.originZone,
      destination: p.destZone,
      takeInPromise: p.takeInPromise,
      dropoffPhotoRef: p.dropoffPhotoRef,
      deliveredPhotoRef: p.deliveredPhotoRef,
      releaseLockedAt: p.otpLockedAt,
      // A parcel held at a border: did the shop that took it in see its papers in the pouch, and when.
      ...(p.customs ? { crossesBorder: true, papersSeen: p.papersSeen } : {}),
      scans: p.scans,
    };
  }
}
