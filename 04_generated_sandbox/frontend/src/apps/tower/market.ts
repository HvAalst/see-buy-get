import type { MessageKey } from '../../shared/i18n';
import { haversineKm, type GeoPoint } from '../../shared/geo';
import { THIN_MARKET_LOADS, boardVsMarket, thinWindow, type MarketDay, type MarketSeriesTotals, type MarketSeriesView, type PriceVsStack } from '../../shared/market';

/**
 * CL3 — SCARCITY, as the console reads it.
 *
 * The server derives every figure from timestamps the loads already carry; nothing on this screen was
 * reported by anybody. This file shapes what the screen may SAY about those figures, and its whole job is
 * refusing to say more than the sample supports.
 *
 * The rule that shapes the rest: a claim that a market CHANGED needs something to have changed from. Where
 * the server marked a figure thin, the screen states the numbers and withholds the verdict — it never
 * softens a verdict into a hedge, because a hedged verdict still reads as a verdict.
 *
 * That rule assumes the figure and the verdict are separable, and for a count or a duration they are. For a
 * RATIO against the rate stack they are the same thing, so `priceClaim` withholds the number itself and
 * keeps only the count of loads behind it. See its own comment for what the sandbox printed.
 *
 * The TYPES and the board-versus-market question live in `shared/market` because a fleet office asks the
 * same question from the other side, and a rule copied into two apps is a rule that will eventually
 * disagree with itself about what counts as thin.
 */

export { THIN_MARKET_LOADS, boardVsMarket, thinWindow };
export type { BodySeries, LaneSeries, MarketDay, MarketSeriesTotals, MarketSeriesView, PriceVsStack, TimeToClaim } from '../../shared/market';

/* -------------------------------------------------------------------- reading -- */

/**
 * What share of the work asked for was actually taken.
 *
 * Null when nothing was asked for. A percentage with a zero denominator is not 0% — it is a question nobody
 * put, and rendering it as 0% tells a reader the fleet failed at something that never came up.
 *
 * NUMERATOR AND DENOMINATOR COME FROM ONE POPULATION, which is the whole reason `metLoads` exists. This was
 * `movedLoads / offeredLoads` and that is a ratio of two different populations: loads claimed in the window
 * over loads posted in it. A live sandbox read 30% where the loads posted in that window had in fact been
 * taken 24% of the time, and on a thinner market the same expression can exceed 100%.
 */
export function takeUp(totals: MarketSeriesTotals): number | null {
  if (!totals.offeredLoads) return null;
  return Math.round((totals.metLoads / totals.offeredLoads) * 100);
}

/**
 * The same question for one day — or for anything else that was posted and taken: a lane asks it too.
 *
 * Structural rather than typed to MarketDay, because the question is about two counts and nothing else,
 * and a second copy of this arithmetic under another name is how two places start disagreeing.
 *
 * NULL where nothing was posted. And the CALLER must still withhold it on a thin sample: a ratio IS the
 * claim, so one load out of two publishes as 50% and means nothing — the CL3 rule, which is the one
 * exception to "state the figure, withhold the verdict".
 */
export function dayTakeUp(day: { postedLoads: number; claimedLoads: number }): number | null {
  if (!day.postedLoads) return null;
  return Math.round((day.claimedLoads / day.postedLoads) * 100);
}

/**
 * WHAT THE MARKET IS DOING — and `unknown` whenever the sample cannot say.
 *
 * `tight` is asserted only on facts the server already refused to state loosely: the wait is lengthening on
 * a sample it called thick enough. `easing` needs the mirror of that. Everything else is `steady`, and a
 * window too small for any of it is `unknown` rather than quietly `steady` — "we do not know" and "nothing
 * is happening" are different sentences and only one of them is honest here.
 */
export function marketMood(series: MarketSeriesView | null): 'tight' | 'easing' | 'steady' | 'unknown' {
  if (!series || thinWindow(series.totals)) return 'unknown';
  const wait = series.timeToClaim;
  if (wait.thin || wait.medianHours == null || wait.priorMedianHours == null) return 'unknown';
  if (wait.stretching) return 'tight';
  if (wait.priorMedianHours > 0 && wait.medianHours / wait.priorMedianHours <= 0.8) return 'easing';
  return 'steady';
}

export const MOOD_LABEL: Record<'tight' | 'easing' | 'steady' | 'unknown', MessageKey> = {
  tight: 'tower.market.mood.tight',
  easing: 'tower.market.mood.easing',
  steady: 'tower.market.mood.steady',
  unknown: 'tower.market.mood.unknown',
};

