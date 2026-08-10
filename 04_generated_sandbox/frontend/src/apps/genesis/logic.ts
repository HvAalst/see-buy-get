/**
 * Pure Send-app logic — no DOM, no fetch, no Preact. Deterministic and unit-tested.
 * The status ladder wording is the consumer-facing half of the parcel state machine;
 * the quote presentation decides what a sender is told a journey costs.
 */

import { distanceLabel, haversineKm, type GeoPoint } from '../../shared/geo';
import type { IconName } from '../../shared/ui/Icon';
import type { ConsumerParcelView, NetworkPoint, ParcelSize, ParcelStatus, PersonRole, QuoteView, TrackView } from './types';

/* ------------------------------------------------------------------ sizes -- */

export const SIZES: Array<{ key: ParcelSize; label: string; hint: string }> = [
  { key: 'S', label: 'Small', hint: 'Fits in one hand' },
  { key: 'M', label: 'Medium', hint: 'Shoebox' },
  { key: 'L', label: 'Large', hint: 'Needs both arms' },
  { key: 'HEAVY', label: 'Heavy', hint: 'Over 20 kg' },
];

/** The plain-words presentation of a DERIVED tier (PG3: sizes are computed from dims, never tapped). */
export function sizeMeta(size: ParcelSize): { key: ParcelSize; label: string; hint: string } {
  return SIZES.find((s) => s.key === size) ?? { key: size, label: size, hint: '' };
}

/* ------------------------------------------------------------- dims (PG3) -- */

/** The measure-your-parcel form: free-typed strings until they parse (identical to the vendor mint). */
export interface DimsForm {
  l: string;
  w: string;
  h: string;
  kg: string;
}

export const EMPTY_DIMS: DimsForm = { l: '', w: '', h: '', kg: '' };

/** The smallest measurement we accept, in cm — 1 mm, so a thin item (an envelope / a letter at ~0.5 cm
 *  thick) is shippable. Mirrors the backend's @Min. */
export const MIN_DIM_CM = 0.1;

/** Accept a European decimal comma ("0,5") as well as a dot before parsing. */
function num(s: string): number {
  return Number(String(s).trim().replace(',', '.'));
}

/**
 * Parse the typed dims + weight, or null while anything is missing/invalid. Explicit range checks —
 * never `Number(x) || fallback` (a truthy negative would slip through and 400 the backend's @Min). The
 * floor is 1 mm, not 1 cm, so a letter's thickness is a valid measurement.
 */
export function parseDims(d: DimsForm): { l: number; w: number; h: number; kg: number } | null {
  const l = num(d.l);
  const w = num(d.w);
  const h = num(d.h);
  const kg = num(d.kg);
  const cm = (v: number) => Number.isFinite(v) && v >= MIN_DIM_CM;
  if (!cm(l) || !cm(w) || !cm(h)) return null;
  if (!Number.isFinite(kg) || kg < 0.01) return null;
  return { l, w, h, kg };
}

/** What blocks the parcel step's Continue (empty string when nothing does). */
export function dimsBlocker(d: DimsForm): string {
  return parseDims(d) ? '' : 'Measure the parcel: length, width, height and weight';
}

/** The done-screen instructions — what turns the minted label into a moving parcel. */
export function mintChecklist(shopName: string, total: number): string[] {
  return [
    `Take the parcel to ${shopName} and show this label`,
    `Pay ${money(total)} there — cash is fine`,
    'The receiver already sees it in their app',
  ];
}

/* ------------------------------------------------------------------ money -- */

export function money(v: number | null | undefined): string {
  return (Number(v) || 0).toFixed(2);
}

/* ----------------------------------------------------------------- points -- */

/**
 * Shops a sender can choose: open ones first. With a reference point (typed place
 * words), NEAREST FIRST — that is the whole reason the words exist: "the shop closest
 * to where I said" needs no address. Without one, A→Z by name.
 */
export function selectablePoints(points: NetworkPoint[] | null, excludeDid?: string, near?: GeoPoint | null): NetworkPoint[] {
  return (points ?? [])
    .filter((p) => p.did !== excludeDid)
    .sort((a, b) => {
      if (a.openState !== b.openState) return a.openState === 'open' ? -1 : 1;
      if (near) {
        const da = a.location ? haversineKm(near, a.location) : Number.POSITIVE_INFINITY;
        const db = b.location ? haversineKm(near, b.location) : Number.POSITIVE_INFINITY;
        if (da !== db) return da - db;
      }
      return a.shopName.localeCompare(b.shopName);
    });
}

