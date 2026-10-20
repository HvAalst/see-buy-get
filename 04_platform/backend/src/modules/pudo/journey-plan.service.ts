import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { ParcelService, planVsActual } from './parcel.service';
import type { JourneyPlan, Parcel } from './pudo.types';
import { RoutingService } from './routing.service';

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
  /** The latest of them, to open and read. */
  worst?: { parcelId: string; lateHours: number };
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
  }

  /** Plan the journey now and keep it on the parcel — once. Nothing where it has a plan already or nowhere to go. */
  freeze(parcelId: string, now: number = Date.now()): JourneyPlan | undefined {
    let parcel: Parcel;
    try {
      parcel = this.parcels.get(parcelId);
    } catch {
      return undefined;
    }
    if (parcel.plan || !parcel.destAgentDid) return parcel.plan;
    try {
      // From the take-in, which is when the promise starts — earlier than now where the counter had no signal (round 23).
      const takenIn = parcel.acceptedAt ? Date.parse(parcel.acceptedAt) : NaN;
      const j = this.routing.planJourney({ originAgentDid: parcel.committedNodeDid ?? parcel.originAgentDid, destAgentDid: parcel.destAgentDid, ...(takenIn < now ? { startAt: takenIn } : {}) });
      const plan: JourneyPlan = {
        hops: j.hops.map((h) => ({ type: h.type, id: h.id, label: h.label, zone: h.zone })),
        mdpRouted: j.mdpRouted,
        pickupReadyAt: j.pickupReadyAt,
        plannedAt: new Date(now).toISOString(),
      };
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
    const byLane = new Map<string, { from: string; to: string; rows: Array<{ parcelId: string; onTime: boolean; lateHours: number; routeKept?: boolean }> }>();
    for (const p of this.parcels.list()) {
      const said = planVsActual(p);
      if (!said || Date.parse(said.readyAt) < since || !p.plan?.hops.length) continue;
      const from = p.plan.hops[0].zone;
      const to = p.plan.hops[p.plan.hops.length - 1].zone;
      const lane = byLane.get(`${from}>${to}`) ?? { from, to, rows: [] };
      lane.rows.push({ parcelId: p.parcelId, onTime: said.onTime, lateHours: said.lateHours, ...(said.routeKept === undefined ? {} : { routeKept: said.routeKept }) });
      byLane.set(`${from}>${to}`, lane);
    }
    return [...byLane.values()]
      .map(({ from, to, rows }) => {
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
          ...(worst ? { worst: { parcelId: worst.parcelId, lateHours: worst.lateHours } } : {}),
        };
      })
      .sort((a, b) => b.late / b.arrived - a.late / a.arrived || b.arrived - a.arrived);
  }
}
