import { clampMultiplier, computeFreightPrice, computeToteHaul, distanceSplit, earningsPerKm, freightMultiplier, roadLeftToPay, roadPartAt, shipperCharge, type PriceBreakdown } from './pricing';
import { BAG_CAPACITY_UNITS, SIZE_TRANSPORT_FACTOR, SIZE_UNITS, bagShare, withPlatformFee } from './pudo.config';
import { ParcelService } from './parcel.service';

describe('how much room a parcel takes — ONE fact, two expressions', () => {
  it('derives the transport factor from the bag units, so the two can never disagree again', () => {
    // They were separate tables and they DID disagree: a HEAVY consumed a whole bag (10 of 10 units) and
    // was charged three mediums' worth of road. This test is the reason that cannot come back — edit
    // either table and it fails until both mean the same thing.
    for (const size of ['S', 'M', 'L', 'HEAVY'] as const) {
      expect(SIZE_TRANSPORT_FACTOR[size]).toBeCloseTo(SIZE_UNITS[size] / SIZE_UNITS.M, 5);
    }
  });

  it('leaves the reference size alone and moves the rest around it', () => {
    // A REDISTRIBUTION, not a rise. Small parcels were subsidising heavy ones.
    expect(SIZE_TRANSPORT_FACTOR.M).toBe(1); // was 1
    expect(SIZE_TRANSPORT_FACTOR.S).toBe(0.18); // was 0.4 — an S takes 1.8% of a bag, not 40% of a medium
    expect(SIZE_TRANSPORT_FACTOR.L).toBe(2); // was 1.6
    expect(SIZE_TRANSPORT_FACTOR.HEAVY).toBe(10); // was 3 — it denies the bag to everything else
  });

  it('charges a heavy for the whole bag, because it travels alone', () => {
    // The policy ("nothing shares with a heavy") is what justifies the price. If that policy ever changes,
    // this assertion is what forces the factor down with it.
    expect(SIZE_UNITS.HEAVY).toBe(BAG_CAPACITY_UNITS);
    expect(bagShare('HEAVY')).toBe(1);
  });

  it('a bag full of any one size is exactly one bag', () => {
    expect(bagShare('M') * 10).toBeCloseTo(1, 5);
    expect(bagShare('L') * 5).toBeCloseTo(1, 5);
  });
});

describe('what carrying a bag is worth', () => {
  it('prices the road by distance × the vehicle’s own rate × what is actually in the bag', () => {
    // The three things the flat 50c ignored. `units` is medium-equivalents — the SAME basis the buyers
    // inside the bag were charged on, so the two sides of the transaction are finally in one unit.
    expect(computeToteHaul({ ratePerKm: 0.08, tripKm: 40, units: 10 }).road).toBe(32);
    expect(computeToteHaul({ ratePerKm: 0.08, tripKm: 2, units: 10 }).road).toBe(1.6);
  });

  it('pays a half-full bag half — it is carrying half', () => {
    // Right rather than harsh: this is belly freight in a vehicle that was going anyway, so the empty space
    // costs the driver almost nothing. Paying a full-bag rate for air would spend a 2% margin covering a
    // shortfall that is routinely 50%. The answer to the emptiness is to fill the trip, not to subsidise it.
    const full = computeToteHaul({ ratePerKm: 0.08, tripKm: 40, units: 10 }).road;
    const half = computeToteHaul({ ratePerKm: 0.08, tripKm: 40, units: 5 }).road;
    expect(half).toBe(full / 2);
  });

  it('earns nothing extra for an unresolvable journey rather than a NaN', () => {
    // An unplaceable destination arrives here as 0 km. This is money going into a ledger, so every input is
    // sanitised first and a broken figure resolves to zero instead of propagating.
    expect(computeToteHaul({ ratePerKm: 0.08, tripKm: 0, units: 10 }).road).toBe(0);
    expect(computeToteHaul({ ratePerKm: Number.NaN, tripKm: 40, units: 10 }).road).toBe(0);
    expect(computeToteHaul({ ratePerKm: 0.08, tripKm: Number.POSITIVE_INFINITY, units: 10 }).road).toBe(0);
    expect(computeToteHaul({ ratePerKm: -0.5, tripKm: 40, units: 10 }).road).toBe(0);
    expect(computeToteHaul({ ratePerKm: 0.08, tripKm: -40, units: 10 }).road).toBe(0);
  });

  it('is distance-sensitive, which is the whole point', () => {
    // The defect this closes: sixty kilometres and two paid exactly the same fifty cents.
    const near = computeToteHaul({ ratePerKm: 0.08, tripKm: 2, units: 10 }).road;
    const far = computeToteHaul({ ratePerKm: 0.08, tripKm: 60, units: 10 }).road;
    expect(far).toBeGreaterThan(near * 25);
  });
});

