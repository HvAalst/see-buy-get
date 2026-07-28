/**
 * Pure driver domain logic — no DOM, no fetch, no Preact. Everything here is deterministic
 * and unit-tested (logic.test.ts), because these are the numbers a driver is paid on.
 *
 * The capacity and rate-delta maths are harvested verbatim from the legacy driver.js so the
 * PWA and the old page can never disagree about what "72 / 800 kg" or "12% above" means.
 */

import type { AgentRow, Benchmark, Claimable, DriverStatus, MdpRow, NodeOption, PriceBreakdown } from './types';

/* -------------------------------------------------------------- capacity -- */

/**
 * Percent of the vehicle's capacity currently in use.
 *
 * Three properties are load-bearing and must survive any refactor:
 *  - divide-by-zero guard: a vehicle with capacityKg 0 reads 0%, not NaN%;
 *  - the clamp: `remaining` is server-authoritative and CAN go negative (the office may
 *    shrink capacityKg mid-shift, after loads are already claimed), which would otherwise
 *    push the bar past 100% and out of its track;
 *  - rounding to whole percent, matching the bar's pixel resolution.
 *
 * The clamp applies to the BAR only. The numeric row shows the honest figure — a driver who
 * is 40 kg over must see that, not a tidy zero.
 */
export function usedPercent(capacityKg: number | null | undefined, remainingKg: number): number {
  if (!capacityKg) return 0;
  return Math.max(0, Math.min(100, Math.round(((capacityKg - remainingKg) / capacityKg) * 100)));
}

/** True once there is no usable space left — turns the capacity bar red. */
export function isFull(remainingKg: number): boolean {
  return remainingKg <= 0;
}

/** One line of plain language under the big number. Units spelled out, no abbreviations. */
export function capacitySubLine(remainingKg: number, capacityKg: number, claimCount: number): string {
  const loads = claimCount === 1 ? '1 load claimed' : `${claimCount} loads claimed`;
  if (remainingKg <= 0) return `Your van is full — ${loads}. Deliver something to free up space.`;
  return `Free space out of ${capacityKg} kg — ${loads}.`;
}

/* ------------------------------------------------------------------ rate -- */

export interface RateBand {
  /** Whole-percent delta against the market median; positive = charging more. */
  pct: number;
  /** The legacy wording fragment: "12% above" | "8% below" | "at". */
  word: string;
  /** Plain-language headline for the card. */
  headline: string;
  /** The numbers, for a driver who wants them. */
  detail: string;
  /** ±1% is a dead zone — nobody should be nudged over a rounding artefact. */
  showMatch: boolean;
  /** Already rounded to 3 decimals, exactly as it will be sent to the server. */
  matchPrice: number;
  matchLabel: string;
}

/** The price the API is given — 3 decimals, matching the 3-dp display. */
export function roundPrice(price: number): number {
  return Math.round(price * 1000) / 1000;
}

/**
 * The driver's per-km price against the network benchmark.
 *
 * Returns null when there is no benchmark or `count === 0`: a "market median" derived from a
 * single vehicle is worse than no number at all, and would talk a driver into changing their
 * price against themselves.
 *
 * Queried without lat/lng on purpose — vehicles roam, so the meaningful comparison is the
 * whole network, not a radius around wherever the phone happens to be.
 */
export function rateBand(pricePerKm: number | null | undefined, benchmark: Benchmark | null | undefined): RateBand | null {
  if (!benchmark || !benchmark.count) return null;

  const mine = Number(pricePerKm ?? 0);
  const pct = benchmark.median > 0 ? Math.round(((mine - benchmark.median) / benchmark.median) * 100) : 0;
  const word = pct > 1 ? `${pct}% above` : pct < -1 ? `${-pct}% below` : 'at';

  const headline =
    pct > 1
      ? `You charge ${pct}% more than most drivers.`
      : pct < -1
        ? `You charge ${-pct}% less than most drivers.`
        : 'You charge about the same as most drivers.';

  const detail =
    `Your rate ${mine.toFixed(3)} per km. Most drivers charge ${benchmark.median.toFixed(3)} ` +
    `(${benchmark.min.toFixed(3)}–${benchmark.max.toFixed(3)} across ${benchmark.count} vehicles).`;

  return {
    pct,
    word,
    headline,
    detail,
    showMatch: Math.abs(pct) > 1,
    matchPrice: roundPrice(benchmark.median),
    matchLabel: `Match ${benchmark.median.toFixed(3)}`,
  };
}

/* ---------------------------------------------------------------- driver -- */

/** The office must activate a driver before any shift can start. Null when they are ACTIVE. */
export function driverStatusNotice(status: DriverStatus | undefined): string | null {
  if (!status || status === 'ACTIVE') return null;
  return `Your driver account is ${status.replace(/_/g, ' ').toLowerCase()}. The fleet office must activate you before you can start a shift.`;
}

export function canStartShift(status: DriverStatus | undefined): boolean {
  return status === 'ACTIVE';
}

/* -------------------------------------------------------------- speaking -- */

/**
 * The read-aloud screen summary. Units are spelled out ("kilograms", never "kg") because a
 * speech synthesiser reads "kg" as the letters k-g.
 */
