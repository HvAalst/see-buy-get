import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { randomBytes } from 'crypto';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { AgentService } from './agent.service';
import { ParcelService } from './parcel.service';
import { hashPhone } from '../../foundation/identity/phone';
import { PersistentMap } from '../../foundation/store/persistent-map';

/** REP1 — below this rating count a public reputation reads as "New" rather than a headline average: a
 *  mean of one review is noise, and a lone 1-star (or 5-star) must not brand a provider. Mirrors the
 *  priceBand "never benchmark against a median of one" lesson. */
export const MIN_PUBLIC_RATINGS = 3;

/** REP4 — the ENFORCING floor: a provider whose RELIABLE rating (enough ratings, not cold-start) falls below
 *  this faces a consequence (a poorly-rated driver loses the freight marketplace; low-rated providers surface
 *  for operator review). Set below the midpoint so only genuinely bad service bites. */
export const RATING_FLOOR = 2.5;

/** REP4 — is this rating below the enforcing floor? COLD-START SAFE: a provider without enough ratings (isNew)
 *  is NEVER enforced against, so a lone bad review can't bar anyone and a newcomer is never penalised. */
export function belowFloor(rating: { average: number; isNew: boolean }): boolean {
  return !rating.isNew && rating.average < RATING_FLOOR;
}

export interface RatingRecord {
  id: string;
  parcelId: string;
  agentDid: string;
  stars: number; // 1–5
  raterHash: string; // REP1 — the rater's phone HASH, never the cleartext (the record is PII-at-rest otherwise)
  at: string;
}

/** REP1 — the PII-free public rating a reputation surface shows: the aggregate only, plus a cold-start flag. */
export interface PublicRating {
  agentDid: string; // the subject's did — an AGENT (REP1) or a DRIVER (REP2); the field name is kept for compat
  average: number; // 0 when unrated; the field the whole frontend already reads (was mis-named `stars`)
  count: number;
  isNew: boolean; // count < MIN_PUBLIC_RATINGS → show "New", not a headline average
}

/** REP2 — the specific driver failings an agent can flag alongside the star rating (the movement leg the
 *  agent actually witnesses: pickup punctuality, on-time / after-hours arrival, overnight holds, care and
 *  equipment). Advisory now; a later slice can weigh these into an enforcing routing/eligibility gate. */
export const DRIVER_ISSUES = ['LATE_PICKUP', 'LATE_ARRIVAL', 'KEPT_OVERNIGHT', 'AFTER_HOURS', 'EQUIPMENT_FAILURE', 'ROUGH_HANDLING'] as const;
export type DriverIssue = (typeof DRIVER_ISSUES)[number];

/** REP2 — one agent's rating of one driver (last-wins per agent↔driver pair). By-agent, never a phone. */
export interface DriverRatingRecord {
  id: string;
  driverDid: string;
  byAgentDid: string;
  stars: number; // 1–5
  issues: DriverIssue[];
  at: string;
  /** FP6 — set when the rating is the shipper's verdict on ONE delivered load (last-wins per load, not per pair). */
  freightId?: string;
}

/**
 * RatingService (P-008, ↔ M5 TRL light + graduation). PUDO Light reputation is a single 0–5 star
 * rating per delivered parcel plus an agent-retention metric — no Bayesian prior, no portable VC.
 * Crucially it writes the agent's running composite back to the **shared OperationalStore**, the same
 * pseudonymous core M5/M3 read, so the rating data graduates onto GLOS-grade reputation with no
 * schema migration (Compendium Ch 8 mapping).
 */
@Injectable()
export class RatingService {
  /*
   * EVERY RATING IS KEPT. They were held in memory alone while their average was written to the core: a restart wiped
   * them, reset each count, and lifted the bar that keeps a driver rated below the floor off freight. The tallies are
   * worked out from the kept ratings when the service starts, and kept in step as ratings come in.
   */
  private readonly ratings = new PersistentMap<string, RatingRecord>('pudo-ratings');
  private readonly tally = new Map<string, { sum: number; count: number }>(); // agentDid → stars
  // REP2 — driver reputation lives in its own store (rated BY agents, not by phone), aggregated the same way.
  private readonly driverRatings = new PersistentMap<string, DriverRatingRecord>('pudo-driver-ratings');
  private readonly driverTally = new Map<string, { sum: number; count: number }>(); // driverDid → stars

  constructor(
    private readonly parcels: ParcelService,
    private readonly agents: AgentService,
    private readonly core: OperationalStore,
    private readonly events: EventBus,
  ) {
    const add = (tally: Map<string, { sum: number; count: number }>, did: string, stars: number) => {
      const t = tally.get(did) ?? { sum: 0, count: 0 };
      tally.set(did, { sum: t.sum + stars, count: t.count + 1 });
    };
    for (const r of this.ratings.values()) add(this.tally, r.agentDid, r.stars);
    for (const r of this.driverRatings.values()) add(this.driverTally, r.driverDid, r.stars);
  }

