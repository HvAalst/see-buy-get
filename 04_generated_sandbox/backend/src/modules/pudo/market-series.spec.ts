import { buildSeries, lanesOf, loadedKmOf, median, UNKNOWN_BODY, UNKNOWN_PLACE } from './market-series';
import { Freight } from './dispatch.types';

/**
 * FB4 — the market series, which is the one output of this system somebody spends real money on the strength
 * of. Every test here is about a way the numbers could flatter the market rather than describe it.
 */

const DAY = 24 * 3_600_000;
const T0 = Date.parse('2026-06-01T00:00:00.000Z');
const at = (days: number) => new Date(T0 + days * DAY).toISOString();

/** A straight-line stand-in for the road router — 1 unit of latitude ≈ 100 km, so distances are legible. */
const roadKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => Math.abs(a.lat - b.lat) * 100 + Math.abs(a.lng - b.lng) * 100;

function freight(over: Partial<Freight> = {}): Freight {
  return {
    freightId: `f-${Math.random().toString(36).slice(2)}`,
    code: 'FRT-1',
    description: 'Load',
    pickupLocation: { lat: 0, lng: 0 },
    pickupLabel: 'A',
    destLabel: 'B',
    destLocation: { lat: 1, lng: 0 }, // 100 km
    weightKg: 4000,
    fragile: false,
    packaging: 'palletised',
    cargoClass: 'P4',
    natureCode: 'GEN',
    requiredCapabilities: [],
    requiredEquipment: [],
    equipmentGaps: [],
    status: 'available',
    createdAt: at(1),
    bodyDerived: { body: 'flatbed', basis: 'measured' },
    ...over,
  } as Freight;
}

/** A claimed load, with the price breakdown a real claim locks on. */
function claimed(over: Partial<Freight> = {}): Freight {
  return freight({
    status: 'claimed',
    claimedAt: at(2),
    claimedBy: 'did:glos:driver:1',
    carriedBy: { vehicleClass: 'truck', truckSubtype: 'flatbed' },
    priceBreakdown: { baseFee: 10, distanceKm: 130, deadheadKm: 30, loadedKm: 100, ratePerKm: 0.5, multiplier: 1, effectiveRate: 0.5, total: 75 },
    ...over,
  });
}

const WINDOW = { from: T0, to: T0 + 30 * DAY };
const series = (rows: Freight[], w = WINDOW) => buildSeries(rows, w, roadKm);

/**
 * CL3 — scarcity, derived. Nothing here is reported by anybody: every figure comes from timestamps the
 * load already carries, which is what lets it keep working in a market where nobody fills anything in.
 */