describe('the platform’s take on a freight', () => {
  it('uses the selling sister’s rate when there is one', () => {
    // Freight is the DEDICATED lane — where a specialised vehicle is bought and where profit-on-risk is
    // actually earned. It charged the bare network constant until the knobs existed, which would have made
    // the dedicated knob decorative.
    expect(shipperCharge(100, 0.09)).toBe(109);
  });

  it('falls back to the network default for a load with no seller', () => {
    // A counter-booked cash freight settles off-platform: nobody is billed, so there is no selling sister
    // whose rate could apply. The default is the honest answer rather than a guess at somebody's rate.
    expect(shipperCharge(100)).toBe(withPlatformFee(100));
  });
});

describe('the factor a parcel was SOLD at (durability)', () => {
  it('uses the stamped factor, not today’s constant', () => {
    // The flexible rebate recomputes a parcel's real cost at DELIVERY. Retuning the network constant while
    // a parcel is in the air would otherwise rewrite a price the customer already agreed to.
    expect(ParcelService.transportFactorOf({ size: 'M', transportFactor: 1.6 })).toBe(1.6);
  });

  it('falls back to the constant for a record written before the field existed', () => {
    expect(ParcelService.transportFactorOf({ size: 'HEAVY', transportFactor: undefined })).toBe(SIZE_TRANSPORT_FACTOR.HEAVY);
  });

  it('refuses a corrupt stamp rather than pricing transport at zero', () => {
    // `?? ` would accept a stored 0 and make the road free. A zero is never a real answer here — it is a
    // damaged record, and the constant is a better guess than free.
    expect(ParcelService.transportFactorOf({ size: 'M', transportFactor: 0 })).toBe(SIZE_TRANSPORT_FACTOR.M);
    expect(ParcelService.transportFactorOf({ size: 'M', transportFactor: Number.NaN })).toBe(SIZE_TRANSPORT_FACTOR.M);
    expect(ParcelService.transportFactorOf({ size: 'M', transportFactor: -2 })).toBe(SIZE_TRANSPORT_FACTOR.M);
  });
});