  /** Rate a delivered parcel (1–5 stars). Updates the agent composite + writes it to the core. */
  rate(input: { parcelId: string; stars: number; raterMobile: string }): { rating: RatingRecord; agentComposite: number } {
    const parcel = this.parcels.get(input.parcelId);
    if (parcel.status !== 'Delivered') throw new GlosError('INVALID_STATE', 'Only a delivered parcel can be rated');
    if (!(input.stars >= 1 && input.stars <= 5)) throw new GlosError('INVALID_RATING', 'Stars must be 1–5');

    // The shop being rated. Normally the origin (which is what this has always used); when a parcel had no
    // origin shop at all — collected from a store's own dock — the only shop that served it is the one the
    // customer collected from, so the rating goes there rather than nowhere.
    const agentDid = parcel.originAgentDid ?? parcel.destAgentDid;
    if (!agentDid) throw new GlosError('INVALID_STATE', 'This parcel passed through no shop — there is nobody to rate');
    const raterHash = hashPhone(input.raterMobile) || 'anon'; // never store the cleartext number
    const now = new Date().toISOString();

    // REP1 — one rating per parcel: a re-rating REPLACES the earlier one (last-wins), it never adds a second
    // vote. Without this a buyer (or a script) could POST the same parcel's rating repeatedly and inflate both
    // the count and the average. The tally is adjusted by the delta, not re-incremented.
    const existing = [...this.ratings.values()].find((r) => r.parcelId === input.parcelId);
    let record: RatingRecord;
    const t = this.tally.get(agentDid) ?? { sum: 0, count: 0 };
    if (existing) {
      t.sum += input.stars - existing.stars; // count unchanged — same single vote, new value
      existing.stars = input.stars;
      existing.raterHash = raterHash;
      existing.at = now;
      record = existing;
    } else {
      record = { id: `rat_${randomBytes(6).toString('hex')}`, parcelId: input.parcelId, agentDid, stars: input.stars, raterHash, at: now };
      t.sum += input.stars;
      t.count += 1;
    }
    this.ratings.set(record.id, record);
    this.tally.set(agentDid, t);
    const composite = Math.round((t.sum / t.count) * 100) / 100;

    // Graduation: write the composite to the shared operational core (what M3/M5 match on).
    this.core.updateReputation(agentDid, composite);
    void this.events.publish(GlosEvent.Reputation.RatingSubmitted, { subjectDid: agentDid, parcelId: input.parcelId, stars: input.stars }, { source: 'pudo' }).catch(() => undefined);
    void this.events.publish(GlosEvent.Reputation.ScoreUpdated, { subjectDid: agentDid, composite }, { source: 'pudo' }).catch(() => undefined);
    return { rating: record, agentComposite: composite };
  }

  /** Shared aggregate → the PII-free PublicRating for any subject (agent or driver). */
  private aggregate(tally: Map<string, { sum: number; count: number }>, subjectDid: string): PublicRating {
    const t = tally.get(subjectDid) ?? { sum: 0, count: 0 };
    return {
      agentDid: subjectDid,
      average: t.count ? Math.round((t.sum / t.count) * 100) / 100 : 0,
      count: t.count,
      isNew: t.count < MIN_PUBLIC_RATINGS,
    };
  }

  agentRating(agentDid: string): PublicRating {
    return this.aggregate(this.tally, agentDid);
  }

  /** REP2 — the driver's PII-free public rating (aggregate + cold-start flag), same shape as an agent's. */
  driverRating(driverDid: string): PublicRating {
    return this.aggregate(this.driverTally, driverDid);
  }

  /**
   * REP3 — a FLEET's DERIVED rating: the count-weighted aggregate of its drivers' ratings (all their stars
   * over the total number of ratings), with the same cold-start rule. A fleet is only as good as the drivers
   * it fields, and a fleet with 30 ratings across its drivers is more trustworthy than one with 2 — so weight
   * by volume, not a mean-of-means. The caller supplies the fleet's driver DIDs (it owns the roster).
   */
  fleetRating(fleetDid: string, driverDids: string[]): PublicRating {
    let sum = 0;
    let count = 0;
    for (const did of driverDids) {
      const t = this.driverTally.get(did);
      if (t) {
        sum += t.sum;
        count += t.count;
      }
    }
    return { agentDid: fleetDid, average: count ? Math.round((sum / count) * 100) / 100 : 0, count, isNew: count < MIN_PUBLIC_RATINGS };
  }

