/**
 * CL3 — the market series, and the one question two different apps ask of it.
 *
 * Shared rather than duplicated: the operator console reads this to describe the market, and a fleet office
 * reads it to find out whether an empty dispatch board is the market's doing or its own reach. Those are the
 * same rule seen from two sides, and a rule copied into two apps is a rule that will eventually disagree
 * with itself about what counts as thin.
 */

/** Mirrors THIN_MARKET_LOADS in the backend config. Kept in step deliberately: a screen must not call a
 *  market thin at a different threshold from the one the server used to set its own flags. */
export const THIN_MARKET_LOADS = 5;

export interface BodySeries {
  body: string;
  offeredLoads: number;
  offeredKm: number;
  offeredMeasured: number;
  movedLoads: number;
  movedKm: number;
  deadheadKm: number;
}

export interface MarketSeriesTotals {
  offeredLoads: number;
  offeredKm: number;
  movedLoads: number;
  movedKm: number;
  deadheadKm: number;
  unmetLoads: number;
  unmetKm: number;
  /** Posted and then withdrawn by the shipper — counted, and deliberately not inside `unmetLoads`. */
  cancelledLoads: number;
  /**
   * Posted in the window, still standing, and taken by somebody.
   *
   * The only figure that completes what was asked for: `metLoads + unmetLoads + cancelledLoads ===
   * offeredLoads`, always. `movedLoads` counts loads CLAIMED in the window whenever they were posted, so it
   * answers a different question over a different population and must never be shown as the third number
   * under a total of what was asked for.
   */
  metLoads: number;
}

export interface MarketDay {
  day: string;
  postedLoads: number;
  claimedLoads: number;
  postedKm: number;
  claimedKm: number;
}

export interface TimeToClaim {
  medianHours: number | null;
  loads: number;
  priorMedianHours: number | null;
  priorLoads: number;
  stretching: boolean;
  thin: boolean;
}

export interface PriceVsStack {
  loads: number;
  medianRatio: number | null;
  thin: boolean;
}

export interface LaneSeries {
  lane: string;
  from: string;
  to: string;
  postedLoads: number;
  claimedLoads: number;
  priorPostedLoads: number;
  quiet: boolean;
  thin: boolean;
}

/** `GET /v1/sbg/market/series` — public, and derived entirely from timestamps the loads already carry. */
export interface MarketSeriesView {
  from: string;
  to: string;
  bodies: BodySeries[];
  totals: MarketSeriesTotals;
  days: MarketDay[];
  timeToClaim: TimeToClaim;
  priceVsStack: PriceVsStack;
  lanes: LaneSeries[];
}

/** Is the whole window too small to carry a claim about the market's direction? */
export function thinWindow(totals: MarketSeriesTotals): boolean {
  return totals.offeredLoads < THIN_MARKET_LOADS;
}

/**
 * IS A THIN BOARD THE MARKET'S DOING, OR THIS OFFICE'S REACH?
 *
 * The question a dispatcher actually has when the screen is empty, and the one thing a per-driver view can
 * never answer on its own — it only ever shows loads this driver could be sent to, so an empty board looks
 * identical whether the market died or the radius is too tight.
 *
 * `unknown` where the market sample cannot answer it either. That is the honest reply, and far better than
 * blaming a radius for a quiet week or a quiet week for a radius.
 */
export function boardVsMarket(rowsOnBoard: number, series: MarketSeriesView | null): 'market-thin' | 'board-thin' | 'market-busy' | 'unknown' {
  if (!series || thinWindow(series.totals)) return 'unknown';
  const postedLately = series.days.slice(-7).reduce((sum, d) => sum + d.postedLoads, 0);
  if (postedLately < THIN_MARKET_LOADS) return 'market-thin';
  return rowsOnBoard === 0 ? 'board-thin' : 'market-busy';
}
