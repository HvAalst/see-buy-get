// Dynamic freight pricing (S34). A vehicle's pricing profile — baseFee B, pricePerKm R_base, and the
// multiplier corridor [minMultiplier, maxMultiplier] — meets the market: an offer's price is
//   P = B + D·R_base·M
// where D is the total trip distance (deadhead driver→pickup + haul pickup→dropoff) and M is a market
// multiplier the platform flexes WITHIN the driver's own bounds — the driver always owns the floor + ceiling.
// S34a ships a deliberately simple time-of-day multiplier; S34b swaps in the real supply/demand engine while
// keeping the clamp-to-bounds contract. All pure functions here so the pricing is trivially testable.

import { withPlatformFee } from './pudo.config';
// PriceBreakdown is declared in dispatch.types because it is a WIRE type — it rides on an Offer and on a
// Freight, and the OpenAPI emitter only introspects the *.types.ts files. Declared here it emitted as a bare
// typeless object, so every generated client saw `price: object` and no screen could read a term off it. The
// dependency runs one way: dispatch.types knows nothing about this module.
import { PriceBreakdown } from './dispatch.types';

export { PriceBreakdown };

/** Sanity bounds for a declared multiplier — never below a small floor, never a runaway ceiling. */
export function clampMultiplier(m: number): number {
  if (!Number.isFinite(m)) return 1;
  return Math.min(3, Math.max(0.1, Math.round(m * 100) / 100));
}

// Peak windows (local time): the morning + evening rush earn a surcharge (still clamped to the driver's max).
const PEAK_HOURS = new Set([7, 8, 16, 17, 18]);
const PEAK_BONUS = 0.15;

/** The seasonal (time-of-day) component of the multiplier — 1.0 off-peak, +PEAK_BONUS in a rush-hour window.
 *  The market engine (S34b) multiplies this by a per-zone supply/demand factor before the corridor clamp. */
export function seasonalFactor(now: Date): number {
  return PEAK_HOURS.has(now.getHours()) ? 1 + PEAK_BONUS : 1;
}

/**
 * The market multiplier for a job, CLAMPED to the driver's [min, max] corridor — the invariant the driver owns.
 * It is the seasonal (time-of-day) factor times a `marketFactor` the caller supplies: 1.0 by default (S34a's
 * behaviour), and in S34b the per-zone supply/demand + admin-surge factor from the MarketPulseStore. The clamp
 * to the vehicle's own corridor is the guarantee: however hot the market, the driver's floor and ceiling hold.
 */
export function freightMultiplier(now: Date, bounds: { min: number; max: number }, marketFactor = 1): number {
  const market = Number.isFinite(marketFactor) ? marketFactor : 1;
  const m = Math.round(seasonalFactor(now) * market * 100) / 100;
  // Sanitise the corridor on READ: a vehicle persisted before pricing existed rehydrates with undefined
  // bounds, and an undefined slipping into Math.min/max yields NaN — which must never reach a price or a
  // ledger. A non-finite bound falls back to a neutral 1.0 (the safe identity), never NaN.
  const lo = Number.isFinite(bounds.min) ? bounds.min : 1;
  const hi = Number.isFinite(bounds.max) ? bounds.max : 1;
  return Math.min(hi, Math.max(lo, m));
}

/**
 * The deadhead/loaded split of a breakdown, or null when it predates FB0a and simply does not have one.
 *
 * Never derive a split from distanceKm alone. A caller showing "—" tells the truth; a caller that assumes the
 * whole distance was loaded (or was empty) invents the one figure the operator is deciding on.
 */
export function distanceSplit(b: Pick<PriceBreakdown, 'deadheadKm' | 'loadedKm'> | undefined): { deadheadKm: number; loadedKm: number } | null {
  if (!b || !Number.isFinite(b.deadheadKm as number) || !Number.isFinite(b.loadedKm as number)) return null;
  return { deadheadKm: b.deadheadKm as number, loadedKm: b.loadedKm as number };
}

