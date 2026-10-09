/**
 * Pure driver domain logic — no DOM, no fetch, no Preact. Everything here is deterministic
 * and unit-tested (logic.test.ts), because these are the numbers a driver is paid on.
 *
 * The capacity and rate-delta maths are harvested verbatim from the legacy driver.js so the
 * PWA and the old page can never disagree about what "72 / 800 kg" or "12% above" means.
 */

import type { Translate } from '../../shared/i18n';
import type { GeoPoint } from '../../shared/geo';
import type { AgentRow, Benchmark, BlockerKind, BoardRow, Claimable, DriverStatus, MdpRow, NodeOption, PriceBreakdown } from './types';

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

/**
 * How this driver looks for work by default, from what they drive.
 *
 * A bike or a bajaj works a district and comes back; a van, bus or truck runs a road. Neither is forbidden
 * the other — a trucker waiting out a morning in town may well want the patch — but the first screen should
 * already be the right one for the vehicle they just coupled to.
 */
export const DEFAULT_WORK_RADIUS_KM = 5;
export const MAX_WORK_RADIUS_KM = 15;

export function defaultWorkMode(vehicleClass: string | undefined): 'route' | 'near' {
  return vehicleClass === 'bike' || vehicleClass === 'motorcycle' || vehicleClass === 'tuktuk' ? 'near' : 'route';
}

/** True once there is no usable space left — turns the capacity bar red. */
export function isFull(remainingKg: number): boolean {
  return remainingKg <= 0;
}

/**
 * One line of plain language under the big number. Units spelled out, no abbreviations.
 *
 * `remainingTotes` is the OTHER capacity, and on a line-haul it is usually the one that binds: a bus with
 * 400 kg free whose boot holds no more bags is full in every way that matters to the driver standing at it,
 * so when the bags run out first the line says so instead of advertising kilos they cannot use.
 */
