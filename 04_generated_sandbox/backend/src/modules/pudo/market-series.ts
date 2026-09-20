// FB4 — the market series. What was ASKED FOR, against what actually MOVED, by truck body.
//
// User, 2026-08-30: "Another slice would be analytics: how many yearly km's of flatbed offered, compared to
// km's of containers moved. In that way we become irreplaceable."
//
// The product is not the list of loads — anyone can copy a list. It is the SHAPE of a market over time, and
// nobody else holds both halves of it: what shippers needed, and what the fleet that exists could actually
// take. The gap between the two lines is the whole thesis. A body with kilometres offered and none moved is
// demand nobody is serving, which is the single most valuable sentence you can hand somebody deciding what
// truck to buy.
//
// Pure functions over plain records: no clock, no store, no service. Everything the aggregation depends on is
// an argument, so the numbers somebody invests against can be reproduced exactly.
//
// FOUR RULES, all of them about not flattering the data.
//
//  1. EMPTY KILOMETRES ARE NOT WORK. Deadhead is counted, reported, and never added into a "moved" figure.
//     Conflating them would make the headline comparison meaningless — it is the reason the loaded/deadhead
//     split was built before this.
//  2. NEVER INFER A BODY. A load whose body was guessed from weight alone is counted, and counted SEPARATELY,
//     because "we measured this" and "we guessed from the weight" are different claims. A haul carried by a
//     vehicle whose body was never recorded is 'unknown', not attributed to whatever its driver drives now.
//  3. A COUNT ALWAYS RIDES WITH A KILOMETRE. Two loads is not a market, and a km figure with no n beside it
//     invites somebody to read a fluke as a trend.
//  4. (CL3) A CLAIM ABOUT A TREND NEEDS SOMETHING TO COMPARE AGAINST. "Stretching" and "quiet" assert that a
//     market CHANGED, so each is measured against the window of equal length immediately before, and each is
//     refused outright on a thin sample rather than stated softly. A lane that never had traffic is not
//     quiet, it is empty — and calling it quiet would invent a decline nobody suffered.

import { TruckSubtype } from './fleet.config';
import { BodySeries, Freight, LaneSeries, MarketDay, MarketSeries, PriceVsStack, TimeToClaim } from './dispatch.types';
import { distanceSplit } from './pricing';
import { nearestPlaceAt } from './geo-gazetteer';
import { GeoPoint } from './pudo.types';
import { CLAIM_STRETCH_RATIO, QUIET_LANE_RATIO, THIN_MARKET_LOADS } from './pudo.config';

/** The bucket a load's kilometres land in. A real body, or the honest absence of one. */
export const UNKNOWN_BODY = 'unknown';
export type SeriesBody = TruckSubtype | typeof UNKNOWN_BODY;

/** Round to one decimal, matching every other distance this system reports. */
function r1(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 10) / 10 : 0;
}

/** Round money/ratios to two. */
export function r2(n: number): number {
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : 0;
}

/**
 * The LOADED kilometres of a load, or null when they are not known.
 *
 * Two sources, in order of authority. A claimed load carries a price breakdown whose split is what the haul
 * was actually priced on — the real, recorded number. An unclaimed one has no breakdown, so its loaded run is
 * measured from its own two ends by the caller's router.
 *
 * Returns null rather than 0 when neither is available: a load with no destination has an UNKNOWN haul, and
 * counting it as zero kilometres would quietly drag every average down.
 */
export function loadedKmOf(f: Freight, roadKm: (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => number): number | null {
  const split = distanceSplit(f.priceBreakdown);
  if (split) return split.loadedKm;
  if (!f.destLocation) return null;
  return roadKm(f.pickupLocation, f.destLocation);
}

/** Which body bucket a load's OFFERED kilometres belong to — the body it needed. */
function offeredBody(f: Freight): SeriesBody {
  return f.bodyDerived?.body ?? UNKNOWN_BODY;
}

/** Which bucket its MOVED kilometres belong to — the body that turned up. Never inferred from the driver's
 *  current coupling: an unrecorded carrier is 'unknown', which is a true statement about our records. */
function movedBody(f: Freight): SeriesBody {
  return f.carriedBy?.truckSubtype ?? UNKNOWN_BODY;
}

function inWindow(iso: string | undefined, from: number, to: number): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t >= from && t <= to;
}

