import { Inject, Injectable, Logger, OnModuleDestroy, OnModuleInit, Optional } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { AgentService } from './agent.service';
import { NotificationService } from './notification.service';
import { EXPECTED_LATE_RETELL_H, EXPECTED_LATE_TELL_H, NEAR_LOCATED_H, STUCK_SWEEP_MS, VEHICLE_SPEED_KMH } from './pudo.config';
import { FleetService } from './fleet.service';
import { nextOpenAt } from './hours';
import { ROUTER, type Router } from './router';
import { MdpService } from './mdp.service';
import { ParcelService } from './parcel.service';
import type { JourneyPlan, Mdp, Parcel } from './pudo.types';
import type { OffPlanReason, OffPlanSaid, OffPlanStep, PlanHop, RouteKeeper } from './route-plan.types';
import { RoutingService } from './routing.service';

/** A plan kept stop by stop. One made before (no `at`), or none at all, is not asked: the parcel moves as it always did. */
export function keptPlanOf(parcel: Parcel): JourneyPlan | undefined {
  return parcel.plan && parcel.plan.at !== undefined && parcel.plan.hops.length ? parcel.plan : undefined;
}

/**
 * The stop a parcel goes to next by its kept plan, if it has one. A plain function as well as the keeper's: the shop's bag
 * plan and a store's dock address their bags by it, and are made in places the keeper is not (movement unification).
 */
export function nextStopOf(parcel: Parcel): PlanHop | undefined {
  const plan = keptPlanOf(parcel);
  return plan ? plan.hops[plan.at! + 1] : undefined;
}

/**
 * 2026-11-06 — ONE PLAN PER PARCEL, ASKED AT EVERY HAND-OVER (movement unification; the owner: "build the whole thing").
 *
 * WHAT IT WAS. A parcel left a shop two ways that did not know of each other: loose, handed to a driver at the counter by
 * their pass, straight to its area; or in a bag, through a hub. It was priced on one route when it was booked, planned on
 * another when it was taken in, and at every bag and every hub its way was worked out again from scratch — so nothing made
 * it travel the way it was priced and promised, and nothing said when it did not.
 *
 * WHAT IT IS. The plan kept on the parcel when it is taken in (JourneyPlanService) says its stops in order; `at` says which
 * it last reached. Every place that DECIDES its next step asks this keeper first — the counter handing it loose to a bus,
 * a shop or a hub putting it in a bag, a hub sorting it: is this its next stop? If not, it goes that way only with a reason
 * said, which is kept on the parcel. Every place it ARRIVES tells the keeper — a hub, a shop — and an arrival is never
 * refused: the plan moves on, or, somewhere it was not planned to be, is made again from there and that is kept. The network
 * itself sends a parcel another way only with its reason kept too (a full hub; a hub no longer to be used).
 *
 * WHAT IT NEVER DOES. Change what the customer pays — a price is a promise, and the money already follows what happened, each
 * step paying whoever did it — or move the time they were promised (`pickupReadyAt`): lateness is measured against it,
 * and the plan made again keeps its own estimate beside it (`expectedAt`).
 */