export function capacitySubLine(remainingKg: number, capacityKg: number, claimCount: number, t: Translate, remainingTotes?: number, vehicle?: string): string {
  const loads = claimCount === 1 ? t('driver.logic.loadClaimedOne') : t('driver.logic.loadClaimedMany', { count: claimCount });
  // The word for what they are actually driving — "Your bike is full". Falls back to the plain noun, which
  // is what a caller with no coupled vehicle honestly has.
  if (remainingKg <= 0) return t('driver.logic.vanFull', { loads, vehicle: vehicle ?? t('driver.vehicleWord.generic') });
  if (remainingTotes != null && remainingTotes <= 0) return t('driver.logic.bagsFull', { loads });
  if (remainingTotes != null) {
    return t(remainingTotes === 1 ? 'driver.logic.freeSpaceBagsOne' : 'driver.logic.freeSpaceBags', { kg: capacityKg, bags: remainingTotes, loads });
  }
  return t('driver.logic.freeSpace', { kg: capacityKg, loads });
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
export function rateBand(pricePerKm: number | null | undefined, benchmark: Benchmark | null | undefined, t: Translate): RateBand | null {
  if (!benchmark || !benchmark.count) return null;

  const mine = Number(pricePerKm ?? 0);
  const pct = benchmark.median > 0 ? Math.round(((mine - benchmark.median) / benchmark.median) * 100) : 0;
  const word = pct > 1 ? t('driver.logic.rateAbove', { pct }) : pct < -1 ? t('driver.logic.rateBelow', { pct: -pct }) : t('driver.logic.rateAt');

  const headline =
    pct > 1
      ? t('driver.logic.rateMore', { pct })
      : pct < -1
        ? t('driver.logic.rateLess', { pct: -pct })
        : t('driver.logic.rateSame');

  const detail = t('driver.logic.rateDetail', {
    mine: mine.toFixed(3),
    median: benchmark.median.toFixed(3),
    min: benchmark.min.toFixed(3),
    max: benchmark.max.toFixed(3),
    count: benchmark.count,
  });

  return {
    pct,
    word,
    headline,
    detail,
    showMatch: Math.abs(pct) > 1,
    matchPrice: roundPrice(benchmark.median),
    matchLabel: t('driver.logic.matchLabel', { price: benchmark.median.toFixed(3) }),
  };
}

/* ---------------------------------------------------------------- driver -- */

/**
 * Why no shift can start yet. Null when they are ACTIVE.
 *
 * IT HAS TO NAME THE RIGHT PARTY. This said "the fleet office must activate you" to everybody, including
 * couriers who have no fleet — and to somebody who had just signed up on their own, that sentence reads
 * as "you joined the wrong way". It was the last link in a chain that made independent registration look
 * impossible, and the only one made of words rather than of a missing field.
 */
export function driverStatusNotice(status: DriverStatus | undefined, t: Translate, hasFleet = true): string | null {
  if (!status || status === 'ACTIVE') return null;
  const state = status.replace(/_/g, ' ').toLowerCase();
  return t(hasFleet ? 'driver.logic.statusNotice' : 'driver.logic.statusNoticeOwn', { status: state });
}

/** Why a fleet took this driver off, and what it means — the fleet's own words when it chose to give them. */
export function removalWords(removed: { reason: 'left' | 'ended' | 'other'; note?: string }, t: Translate): string {
  const why = removed.reason === 'left' ? t('driver.fleet.removedLeft') : removed.reason === 'ended' ? t('driver.fleet.removedEnded') : removed.note ? t('driver.fleet.removedNote', { note: removed.note }) : '';
  return [why, t('driver.fleet.removedNext')].filter(Boolean).join(' ');
}

export function canStartShift(status: DriverStatus | undefined): boolean {
  return status === 'ACTIVE';
}

/* -------------------------------------------------------------- speaking -- */

/**
 * The read-aloud screen summary. Units are spelled out ("kilograms", never "kg") because a
 * speech synthesiser reads "kg" as the letters k-g.
 */
export function shiftSummary(plate: string, remainingKg: number, claimCount: number, t: Translate): string {
  return t('driver.logic.shiftSummary', { plate, kg: remainingKg, count: claimCount });
}

export function offShiftSummary(t: Translate): string {
  return t('driver.logic.offShiftSummary');
}

export function offersSummary(count: number, t: Translate): string {
  if (count === 0) return t('driver.logic.offersNone');
  if (count === 1) return t('driver.logic.offersOne');
  return t('driver.logic.offersMany', { count });
}

export function loadsSummary(claims: Claimable[], remainingKg: number, t: Translate): string {
  if (claims.length === 0) return t('driver.logic.loadsNone');
  return claims.length === 1
    ? t('driver.logic.loadsOne', { count: claims.length, kg: remainingKg })
    : t('driver.logic.loadsMany', { count: claims.length, kg: remainingKg });
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
export function countdownLabel(seconds: number, t: Translate): string {
  if (seconds <= 0) return t('driver.logic.gone');
  if (seconds < 60) return t('driver.logic.secLeft', { seconds });
  return t('driver.logic.minLeft', { min: Math.floor(seconds / 60) });
}

/**
 * Detour, weight, time and the earning in one plain sentence for the read-aloud summary.
 *
 * Reads `earn`, which covers a bag as well as a freight. It used to read the freight-only price, so a
 * driver who listens rather than reads — the whole reason this exists — heard every figure except the one
 * on the bags they were being offered.
 */
export function offerSpoken(
  o: { message: string; weightKg: number; destLabel: string; detourKm: number; earn?: number; parcels?: number; collectMin?: number; deliverMin?: number },
  t: Translate,
): string {
  const base = t('driver.logic.offerSpokenBase', { message: o.message, kg: o.weightKg, dest: o.destLabel, detour: o.detourKm });
  const withEarn = o.earn != null ? t('driver.logic.offerSpokenEarn', { base, amount: money(o.earn) }) : base;
  // The time cost is spoken too, and for the same reason the card leads with it: a driver hears "nine extra
  // minutes" and knows at once whether it fits the day, where kilometres need converting first.
  const withTime =
    o.collectMin == null
      ? withEarn
      : o.deliverMin != null
        ? t('driver.logic.offerSpokenTime', { base: withEarn, collect: o.collectMin, deliver: o.deliverMin })
        : t('driver.logic.offerSpokenTimeCollect', { base: withEarn, collect: o.collectMin });
  // A bag's contents are spoken too — the ear should get the same facts as the eye, and how many parcels
  // are in a bag is what the unloading at the far end will actually be.
  if (o.parcels == null) return withTime;
  const inside = t(o.parcels === 1 ? 'driver.offers.parcelOne' : 'driver.offers.parcelMany', { count: o.parcels });
  return t('driver.logic.offerSpokenInside', { base: withTime, inside });
}

/* ---------------------------------------------------------------- pricing -- */

/** Plain money, two decimals, no symbol — the driver's local currency is set by their zone. */
export function money(v: number | null | undefined): string {
  return (Number(v) || 0).toFixed(2);
}

/**
 * FB3a — the point the board is read from.
 *
 * A chosen origin WINS over the device and never waits on it. The operator most likely to be browsing the
 * market is the one indoors at a desk deciding where to work next, and making their answer about Mombasa
 * depend on a satellite fix in Nairobi would fail the browse for exactly them.
 *
 * Returns null only when there is neither — and then the board must say so rather than guessing, because
 * every distance, every price and the entire sort order are measured from this point.
 */
export function boardOriginPin(origin: { pin: GeoPoint | null } | null, device: GeoPoint | null): GeoPoint | null {
  return origin?.pin ?? device ?? null;
}

/** Is the half-typed origin usable? Both halves or neither: a name nobody could place is not a point, and a
 *  bare pin cannot be read back to the operator on the row above the list. */
export function originReady(place: { label: string; pin: GeoPoint | null }): boolean {
  return Boolean(place.pin && place.label.trim());
}

/**
 * S34c — the driver's minimum-earning filter as a number the API accepts, or undefined for "show all". Only a
 * finite POSITIVE floor is a real filter: blank, 0, a negative (a naive `x || undefined` keeps -5, which the
 * backend's @Min(0) would then 400), or junk all collapse to undefined — matching the backend's `minEarn > 0`.
 */
export function minEarnFilter(raw: string | number | null | undefined): number | undefined {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/**
 * S33b — was the JUST-logged temperature reading a breach? The recordTemp response returns the whole freight,
 * whose `tempBreached` is STICKY (stays true after any past breach). To warn a driver about THIS reading (not a
 * past one), key off the last reading's own verdict, not the sticky flag — an in-band reading after a recovery
 * must read as fine, not as a fresh alert.
 */
export function lastReadingBreached(readings: Array<{ breach: boolean }> | undefined): boolean {
  return Boolean(readings?.length && readings[readings.length - 1].breach);
}

/**
 * The transparent breakdown behind a freight earning, as plain lines for a Checklist. Every term a driver
 * can see and trust: the flag-down fee, the distance × the rate actually applied, and — only when the
 * market moved the rate off the base — a note that a busy- or quiet-time rate is in effect.
 */
export function priceBreakdownLines(price: PriceBreakdown | undefined, t: Translate): string[] {
  if (!price) return [];
  const lines = [
    t('driver.logic.baseFee', { amount: money(price.baseFee) }),
    t('driver.logic.distanceAt', { km: price.distanceKm, rate: price.effectiveRate.toFixed(3) }),
  ];
  // FB0a — how much of that distance is run EMPTY. The pay is on the total either way; this line exists
  // because "80 km, 8 of them loaded" and "80 km, 72 of them loaded" are not the same job. Only shown when the
  // price actually carries the split — an older locked price has none, and a guess here would be a lie.
  if (typeof price.deadheadKm === 'number' && typeof price.loadedKm === 'number') {
    lines.push(t('driver.logic.distanceSplit', { empty: price.deadheadKm, loaded: price.loadedKm }));
  }
  if (price.multiplier > 1) lines.push(t('driver.logic.busyRate', { pct: Math.round((price.multiplier - 1) * 100) }));
  else if (price.multiplier < 1) lines.push(t('driver.logic.quietRate', { pct: Math.round((1 - price.multiplier) * 100) }));
  return lines;
}

/* ------------------------------------------------------------- the board -- */

// The colour table lives in shared/board.ts — the fleet's dispatch view (FP5) reads the same board.
export { blockerTone } from '../../shared/board';

/** One change, and what taking it would open up. */
export interface Unlock {
  code: string;
  kind: BlockerKind;
  message: string;
  /** How many loads ON THIS BOARD this single change would make takeable. */
  loads: number;
  /** What those loads would pay, at this vehicle's own rate. 0 when none of them could be priced. */
  earnings: number;
}

/**
 * WHAT WOULD UNLOCK MORE WORK — the reason the board shows loads you cannot take.
 *
 * "Information is a key for decision making and that is also true for investments. Entrepreneurs should get
 * that data from us." A list of red rows is not that; "a forklift would open 7 more loads worth 12,400 on
 * this board today" is.
 *
 * ONLY single-obstacle rows count. If a load needs both a forklift and twelve more tonnes, buying the
 * forklift unlocks nothing, and counting it under both would promise an operator work they still could not
 * take — the most expensive kind of wrong number this screen could show. 'unknown' marks are ignored in that
 * test, because an unchecked route never blocked the load in the first place.
 *
 * Sorted by earnings, then by count: what is worth most comes first, since that is the decision being made.
 */
export function unlocks(rows: BoardRow[]): Unlock[] {
  const found = new Map<string, Unlock>();
  for (const row of rows) {
    if (row.canTake) continue;
    const real = row.blockers.filter((b) => b.kind !== 'unknown');
    if (real.length !== 1) continue;
    const [b] = real;
    // A preference is somebody's choice, not a purchase. It stays on the row where an operator can argue with
    // it, but it never appears as something to go and buy.
    if (b.kind === 'preference') continue;
    const at = found.get(b.code) ?? { code: b.code, kind: b.kind, message: b.message, loads: 0, earnings: 0 };
    at.loads += 1;
    at.earnings = Math.round((at.earnings + (row.price?.total ?? 0)) * 100) / 100;
    found.set(b.code, at);
  }
  return [...found.values()].sort((a, b) => b.earnings - a.earnings || b.loads - a.loads);
}

/** A spoken summary of the board — what is takeable now, and what is being shown anyway. */
export function boardSummary(rows: BoardRow[], t: Translate): string {
  if (rows.length === 0) return t('driver.board.spokenEmpty');
  const can = rows.filter((r) => r.canTake).length;
  return t('driver.board.spoken', { total: rows.length, can, blocked: rows.length - can });
}

/**
 * The distance line for a row: how far EMPTY, how far LOADED, and what that works out at per kilometre.
 *
 * The empty run is named first on purpose. It is the number a fixed-cost operator is actually deciding on,
 * and the whole reason FB0a split it back out of the total.
 */
export function boardDistanceLine(row: BoardRow, t: Translate): string {
  return t('driver.board.distance', { empty: row.deadheadKm, loaded: row.loadedKm, total: row.totalKm });
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

/** FP8 — the shift clock in one line: how long on duty against the limit, and the plain word once it is passed. */
export function hoursWords(h: { onDuty: number; limit: number; over: boolean; near?: boolean } | undefined, t: Translate): string | null {
  if (!h) return null;
  if (h.over) return t('driver.home.hoursOverLine', { onDuty: h.onDuty, limit: h.limit });
  // The last hour is said as the last hour: it is the last moment the news is of any use.
  return t(h.near ? 'driver.home.hoursNearLine' : 'driver.home.hoursLine', { onDuty: h.onDuty, limit: h.limit });
}

/** What ending the shift NOW means for the next one: a working day owes its rest, a short coupling owes nothing. */
export function afterShiftLine(h: { restOwed?: boolean; restHours: number } | undefined, t: Translate): string {
  return h?.restOwed ? t('driver.home.end2Rest', { rest: h.restHours }) : t('driver.home.end2');
}

/**
 * OFF DUTY AFTER A WORKING DAY: from when the next shift can start — said before they try, because until now the only
 * way to learn it was to start a shift and be refused — and whether they have asked to be told at that moment.
 */
export function restSays(
  h: { restUntil?: string; tellWhenRested?: boolean; restHours: number } | undefined,
  t: Translate,
  clock: (iso: string) => string,
): { title: string; detail: string; asked: boolean } | null {
  if (!h?.restUntil) return null;
  const asked = Boolean(h.tellWhenRested);
  return { title: t('driver.home.restTitle', { time: clock(h.restUntil) }), detail: t(asked ? 'driver.home.restAsked' : 'driver.home.restDetail', { rest: h.restHours }), asked };
}

/** Loading a bag books the driver's payout against their badge; without one, nothing is booked. */
export function canLoadBag(badgeId: string | undefined): boolean {
  return typeof badgeId === 'string' && badgeId.length > 0;
}

/* ----------------------------------------------------------------- nodes -- */

/** Hubs and shops flattened into one pick-list. Agents with no location cannot be routed to. */
export function nodeOptions(mdps: MdpRow[] | null, agents: AgentRow[] | null, t: Translate): NodeOption[] {
  const hubs = (mdps ?? [])
    .filter((m) => m?.location)
    .map((m) => ({ id: m.mdpId, label: t('driver.logic.hubLabel', { name: m.name }), lat: m.location.lat, lng: m.location.lng }));
  const shops = (agents ?? [])
    .filter((a) => a?.location)
    .map((a) => ({ id: a.did, label: a.shopName, lat: a.location!.lat, lng: a.location!.lng }));
  return [...hubs, ...shops];
}

/**
 * THE LIVE LINE in the top bar — where this driver is going and what room is left.
 *
 * It replaced the driver's own name, which they already know. What actually changes across a shift is
 * whether they are on it, the road they declared, and how much of the vehicle is still free.
 *
 * COMMITTED STATE ONLY. Waiting offers are deliberately absent: an offer is an incoming event, and a
 * header that moves when one lands pulls a driver's eyes off the road and competes with the nudge —
 * which this product restrains to one pop-up and one decision precisely so it stays interruptible on
 * the driver's terms. The bar reports what they have agreed to, never what is being asked of them.
 */
export function driverWorkLine(
  session: { active?: boolean } | null,
  route: { toLabel?: string } | null,
  remainingTotes: number | null,
  t: Translate,
): string | undefined {
  if (!session?.active) return t('driver.bar.offShift');
  const bits = [route?.toLabel ? t('driver.bar.heading', { place: route.toLabel }) : t('driver.bar.onShift')];
  // Only when the hold is actually measured in bags. A vehicle with no bag capacity (or a figure we
  // never received) says nothing rather than claiming "0 free", which reads as full.
  if (typeof remainingTotes === 'number' && remainingTotes >= 0) {
    bits.push(t('driver.bar.bagsFree', { count: remainingTotes }));
  }
  return bits.join(' · ');
}

/* ------------------------------------------------------- the road, reported -- */

/**
 * What a driver can report from the cab, in the order the sheet shows it.
 *
 * BLOCKERS FIRST, advisories last, because the list is read top-down by somebody who has already pulled
 * over and wants to be moving again. This mirrors the backend's CONSTRAINT_KINDS; the server is the
 * authority and refuses anything it does not know, so drift here fails safe rather than silently.
 */
export const ROAD_KINDS = [
  'LOW_BRIDGE',
  'HEIGHT_BARRIER',
  'WEIGHT_LIMIT',
  'NO_HAZMAT',
  'WASHOUT',
  'WEIGHBRIDGE',
  'FERRY',
  'CHECKPOINT',
  'ROAD_CLOSED',
  'BORDER_CLOSED',
] as const;
export type RoadKind = (typeof ROAD_KINDS)[number];

/**
 * Which kinds carry a number, and what the number IS.
 *
 * A height or a limit is the whole content of the report — the server refuses "low bridge, unknown
 * height", because an unmeasured limit cannot be checked against any load. Asking here rather than
 * letting that round-trip fail is the difference between one tap and a rejected form at a junction.
 */
export function roadMeasure(kind: string): 'height_m' | 'weight_kg' | null {
  if (kind === 'LOW_BRIDGE' || kind === 'HEIGHT_BARRIER') return 'height_m';
  if (kind === 'WEIGHT_LIMIT') return 'weight_kg';
  return null;
}

/**
 * Does meeting this stop a vehicle, or only cost it time?
 *
 * The distinction the whole list lives on. A ferry and a weighbridge are things a haulier wants to know
 * about and neither is a reason to refuse a load; showing them with the same weight as "this bridge will
 * not take you" teaches a driver to skim past both.
 */
export function roadBlocks(kind: string): boolean {
  // Closed is closed: a closed road or border stops every vehicle, whatever it carries.
  return kind === 'LOW_BRIDGE' || kind === 'HEIGHT_BARRIER' || kind === 'WEIGHT_LIMIT' || kind === 'NO_HAZMAT' || kind === 'WASHOUT' || kind === 'ROAD_CLOSED' || kind === 'BORDER_CLOSED';
}

/**
 * The colour one reported constraint is shown in.
 *
 * A DISPUTED blocker is still 'danger', never softened. Somebody saying a low bridge is gone does not
 * make it gone — it is exactly the state in which a driver must keep treating it as there — so the only
 * thing dispute changes on screen is the sentence beside it, never the weight of the warning.
 */
export function roadTone(c: { kind: string; status: string }): 'danger' | 'info' {
  return roadBlocks(c.kind) ? 'danger' : 'info';
}

/** Metres or tonnes, in the words on the sign. Tonnes because no sign anywhere is posted in kilograms. */
export function roadValueLabel(c: { kind: string; value?: number }, t: Translate): string | null {
  const measure = roadMeasure(c.kind);
  if (measure == null || c.value == null) return null;
  return measure === 'height_m'
    ? t('driver.road.metres', { n: String(Math.round(c.value * 10) / 10) })
    : t('driver.road.tonnes', { n: String(Math.round(c.value / 100) / 10) });
}

/**
 * The one-line summary above the list.
 *
 * Says how many things are REPORTED, and never anything about the rest of the road. "Nothing reported"
 * is not "clear", and the sentence has to survive being read quickly by somebody who wants it to mean
 * the road is fine.
 */
export function roadSummary(items: Array<{ kind: string }>, t: Translate): string {
  if (items.length === 0) return t('driver.road.noneReported');
  const blocking = items.filter((c) => roadBlocks(c.kind)).length;
  if (blocking === 0) return t('driver.road.onlyAdvisories', { count: items.length });
  return t('driver.road.someBlocking', { count: items.length, blocking });
}
