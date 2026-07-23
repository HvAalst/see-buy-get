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
  if (p.rating?.count) bits.push(`rated ${p.rating.average.toFixed(1)}`);
  return bits.join(' · ');
}

/* ------------------------------------------------------------------ quote -- */

export interface PriceCard {
  key: 'locked' | 'flexible';
  title: string;
  sub: string;
  total: number;
}

/**
 * The two ways to buy the same journey, CHEAPEST FIRST — a sender comparing prices reads
 * top-down, and anchoring on the dearer option would be a dark pattern. `locked` rides the
 * bottom of the per-km market (waits for that carrier); `flexible` pays the top so any
 * passing vehicle can take it.
 */
export function priceCards(q: QuoteView): PriceCard[] {
  return [
    { key: 'locked', title: 'Cheapest', sub: 'Waits for the lowest-price bus', total: q.locked.total },
    { key: 'flexible', title: 'Fastest', sub: 'Any bus can take it', total: q.flexible.total },
  ];
}

/** "Shop A → Central hub → Shop B" — the journey in names, not ids. */
export function journeyLine(q: QuoteView): string {
  return q.hops.map((h) => h.label).join(' → ');
}

export function quoteSummary(q: QuoteView): string {
  return (
    `${Math.round(q.totalKm)} kilometres across ${q.hops.length} stops. ` +
    `Cheapest ${money(q.locked.total)}, fastest ${money(q.flexible.total)}.`
  );
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
