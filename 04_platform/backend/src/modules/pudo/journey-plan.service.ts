import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { ParcelService, planVsActual } from './parcel.service';
import type { JourneyPlan, Parcel } from './pudo.types';
import { RoutingService, type RouteEnd } from './routing.service';

/** One lane, as the plan said and as it went: how many arrived, how many by the time promised, how late the late ones were. */
export interface PlanLane {
  from: string;
  to: string;
  arrived: number;
  onTime: number;
  late: number;
  /** The middle lateness of the late ones, in hours — what "late on this lane" usually means. */
  typicalLateHours: number;
  /** Of the ones whose custody was recorded, how many went through the shops and hubs planned. */
  routeKnown: number;
  routeKept: number;
  /** 2026-11-06 — how many took a step their plan did not say, and why (movement unification). */
  offPlan: number;
  offPlanReasons: Partial<Record<string, number>>;
  /** The latest of them, to open and read. */
  worst?: { parcelId: string; lateHours: number };
  /** 2026-11-12 — the hubs its latest parcel's plan passed between its ends (along the road map, step 4). */
  hubs?: string[];
  /** 2026-11-12 — how many of its parcels passed a hub in a whole bag, unopened (step 5). */
  passedWhole?: number;
  /**
   * 2026-11-06 — WHAT THE WAYS NOT PRICED COST (the owner: "I follow point 1 to 6"): paid at stops its parcels were not
   * priced through, and the priced stops they never used (at the fee they were priced at) — each in its own money, never
   * added across monies. Absent where nothing went another way, or only parcels paid before stops were kept.
   */
  detours?: { parcels: number; paid: Array<{ currency: string; amount: number }>; unused: Array<{ currency: string; amount: number }> };
}

/** Sums by money: a list, by currency, rounded to the cent — monies are compared, never added together. */
export function byMoney(items: Array<{ currency: string; amount: number }>): Array<{ currency: string; amount: number }> {
  const at = new Map<string, number>();
  for (const i of items) at.set(i.currency, (at.get(i.currency) ?? 0) + i.amount);
  return [...at].map(([currency, amount]) => ({ currency, amount: Math.round(amount * 100) / 100 })).filter((m) => m.amount > 0).sort((a, b) => a.currency.localeCompare(b.currency));
}

/**
 * A parcel's detours, from what its plan kept as paid: the stops paid that were not priced, and — its stops now settled
 * (ready to collect) — the priced stops after the one it was handed in at that were never paid. Nothing for a parcel whose
 * pays were not kept (paid before 2026-11-06).
 */
export function detoursOf(p: Pick<Parcel, 'plan' | 'stopFees' | 'originAgentDid'>): { paid: Array<{ currency: string; amount: number }>; unused: Array<{ currency: string; amount: number }> } | undefined {
  const paid = p.plan?.paid;
  if (!paid || !p.stopFees?.length) return undefined;
  const unpriced = paid.filter((x) => !x.priced).map((x) => ({ currency: x.currency, amount: x.amount }));
  const unused = p.stopFees.filter((s) => !(s.type === 'pudo' && s.id === p.originAgentDid) && !paid.some((x) => x.type === s.type && x.id === s.id)).map((s) => ({ currency: s.currency, amount: s.fee }));
  return { paid: unpriced, unused };
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
};

/**
 * PLAN VERSUS ACTUAL WAS SILENT — and could not have been anything else.
 *
 * A quote predicts a chain of custody and a time to collect, and the parcel then does what it does. Nothing compared
 * the two, so a lane that is habitually late looked exactly like one that is on time. Worse, the plan the tracking
 * page showed was worked out AGAIN at every read, from the moment of reading: a promise recalculated each time it is
 * looked at is always on time, so there was nothing to compare with even in principle.
 *
 * So the plan is FROZEN the moment a parcel enters custody at its first shop — the route and the time it should be
 * ready — and kept on the parcel. When it is ready to collect, the two can be put side by side (`planVsActual`), and
 * the lanes read together (`lanes`): which run late, by how much, and which do not go the way they were planned.
 */
@Injectable()
export class JourneyPlanService implements OnModuleInit {
  private readonly logger = new Logger(JourneyPlanService.name);

  constructor(
    private readonly events: EventBus,
    private readonly parcels: ParcelService,
    private readonly routing: RoutingService,
  ) {}

  onModuleInit(): void {
    // Every way into the network — a walk-up at the counter, a send booked in the app, a store's order — is taken in
    // at a shop, and says so with this one event: the moment the promise starts.
    this.events.subscribe<{ parcelId: string }>(GlosEvent.Pudo.ParcelAccepted, (e) => {
      this.freeze(e.payload.parcelId);
    });
    // Reading B — or taken in at a hub, handed in there by the store in bulk: the promise starts at the hub.
    this.events.subscribe<{ parcelId: string }>(GlosEvent.Pudo.ParcelTakenInAtHub, (e) => {
      this.freeze(e.payload.parcelId);
    });
  }

