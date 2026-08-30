import { buildSeries, loadedKmOf, UNKNOWN_BODY } from './market-series';
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
    bulk: false,
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
    expect(s.totals).toEqual({ offeredLoads: 0, offeredKm: 0, movedLoads: 0, movedKm: 0, deadheadKm: 0, unmetLoads: 0, unmetKm: 0 });
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
