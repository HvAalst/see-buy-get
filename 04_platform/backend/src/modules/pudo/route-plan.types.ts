import type { Parcel } from './pudo.types';

/**
 * 2026-11-06 — ONE PLAN PER PARCEL, ASKED AT EVERY HAND-OVER (movement unification; the owner: "build the whole thing").
 *
 * The shapes shared by the services a parcel passes through. Kept in a file of their own, with no service imported, so the
 * parcel and hub services can name them without the cycle that importing routing would close (routing reads the hubs).
 */

/** Why a parcel went another way than its plan. The first four are said by whoever hands it over; the rest by the system. */
export const HUMAN_OFF_PLAN_REASONS = ['no_transport', 'hub_full', 'faster', 'other'] as const;
// 2026-11-06 — 'done_offline': handed over or bagged on a phone with no signal, and heard of afterwards — the parcel had
// gone by then, so it is recorded, never refused (pudo.controller offPlanSaid; the outbox's Sbg-Queued-At).
export const OFF_PLAN_REASONS = [...HUMAN_OFF_PLAN_REASONS, 'room', 'arrived_elsewhere', 'network_changed', 'priced_other_way', 'done_offline'] as const;
export type OffPlanReason = (typeof OFF_PLAN_REASONS)[number];
export type HumanOffPlanReason = (typeof HUMAN_OFF_PLAN_REASONS)[number];

/** One stop of a plan: a shop, a hub, or a store's dock. */
export interface PlanHop {
  type: 'pudo' | 'mdp' | 'dock';
  id: string;
  label: string;
  zone: string;
}

/**
 * A step a parcel took that its plan did not say.
 *
 * decision — somebody sent it another way, and said why (a counter, a shop's bag);
 * arrival — it reached a place that was not its next stop, with nobody having said so beforehand;
 * system — the network sent it another way: a full hub, a hub no longer to be used, or a route that changed between the
 * booking and the take-in.
 */
export class OffPlanStep {
  at!: string;
  kind!: 'decision' | 'arrival' | 'system';
  /** Where it was when it went another way. */
  where!: string;
  whereLabel!: string;
  /** Its next stop by the plan, and where it went instead. */
  planned?: string;
  plannedLabel?: string;
  took!: string;
  tookLabel!: string;
  reason!: OffPlanReason;
  /** In their own words, where the reason was "other" — short. */
  note?: string;
  by!: string;
}

/** What a reasoned hand-over off the plan carries: one of the four reasons, and a few words for "other". */
export interface OffPlanSaid {
  /** Said by whoever did it — or, done on a phone with no signal, 'done_offline' (nobody could be asked then). */
  reason: HumanOffPlanReason | 'done_offline';
  note?: string;
}

/**
 * 2026-11-06 — WHY A PARCEL WENT ANOTHER WAY THAN ITS PLAN, as the counter or hub said it — or, sent afterwards by a phone
 * that had no signal (the outbox marks it: Sbg-Queued-At), "done without a signal": the parcel had gone by the time we heard,
 * and refusing it then would only leave the record behind the parcel. Recorded on it, and its plan made again from there.
 */
export function offPlanSaid(dto: { offPlanReason?: HumanOffPlanReason; offPlanNote?: string }, queuedAt?: string): OffPlanSaid | undefined {
  if (dto.offPlanReason) return { reason: dto.offPlanReason, ...(dto.offPlanNote ? { note: dto.offPlanNote } : {}) };
  return queuedAt ? { reason: 'done_offline' } : undefined;
}

/**
 * THE PLAN'S KEEPER, as the parcel and hub services see it (RoutePlanService implements it and registers itself, as the bag
 * plan registers the next hop). Every method is a no-op for a parcel with no plan yet, or one planned before plans were
 * kept stop by stop (no `at`): those move as they always did.
 */
export interface RouteKeeper {
  /** Its next stop by the plan, or nothing where it has no plan to say. */
  nextStop(parcel: Parcel): PlanHop | undefined;
  /**
   * Leaving for `to` — a hub's id, a shop's DID, or an area: nothing when that is its next stop, else the stop it should go
   * to. An area stands for a shop in it, or a hub that serves it — except `loose` (onto a bus by the counter, no bag): a bus
   * to an area takes it to a shop there, never through a hub, so only a shop in that area is its next stop.
   */
  offPlan(parcel: Parcel, to: string, opts?: { loose?: boolean }): PlanHop | undefined;
  /** Sent another way on purpose, with the reason said: recorded, and where it is heading kept until it arrives. */
  leave(parcel: Parcel, to: string, by: string, said: OffPlanSaid): void;
  /**
   * Arrived at a hub or a shop: the plan moves on, or — somewhere else — is made again from here, and that is recorded.
   * Somewhere it was not planned, nobody having said why: the stop it was planned for, so whoever received it is told.
   */
  arrived(parcel: Parcel, where: string, by: string): { planned: string } | undefined;
  /** The network sends it to `to` instead of its next stop (a full hub, a hub no longer used): recorded, the plan made again. */
  redirect(parcel: Parcel, to: string, reason: OffPlanReason, by: string): void;
  /** At a hub, sorting: the plan's next stop where it can still be used — else nothing, and the hub chooses as it always did. */
  sortTarget(parcel: Parcel, mdpId: string): { type: 'pudo' | 'mdp'; id: string; label: string; zone: string } | undefined;
}