@Injectable()
export class RoutePlanService implements RouteKeeper, OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RoutePlanService.name);

  constructor(
    private readonly parcels: ParcelService,
    private readonly mdps: MdpService,
    private readonly routing: RoutingService,
    private readonly agents: AgentService,
    @Optional() private readonly events?: EventBus,
    @Optional() private readonly notifications?: NotificationService,
    // 2026-11-06 — where a driver carrying a parcel last was, and how long the road from there: a parcel on a vehicle.
    @Optional() private readonly fleet?: FleetService,
    @Optional() @Inject(ROUTER) private readonly router?: Router,
  ) {
    // Registered rather than asked for: routing reads the hubs, so the parcel and hub services cannot import it.
    parcels.registerRouteKeeper(this);
    mdps.registerRouteKeeper(this);
  }

  /** 2026-11-06 — the sweep asking parcels at a stop whether they can still keep their promise. Self-unref'd. */
  private stuckTimer?: ReturnType<typeof setInterval>;

  onModuleInit(): void {
    this.stuckTimer = setInterval(() => {
      try {
        this.sweepStuck();
      } catch (err) {
        this.logger.warn(`stuck sweep failed: ${(err as Error).message}`);
      }
    }, STUCK_SWEEP_MS);
    this.stuckTimer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.stuckTimer) clearInterval(this.stuckTimer);
  }

  /**
   * 2026-11-06 — A PARCEL SITTING TOO LONG AT A STOP (the owner: "go ahead"). Its people were told it would be late only
   * when its plan was made again, or once the time promised had passed. Now each parcel waiting at a shop or a hub is asked,
   * every STUCK_SWEEP_MS: leaving here now, when would it be ready? Where that is already EXPECTED_LATE_TELL_H past the
   * time it was promised, the promise cannot be kept, and its people are told at once (sayIfLate) — once, and again only
   * if it slips further. Nothing is written for a parcel still on time. Answers how many were told.
   */
  sweepStuck(now: number = Date.now()): number {
    let told = 0;
    // 2026-11-06 — the parcels at each hub found late this time: the hub is told which, to sort them first (tellHubs).
    const lateAtHub = new Map<string, Parcel[]>();
    for (const status of ['At_PUDO', 'At_MDP'] as const) {
      for (const parcel of this.parcels.list({ status })) {
        const plan = this.planOf(parcel);
        if (!plan || !parcel.destAgentDid) continue;
        const here = plan.hops[plan.at!];
        if (!here || here.type === 'dock' || plan.at === plan.hops.length - 1) continue;
        // Told of an expected time still to come: a plan made again says more, if it slips.
        if (plan.lateTold && Date.parse(plan.lateTold) > now) continue;
        let readyAt: number;
        try {
          const hub = here.type === 'mdp' ? this.routing.hubEnd(here.id) : undefined;
          readyAt = Date.parse(this.routing.planJourney({ ...(hub ? { from: hub } : { originAgentDid: here.id }), destAgentDid: parcel.destAgentDid, startAt: now }).pickupReadyAt);
        } catch {
          continue; // no route from here to read: nothing to say
        }
        if (readyAt < Date.parse(plan.pickupReadyAt) + EXPECTED_LATE_TELL_H * 3_600_000) continue;
        const before = plan.lateTold;
        plan.expectedAt = new Date(readyAt).toISOString();
        this.sayIfLate(parcel, plan);
        if (plan.lateTold !== before) {
          told += 1;
          this.parcels.notePlan(parcel);
          if (status === 'At_MDP' && parcel.atMdpId) lateAtHub.set(parcel.atMdpId, [...(lateAtHub.get(parcel.atMdpId) ?? []), parcel]);
        }
      }
    }
    // 2026-11-06 — …and each parcel ON A VEHICLE (the owner: "I follow point 1 to 6"): it reaches its next stop when the
    // road from where its driver last was says, and goes on from there — ready when? The same telling, once, and again
    // only if it slips further. A driver who has gone home with it is found here before its time has passed, not after.
    for (const parcel of this.parcels.list({ status: 'On_Bus' })) {
      const plan = this.planOf(parcel);
      if (!plan || !parcel.destAgentDid) continue;
      if (plan.lateTold && Date.parse(plan.lateTold) > now) continue;
      const readyAt = this.readyFromTheRoad(parcel, plan, now);
      if (readyAt === undefined || readyAt < Date.parse(plan.pickupReadyAt) + EXPECTED_LATE_TELL_H * 3_600_000) continue;
      const before = plan.lateTold;
      plan.expectedAt = new Date(readyAt).toISOString();
      this.sayIfLate(parcel, plan);
      if (plan.lateTold !== before) {
        told += 1;
        this.parcels.notePlan(parcel);
      }
    }
    this.tellHubs(lateAtHub, now);
    return told;
  }

  /**
   * A parcel on a vehicle: where it is going next (sent another way: there; else its plan's next stop), reached when the
   * road from its driver's last position says — a position from the last NEAR_LOCATED_H, else as if there now, which never
   * makes it later than it is — then ready when: at its own shop, when the shop is next open; at a hub or a shop on the
   * way, the plan from there. Nothing where the next stop cannot be found or no way on from it can be read.
   */
  private readyFromTheRoad(parcel: Parcel, plan: JourneyPlan, now: number): number | undefined {
    const target = plan.heading?.to ?? plan.hops[plan.at! + 1]?.id;
    if (!target) return undefined;
    const hub = this.hub(target);
    const shop = hub ? undefined : this.agents.find(target);
    const at = hub?.location ?? shop?.location;
    if (!at) return undefined; // an area, a dock, a place no longer there: no stop to reckon from
    let arrival = now;
    const driverDid = [...(parcel.custody ?? [])].reverse().find((l) => !l.to && l.holderKind === 'driver')?.holderId;
    const seen = driverDid ? this.lastSeen(driverDid) : undefined;
    if (seen && this.router && now - Date.parse(seen.at) <= NEAR_LOCATED_H * 3_600_000) {
      arrival = now + this.router.etaMinutes(seen.location, at, VEHICLE_SPEED_KMH.bus) * 60_000;
    }
    try {
      if (shop && shop.did === parcel.destAgentDid) return shop.openingHours ? nextOpenAt(shop.openingHours, new Date(arrival)).getTime() : arrival;
      const end = hub ? this.routing.hubEnd(hub.mdpId) : undefined;
      return Date.parse(this.routing.planJourney({ ...(end ? { from: end } : { originAgentDid: target }), destAgentDid: parcel.destAgentDid!, startAt: arrival }).pickupReadyAt);
    } catch {
      return undefined; // no way on from there to read: nothing to say
    }
  }

  /** Where a driver's phone last placed them: on shift, or — the day ended — where it ended. */
  private lastSeen(driverDid: string): { location: { lat: number; lng: number }; at: string } | undefined {
    if (!this.fleet) return undefined;
    const active = this.fleet.activeForDriver(driverDid);
    const a =
      active ??
      this.fleet
        .list({ status: 'ended' })
        .filter((x) => x.driverDid === driverDid)
        .sort((x, y) => Date.parse(y.endedAt ?? '') - Date.parse(x.endedAt ?? ''))[0];
    return a?.location && a.lastLocatedAt ? { location: a.location, at: a.lastLocatedAt } : undefined;
  }

  /**
   * 2026-11-06 — THE HUB HOLDING THEM, TOLD (the owner: "great, first in first out"): the parcels standing at a hub that can
   * no longer be ready in time — their people have just been told — named to the hub in its bell, the longest there first,
   * to sort first. Its list of parcels to sort is first in, first out already; these are at the front of it.
   */
  private tellHubs(lateAtHub: Map<string, Parcel[]>, now: number): void {
    if (!this.notifications) return;
    for (const [mdpId, late] of lateAtHub) {
      const hub = this.hub(mdpId);
      if (!hub) continue;
      const since = (p: Parcel) => Date.parse([...(p.scans ?? [])].reverse().find((s) => s.status === 'At_MDP')?.at ?? new Date(now).toISOString());
      const named = [...late].sort((a, b) => since(a) - since(b));
      const list = named.slice(0, 10).map((p) => `${p.parcelId} (here ${Math.max(0, Math.floor((now - since(p)) / 3_600_000))} h)`).join(', ');
      const more = named.length > 10 ? `, and ${named.length - 10} more` : '';
      void this.notifications
        .notify(hub.did, {
          kind: 'sort_first',
          title: named.length === 1 ? 'A parcel here can no longer be ready in time' : `${named.length} parcels here can no longer be ready in time`,
          body: `Sort ${named.length === 1 ? 'it' : 'them'} first, first in first out: ${list}${more}. ${named.length === 1 ? 'Its receiver has' : 'Their receivers have'} been told ${named.length === 1 ? 'it is' : 'they are'} running late.`,
          link: '/?go=sort',
          tag: `sort-first:${mdpId}:${new Date(now).toISOString().slice(0, 13)}`,
          data: { parcelIds: named.map((p) => p.parcelId) },
        })
        .catch(() => undefined);
    }
  }

  nextStop(parcel: Parcel): PlanHop | undefined {
    return nextStopOf(parcel);
  }

  offPlan(parcel: Parcel, to: string, opts: { loose?: boolean } = {}): PlanHop | undefined {
    const plan = this.planOf(parcel);
    if (!plan) return undefined;
    const next = plan.hops[plan.at! + 1];
    if (!next) return undefined; // at its last stop: nowhere further for a plan to say
    // Sent another way on purpose already: where it was said to be heading is its next step now.
    if (plan.heading && plan.heading.to === to) return undefined;
    return this.matches(next, to, opts.loose === true) ? undefined : next;
  }

  leave(parcel: Parcel, to: string, by: string, said: OffPlanSaid): void {
    const plan = this.planOf(parcel);
    if (!plan) return;
    const note = said.note?.trim().slice(0, 100) || undefined;
    this.record(plan, 'decision', plan.hops[plan.at!], plan.hops[plan.at! + 1], to, said.reason, by, note);
    plan.heading = { to, label: this.labelOf(to), reason: said.reason, ...(note ? { note } : {}) };
    this.parcels.notePlan(parcel);
  }

  arrived(parcel: Parcel, where: string, by: string): { planned: string } | undefined {
    const plan = this.planOf(parcel);
    if (!plan) return undefined;
    const at = plan.at!;
    if (plan.hops[at]?.id === where) return undefined; // scanned here again: it is where the plan already has it
    const next = plan.hops[at + 1];
    if (next?.id === where) {
      plan.at = at + 1;
      delete plan.heading;
      this.parcels.notePlan(parcel);
      return undefined;
    }
    // Somewhere it was not planned to be. Sent this way on purpose, the reason was kept when it left; nobody said so, and
    // it is kept now, for operations to see — and said to whoever received it (a hub's drop, 2026-11-06). Either way the
    // plan is made again from here.
    const unsaid = !plan.heading;
    if (unsaid) this.record(plan, 'arrival', plan.hops[at], next, where, 'arrived_elsewhere', by);
    this.remake(parcel, plan, where, 'here');
    delete plan.heading;
    this.parcels.notePlan(parcel);
    return unsaid && next ? { planned: next.label } : undefined;
  }

  redirect(parcel: Parcel, to: string, reason: OffPlanReason, by: string): void {
    const plan = this.planOf(parcel);
    if (!plan) return;
    const next = plan.hops[plan.at! + 1];
    if (!next || this.matches(next, to, false)) return; // its next stop already, or nowhere further to go
    this.record(plan, 'system', plan.hops[plan.at!], next, to, reason, by);
    this.remake(parcel, plan, to, 'next');
    this.parcels.notePlan(parcel);
  }

  /**
   * 2026-11-06 — ITS PICKUP SHOP CHANGED, its own being closed (the owner, point 6): kept as a decision — planned to the
   * closed shop, going to the one chosen — and that shop its plan's last stop. The shops offered are near the closed one, so
   * the way there is the way it was: only the end of it moves.
   */
  changeDestination(parcel: Parcel, fromDid: string, toDid: string, by: string, reason: OffPlanReason): void {
    const plan = this.planOf(parcel);
    if (!plan) return;
    const last = plan.hops[plan.hops.length - 1];
    this.record(plan, 'decision', plan.hops[plan.at!], last?.id === fromDid ? last : plan.hops[plan.at! + 1], toDid, reason, by);
    const shop = this.agents.find(toDid);
    if (last?.id === fromDid && shop) plan.hops = [...plan.hops.slice(0, -1), { type: 'pudo', id: shop.did, label: shop.shopName, zone: shop.zone }];
    if (plan.heading?.to === fromDid) delete plan.heading;
    this.parcels.notePlan(parcel);
  }

  sortTarget(parcel: Parcel, mdpId: string): { type: 'pudo' | 'mdp'; id: string; label: string; zone: string } | undefined {
    const plan = this.planOf(parcel);
    if (!plan || plan.hops[plan.at!]?.id !== mdpId) return undefined; // the plan does not have it at this hub
    const next = plan.hops[plan.at! + 1];
    if (!next) return undefined;
    if (next.type === 'pudo') return this.agents.find(next.id) ? { type: 'pudo', id: next.id, label: next.label, zone: parcel.destZone } : undefined;
    if (next.type !== 'mdp') return undefined;
    // A hub on its way is used only while it may work: one no longer approved, or in a country not open, is not sent to.
    const hub = this.hub(next.id);
    if (!hub || !this.mdps.isApproved(hub) || this.mdps.notOpenYet(hub) || this.mdps.isDown(hub)) return undefined;
    return { type: 'mdp', id: hub.mdpId, label: hub.name, zone: parcel.destZone };
  }

  /* --------------------------------------------------------------------------------------------------------- inside -- */

  private planOf(parcel: Parcel): JourneyPlan | undefined {
    return keptPlanOf(parcel);
  }

  /**
   * Whether going to `to` IS going to the next stop: the stop itself; or an area — a shop of the next stop's in it, or (in a
   * bag) the hub next serving it. A place that is not the next stop is never its equal.
   */
  private matches(next: PlanHop, to: string, loose: boolean): boolean {
    if (next.id === to) return true;
    if (this.agents.find(to) || this.hub(to)) return false; // another place
    if (next.type === 'pudo') return next.zone === to;
    if (next.type === 'mdp') return !loose && Boolean(this.hub(next.id)?.zones.includes(to));
    return false;
  }

  private record(plan: JourneyPlan, kind: OffPlanStep['kind'], here: PlanHop | undefined, next: PlanHop | undefined, took: string, reason: OffPlanReason, by: string, note?: string): void {
    const step: OffPlanStep = {
      at: new Date().toISOString(),
      kind,
      where: here?.id ?? '',
      whereLabel: here?.label ?? '',
      ...(next ? { planned: next.id, plannedLabel: next.label } : {}),
      took,
      tookLabel: this.labelOf(took),
      reason,
      ...(note ? { note } : {}),
      by,
    };
    plan.offPlan = [...(plan.offPlan ?? []), step];
  }

  /**
   * The plan made again: the stops it has reached kept as they were; then `place` — where it is now ('here', and `at` moves
   * to it) or where it is being sent ('next') — and the rest planned from there to its shop, as a new booking would be. The
   * promise stays; the new estimate is kept beside it.
   */
  private remake(parcel: Parcel, plan: JourneyPlan, place: string, as: 'here' | 'next'): void {
    const kept = plan.hops.slice(0, plan.at! + 1);
    const stop = this.hopFor(place, parcel);
    let onward: PlanHop[] = [];
    const dest = parcel.destAgentDid ? this.agents.find(parcel.destAgentDid) : undefined;
    // Planned as a new journey from there — a hub that serves its shop's area takes it straight to the shop (RoutingService
    // collapses shared hubs since 2026-11-06), as its own rule does — with the time that journey would take from now.
    if (parcel.destAgentDid && stop.type !== 'dock') {
      try {
        const hub = stop.type === 'mdp' ? this.routing.hubEnd(stop.id) : undefined;
        const j = this.routing.planJourney({ ...(hub ? { from: hub } : { originAgentDid: stop.id }), destAgentDid: parcel.destAgentDid });
        onward = j.hops.slice(1).map((h) => ({ type: h.type, id: h.id, label: h.label, zone: h.zone }));
        plan.expectedAt = j.pickupReadyAt;
      } catch (err) {
        // No route from there: straight on to its shop, which is the one thing certain about where it goes — and no estimate.
        onward = dest && dest.did !== stop.id ? [{ type: 'pudo', id: dest.did, label: dest.shopName, zone: dest.zone }] : [];
        delete plan.expectedAt;
        this.logger.warn(`plan for ${parcel.parcelId} made again without a route from ${stop.label}: ${(err as Error).message}`);
      }
    }
    plan.hops = [...kept, stop, ...onward];
    if (as === 'here') plan.at = kept.length; // it is at `stop` now
    this.sayIfLate(parcel, plan);
  }

  /**
   * 2026-11-06 — ITS PEOPLE TOLD IT WILL BE LATE, before the time it was promised comes (the owner: "build as you suggest"):
   * where its plan, made again, expects it at least EXPECTED_LATE_TELL_H after that time. Once; again only where it slips at
   * least EXPECTED_LATE_RETELL_H more. Who is told, and how, is the notice dispatcher's (ParcelExpectedLate). The promise is
   * never moved.
   */
  private sayIfLate(parcel: Parcel, plan: JourneyPlan): void {
    if (!plan.expectedAt) return;
    const expected = Date.parse(plan.expectedAt);
    if (!(expected >= Date.parse(plan.pickupReadyAt) + EXPECTED_LATE_TELL_H * 3_600_000)) return;
    if (plan.lateTold && expected < Date.parse(plan.lateTold) + EXPECTED_LATE_RETELL_H * 3_600_000) return;
    plan.lateTold = plan.expectedAt;
    void this.events?.publish(GlosEvent.Pudo.ParcelExpectedLate, { parcelId: parcel.parcelId, promisedAt: plan.pickupReadyAt, expectedAt: plan.expectedAt }, { source: 'pudo' }).catch(() => undefined);
  }

  /** A place as a stop: a shop, a hub — or an area it is heading for, standing in until it arrives somewhere. */
  private hopFor(id: string, parcel: Parcel): PlanHop {
    const shop = this.agents.find(id);
    if (shop) return { type: 'pudo', id: shop.did, label: shop.shopName, zone: shop.zone };
    const hub = this.hub(id);
    if (hub) return { type: 'mdp', id: hub.mdpId, label: hub.name, zone: hub.zones.includes(parcel.destZone) ? parcel.destZone : (hub.zones[0] ?? '') };
    return { type: 'pudo', id, label: id, zone: id };
  }

  private labelOf(id: string): string {
    return this.agents.find(id)?.shopName ?? this.hub(id)?.name ?? id;
  }

  private hub(id: string): Mdp | undefined {
    try {
      return this.mdps.require(id);
    } catch {
      return undefined;
    }
  }
}
