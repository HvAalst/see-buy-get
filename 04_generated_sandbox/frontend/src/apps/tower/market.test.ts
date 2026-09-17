import { describe, expect, it } from 'vitest';
import {
  boardVsMarket,
  chartPoints,
  dayTakeUp,
  marketMood,
  priceClaim,
  quietLanes,
  takeUp,
  thinWindow,
  topLanes,
  type LaneSeries,
  type MarketDay,
  type MarketSeriesTotals,
  type MarketSeriesView,
} from './market';

const totals = (over: Partial<MarketSeriesTotals> = {}): MarketSeriesTotals => ({
  offeredLoads: 40,
  offeredKm: 4000,
  movedLoads: 30,
  movedKm: 3000,
  deadheadKm: 500,
  unmetLoads: 10,
  unmetKm: 1000,
  cancelledLoads: 0,
  metLoads: 30,
  ...over,
});

const day = (over: Partial<MarketDay> = {}): MarketDay => ({ day: '2026-06-01', postedLoads: 0, claimedLoads: 0, postedKm: 0, claimedKm: 0, ...over });

const lane = (over: Partial<LaneSeries> = {}): LaneSeries => ({
  lane: 'Nairobi → Mombasa',
  from: 'Nairobi',
  to: 'Mombasa',
  postedLoads: 10,
  claimedLoads: 8,
  priorPostedLoads: 10,
  quiet: false,
  thin: false,
  ...over,
});

const view = (over: Partial<MarketSeriesView> = {}): MarketSeriesView => ({
  from: '2026-06-01T00:00:00.000Z',
  to: '2026-07-01T00:00:00.000Z',
  bodies: [],
  totals: totals(),
  days: Array.from({ length: 30 }, (_, i) => day({ day: `2026-06-${String(i + 1).padStart(2, '0')}`, postedLoads: 3, claimedLoads: 2 })),
  timeToClaim: { medianHours: 20, loads: 20, priorMedianHours: 20, priorLoads: 20, stretching: false, thin: false },
  priceVsStack: { loads: 10, medianRatio: 1, thin: false },
  lanes: [lane()],
  ...over,
});