/**
 * WHAT THE MARKET PAID OVER THE RATE CARD, as a percentage — and null wherever we may not say.
 *
 * Every other figure on this screen can be stated on a thin sample because the FIGURE is a fact and only the
 * verdict beside it is a claim: eighteen hours is eighteen hours, however few loads it came from. This one is
 * different. A ratio against the rate stack is itself the assertion "the market is paying X% over the card",
 * so stating it on a thin sample breaks rule 4 no matter how it is labelled — there is no number here to
 * keep once the claim is withheld, only the count of loads it would have come from.
 *
 * The sandbox made the case better than the argument does: one seeded load negotiated at 350 against a stack
 * that said 1.17 rendered as "+29,815% over the rate card" on an operator console, beside a quiet little tag
 * saying the sample was thin. Nobody reads the tag instead of the number.
 *
 * The server still publishes the ratio, and should — `market/series` is public and a consumer with their own
 * judgement is entitled to the raw figure. This is the console deciding what it is willing to SAY.
 */
export function priceClaim(price: PriceVsStack | undefined): number | null {
  if (!price || price.thin || price.medianRatio == null) return null;
  return Math.round((price.medianRatio - 1) * 100);
}

/** Lanes that fell away, busiest first. The server decides `quiet`; this only selects. */
export function quietLanes<T extends { quiet: boolean }>(lanes: T[]): T[] {
  return lanes.filter((l) => l.quiet);
}

/** The lanes worth showing at all — busiest first, and never an endless tail. */
export function topLanes<T>(lanes: T[], limit = 8): T[] {
  return lanes.slice(0, limit);
}

/* --------------------------------------------------- finding a lane among many -- */

/** The shape of a lane this file needs. Kept minimal so the tests do not have to build a whole series. */
export interface LanePlaces {
  lane: string;
  from: string;
  to: string;
  fromPoint?: GeoPoint;
  toPoint?: GeoPoint;
}

/** Can this lane be drawn at all? Both ends have to be somewhere the gazetteer could name. */
export function lanePlottable(lane: LanePlaces): boolean {
  return Boolean(lane.fromPoint && lane.toPoint);
}

/**
 * Lanes with EITHER end within a radius of a place.
 *
 * Either end, not just the start, and the control has to say so. A haulier looking at Nakuru wants the
 * loads leaving Nakuru and the loads arriving there — half a market is not a market, and a filter whose
 * name says "from" while it means "touching" is worse than either.
 *
 * A LANE WITH AN UNPLACEABLE END IS NOT SILENTLY DROPPED. It is excluded from the radius, because we
 * genuinely do not know whether it is near, and the caller is expected to say how many were set aside
 * that way. An unknown end is a fact about a load nobody could locate, not an absence of one.
 */
export function lanesNear<T extends LanePlaces>(lanes: T[], centre: GeoPoint, km: number): T[] {
  return lanes.filter((l) => {
    const ends = [l.fromPoint, l.toPoint].filter(Boolean) as GeoPoint[];
    return ends.some((p) => haversineKm(centre, p) <= km);
  });
}

/**
 * THE PLACES THIS MARKET ACTUALLY TOUCHES, as somewhere to measure a radius from.
 *
 * Derived from the lane ends rather than offered as a search box over a gazetteer, and that is the
 * better control as well as the cheaper one: typing a town no lane reaches returns an empty list and
 * no explanation, while a list of the places the market runs through cannot name one it does not.
 *
 * ALPHABETICAL, never by traffic. A picker ordered by size is a ranking, and this product does not
 * publish rankings of the places it serves.
 */
export function laneEnds<T extends LanePlaces>(lanes: T[]): { name: string; point: GeoPoint }[] {
  const seen = new Map<string, GeoPoint>();
  for (const l of lanes) {
    if (l.fromPoint) seen.set(l.from, l.fromPoint);
    if (l.toPoint) seen.set(l.to, l.toPoint);
  }
  return [...seen.entries()].map(([name, point]) => ({ name, point })).sort((a, b) => a.name.localeCompare(b.name));
}

/** How many of these could not be judged against a radius, because an end has no place. */
export function lanesUnplaceable<T extends LanePlaces>(lanes: T[]): number {
  return lanes.filter((l) => !l.fromPoint && !l.toPoint).length;
}

/**
 * A lane's share of the busiest lane's traffic, 0..1 — the stroke weight on the map.
 *
 * Against the BUSIEST OF WHAT IS SHOWN rather than an absolute scale, for the same reason the two-line
 * chart shares one scale: a relative weight answers "which of these is the big one", which is the only
 * question a stroke width can honestly answer.
 */
export function laneWeights<T extends { postedLoads: number }>(lanes: T[]): (l: T) => number {
  const peak = lanes.reduce((m, l) => Math.max(m, l.postedLoads), 0);
  return (l) => (peak > 0 ? l.postedLoads / peak : 0);
}

/**
 * Heights for a bare two-line chart, 0..1, scaled against the busiest day in the window.
 *
 * Both lines share ONE scale on purpose: drawing posted and claimed against separate maxima would make a day
 * where nothing moved look identical to a day where everything did.
 */
export function chartPoints(days: MarketDay[]): Array<{ day: string; posted: number; claimed: number }> {
  const peak = days.reduce((m, d) => Math.max(m, d.postedLoads, d.claimedLoads), 0);
  return days.map((d) => ({
    day: d.day,
    posted: peak ? d.postedLoads / peak : 0,
    claimed: peak ? d.claimedLoads / peak : 0,
  }));
}