  /**
   * REP2 — an AGENT rates a DRIVER on the movement leg. ONE rating per (agent, driver) pair, last-wins: the
   * agent's standing opinion of that driver, updatable — never a second vote (so one agent can't ballot-stuff
   * a driver up or down). The CALLER must first prove the agent actually handed to / received from the driver
   * (the verified-interaction gate). Writes the driver composite to the shared reputation core, exactly like an
   * agent rating graduates. `issues` are validated against DRIVER_ISSUES (unknown tags are dropped).
   */
  rateDriver(input: { driverDid: string; byAgentDid: string; stars: number; issues?: DriverIssue[] }): { rating: DriverRatingRecord; driverComposite: number } {
    if (!(input.stars >= 1 && input.stars <= 5)) throw new GlosError('INVALID_RATING', 'Stars must be 1–5');
    const issues = [...new Set((input.issues ?? []).filter((i) => DRIVER_ISSUES.includes(i)))];
    const now = new Date().toISOString();

    const existing = [...this.driverRatings.values()].find((r) => r.driverDid === input.driverDid && r.byAgentDid === input.byAgentDid);
    let record: DriverRatingRecord;
    const t = this.driverTally.get(input.driverDid) ?? { sum: 0, count: 0 };
    if (existing) {
      t.sum += input.stars - existing.stars; // count unchanged — the same agent's single vote, revised
      existing.stars = input.stars;
      existing.issues = issues;
      existing.at = now;
      record = existing;
    } else {
      record = { id: `drt_${randomBytes(6).toString('hex')}`, driverDid: input.driverDid, byAgentDid: input.byAgentDid, stars: input.stars, issues, at: now };
      t.sum += input.stars;
      t.count += 1;
    }
    this.driverRatings.set(record.id, record);
    this.driverTally.set(input.driverDid, t);
    const composite = Math.round((t.sum / t.count) * 100) / 100;

    this.core.updateReputation(input.driverDid, composite); // graduation, same as an agent rating
    void this.events.publish(GlosEvent.Reputation.RatingSubmitted, { subjectDid: input.driverDid, byAgentDid: input.byAgentDid, stars: input.stars }, { source: 'pudo' }).catch(() => undefined);
    void this.events.publish(GlosEvent.Reputation.ScoreUpdated, { subjectDid: input.driverDid, composite }, { source: 'pudo' }).catch(() => undefined);
    return { rating: record, driverComposite: composite };
  }

  /**
   * FP6 — the SHIPPER rates the carrier on a delivered load. One rating per LOAD, last wins: a shop that
   * ships ten loads with the same driver has ten verdicts, one each, because each haul was its own job —
   * the per-pair rule above is for the standing counter relationship, not for freight. Counts toward the
   * driver's composite exactly like a counter rating, so a fleet's derived rating reads its hauls too. The
   * CALLER proves the rater shipped the load and that it was delivered; this only keeps the arithmetic honest.
   */
  rateFreight(input: { freightId: string; driverDid: string; byDid: string; stars: number; issues?: DriverIssue[] }): { rating: DriverRatingRecord; driverComposite: number } {
    if (!(input.stars >= 1 && input.stars <= 5)) throw new GlosError('INVALID_RATING', 'Stars must be 1–5');
    const issues = [...new Set((input.issues ?? []).filter((i) => DRIVER_ISSUES.includes(i)))];
    const now = new Date().toISOString();
    const existing = [...this.driverRatings.values()].find((r) => r.freightId === input.freightId);
    let record: DriverRatingRecord;
    const t = this.driverTally.get(input.driverDid) ?? { sum: 0, count: 0 };
    if (existing) {
      t.sum += input.stars - existing.stars;
      existing.stars = input.stars;
      existing.issues = issues;
      existing.at = now;
      record = existing;
    } else {
      record = { id: `drt_${randomBytes(6).toString('hex')}`, driverDid: input.driverDid, byAgentDid: input.byDid, stars: input.stars, issues, at: now, freightId: input.freightId };
      t.sum += input.stars;
      t.count += 1;
    }
    this.driverRatings.set(record.id, record);
    this.driverTally.set(input.driverDid, t);
    const composite = Math.round((t.sum / t.count) * 100) / 100;
    this.core.updateReputation(input.driverDid, composite);
    void this.events.publish(GlosEvent.Reputation.RatingSubmitted, { subjectDid: input.driverDid, byAgentDid: input.byDid, stars: input.stars, freightId: input.freightId }, { source: 'pudo' }).catch(() => undefined);
    void this.events.publish(GlosEvent.Reputation.ScoreUpdated, { subjectDid: input.driverDid, composite }, { source: 'pudo' }).catch(() => undefined);
    return { rating: record, driverComposite: composite };
  }

  /** REP2 — the ratings a driver has received (operator/analytics; PII-free — by-agent + issue tags, no phone). */
  driverRatingsFor(driverDid: string): DriverRatingRecord[] {
    return [...this.driverRatings.values()].filter((r) => r.driverDid === driverDid).reverse();
  }

  /** Network agent-retention metric: share of onboarded agents still ACTIVE (steel-thread KPI). */
  retention(): { activeShare: number; active: number; total: number } {
    const all = this.agents.list();
    const active = all.filter((a) => a.status === 'ACTIVE').length;
    return { activeShare: all.length ? Math.round((active / all.length) * 100) / 100 : 0, active, total: all.length };
  }

  list(): RatingRecord[] {
    return [...this.ratings.values()].reverse();
  }
}