export function shiftSummary(plate: string, remainingKg: number, claimCount: number): string {
  return `On shift with ${plate}. Remaining capacity ${remainingKg} kilograms. ${claimCount} claimed loads.`;
}

export function offShiftSummary(): string {
  return 'Scan the vehicle QR on the dashboard to start your shift.';
}

export function offersSummary(count: number): string {
  if (count === 0) return 'No shipments waiting on this route right now.';
  if (count === 1) return 'One shipment on your way. Swipe to see it, then claim it.';
  return `${count} shipments on your way. Swipe through them, then claim the ones you want.`;
}

export function loadsSummary(claims: Claimable[], remainingKg: number): string {
  if (claims.length === 0) return 'You have no claimed loads. Find work on your route to pick some up.';
  const noun = claims.length === 1 ? 'load' : 'loads';
  return `${claims.length} claimed ${noun}. Remaining capacity ${remainingKg} kilograms.`;
}

/* ---------------------------------------------------------------- offers -- */

/**
 * Seconds left on an offer. The server's TTL is 10 minutes and it auto-expires on read, so a
 * card that has been sitting on screen is very often already dead — the countdown is what
 * stops a driver tapping Claim on a corpse.
 */
export function secondsLeft(expiresAt: string, now: number = Date.now()): number {
  const t = Date.parse(expiresAt);
  if (Number.isNaN(t)) return 0;
  return Math.max(0, Math.round((t - now) / 1000));
}

/** "4 min left" / "45 sec left" / "Gone". Never a bare number. */
export function countdownLabel(seconds: number): string {
  if (seconds <= 0) return 'Gone';
  if (seconds < 60) return `${seconds} sec left`;
  return `${Math.floor(seconds / 60)} min left`;
}

/** Detour, weight, time and (for freight) the earning in one plain sentence for the read-aloud summary. */
export function offerSpoken(o: { message: string; weightKg: number; destLabel: string; detourKm: number; price?: PriceBreakdown }): string {
  const base = `${o.message} ${o.weightKg} kilograms to ${o.destLabel}. ${o.detourKm} kilometres extra driving.`;
  return o.price ? `${base} You earn ${money(o.price.total)}.` : base;
}

/* ---------------------------------------------------------------- pricing -- */

/** Plain money, two decimals, no symbol — the driver's local currency is set by their zone. */
export function money(v: number | null | undefined): string {
  return (Number(v) || 0).toFixed(2);
}

/**
 * The transparent breakdown behind a freight earning, as plain lines for a Checklist. Every term a driver
 * can see and trust: the flag-down fee, the distance × the rate actually applied, and — only when the
 * market moved the rate off the base — a note that a busy- or quiet-time rate is in effect.
 */
export function priceBreakdownLines(price: PriceBreakdown | undefined): string[] {
  if (!price) return [];
  const lines = [
    `Base fee ${money(price.baseFee)}`,
    `${price.distanceKm} km at ${price.effectiveRate.toFixed(3)} per km`,
  ];
  if (price.multiplier > 1) lines.push(`Busy-time rate: ${Math.round((price.multiplier - 1) * 100)}% more per km`);
  else if (price.multiplier < 1) lines.push(`Quiet-time rate: ${Math.round((1 - price.multiplier) * 100)}% less per km`);
  return lines;
}

/* ----------------------------------------------------------------- loads -- */

export type ClaimControl = 'load' | 'onboard' | 'pickup' | 'deliver' | 'none';

/**
 * What the trailing control on a claim row should be.
 *  - 'load'    — a tote still sitting at a shop/hub: one scan puts it on the van.
 *  - 'onboard' — already on the van, nothing to do.
 *  - 'pickup'  — a claimed dedicated-freight job awaiting collection (claimed → in_transit).
 *  - 'deliver' — an in-transit freight job to drop at its destination (in_transit → delivered).
 *  - 'none'    — nothing actionable (a freight in an unexpected state).
 */
export function claimControl(claim: Claimable): ClaimControl {
  if (claim.kind === 'freight') {
    if (claim.status === 'in_transit') return 'deliver';
    if (claim.status === 'claimed') return 'pickup';
    return 'none';
  }
  if (claim.pickupLabel === 'on board') return 'onboard';
  if (claim.kind === 'tote') return 'load';
  return 'none';
}

/** Loading a bag books the driver's payout against their badge; without one, nothing is booked. */
export function canLoadBag(badgeId: string | undefined): boolean {
  return typeof badgeId === 'string' && badgeId.length > 0;
}

/* ----------------------------------------------------------------- nodes -- */

/** Hubs and shops flattened into one pick-list. Agents with no location cannot be routed to. */
export function nodeOptions(mdps: MdpRow[] | null, agents: AgentRow[] | null): NodeOption[] {
  const hubs = (mdps ?? [])
    .filter((m) => m?.location)
    .map((m) => ({ id: m.mdpId, label: `${m.name} (hub)`, lat: m.location.lat, lng: m.location.lng }));
  const shops = (agents ?? [])
    .filter((a) => a?.location)
    .map((a) => ({ id: a.did, label: a.shopName, lat: a.location!.lat, lng: a.location!.lng }));
  return [...hubs, ...shops];
}
