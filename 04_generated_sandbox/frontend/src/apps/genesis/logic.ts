/**
 * Pure Send-app logic — no DOM, no fetch, no Preact. Deterministic and unit-tested.
 * The status ladder wording is the consumer-facing half of the parcel state machine;
 * the quote presentation decides what a sender is told a journey costs.
 */

import { distanceLabel, haversineKm, type GeoPoint } from '../../shared/geo';
import type { IconName } from '../../shared/ui/Icon';
import type { MessageKey } from '../../shared/i18n';
import type { ConsumerParcelView, NetworkPoint, ParcelSize, ParcelStatus, PersonRole, QuoteView, TrackView } from './types';

/**
 * The translate function, threaded into every prose-producing helper so this module stays pure (no direct
 * catalog import at call time) and testable. Callers pass the `t` from `useT()` (components) or the plain
 * `t` (the hook). English is the base catalog, so a test passing the real `t` sees the English literals.
 */
export type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/* ------------------------------------------------------------------ sizes -- */

const SIZE_KEYS: Record<ParcelSize, { labelKey: MessageKey; hintKey: MessageKey }> = {
  S: { labelKey: 'send.size.s.label', hintKey: 'send.size.s.hint' },
  M: { labelKey: 'send.size.m.label', hintKey: 'send.size.m.hint' },
  L: { labelKey: 'send.size.l.label', hintKey: 'send.size.l.hint' },
  HEAVY: { labelKey: 'send.size.heavy.label', hintKey: 'send.size.heavy.hint' },
};