describe('freight pricing (S34)', () => {
  describe('clampMultiplier', () => {
    it('keeps a sane multiplier untouched (rounded to 2dp)', () => {
      expect(clampMultiplier(1)).toBe(1);
      expect(clampMultiplier(1.234)).toBe(1.23);
    });

    it('clamps to the [0.1, 3] sanity band', () => {
      expect(clampMultiplier(0)).toBe(0.1);
      expect(clampMultiplier(-5)).toBe(0.1);
      expect(clampMultiplier(9)).toBe(3);
    });

    it('falls back to 1 for a non-finite input', () => {
      expect(clampMultiplier(Number.NaN)).toBe(1);
      expect(clampMultiplier(Number.POSITIVE_INFINITY)).toBe(1);
    });
  });

  describe('freightMultiplier', () => {
    const bounds = { min: 0.8, max: 1.5 };

    it('is neutral (1.0) off-peak', () => {
      expect(freightMultiplier(new Date('2026-07-22T11:00:00'), bounds)).toBe(1);
    });

    it('adds the peak-hour bonus in a rush window', () => {
      // 08:00 and 17:00 are peak → 1 + 0.15
      expect(freightMultiplier(new Date('2026-07-22T08:30:00'), bounds)).toBe(1.15);
      expect(freightMultiplier(new Date('2026-07-22T17:15:00'), bounds)).toBe(1.15);
    });

    it('never prices outside the driver-owned corridor', () => {
      // A ceiling below the peak result clamps the surge away.
      expect(freightMultiplier(new Date('2026-07-22T08:00:00'), { min: 0.8, max: 1.1 })).toBe(1.1);
      // A floor above 1.0 lifts an off-peak job to the driver's minimum.
      expect(freightMultiplier(new Date('2026-07-22T11:00:00'), { min: 1.2, max: 1.5 })).toBe(1.2);
    });

    it('stays finite when a bound is undefined (a legacy vehicle with no profile) → neutral 1.0', () => {
      // The NaN-corruption backstop: undefined bounds must never yield NaN (which would poison a ledger).
      const m = freightMultiplier(new Date('2026-07-22T11:00:00'), { min: undefined as never, max: undefined as never });
      expect(Number.isFinite(m)).toBe(true);
      expect(m).toBe(1);
    });

    it('folds the S34b market factor (seasonal × market), still clamped to the corridor', () => {
      const offpeak = new Date('2026-07-22T11:00:00');
      // Market surge lifts the multiplier — but the vehicle's ceiling still wins.
      expect(freightMultiplier(offpeak, { min: 0.8, max: 1.5 }, 1.4)).toBe(1.4);
      expect(freightMultiplier(offpeak, { min: 0.8, max: 1.2 }, 1.4)).toBe(1.2); // clamped to ceiling
      // A quiet market discounts down to the floor.
      expect(freightMultiplier(offpeak, { min: 0.9, max: 1.5 }, 0.7)).toBe(0.9); // clamped up to floor
      // Peak (1.15) × market compound.
      expect(freightMultiplier(new Date('2026-07-22T08:00:00'), { min: 0.8, max: 2 }, 1.2)).toBe(1.38);
      // A non-finite market factor degrades to neutral (never NaN).
      expect(freightMultiplier(offpeak, { min: 0.8, max: 1.5 }, Number.NaN)).toBe(1);
    });
  });

  describe('computeFreightPrice', () => {
    it('computes P = B + D·R·M with D = deadhead + trip', () => {
      const b = computeFreightPrice({ baseFee: 5, ratePerKm: 0.4, deadheadKm: 3, tripKm: 7, multiplier: 1 });
      expect(b.distanceKm).toBe(10);
      expect(b.effectiveRate).toBe(0.4);
      expect(b.total).toBe(5 + 10 * 0.4); // 9
    });

    it('applies the multiplier to the per-km rate only, not the base fee', () => {
      const b = computeFreightPrice({ baseFee: 5, ratePerKm: 0.4, deadheadKm: 0, tripKm: 10, multiplier: 1.5 });
      expect(b.effectiveRate).toBe(0.6); // 0.4 × 1.5
      expect(b.total).toBe(5 + 10 * 0.6); // 11 — base fee is flat
    });

    it('floors negative distances at zero (a defensive guard, never a credit)', () => {
      const b = computeFreightPrice({ baseFee: 5, ratePerKm: 0.4, deadheadKm: -3, tripKm: -7, multiplier: 1 });
      expect(b.distanceKm).toBe(0);
      expect(b.total).toBe(5);
    });

    it('sanitises every non-finite input to 0 — no NaN/Infinity can reach a balance or a ledger', () => {
      // The last-line backstop against a legacy vehicle (undefined baseFee/rate) or a bad geo leg.
      const b = computeFreightPrice({ baseFee: undefined as never, ratePerKm: Number.NaN, deadheadKm: Number.POSITIVE_INFINITY, tripKm: undefined as never, multiplier: Number.NaN });
      expect(Number.isFinite(b.total)).toBe(true);
      expect(Number.isFinite(b.baseFee)).toBe(true);
      expect(Number.isFinite(b.distanceKm)).toBe(true);
      expect(Number.isFinite(b.effectiveRate)).toBe(true);
      expect(b.total).toBe(0);
    });

    // FB0a — the two halves survive the computation instead of being summed away.
    it('keeps the deadhead and loaded halves, and they reconstruct the billed distance', () => {
      const b = computeFreightPrice({ baseFee: 5, ratePerKm: 0.4, deadheadKm: 3, tripKm: 7, multiplier: 1 });
      expect(b.deadheadKm).toBe(3);
      expect(b.loadedKm).toBe(7);
      expect((b.deadheadKm as number) + (b.loadedKm as number)).toBe(b.distanceKm);
    });

    it('splits the same way the total is guarded — the halves still sum to the billed distance', () => {
      // Negative and non-finite legs are floored/sanitised INDIVIDUALLY, so the invariant cannot be broken by
      // a bad geo leg: whatever goes in, deadheadKm + loadedKm === distanceKm.
      for (const input of [
        { deadheadKm: -3, tripKm: 7 },
        { deadheadKm: 3, tripKm: -7 },
        { deadheadKm: Number.POSITIVE_INFINITY, tripKm: Number.NaN },
        { deadheadKm: undefined as never, tripKm: 4.25 },
      ]) {
        const b = computeFreightPrice({ baseFee: 5, ratePerKm: 0.4, multiplier: 1, ...input });
        expect((b.deadheadKm as number) + (b.loadedKm as number)).toBe(b.distanceKm);
        expect(b.deadheadKm).toBeGreaterThanOrEqual(0);
        expect(b.loadedKm).toBeGreaterThanOrEqual(0);
      }
    });

    it('prices on the total distance only — moving km between the halves never changes the money', () => {
      // The split is INFORMATION, not a new price term. If it ever moved the total it would be a repricing.
      const a = computeFreightPrice({ baseFee: 5, ratePerKm: 0.4, deadheadKm: 9, tripKm: 1, multiplier: 1.2 });
      const b = computeFreightPrice({ baseFee: 5, ratePerKm: 0.4, deadheadKm: 1, tripKm: 9, multiplier: 1.2 });
      expect(a.total).toBe(b.total);
    });
  });

  describe('distanceSplit', () => {
    it('returns the split when it is there', () => {
      const b = computeFreightPrice({ baseFee: 5, ratePerKm: 0.4, deadheadKm: 3, tripKm: 7, multiplier: 1 });
      expect(distanceSplit(b)).toEqual({ deadheadKm: 3, loadedKm: 7 });
    });

    it('returns null for a breakdown locked before the split existed — it never invents one', () => {
      // A price locked pre-FB0a knows only the sum. Deriving a split from it would fabricate the exact figure
      // an operator decides on, so the caller must be told there is none and show "—".
      const legacy: PriceBreakdown = { baseFee: 5, distanceKm: 10, ratePerKm: 0.4, multiplier: 1, effectiveRate: 0.4, total: 9 };
      expect(distanceSplit(legacy)).toBeNull();
      expect(distanceSplit(undefined)).toBeNull();
      expect(distanceSplit({ deadheadKm: 3, loadedKm: undefined })).toBeNull(); // half a split is not a split
    });
  });

  describe('earningsPerKm', () => {
    it('divides the earning by the TOTAL km, empty run included', () => {
      // 5 + 10×0.4 = 9 over 10 km. The deadhead is in the denominator on purpose: a long haul reached by a
      // long empty run is a worse job than a short one at the door, and only the total says so.
      const b = computeFreightPrice({ baseFee: 5, ratePerKm: 0.4, deadheadKm: 3, tripKm: 7, multiplier: 1 });
      expect(earningsPerKm(b)).toBe(0.9);
    });

    it('ranks a near load above a far one that pays the same', () => {
      const near = computeFreightPrice({ baseFee: 10, ratePerKm: 0, deadheadKm: 2, tripKm: 8, multiplier: 1 });
      const far = computeFreightPrice({ baseFee: 10, ratePerKm: 0, deadheadKm: 90, tripKm: 8, multiplier: 1 });
      expect(near.total).toBe(far.total); // same money…
      expect(earningsPerKm(near) as number).toBeGreaterThan(earningsPerKm(far) as number); // …not the same job
    });

    it('is null rather than a fabricated score when it cannot be computed', () => {
      const legacy: PriceBreakdown = { baseFee: 5, distanceKm: 10, ratePerKm: 0.4, multiplier: 1, effectiveRate: 0.4, total: 9 };
      expect(earningsPerKm(legacy)).toBeNull(); // no split
      expect(earningsPerKm(undefined)).toBeNull();
      // A zero-distance job would divide by zero; it sorts as unsortable, never to the top.
      expect(earningsPerKm(computeFreightPrice({ baseFee: 5, ratePerKm: 0.4, deadheadKm: 0, tripKm: 0, multiplier: 1 }))).toBeNull();
    });
  });

  describe('shipperCharge', () => {
    it('is the driver earning plus the platform fee', () => {
      expect(shipperCharge(100)).toBe(withPlatformFee(100));
      expect(shipperCharge(100)).toBeGreaterThan(100);
    });
  });
});

