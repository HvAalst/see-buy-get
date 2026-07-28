// Dynamic freight pricing (S34). A vehicle's pricing profile — baseFee B, pricePerKm R_base, and the
// multiplier corridor [minMultiplier, maxMultiplier] — meets the market: an offer's price is
//   P = B + D·R_base·M
// where D is the total trip distance (deadhead driver→pickup + haul pickup→dropoff) and M is a market
// multiplier the platform flexes WITHIN the driver's own bounds — the driver always owns the floor + ceiling.
// S34a ships a deliberately simple time-of-day multiplier; S34b swaps in the real supply/demand engine while
// keeping the clamp-to-bounds contract. All pure functions here so the pricing is trivially testable.

import { withPlatformFee } from './pudo.config';

/** Sanity bounds for a declared multiplier — never below a small floor, never a runaway ceiling. */
export function clampMultiplier(m: number): number {
  if (!Number.isFinite(m)) return 1;
  return Math.min(3, Math.max(0.1, Math.round(m * 100) / 100));
}

// Peak windows (local time): the morning + evening rush earn a surcharge (still clamped to the driver's max).
const PEAK_HOURS = new Set([7, 8, 16, 17, 18]);
const PEAK_BONUS = 0.15;

/**
 * The market multiplier for a job, CLAMPED to the driver's [min, max] corridor. S34a is intentionally simple:
 * a neutral 1.0, +PEAK_BONUS in a rush-hour window. S34b replaces the body with the real market pulse
 * (per-zone supply/demand, urgency SLA, seasonal admin rules); the clamp-to-bounds contract is the invariant.
 */
export function freightMultiplier(now: Date, bounds: { min: number; max: number }): number {
  let m = 1;
  if (PEAK_HOURS.has(now.getHours())) m += PEAK_BONUS;
  // Sanitise the corridor on READ: a vehicle persisted before pricing existed rehydrates with undefined
  // bounds, and an undefined slipping into Math.min/max yields NaN — which must never reach a price or a
  // ledger. A non-finite bound falls back to a neutral 1.0 (the safe identity), never NaN.
  const lo = Number.isFinite(bounds.min) ? bounds.min : 1;
  const hi = Number.isFinite(bounds.max) ? bounds.max : 1;
  return Math.min(hi, Math.max(lo, Math.round(m * 100) / 100));
}

/** The transparent price breakdown shown on an offer card — every term the driver can see and trust. */
export interface PriceBreakdown {
  baseFee: number; // B — the flag-down / loading fee
  distanceKm: number; // D — deadhead + haul
  ratePerKm: number; // R_base
  multiplier: number; // M — already clamped to the driver's bounds
  effectiveRate: number; // R_base × M
  total: number; // B + D × effectiveRate — the driver's earning (the offer price)
}

/** Compute an offer's price from the vehicle profile + the two distance legs + the (already clamped) M. Every
 *  numeric input is sanitised to a finite number FIRST — this is money that flows into a vendor balance and the
 *  ledger, so a NaN/Infinity anywhere (a legacy vehicle with no profile, a bad geo leg) must resolve to a
 *  safe 0, never propagate. The caller resolves sensible class defaults; this is the last-line backstop. */
export function computeFreightPrice(input: { baseFee: number; ratePerKm: number; deadheadKm: number; tripKm: number; multiplier: number }): PriceBreakdown {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const num = (n: number) => (Number.isFinite(n) ? n : 0);
  const baseFee = round2(num(input.baseFee));
  const ratePerKm = num(input.ratePerKm);
  const multiplier = num(input.multiplier);
  const distanceKm = round2(Math.max(0, num(input.deadheadKm)) + Math.max(0, num(input.tripKm)));
  const effectiveRate = Math.round(ratePerKm * multiplier * 1000) / 1000;
  const total = round2(baseFee + distanceKm * effectiveRate);
  return { baseFee, distanceKm, ratePerKm, multiplier, effectiveRate, total };
}

/** What the SHIPPER pays = the driver's earning + the platform fee (the same 2% daughter-co margin the
 *  parcel side applies via withPlatformFee). The driver receives `driverTotal`; the platform keeps the fee. */
export function shipperCharge(driverTotal: number): number {
  return withPlatformFee(driverTotal);
}