  /**
   * Plan the journey now and keep it on the parcel — once. Nothing where it has a plan already or nowhere to go. `dock`: a
   * store's own dock it is bagged on (DockService) — the journey starts there, at the bagging, the store's "it goes now".
   */
  freeze(parcelId: string, now: number = Date.now(), dock?: RouteEnd): JourneyPlan | undefined {
    let parcel: Parcel;
    try {
      parcel = this.parcels.get(parcelId);
    } catch {
      return undefined;
    }
    if (parcel.plan || !parcel.destAgentDid) return parcel.plan;
    try {
      // From the take-in, which is when the promise starts — earlier than now where the counter had no signal (round 23).
      // Reading B — handed in at a hub: the journey starts at the hub, at the take-in, which is now.
      const fromHub = parcel.handInMdpId ? this.routing.hubEnd(parcel.handInMdpId) : undefined;
      const from = fromHub ?? dock;
      const takenIn = from ? NaN : parcel.acceptedAt ? Date.parse(parcel.acceptedAt) : NaN;
      const j = this.routing.planJourney({ ...(from ? { from } : { originAgentDid: parcel.committedNodeDid ?? parcel.originAgentDid }), destAgentDid: parcel.destAgentDid, ...(takenIn < now ? { startAt: takenIn } : {}) });
      const plan: JourneyPlan = {
        hops: j.hops.map((h) => ({ type: h.type, id: h.id, label: h.label, zone: h.zone })),
        mdpRouted: j.mdpRouted,
        pickupReadyAt: j.pickupReadyAt,
        plannedAt: new Date(now).toISOString(),
        // 2026-11-06 — kept stop by stop from here (movement unification): it was taken in at its first stop.
        at: 0,
      };
      // The stops it was PRICED on, where they are not the ones planned now (a hub full when it was taken in, say): kept, and
      // said — the price stands, and the plan is what it now travels by.
      const priced = (parcel.stopFees ?? []).map((f) => f.id);
      const planned = plan.hops.filter((h) => h.type !== 'dock').map((h) => h.id);
      if (priced.length && (priced.length !== planned.length || priced.some((id, i) => id !== planned[i]))) {
        plan.pricedVia = priced;
        plan.offPlan = [{ at: new Date(now).toISOString(), kind: 'system', where: plan.hops[0].id, whereLabel: plan.hops[0].label, took: planned.join(' > '), tookLabel: plan.hops.map((h) => h.label).join(' → '), reason: 'priced_other_way', by: 'system' }];
      }
      this.parcels.keepPlan(parcelId, plan);
      return plan;
    } catch (err) {
      // A route that cannot be planned is not a reason to refuse a parcel already in a shopkeeper's hands.
      this.logger.warn(`no plan kept for ${parcelId}: ${(err as Error).message}`);
      return undefined;
    }
  }

  /**
   * THE LANES, as they went: every parcel ready to collect in the window, by the zone it was taken in and the zone it
   * was sent to. The late ones first — the lanes most often late, then the busiest — because that is the reading the
   * silence was hiding.
   */
  lanes(sinceDays = 30, now: number = Date.now()): PlanLane[] {
    const since = now - sinceDays * 86_400_000;
    const byLane = new Map<string, { from: string; to: string; hubs?: { at: number; names: string[] }; rows: Array<{ parcelId: string; onTime: boolean; lateHours: number; routeKept?: boolean; reasons: string[]; detours?: ReturnType<typeof detoursOf>; whole?: boolean }> }>();
    for (const p of this.parcels.list()) {
      const said = planVsActual(p);
      if (!said || Date.parse(said.readyAt) < since || !p.plan?.hops.length) continue;
      const from = p.plan.hops[0].zone;
      const to = p.plan.hops[p.plan.hops.length - 1].zone;
      const lane = byLane.get(`${from}>${to}`) ?? { from, to, rows: [] };
      // 2026-11-12 — the hubs its latest parcel passed between the ends: along the road map, the stops on the way.
      const passed = p.plan.hops.filter((h) => h.type === 'mdp').map((h) => h.label);
      const readyAt = Date.parse(said.readyAt);
      if (!lane.hubs || readyAt > lane.hubs.at) lane.hubs = { at: readyAt, names: passed };
      lane.rows.push({ ...(p.passedWhole ? { whole: true } : {}), parcelId: p.parcelId, onTime: said.onTime, lateHours: said.lateHours, ...(said.routeKept === undefined ? {} : { routeKept: said.routeKept }), reasons: (p.plan.offPlan ?? []).filter((x) => x.reason !== 'priced_other_way').map((x) => x.reason), detours: detoursOf(p) });
      byLane.set(`${from}>${to}`, lane);
    }
    return [...byLane.values()]
      .map(({ from, to, hubs, rows }) => {
        const late = rows.filter((r) => !r.onTime);
        const known = rows.filter((r) => r.routeKept !== undefined);
        const worst = late.sort((a, b) => b.lateHours - a.lateHours)[0];
        return {
          from,
          to,
          arrived: rows.length,
          onTime: rows.length - late.length,
          late: late.length,
          typicalLateHours: median(late.map((r) => r.lateHours)),
          routeKnown: known.length,
          routeKept: known.filter((r) => r.routeKept).length,
          offPlan: rows.filter((r) => r.reasons.length).length,
          offPlanReasons: rows.flatMap((r) => r.reasons).reduce<Partial<Record<string, number>>>((n, why) => ({ ...n, [why]: (n[why] ?? 0) + 1 }), {}),
          ...(worst ? { worst: { parcelId: worst.parcelId, lateHours: worst.lateHours } } : {}),
          ...laneDetours(rows),
          ...(hubs?.names.length ? { hubs: hubs.names } : {}),
          ...(rows.some((r) => r.whole) ? { passedWhole: rows.filter((r) => r.whole).length } : {}),
        };
      })
      .sort((a, b) => b.late / b.arrived - a.late / a.arrived || b.arrived - a.arrived);
  }
}

/** A lane's detours: how many of its parcels were paid at a stop not priced, what that came to, and the priced stops unused. */
function laneDetours(rows: Array<{ detours?: ReturnType<typeof detoursOf> }>): { detours?: PlanLane['detours'] } {
  const paid = byMoney(rows.flatMap((r) => r.detours?.paid ?? []));
  const unused = byMoney(rows.flatMap((r) => r.detours?.unused ?? []));
  if (!paid.length && !unused.length) return {};
  return { detours: { parcels: rows.filter((r) => r.detours?.paid.length).length, paid, unused } };
}