/** The "400 m away" suffix for a row, when both ends are known. */
export function pointDistance(p: NetworkPoint, near: GeoPoint | null | undefined): string | null {
  if (!near || !p.location) return null;
  return distanceLabel(haversineKm(near, p.location));
}

export function pointLine(p: NetworkPoint): string {
  const bits = [`Zone ${p.zone}`];
  if (p.landmark) bits.push(p.landmark);
  bits.push(`${money(p.pricePerParcel)} handling`);
  // REP1 — only a RELIABLE average on the compact row: not an unrated shop, and not a lone review (isNew).
  // The detail sheet carries the honest "New" wording; a crowded row just drops the chip.
  if (p.rating && p.rating.count && !p.rating.isNew) bits.push(`rated ${p.rating.average.toFixed(1)}`);
  return bits.join(' · ');
}

/**
 * REP1 — the plain-words reputation line for a shop's PUBLIC PROFILE (the detail sheet). Honest about the
 * cold start: an unrated or barely-rated shop reads "New", never a headline average manufactured from a
 * single review (the same "don't trust a median of one" discipline as the price benchmark).
 */
export function reputationLine(rating: NetworkPoint['rating']): string {
  if (!rating || !rating.count) return 'New — no ratings yet';
  if (rating.isNew) return `New — ${rating.count} rating${rating.count === 1 ? '' : 's'} so far`;
  return `Rated ${rating.average.toFixed(1)} by ${rating.count}`;
}

/** REP1 — a "Serving since <year>" trust line for the profile, or null when the onboarding date is unknown.
 *  Reads the year in UTC (the stored instant's own calendar), so a late-December onboarding doesn't render a
 *  different year for a viewer east/west of UTC (e.g. EAT, UTC+3). */
export function servingSince(since: string | undefined): string | null {
  if (!since) return null;
  const t = Date.parse(since);
  return Number.isNaN(t) ? null : `Serving since ${new Date(t).getUTCFullYear()}`;
}

/* ------------------------------------------------------------------ quote -- */

/**
 * PG3 — ONE price, the LOCKED (cheapest) leg. That is what a booked send actually costs (the backend
 * prices every person's parcel at the locked leg; flexible's ceiling-then-rebate is a vendor-rail
 * contract), so showing a dearer "fastest" card would advertise a price nobody here can pay.
 */
export function lockedPrice(q: QuoteView): { total: number; sub: string } {
  return { total: q.locked.total, sub: 'Rides the lowest-price bus on this route' };
}

/** "Shop A → Central hub → Shop B" — the journey in names, not ids. */
export function journeyLine(q: QuoteView): string {
  return q.hops.map((h) => h.label).join(' → ');
}

export function quoteSummary(q: QuoteView): string {
  return `${Math.round(q.totalKm)} kilometres across ${q.hops.length} stops. The price is ${money(q.locked.total)}.`;
}

/* ------------------------------------------------------------------ track -- */

/** Tracking keys are printed T-XXXX; scanners and thumbs add noise. */
export function normalizeKey(input: string): string {
  return input.trim().toUpperCase();
}

/** The consumer ladder. Disputed/Voided fall off it and render as a note instead. */
export const LADDER: ParcelStatus[] = ['Created', 'At_PUDO', 'On_Bus', 'At_MDP', 'Ready_For_Pickup', 'Delivered'];

export function ladderIndex(status: ParcelStatus): number {
  return LADDER.indexOf(status);
}

export interface StatusPresentation {
  word: string;
  icon: IconName;
  tone: 'ok' | 'info' | 'danger';
}

/** Plain words for every state — grade-3 reading level, no logistics jargon. */
export function statusPresentation(status: ParcelStatus): StatusPresentation {
  switch (status) {
    case 'Created':
      return { word: 'Label made', icon: 'edit', tone: 'info' };
    case 'At_PUDO':
      return { word: 'At the shop', icon: 'home', tone: 'info' };
    case 'On_Bus':
      return { word: 'On the bus', icon: 'truck', tone: 'info' };
    case 'At_MDP':
      return { word: 'At the sort hub', icon: 'grid', tone: 'info' };
    case 'Ready_For_Pickup':
      return { word: 'Ready to collect', icon: 'box', tone: 'ok' };
    case 'Delivered':
      return { word: 'Delivered', icon: 'check', tone: 'ok' };
    case 'Disputed':
      return { word: 'Problem reported', icon: 'warning', tone: 'danger' };
    case 'Voided':
      return { word: 'Cancelled', icon: 'block', tone: 'danger' };
  }
}

