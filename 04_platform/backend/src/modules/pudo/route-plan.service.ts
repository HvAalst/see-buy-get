import { Injectable, Logger } from '@nestjs/common';
import { AgentService } from './agent.service';
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
export class RoutePlanService implements RouteKeeper {
  private readonly logger = new Logger(RoutePlanService.name);

  constructor(
    private readonly parcels: ParcelService,
    private readonly mdps: MdpService,
    private readonly routing: RoutingService,
    private readonly agents: AgentService,
  ) {
    // Registered rather than asked for: routing reads the hubs, so the parcel and hub services cannot import it.
    parcels.registerRouteKeeper(this);
    mdps.registerRouteKeeper(this);
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

  arrived(parcel: Parcel, where: string, by: string): void {
    const plan = this.planOf(parcel);
    if (!plan) return;
    const at = plan.at!;
    if (plan.hops[at]?.id === where) return; // scanned here again: it is where the plan already has it
    const next = plan.hops[at + 1];
    if (next?.id === where) {
      plan.at = at + 1;
      delete plan.heading;
      this.parcels.notePlan(parcel);
      return;
    }
    // Somewhere it was not planned to be. Sent this way on purpose, the reason was kept when it left; nobody said so, and
    // it is kept now, for operations to see. Either way the plan is made again from here.
    if (!plan.heading) this.record(plan, 'arrival', plan.hops[at], next, where, 'arrived_elsewhere', by);
    this.remake(parcel, plan, where, 'here');
    delete plan.heading;
    this.parcels.notePlan(parcel);
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

  sortTarget(parcel: Parcel, mdpId: string): { type: 'pudo' | 'mdp'; id: string; label: string; zone: string } | undefined {
    const plan = this.planOf(parcel);
    if (!plan || plan.hops[plan.at!]?.id !== mdpId) return undefined; // the plan does not have it at this hub
    const next = plan.hops[plan.at! + 1];
    if (!next) return undefined;
    if (next.type === 'pudo') return this.agents.find(next.id) ? { type: 'pudo', id: next.id, label: next.label, zone: parcel.destZone } : undefined;
    if (next.type !== 'mdp') return undefined;
    // A hub on its way is used only while it may work: one no longer approved, or in a country not open, is not sent to.
    const hub = this.hub(next.id);
    if (!hub || !this.mdps.isApproved(hub) || this.mdps.notOpenYet(hub)) return undefined;
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
    // A hub serving the area of its shop sends it straight there — the hub's own rule (MdpService.nextHop). Planned as a new
    // journey from a hub, it would go through that area's first hub instead, a stop it does not need.
    if (dest && stop.type === 'mdp' && this.hub(stop.id)?.zones.includes(dest.zone)) {
      onward = [{ type: 'pudo', id: dest.did, label: dest.shopName, zone: dest.zone }];
    } else if (parcel.destAgentDid && stop.type !== 'dock') {
      try {
        const hub = stop.type === 'mdp' ? this.routing.hubEnd(stop.id) : undefined;
        const j = this.routing.planJourney({ ...(hub ? { from: hub } : { originAgentDid: stop.id }), destAgentDid: parcel.destAgentDid });
        onward = j.hops.slice(1).map((h) => ({ type: h.type, id: h.id, label: h.label, zone: h.zone }));
        plan.expectedAt = j.pickupReadyAt;
      } catch (err) {
        // No route from there: straight on to its shop, which is the one thing certain about where it goes.
        onward = dest && dest.did !== stop.id ? [{ type: 'pudo', id: dest.did, label: dest.shopName, zone: dest.zone }] : [];
        this.logger.warn(`plan for ${parcel.parcelId} made again without a route from ${stop.label}: ${(err as Error).message}`);
      }
    }
    plan.hops = [...kept, stop, ...onward];
    if (as === 'here') plan.at = kept.length; // it is at `stop` now
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