describe('scarcity, as the console is allowed to describe it', () => {
  it('never renders a percentage whose denominator is zero', () => {
    // 0% would tell a reader the fleet failed at something nobody ever asked for.
    expect(takeUp(totals({ offeredLoads: 0, metLoads: 0 }))).toBeNull();
    expect(takeUp(totals({ offeredLoads: 40, metLoads: 30 }))).toBe(75);
    expect(dayTakeUp(day({ postedLoads: 0 }))).toBeNull();
    expect(dayTakeUp(day({ postedLoads: 4, claimedLoads: 1 }))).toBe(25);
  });

  it('divides take-up over ONE population, so it can never exceed what was asked for', () => {
    // `movedLoads` counts loads claimed in the window whenever they were posted, so a window that took
    // loads posted before it can move more than it was asked for. The live sandbox read 30% this way where
    // the truth was 24%; on a thinner market the same expression passes 100% and reads as a fleet that took
    // more work than existed.
    const straddling = totals({ offeredLoads: 8, metLoads: 2, unmetLoads: 3, cancelledLoads: 3, movedLoads: 12 });
    expect(takeUp(straddling)).toBe(25);
    expect(takeUp(straddling)!).toBeLessThanOrEqual(100);
    // …and the three outcomes the screen shows under "asked for" still add up to it.
    expect(straddling.metLoads + straddling.unmetLoads + straddling.cancelledLoads).toBe(straddling.offeredLoads);
  });

  it('withholds the price ratio itself on a thin sample, because the ratio IS the claim', () => {
    // One seeded load negotiated at 350 against a stack of 1.17 came back as a 299× median — which the
    // screen would have published as "+29,815% above the rate card" beside a small tag reading "thin".
    expect(priceClaim({ loads: 1, medianRatio: 299.15, thin: true })).toBeNull();
    expect(priceClaim({ loads: 12, medianRatio: 1.2, thin: false })).toBe(20);
    // Nothing to compare, and nothing measured at all, are both silence rather than 0%.
    expect(priceClaim({ loads: 0, medianRatio: null, thin: true })).toBeNull();
    expect(priceClaim(undefined)).toBeNull();
    // A market paying UNDER the card is a real answer and must survive the rule.
    expect(priceClaim({ loads: 9, medianRatio: 0.9, thin: false })).toBe(-10);
  });

  it('calls a window thin on the same threshold the server used', () => {
    expect(thinWindow(totals({ offeredLoads: 4 }))).toBe(true);
    expect(thinWindow(totals({ offeredLoads: 5 }))).toBe(false);
  });

  it('says nothing about the market it cannot support, and says so as "unknown"', () => {
    expect(marketMood(null)).toBe('unknown');
    // Too few loads in the whole window.
    expect(marketMood(view({ totals: totals({ offeredLoads: 3 }) }))).toBe('unknown');
    // Enough loads, but the server already marked the wait comparison thin.
    expect(marketMood(view({ timeToClaim: { medianHours: 40, loads: 2, priorMedianHours: 10, priorLoads: 2, stretching: false, thin: true } }))).toBe('unknown');
    // And "we do not know" is never allowed to collapse into "nothing is happening".
    expect(marketMood(view({ timeToClaim: { medianHours: null, loads: 0, priorMedianHours: null, priorLoads: 0, stretching: false, thin: false } }))).toBe('unknown');
  });

  it('reads tight, easing and steady only off what the server was willing to assert', () => {
    expect(marketMood(view({ timeToClaim: { medianHours: 40, loads: 20, priorMedianHours: 20, priorLoads: 20, stretching: true, thin: false } }))).toBe('tight');
    expect(marketMood(view({ timeToClaim: { medianHours: 10, loads: 20, priorMedianHours: 20, priorLoads: 20, stretching: false, thin: false } }))).toBe('easing');
    expect(marketMood(view())).toBe('steady');
  });

  it('selects quiet lanes rather than deciding which are quiet', () => {
    const lanes = [lane({ lane: 'A → B', quiet: true }), lane({ lane: 'C → D' })];
    expect(quietLanes(lanes).map((l) => l.lane)).toEqual(['A → B']);
    expect(topLanes(lanes, 1)).toHaveLength(1);
  });

  it('draws both lines on one scale, so a day nothing moved does not look like a day everything did', () => {
    const points = chartPoints([day({ postedLoads: 10, claimedLoads: 0 }), day({ day: '2026-06-02', postedLoads: 5, claimedLoads: 5 })]);
    expect(points[0]).toMatchObject({ posted: 1, claimed: 0 });
    expect(points[1]).toMatchObject({ posted: 0.5, claimed: 0.5 });
    // An empty window divides by nothing rather than by zero.
    expect(chartPoints([day()])[0]).toMatchObject({ posted: 0, claimed: 0 });
  });

  it('answers the dispatcher’s real question: is the market thin, or only my board?', () => {
    const busy = view();
    expect(boardVsMarket(0, busy)).toBe('board-thin');
    expect(boardVsMarket(6, busy)).toBe('market-busy');

    // Nothing posted anywhere in the last week — not this office's reach.
    const quiet = view({ days: Array.from({ length: 30 }, (_, i) => day({ day: `2026-06-${String(i + 1).padStart(2, '0')}`, postedLoads: i < 23 ? 3 : 0 })) });
    expect(boardVsMarket(0, quiet)).toBe('market-thin');

    // And where the market itself is too small to answer, it refuses rather than blaming a radius.
    expect(boardVsMarket(0, null)).toBe('unknown');
    expect(boardVsMarket(0, view({ totals: totals({ offeredLoads: 2 }) }))).toBe('unknown');
  });
});