export function trackSummary(t: TrackView): string {
  const p = statusPresentation(t.status);
  const where = t.status === 'Ready_For_Pickup' || t.status === 'Delivered' ? ` at ${t.destination}` : '';
  return `Parcel ${t.ref}: ${p.word.toLowerCase()}${where}.`;
}

/** When a step happened, in the reader's locale — falls back to the raw string. */
export function stepTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * "Show me the way" — a maps link for the destination pin, or null without one. A plain
 * geo query URL: it opens whatever maps app the phone has, and degrades to the browser.
 */
export function mapsHref(t: Pick<TrackView, 'destinationLocation' | 'destination'>): string | null {
  const loc = t.destinationLocation;
  if (!loc) return null;
  return `https://www.google.com/maps?q=${encodeURIComponent(`${loc.lat},${loc.lng}`)}`;
}

/** The collect card renders once the parcel is somewhere a receiver can act on. */
export function showCollectCard(status: ParcelStatus): boolean {
  return status === 'Ready_For_Pickup' || status === 'Delivered';
}

/* -------------------------------------------------- identity (S20/S21) -- */

/** Keep only digits and a single leading + as the user types a phone (the backend does the real E.164). */
export function cleanPhone(raw: string): string {
  const trimmed = (raw ?? '').trim();
  const plus = trimmed.startsWith('+') ? '+' : '';
  return plus + trimmed.replace(/\D/g, '');
}

/** A phone is ready to submit once it has enough digits to be a real number. */
export function phoneReady(phone: string): boolean {
  return cleanPhone(phone).replace(/\D/g, '').length >= 9;
}

/** The PIN/OTP is ready once exactly `length` digits are present. */
export function codeReady(code: string, length = 4): boolean {
  return new RegExp(`^\\d{${length}}$`).test(code ?? '');
}

/** What blocks the primary CTA on each auth step (empty string when nothing does). */
export function phoneBlocker(phone: string): string {
  return phoneReady(phone) ? '' : 'Enter your phone number';
}
export function pinBlocker(pin: string): string {
  return codeReady(pin, 4) ? '' : 'Enter your 4-digit PIN';
}

export interface RoleMeta {
  label: string;
  icon: IconName;
  blurb: string;
}

/** Plain, non-jargon presentation for each role in the switcher. */
export const ROLE_META: Record<PersonRole, RoleMeta> = {
  consumer: { label: 'You', icon: 'person', blurb: 'Send and receive parcels' },
  driver: { label: 'Driver', icon: 'truck', blurb: 'Carry parcels on your route' },
  agent: { label: 'Shop', icon: 'home', blurb: 'Run a pick-up point' },
  mdp: { label: 'Sort hub', icon: 'grid', blurb: 'Sort parcels between towns' },
  fleet_manager: { label: 'Fleet', icon: 'route', blurb: 'Manage your vehicles and drivers' },
  vendor: { label: 'Store', icon: 'bag', blurb: 'Sell and ship to pick-up points' },
};

export function roleMeta(role: PersonRole): RoleMeta {
  return ROLE_META[role] ?? { label: role, icon: 'person', blurb: '' };
}

/* -------------------------------------------------- my parcels (S21) -- */

/** "You are sending" / "Coming to you" — the person's side of a parcel, in plain words. */
export function relationWord(relation: 'sent' | 'received'): string {
  return relation === 'received' ? 'Coming to you' : 'You are sending';
}

/** The one-line subtitle under a parcel row: where it is headed + the kind of send. */
export function parcelRowLine(p: ConsumerParcelView): string {
  const bits = [p.relation === 'received' ? `From ${p.originZone}` : `To ${p.destZone}`];
  bits.push(p.vendorOrder ? 'Store order' : 'Personal send');
  return bits.join(' · ');
}

/** Newest movement first isn't enough for a person — surface the parcels that still need them on top:
 *  anything ready to collect, then in-flight, then finished. Pure + stable for testing. */
export function sortForPerson(list: ConsumerParcelView[]): ConsumerParcelView[] {
  const rank = (s: ParcelStatus): number => {
    if (s === 'Ready_For_Pickup') return 0; // act now
    if (s === 'Delivered' || s === 'Voided' || s === 'Disputed') return 2; // done
    return 1; // in flight
  };
  return [...list].sort((a, b) => {
    const r = rank(a.status) - rank(b.status);
    if (r !== 0) return r;
    return a.updatedAt < b.updatedAt ? 1 : -1; // newest first within a band
  });
}

/** A parcel that is off the normal ladder (cancelled / disputed) renders as a note, not a rung. */
export function isOffLadder(status: ParcelStatus): boolean {
  return ladderIndex(status) === -1;
}