/**
 * What the driver earns per kilometre they actually turn — INCLUDING the empty run to reach the load.
 *
 * This is the board's sort key, and it is deliberately not earnings-per-loaded-km: a 200 km haul reached by
 * running 180 km empty is a worse job than a 40 km haul at the door, and only the total denominator says so.
 * Returns null when the breakdown has no split (pre-FB0a) or the distance is zero — an unsortable row is
 * shown as unsortable, never floated to the top by a fabricated score.
 */
export function earningsPerKm(b: PriceBreakdown | undefined): number | null {
  if (!b || !Number.isFinite(b.total)) return null;
  const d = distanceSplit(b);
  if (!d) return null;
  const totalKm = d.deadheadKm + d.loadedKm;
  if (!(totalKm > 0)) return null;
  return Math.round((b.total / totalKm) * 100) / 100;
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
  // FB0a — keep the halves as well as the sum. Each is sanitised and floored the same way the total always
  // was, so deadheadKm + loadedKm === distanceKm holds for every input, including the defensive ones.
  const deadheadKm = round2(Math.max(0, num(input.deadheadKm)));
  const loadedKm = round2(Math.max(0, num(input.tripKm)));
  const distanceKm = round2(deadheadKm + loadedKm);
  const effectiveRate = Math.round(ratePerKm * multiplier * 1000) / 1000;
  const total = round2(baseFee + distanceKm * effectiveRate);
  return { baseFee, distanceKm, deadheadKm, loadedKm, ratePerKm, multiplier, effectiveRate, total };
}

/**
 * What carrying a BAG is worth, over and above the handling fee for scanning it aboard.
 *
 * The tote path used to pay a driver a flat `TOTE_LOAD_FEE` and nothing else — the same fifty cents for two
 * kilometres and for sixty, for a bag holding one parcel and for a bag holding twelve. Meanwhile the buyers
 * inside that bag were each charged `km × rate × their size factor`. Revenue was measured per kilometre and
 * per unit of room; payment was measured in neither. This closes that.
 *
 * `units` is the bag's fill in MEDIUM-EQUIVALENTS (`Tote.unitsUsed`, summed from SIZE_UNITS with M = 1) —
 * deliberately the SAME basis the quote charged on, so for the first time the two sides of the transaction
 * are denominated in one unit and can be compared.
 *
 * PAID FOR WHAT IS CARRIED, NOT FOR THE SLOT. A half-full bag pays half, and that is right rather than
 * harsh: this is belly freight in a vehicle that was going anyway, so the marginal cost of the empty space
 * is near zero — and paying a full-bag rate for air would spend a 2% margin on a shortfall that is often
 * 50%. The empty space is an opportunity cost only if somebody else wanted it, and the answer to that is to
 * fill the trip, not to subsidise the emptiness.
 *
 * No market multiplier, unlike freight: surge deliberately does not reach parcels, and a bag is parcels.
 */
export function computeToteHaul(input: { ratePerKm: number; tripKm: number; units: number }): { tripKm: number; ratePerKm: number; units: number; road: number } {
  const round2 = (n: number) => Math.round(n * 100) / 100;
  const num = (n: number) => (Number.isFinite(n) ? n : 0);
  // Money into a ledger: every input is sanitised to a finite, non-negative number FIRST. An unresolvable
  // leg arrives here as 0 km and correctly earns nothing extra, rather than propagating a NaN into a payout.
  const tripKm = round2(Math.max(0, num(input.tripKm)));
  const ratePerKm = num(input.ratePerKm);
  const units = round2(Math.max(0, num(input.units)));
  return { tripKm, ratePerKm, units, road: round2(tripKm * Math.max(0, ratePerKm) * units) };
}

/**
 * What the SHIPPER pays = the driver's earning + the platform's take. The driver receives `driverTotal`.
 *
 * `pct` is the SELLING SISTER's rate for the dedicated lane — the same three-layer stack the parcel side
 * resolves, and the reason the dedicated knob is not decorative: freight is where a specialised vehicle is
 * bought and where profit-on-risk is actually earned. Omitted falls back to the network default, which is
 * the honest answer for a load with no sister on it (a counter-booked cash freight settles off-platform,
 * so nobody is billed and there is no seller to have a rate).
 */
export function shipperCharge(driverTotal: number, pct?: number): number {
  return withPlatformFee(driverTotal, pct);
}