describe('CL3 — scarcity, derived from what the loads already say', () => {
  it('counts a WITHDRAWN load as withdrawn, never as demand nobody met', () => {
    // The defect this closes: ANY load with no claim counted as unmet, so a shipper cancelling their own
    // load registered as the fleet failing to turn up — inflating scarcity in the view built to measure it.
    const s = series([freight({ status: 'cancelled', createdAt: at(1) }), freight({ createdAt: at(2) })]);
    expect(s.totals.cancelledLoads).toBe(1);
    expect(s.totals.unmetLoads).toBe(1);
  });

  it('partitions what was ASKED FOR into exactly three outcomes, so the three can be added', () => {
    // The defect a live sandbox showed in one glance: 33 asked for, and moved + unmet + withdrawn came to
    // 35. `movedLoads` counts loads CLAIMED in the window whenever they were posted, so it cannot complete a
    // population keyed on posting. `metLoads` can, and must, always.
    const rows = [
      claimed({ createdAt: at(1), claimedAt: at(2) }), // met
      claimed({ createdAt: at(3), claimedAt: at(4) }), // met
      freight({ createdAt: at(5) }), // nobody took it
      freight({ status: 'cancelled', createdAt: at(6) }), // withdrawn before anybody took it
      // Claimed and THEN withdrawn: a truck turned up, the load did not travel. It belongs on the withdrawn
      // line and nowhere else, or the fleet is credited with work that never happened.
      claimed({ status: 'cancelled', createdAt: at(7), claimedAt: at(8) }),
    ];
    const s = series(rows);
    expect(s.totals).toMatchObject({ offeredLoads: 5, metLoads: 2, unmetLoads: 1, cancelledLoads: 2 });
    expect(s.totals.metLoads + s.totals.unmetLoads + s.totals.cancelledLoads).toBe(s.totals.offeredLoads);
    // …and `moved` is still the other question, over its own population: three loads were claimed here.
    expect(s.totals.movedLoads).toBe(3);
  });

  it('gives every day in the window a row, including the silent ones', () => {
    const s = series([freight({ createdAt: at(1) }), freight({ createdAt: at(1) })]);
    expect(s.days).toHaveLength(31);
    expect(s.days[0].day).toBe('2026-06-01');
    // A market that went quiet must show as zeroes rather than as a gap a chart would draw straight over.
    expect(s.days.filter((d) => d.postedLoads === 0)).toHaveLength(30);
    expect(s.days.find((d) => d.day === '2026-06-02')?.postedLoads).toBe(2);
  });

  it('separates what was POSTED from what was TAKEN on each day', () => {
    // One load, posted on one day and claimed on the next: two different days, two different facts.
    const s = series([claimed({ createdAt: at(1), claimedAt: at(2) })]);
    expect(s.days.find((d) => d.day === '2026-06-02')).toMatchObject({ postedLoads: 1, claimedLoads: 0 });
    expect(s.days.find((d) => d.day === '2026-06-03')).toMatchObject({ postedLoads: 0, claimedLoads: 1 });
  });

  it('measures the wait against the window before, and refuses to call it stretching on a thin sample', () => {
    // Five quick claims before the window, five slow ones inside it: the market is taking longer to answer.
    const prior = [0, 1, 2, 3, 4].map((i) => claimed({ createdAt: at(-9 + i), claimedAt: at(-8 + i) }));
    const now = [0, 1, 2, 3, 4].map((i) => claimed({ createdAt: at(1 + i), claimedAt: at(5 + i) }));
    const s = series([...prior, ...now]);
    expect(s.timeToClaim).toMatchObject({ loads: 5, priorLoads: 5, thin: false, stretching: true });
    expect(s.timeToClaim.medianHours).toBe(96);
    expect(s.timeToClaim.priorMedianHours).toBe(24);

    // The same shape on too few loads states the figures and withholds the verdict.
    const thin = series([claimed({ createdAt: at(-9), claimedAt: at(-8) }), claimed({ createdAt: at(1), claimedAt: at(5) })]);
    expect(thin.timeToClaim).toMatchObject({ thin: true, stretching: false });
    expect(thin.timeToClaim.medianHours).toBe(96);
  });

  it('compares only NEGOTIATED prices against the stack, because a computed price IS the stack', () => {
    const computed = claimed({ priceOrigin: 'computed', lockedPrice: 75 });
    expect(series([computed]).priceVsStack).toMatchObject({ loads: 0, medianRatio: null });

    // Agreed 90 where the stack said 75: the market charging a fifth over the card to get a truck.
    const negotiated = claimed({ priceOrigin: 'negotiated', lockedPrice: 90 });
    const s = series([computed, negotiated]);
    expect(s.priceVsStack).toMatchObject({ loads: 1, medianRatio: 1.2, thin: true });
  });

  it('names a lane from its two ends and calls it quiet only when it fell from something', () => {
    const NBO = { lat: -1.286, lng: 36.817 };
    const MSA = { lat: -4.043, lng: 39.668 };
    // Twelve before, five during. Quiet means a fall to half or less, and not-thin means at least five in
    // each window — so a lane can only be BOTH if the window before it carried at least ten.
    const before = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((i) => freight({ pickupLocation: NBO, destLocation: MSA, createdAt: at(-12 + (i % 6)) }));
    const during = [0, 1, 2, 3, 4].map((i) => freight({ pickupLocation: NBO, destLocation: MSA, createdAt: at(1 + i) }));
    const [lane] = lanesOf([...before, ...during], WINDOW);
    expect(lane).toMatchObject({ postedLoads: 5, priorPostedLoads: 12, thin: false, quiet: true });
    expect(lane.lane).toContain('→');

    // A lane with no history is EMPTY, not quiet: calling it quiet would invent a decline nobody suffered.
    const fresh = lanesOf(during, WINDOW)[0];
    expect(fresh).toMatchObject({ priorPostedLoads: 0, quiet: false });
  });

  it('buckets a lane end it cannot name honestly as unknown', () => {
    // Deep ocean: nothing in the gazetteer is near enough to name without implying precision we lack.
    const nowhere = { lat: -40, lng: -120 };
    const [lane] = lanesOf([freight({ pickupLocation: nowhere, destLocation: nowhere, createdAt: at(1) })], WINDOW);
    expect(lane.from).toBe(UNKNOWN_PLACE);
    expect(lane.to).toBe(UNKNOWN_PLACE);
  });

  it('takes the median rather than the mean, so one freak wait is not the market', () => {
    expect(median([])).toBeNull();
    expect(median([2, 1, 3])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    // The mean of these is 200-odd; the median says what almost every load actually did.
    expect(median([1, 1, 1, 1, 1000])).toBe(1);
  });
});

describe('the market series (FB4)', () => {
  it('counts what was ASKED FOR against what MOVED, per body', () => {
    // The headline the whole slice exists for: km of flatbed offered, km of containers moved.
    const s = series([
      freight({ bodyDerived: { body: 'flatbed', basis: 'measured' } }),
      claimed({ bodyDerived: { body: 'skeletal', basis: 'measured' }, carriedBy: { vehicleClass: 'truck', truckSubtype: 'skeletal' } }),
    ]);
    const flatbed = s.bodies.find((b) => b.body === 'flatbed')!;
    const skeletal = s.bodies.find((b) => b.body === 'skeletal')!;

    expect(flatbed.offeredKm).toBe(100);
    expect(flatbed.movedKm).toBe(0); // asked for, and nothing took it
    expect(skeletal.offeredKm).toBe(100);
    expect(skeletal.movedKm).toBe(100);
  });

  it('never counts an EMPTY kilometre as work', () => {
    // The rule the loaded/deadhead split was built for. A haul reached by 30 km of empty running moved 100 km
    // of freight, not 130 — and conflating them makes the whole comparison meaningless.
    const s = series([claimed()]);
    const flatbed = s.bodies.find((b) => b.body === 'flatbed')!;
    expect(flatbed.movedKm).toBe(100);
    expect(flatbed.deadheadKm).toBe(30); // reported, beside it, never inside it
    expect(s.totals.movedKm).toBe(100);
    expect(s.totals.deadheadKm).toBe(30);
  });

  it('attributes MOVED kilometres to the body that turned up, not the one asked for', () => {
    // A flatbed load taken by a curtain-side moved curtain-side kilometres. The disagreement between the two
    // lines is exactly the market signal — collapsing them would erase it.
    const s = series([claimed({ bodyDerived: { body: 'flatbed', basis: 'measured' }, carriedBy: { vehicleClass: 'truck', truckSubtype: 'curtain_side' } })]);
    expect(s.bodies.find((b) => b.body === 'flatbed')!.offeredKm).toBe(100);
    expect(s.bodies.find((b) => b.body === 'flatbed')!.movedKm).toBe(0);
    expect(s.bodies.find((b) => b.body === 'curtain_side')!.movedKm).toBe(100);
  });

  it('buckets an unrecorded carrier as UNKNOWN rather than inferring one', () => {
    // A haul claimed before the carrier was stamped, or carried by a van with no subtype. Reading the
    // driver's CURRENT coupling would let somebody selling a flatbed rewrite every haul they ever did.
    const s = series([
      claimed({ carriedBy: undefined }),
      claimed({ carriedBy: { vehicleClass: 'van' } }), // a van is a van; it has no body
    ]);
    expect(s.bodies.find((b) => b.body === UNKNOWN_BODY)!.movedLoads).toBe(2);
    expect(s.bodies.find((b) => b.body === 'flatbed')?.movedLoads ?? 0).toBe(0);
  });

  it('separates a MEASURED body from one guessed off the weight', () => {
    // Both count. But "we measured this load" and "we guessed from its weight because nobody measured it"
    // are different claims, and a reader investing against the series is entitled to the difference.
    const s = series([freight({ bodyDerived: { body: 'flatbed', basis: 'measured' } }), freight({ bodyDerived: { body: 'flatbed', basis: 'weight-only' } })]);
    const flatbed = s.bodies.find((b) => b.body === 'flatbed')!;
    expect(flatbed.offeredLoads).toBe(2);
    expect(flatbed.offeredMeasured).toBe(1);
  });

  it('reports demand NOBODY met — the sentence an investor is paying for', () => {
    const s = series([freight(), freight(), claimed()]);
    expect(s.totals.offeredLoads).toBe(3);
    expect(s.totals.unmetLoads).toBe(2); // two posted, never claimed by anyone
    expect(s.totals.unmetKm).toBe(200);
  });

  it('does not call a load unmet just because it was taken later', () => {
    // Posted in the window, claimed after it. It WAS met; counting it as a shortfall would invent demand
    // that nobody failed to serve.
    const s = series([claimed({ createdAt: at(1), claimedAt: at(90) })]);
    expect(s.totals.offeredLoads).toBe(1);
    expect(s.totals.unmetLoads).toBe(0);
    expect(s.totals.movedLoads).toBe(0); // and it did not move IN THIS WINDOW either
  });

  it('keys offered on POSTING and moved on CLAIMING, so a straddling load counts truthfully in both', () => {
    // Posted before the window, claimed inside it: no offered kilometres here, but the fleet really did move
    // it here. One timestamp for both questions would answer neither.
    const s = series([claimed({ createdAt: at(-40), claimedAt: at(3) })]);
    expect(s.totals.offeredLoads).toBe(0);
    expect(s.totals.movedLoads).toBe(1);
    expect(s.totals.movedKm).toBe(100);
  });

  it('excludes everything outside the window at both ends', () => {
    const s = series([freight({ createdAt: at(-1) }), freight({ createdAt: at(31) })]);
    expect(s.totals.offeredLoads).toBe(0);
    expect(s.bodies).toEqual([]);
  });

  it('echoes the window, because a kilometre count without a period is not a rate', () => {
    const s = series([]);
    expect(s.from).toBe(new Date(WINDOW.from).toISOString());
    expect(s.to).toBe(new Date(WINDOW.to).toISOString());
    expect(s.totals).toEqual({ offeredLoads: 0, offeredKm: 0, movedLoads: 0, movedKm: 0, deadheadKm: 0, unmetLoads: 0, unmetKm: 0, cancelledLoads: 0, metLoads: 0 });
  });

  it('prefers the RECORDED haul distance over one measured now', () => {
    // The breakdown's split is what the haul was actually priced on. Re-measuring a delivered load against
    // today's router would let a routing change silently restate history.
    const f = claimed({ priceBreakdown: { baseFee: 10, distanceKm: 90, deadheadKm: 30, loadedKm: 60, ratePerKm: 0.5, multiplier: 1, effectiveRate: 0.5, total: 55 } });
    expect(loadedKmOf(f, roadKm)).toBe(60); // not the 100 km its two pins are apart today
    expect(series([f]).totals.movedKm).toBe(60);
  });

  it('returns null for an unknowable haul rather than calling it zero', () => {
    // A load with no destination has an UNKNOWN run. Counting it as 0 km would drag every average down and
    // read as "this corridor is short", which is a different and false claim.
    const f = freight({ destLocation: undefined, priceBreakdown: undefined });
    expect(loadedKmOf(f, roadKm)).toBeNull();
    const s = series([f]);
    expect(s.totals.offeredLoads).toBe(1); // the DEMAND is still real and still counted
    expect(s.totals.offeredKm).toBe(0); // it just contributes no kilometres it cannot support
  });

  it('orders bodies the same way twice for an unchanged market', () => {
    // Busiest first, ties broken by name — a total order. A table that reshuffles between two reads of the
    // same data reads as movement in the market.
    const rows = [freight({ bodyDerived: { body: 'tipper', basis: 'measured' } }), freight({ bodyDerived: { body: 'box', basis: 'measured' } })];
    expect(series(rows).bodies.map((b) => b.body)).toEqual(['box', 'tipper']);
    expect(series([...rows].reverse()).bodies.map((b) => b.body)).toEqual(['box', 'tipper']);
  });

  it('totals agree with the rows they are made of', () => {
    const s = series([freight(), claimed(), claimed({ carriedBy: { vehicleClass: 'truck', truckSubtype: 'tipper' } })]);
    expect(s.totals.offeredKm).toBe(s.bodies.reduce((n, b) => n + b.offeredKm, 0));
    expect(s.totals.movedKm).toBe(s.bodies.reduce((n, b) => n + b.movedKm, 0));
    expect(s.totals.movedLoads).toBe(s.bodies.reduce((n, b) => n + b.movedLoads, 0));
  });
});