describe('a bag’s road, split at a takeover (the user, 2026-10-25: "Split by the road")', () => {
  const haul = { tripKm: 40, road: 200 };
  it('pays the first driver the stretch they drove: the trip less what is left from where it was taken over', () => {
    expect(roadPartAt(haul, 30)).toEqual({ amount: 50, leftKm: 30, basis: 'measured' });
    expect(roadPartAt(haul, 0)).toEqual({ amount: 200, leftKm: 0, basis: 'measured' });
  });
  it('measures a second takeover from where the first left it, and never pays the road twice', () => {
    const parts = [{ amount: 50, leftKm: 30 }];
    expect(roadPartAt({ ...haul, parts }, 10)).toEqual({ amount: 100, leftKm: 10, basis: 'measured' });
    expect(roadLeftToPay({ ...haul, parts: [...parts, { amount: 100, leftKm: 10 }] })).toBe(50);
    // Whatever the arithmetic says, never more than is left of the road.
    expect(roadPartAt({ tripKm: 40, road: 200, parts: [{ amount: 190, leftKm: 30 }] }, 0).amount).toBe(10);
  });
  it('pays nothing for a stretch that went no nearer, or that nobody could place — and says which', () => {
    expect(roadPartAt(haul, 55)).toEqual({ amount: 0, leftKm: 40, basis: 'measured' });
    expect(roadPartAt(haul, undefined)).toEqual({ amount: 0, leftKm: 40, basis: 'unmeasured' });
    expect(roadPartAt({ tripKm: 0, road: 0 }, 5)).toEqual({ amount: 0, leftKm: 0, basis: 'unmeasured' });
    expect(roadLeftToPay(haul)).toBe(200);
  });
});