/** The plain-words presentation of a DERIVED tier (PG3: sizes are computed from dims, never tapped). */
export function sizeMeta(size: ParcelSize, t: Translate): { key: ParcelSize; label: string; hint: string } {
  const k = SIZE_KEYS[size];
  return k ? { key: size, label: t(k.labelKey), hint: t(k.hintKey) } : { key: size, label: size, hint: '' };
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
export function dimsBlocker(d: DimsForm, t: Translate): string {
  return parseDims(d) ? '' : t('send.logic.dimsBlocker');
}

/** The done-screen instructions — what turns the minted label into a moving parcel. */
export function mintChecklist(shopName: string, total: number, t: Translate): string[] {
  return [
    t('send.logic.mintTake', { shop: shopName }),
    t('send.logic.mintPay', { price: money(total) }),
    t('send.logic.mintReceiverSees'),
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

export function pointLine(p: NetworkPoint, t: Translate): string {
  const bits = [t('send.zone', { zone: p.zone })];
  if (p.landmark) bits.push(p.landmark);
  bits.push(t('send.logic.handling', { price: money(p.pricePerParcel) }));
  // REP1 — only a RELIABLE average on the compact row: not an unrated shop, and not a lone review (isNew).
  // The detail sheet carries the honest "New" wording; a crowded row just drops the chip.
  if (p.rating && p.rating.count && !p.rating.isNew) bits.push(t('send.logic.rated', { avg: p.rating.average.toFixed(1) }));
  return bits.join(' · ');
}

/**
 * REP1 — the plain-words reputation line for a shop's PUBLIC PROFILE (the detail sheet). Honest about the
 * cold start: an unrated or barely-rated shop reads "New", never a headline average manufactured from a
 * single review (the same "don't trust a median of one" discipline as the price benchmark).
 */
export function reputationLine(rating: NetworkPoint['rating'], t: Translate): string {
  if (!rating || !rating.count) return t('send.logic.repNone');
  if (rating.isNew) return rating.count === 1 ? t('send.logic.repNewOne') : t('send.logic.repNewMany', { count: rating.count });
  return t('send.logic.repRated', { avg: rating.average.toFixed(1), count: rating.count });
}

/** REP1 — a "Serving since <year>" trust line for the profile, or null when the onboarding date is unknown.
 *  Reads the year in UTC (the stored instant's own calendar), so a late-December onboarding doesn't render a
 *  different year for a viewer east/west of UTC (e.g. EAT, UTC+3). */
export function servingSince(since: string | undefined, t: Translate): string | null {
  if (!since) return null;
  const ms = Date.parse(since);
  return Number.isNaN(ms) ? null : t('send.logic.servingSince', { year: new Date(ms).getUTCFullYear() });
}

/* ------------------------------------------------------------------ quote -- */

/**
 * PG3 — ONE price, the LOCKED (cheapest) leg. That is what a booked send actually costs (the backend
 * prices every person's parcel at the locked leg; flexible's ceiling-then-rebate is a vendor-rail
 * contract), so showing a dearer "fastest" card would advertise a price nobody here can pay.
 */
export function lockedPrice(q: QuoteView, t: Translate): { total: number; sub: string } {
  return { total: q.locked.total, sub: t('send.logic.lockedSub') };
}

/** "Shop A → Central hub → Shop B" — the journey in names, not ids. */
export function journeyLine(q: QuoteView): string {
  return q.hops.map((h) => h.label).join(' → ');
}

export function quoteSummary(q: QuoteView, t: Translate): string {
  return t('send.logic.quoteSummary', { km: Math.round(q.totalKm), stops: q.hops.length, price: money(q.locked.total) });
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
export function statusPresentation(status: ParcelStatus, t: Translate): StatusPresentation {
  switch (status) {
    case 'Created':
      return { word: t('send.status.created'), icon: 'edit', tone: 'info' };
    case 'At_PUDO':
      return { word: t('send.status.atPudo'), icon: 'home', tone: 'info' };
    case 'On_Bus':
      return { word: t('send.status.onBus'), icon: 'truck', tone: 'info' };
    case 'At_MDP':
      return { word: t('send.status.atMdp'), icon: 'grid', tone: 'info' };
    case 'Ready_For_Pickup':
      return { word: t('send.status.ready'), icon: 'box', tone: 'ok' };
    case 'Delivered':
      return { word: t('send.status.delivered'), icon: 'check', tone: 'ok' };
    case 'Disputed':
      return { word: t('send.status.disputed'), icon: 'warning', tone: 'danger' };
    case 'Voided':
      return { word: t('send.status.voided'), icon: 'block', tone: 'danger' };
  }
}

export function trackSummary(view: TrackView, t: Translate): string {
  const status = statusPresentation(view.status, t).word.toLowerCase();
  const atDest = view.status === 'Ready_For_Pickup' || view.status === 'Delivered';
  return atDest
    ? t('send.logic.trackAt', { ref: view.ref, status, dest: view.destination })
    : t('send.logic.trackPlain', { ref: view.ref, status });
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
export function phoneBlocker(phone: string, t: Translate): string {
  return phoneReady(phone) ? '' : t('send.logic.phoneBlocker');
}
export function pinBlocker(pin: string, t: Translate): string {
  return codeReady(pin, 4) ? '' : t('send.logic.pinBlocker');
}

export interface RoleMeta {
  label: string;
  icon: IconName;
  blurb: string;
}

/** Plain, non-jargon presentation for each role in the switcher (icon + the label/blurb catalog keys). */
const ROLE_KEYS: Record<PersonRole, { icon: IconName; labelKey: MessageKey; blurbKey: MessageKey }> = {
  consumer: { icon: 'person', labelKey: 'send.role.consumer.label', blurbKey: 'send.role.consumer.blurb' },
  driver: { icon: 'truck', labelKey: 'send.role.driver.label', blurbKey: 'send.role.driver.blurb' },
  agent: { icon: 'home', labelKey: 'send.role.agent.label', blurbKey: 'send.role.agent.blurb' },
  mdp: { icon: 'grid', labelKey: 'send.role.mdp.label', blurbKey: 'send.role.mdp.blurb' },
  fleet_manager: { icon: 'route', labelKey: 'send.role.fleet.label', blurbKey: 'send.role.fleet.blurb' },
  vendor: { icon: 'bag', labelKey: 'send.role.vendor.label', blurbKey: 'send.role.vendor.blurb' },
};

export function roleMeta(role: PersonRole, t: Translate): RoleMeta {
  const k = ROLE_KEYS[role];
  return k ? { label: t(k.labelKey), icon: k.icon, blurb: t(k.blurbKey) } : { label: role, icon: 'person', blurb: '' };
}

/* -------------------------------------------------- my parcels (S21) -- */

/** "You are sending" / "Coming to you" — the person's side of a parcel, in plain words. */
export function relationWord(relation: 'sent' | 'received', t: Translate): string {
  return relation === 'received' ? t('send.relation.received') : t('send.relation.sent');
}

/** The one-line subtitle under a parcel row: where it is headed + the kind of send. */
export function parcelRowLine(p: ConsumerParcelView, t: Translate): string {
  const bits = [p.relation === 'received' ? t('send.logic.rowFrom', { zone: p.originZone }) : t('send.logic.rowTo', { zone: p.destZone })];
  bits.push(p.vendorOrder ? t('send.logic.storeOrder') : t('send.logic.personalSend'));
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