/**
 * Build the series.
 *
 * `offered` is keyed on when a load was POSTED and `moved` on when it was CLAIMED, deliberately — they are
 * different events and a load can straddle the window. Asking "what was asked for in March" and "what the
 * fleet took in March" are both real questions, and forcing them onto one timestamp would answer neither.
 *
 * THE TRAP THAT FOLLOWS, and the reason `metLoads` exists: because they are two populations, `movedLoads`
 * does not complete `offeredLoads`. A screen showing moved, unmet and withdrawn under a total of what was
 * asked for reads as a partition and is not one — the three can sum to more than the total, which a live
 * sandbox promptly did (33 asked, 10 moved, 14 unmet, 11 withdrawn). `metLoads` is the figure that does
 * complete it, and take-up belongs on that one, over the population it divides.
 */
export function buildSeries(
  freights: Freight[],
  window: { from: number; to: number },
  roadKm: (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => number,
): MarketSeries {
  const rows = new Map<SeriesBody, BodySeries>();
  const row = (body: SeriesBody): BodySeries => {
    let r = rows.get(body);
    if (!r) {
      r = { body, offeredLoads: 0, offeredKm: 0, offeredMeasured: 0, movedLoads: 0, movedKm: 0, deadheadKm: 0 };
      rows.set(body, r);
    }
    return r;
  };

  let unmetLoads = 0;
  let unmetKm = 0;
  let cancelledLoads = 0;
  let metLoads = 0;

  for (const f of freights) {
    const loaded = loadedKmOf(f, roadKm);

    if (inWindow(f.createdAt, window.from, window.to)) {
      const r = row(offeredBody(f));
      r.offeredLoads += 1;
      r.offeredKm += loaded ?? 0;
      if (f.bodyDerived?.basis === 'measured') r.offeredMeasured += 1;
      // Never claimed by anybody, ever — not "not claimed yet in this window". A load posted in March and
      // taken in April was met; counting it as unmet would invent a shortfall that never existed.
      //
      // CL3 — AND A LOAD THE SHIPPER WITHDREW WAS NEVER DEMAND THE FLEET FAILED TO MEET. It used to fall
      // into `unmet` along with everything unclaimed, which over-reported scarcity in the one view built to
      // measure scarcity. Counted on its own line rather than dropped: "posted, then withdrawn" is itself a
      // fact about a market.
      //
      // THE THREE OUTCOMES ARE EXCLUSIVE AND EXHAUSTIVE, which is what makes them addable: withdrawn, or
      // never taken, or taken. A load claimed and THEN withdrawn is counted once, as withdrawn — the truck
      // did turn up, and `movedLoads` still records that, but the shipper's load did not travel and calling
      // it met would credit the fleet with work that never happened.
      if (f.status === 'cancelled') {
        cancelledLoads += 1;
      } else if (!f.claimedAt) {
        unmetLoads += 1;
        unmetKm += loaded ?? 0;
      } else {
        metLoads += 1;
      }
    }

    if (inWindow(f.claimedAt, window.from, window.to)) {
      const r = row(movedBody(f));
      r.movedLoads += 1;
      r.movedKm += loaded ?? 0;
      r.deadheadKm += distanceSplit(f.priceBreakdown)?.deadheadKm ?? 0;
    }
  }

  const bodies = [...rows.values()]
    .map((r) => ({ ...r, offeredKm: r1(r.offeredKm), movedKm: r1(r.movedKm), deadheadKm: r1(r.deadheadKm) }))
    // Busiest first by the work asked for, then by what moved, then by name — a total order, so two reads of
    // an unchanged market never come back in a different order.
    .sort((a, b) => b.offeredKm - a.offeredKm || b.movedKm - a.movedKm || String(a.body).localeCompare(String(b.body)));

  return {
    from: new Date(window.from).toISOString(),
    to: new Date(window.to).toISOString(),
    bodies,
    totals: {
      offeredLoads: bodies.reduce((s, b) => s + b.offeredLoads, 0),
      offeredKm: r1(bodies.reduce((s, b) => s + b.offeredKm, 0)),
      movedLoads: bodies.reduce((s, b) => s + b.movedLoads, 0),
      movedKm: r1(bodies.reduce((s, b) => s + b.movedKm, 0)),
      deadheadKm: r1(bodies.reduce((s, b) => s + b.deadheadKm, 0)),
      unmetLoads,
      unmetKm: r1(unmetKm),
      cancelledLoads,
      metLoads,
    },
    days: marketDays(freights, window, roadKm),
    timeToClaim: timeToClaimOf(freights, window),
    priceVsStack: priceVsStackOf(freights, window),
    lanes: lanesOf(freights, window),
  };
}

/* ------------------------------------------------------------------ CL3: scarcity -- */
//
// Everything below is DERIVED from timestamps the loads already carry. Nothing new is recorded and nobody
// fills anything in, which is the whole point: a fleet withdrawing capacity does not file a report, it just
// stops claiming — and these figures move on their own within a day.

const DAY_MS = 24 * 3_600_000;

/**
 * The median of a sample, or null when there is none.
 *
 * Median rather than mean, deliberately: one freak load that sat open over a public holiday would drag an
 * average into a claim that is true of no load in the market.
 */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** The UTC day a moment falls in. */
function dayKey(t: number): string {
  return new Date(t).toISOString().slice(0, 10);
}

/**
 * POSTED AGAINST CLAIMED, DAY BY DAY.
 *
 * The windowed totals answer "how big was this market"; only a day-by-day line answers "is it turning". And
 * every day in the window gets a row, including the silent ones — a market that stopped moving must show as
 * a run of zeroes, because omitting empty days lets a chart draw a straight line over the gap.
 */
export function marketDays(
  freights: Freight[],
  window: { from: number; to: number },
  roadKm: (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => number,
): MarketDay[] {
  const days = new Map<string, MarketDay>();
  for (let t = Date.parse(dayKey(window.from)); t <= window.to; t += DAY_MS) {
    const day = dayKey(t);
    days.set(day, { day, postedLoads: 0, claimedLoads: 0, postedKm: 0, claimedKm: 0 });
  }
  for (const f of freights) {
    const loaded = loadedKmOf(f, roadKm) ?? 0;
    if (inWindow(f.createdAt, window.from, window.to)) {
      const posted = days.get(dayKey(Date.parse(f.createdAt)));
      if (posted) {
        posted.postedLoads += 1;
        posted.postedKm += loaded;
      }
    }
    if (f.claimedAt && inWindow(f.claimedAt, window.from, window.to)) {
      const taken = days.get(dayKey(Date.parse(f.claimedAt)));
      if (taken) {
        taken.claimedLoads += 1;
        taken.claimedKm += loaded;
      }
    }
  }
  return [...days.values()].map((d) => ({ ...d, postedKm: r1(d.postedKm), claimedKm: r1(d.claimedKm) }));
}

/**
 * HOW LONG THE MARKET TOOK TO ANSWER, against the window before it.
 *
 * The earliest sign of scarcity that needs nobody to report anything: when trucks get scarce, loads still get
 * posted and still get taken — they simply wait longer first. Measured only on loads CLAIMED in the window,
 * because a load still sitting open has no time-to-claim yet, and counting its age as one would understate
 * the wait at exactly the moment it is growing.
 */
export function timeToClaimOf(freights: Freight[], window: { from: number; to: number }): TimeToClaim {
  const span = window.to - window.from;
  const waitsIn = (from: number, to: number): number[] => {
    const out: number[] = [];
    for (const f of freights) {
      if (!f.claimedAt || !f.createdAt) continue;
      const claimed = Date.parse(f.claimedAt);
      const posted = Date.parse(f.createdAt);
      if (!Number.isFinite(claimed) || !Number.isFinite(posted)) continue;
      if (claimed < from || claimed > to) continue;
      // A claim stamped before its own posting is a broken record, not a zero-hour wait.
      if (claimed < posted) continue;
      out.push((claimed - posted) / 3_600_000);
    }
    return out;
  };

  const now = waitsIn(window.from, window.to);
  const prior = waitsIn(window.from - span, window.from - 1);
  const medianHours = median(now);
  const priorMedianHours = median(prior);
  const thin = now.length < THIN_MARKET_LOADS || prior.length < THIN_MARKET_LOADS;

  return {
    medianHours: medianHours == null ? null : r2(medianHours),
    loads: now.length,
    priorMedianHours: priorMedianHours == null ? null : r2(priorMedianHours),
    priorLoads: prior.length,
    // Never asserted on a thin sample, and never without both halves of the comparison present.
    stretching: !thin && medianHours != null && priorMedianHours != null && priorMedianHours > 0 && medianHours / priorMedianHours >= CLAIM_STRETCH_RATIO,
    thin,
  };
}

/**
 * WHAT NEGOTIATED LOADS CLEARED AT, against what the rate stack said.
 *
 * Only negotiated loads can answer this, and that is the point rather than a limitation: a load taken at the
 * computed price IS the rate stack, so including those would drag every ratio towards 1 and bury the signal.
 * When a price is negotiated the breakdown keeps the COMPUTED figure and the locked price holds what the two
 * parties agreed — so the gap between them is the market saying what a truck was worth that day.
 */
export function priceVsStackOf(freights: Freight[], window: { from: number; to: number }): PriceVsStack {
  const ratios: number[] = [];
  for (const f of freights) {
    if (!f.claimedAt || !inWindow(f.claimedAt, window.from, window.to)) continue;
    if (f.priceOrigin !== 'negotiated') continue;
    const computed = f.priceBreakdown?.total;
    const agreed = f.lockedPrice;
    if (!(typeof computed === 'number' && computed > 0)) continue;
    if (!(typeof agreed === 'number' && agreed > 0)) continue;
    ratios.push(agreed / computed);
  }
  const m = median(ratios);
  return { loads: ratios.length, medianRatio: m == null ? null : r2(m), thin: ratios.length < THIN_MARKET_LOADS };
}

/** A lane end we cannot name honestly. The never-infer rule, applied to places instead of bodies. */
export const UNKNOWN_PLACE = 'unknown';

/** The coarse name AND the gazetteer's coordinate for it, in one lookup. */
function placeAt(point?: { lat: number; lng: number }): { name: string; at?: { lat: number; lng: number } } {
  if (!point) return { name: UNKNOWN_PLACE };
  const found = nearestPlaceAt(point);
  return found ? { name: found.name, at: found.location } : { name: UNKNOWN_PLACE };
}

/**
 * LANES, AND WHICH OF THEM WENT QUIET.
 *
 * A lane is named from its two ends by the same gazetteer that coarsens a pickup on the public market, so a
 * lane here reads as the same place a board row does. An end too far from anywhere we know is 'unknown'
 * rather than snapped to the nearest big town.
 */
export function lanesOf(freights: Freight[], window: { from: number; to: number }): LaneSeries[] {
  const span = window.to - window.from;
  const rows = new Map<string, LaneSeries>();
  const row = (from: { name: string; at?: GeoPoint }, to: { name: string; at?: GeoPoint }): LaneSeries => {
    const lane = from.name + ' → ' + to.name;
    let r = rows.get(lane);
    if (!r) {
      r = {
        lane,
        from: from.name,
        to: to.name,
        ...(from.at ? { fromPoint: from.at } : {}),
        ...(to.at ? { toPoint: to.at } : {}),
        postedLoads: 0,
        claimedLoads: 0,
        priorPostedLoads: 0,
        quiet: false,
        thin: true,
      };
      rows.set(lane, r);
    }
    return r;
  };

  for (const f of freights) {
    const from = placeAt(f.pickupLocation);
    const to = placeAt(f.destLocation);
    if (inWindow(f.createdAt, window.from, window.to)) row(from, to).postedLoads += 1;
    if (f.claimedAt && inWindow(f.claimedAt, window.from, window.to)) row(from, to).claimedLoads += 1;
    if (inWindow(f.createdAt, window.from - span, window.from - 1)) row(from, to).priorPostedLoads += 1;
  }

  return [...rows.values()]
    .map((r) => {
      const thin = r.postedLoads < THIN_MARKET_LOADS || r.priorPostedLoads < THIN_MARKET_LOADS;
      return {
        ...r,
        thin,
        // Quiet is a claim about a FALL, so it needs something to have fallen from.
        quiet: !thin && r.priorPostedLoads > 0 && r.postedLoads <= r.priorPostedLoads * QUIET_LANE_RATIO,
      };
    })
    .sort((a, b) => b.postedLoads - a.postedLoads || b.claimedLoads - a.claimedLoads || a.lane.localeCompare(b.lane));
}
