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
// THREE RULES, all of them about not flattering the data.
//
//  1. EMPTY KILOMETRES ARE NOT WORK. Deadhead is counted, reported, and never added into a "moved" figure.
//     Conflating them would make the headline comparison meaningless — it is the reason the loaded/deadhead
//     split was built before this.
//  2. NEVER INFER A BODY. A load whose body was guessed from weight alone is counted, and counted SEPARATELY,
//     because "we measured this" and "we guessed from the weight" are different claims. A haul carried by a
//     vehicle whose body was never recorded is 'unknown', not attributed to whatever its driver drives now.
//  3. A COUNT ALWAYS RIDES WITH A KILOMETRE. Two loads is not a market, and a km figure with no n beside it
//     invites somebody to read a fluke as a trend.

import { TruckSubtype } from './fleet.config';
import { BodySeries, Freight, MarketSeries } from './dispatch.types';
import { distanceSplit } from './pricing';

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

  for (const f of freights) {
    const loaded = loadedKmOf(f, roadKm);

    if (inWindow(f.createdAt, window.from, window.to)) {
      const r = row(offeredBody(f));
      r.offeredLoads += 1;
      r.offeredKm += loaded ?? 0;
      if (f.bodyDerived?.basis === 'measured') r.offeredMeasured += 1;
      // Never claimed by anybody, ever — not "not claimed yet in this window". A load posted in March and
      // taken in April was met; counting it as unmet would invent a shortfall that never existed.
      if (!f.claimedAt) {
        unmetLoads += 1;
        unmetKm += loaded ?? 0;
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
    },
  };
}
