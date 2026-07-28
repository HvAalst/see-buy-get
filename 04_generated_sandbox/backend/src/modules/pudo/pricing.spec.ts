import { clampMultiplier, computeFreightPrice, freightMultiplier, shipperCharge } from './pricing';
import { withPlatformFee } from './pudo.config';

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
  });

  describe('shipperCharge', () => {
    it('is the driver earning plus the platform fee', () => {
      expect(shipperCharge(100)).toBe(withPlatformFee(100));
      expect(shipperCharge(100)).toBeGreaterThan(100);
    });
  });
});
