import { GlosError } from '../../foundation/http/glos-error';
import { paperDay, paperLapsesAt, PAPER_DUE_DAYS } from './papers';

/**
 * Round 40 — A SHOP'S TRADING LICENCE THAT LAPSES (the user: "Expiry, notice, grace"). Staff note the date the licence
 * runs to when they approve the shop, read off the licence the shop sent; the shop is told thirty days before; after it
 * lapses there are fourteen days' grace; then no new parcel can be started at the shop, or name it, until the renewed
 * licence is recorded. Parcels already booked to be handed in there, what is on its shelf, and what is on its way to it
 * go on: a stop is of new work, never of old finishing.
 *
 * Everything here is DERIVED from the date at the moment of asking, as every paper's state is (papers.ts): recording
 * the renewed date is the whole of putting the shop back, with nothing to unwind. A shop with no date noted — one
 * approved before this — stops nothing: we cannot enforce what we never asked for.
 */

/** After the licence lapses, the days the shop goes on as before. Then new parcels stop. */
export const LICENCE_GRACE_DAYS = 14;
/** How far ahead the shop is told its licence is running out — the same as every paper's. */
export const LICENCE_DUE_DAYS = PAPER_DUE_DAYS;
const DAY_MS = 86_400_000;

export type ShopLicenceState = 'none' | 'ok' | 'due' | 'grace' | 'stopped';

/** What a shop's licence record holds — the fields this reads, so a caller with a partial record can ask. */
export interface ShopLicenceFields {
  licence?: { expiresAt: string };
  licenceRenewal?: { sentAt: string };
}

export interface ShopLicenceStanding {
  state: ShopLicenceState;
  /** The last day the licence is valid, as staff noted it. */
  expiresAt?: string;
  /** Whole days until it lapses — negative once it has. Absent with no date. */
  daysLeft?: number;
  /** The first day no new parcel can be started here: the day after the grace ends. Absent with no date. */
  stopsOn?: string;
  /** Whole days of grace left, while in grace. */
  graceDaysLeft?: number;
  /** The shop has sent its renewed licence and staff have not read it yet: it has done its part. */
  renewalSent: boolean;
}

/** YYYY-MM-DD of an instant, by the UTC calendar — the calendar every paper date here is kept in. */
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Where a shop's licence stands now. */
export function shopLicenceStanding(shop: ShopLicenceFields, now: number = Date.now()): ShopLicenceStanding {
  const renewalSent = Boolean(shop.licenceRenewal);
  const expiresAt = shop.licence?.expiresAt;
  if (!expiresAt) return { state: 'none', renewalSent };
  const lapses = paperLapsesAt(expiresAt);
  if (!Number.isFinite(lapses)) return { state: 'none', expiresAt, renewalSent };
  const stops = lapses + LICENCE_GRACE_DAYS * DAY_MS;
  const daysLeft = Math.ceil((lapses - now) / DAY_MS) || 0; // never "-0"
  const base = { expiresAt, daysLeft, stopsOn: isoDay(stops), renewalSent };
  if (now >= stops) return { state: 'stopped', ...base };
  if (now >= lapses) return { state: 'grace', ...base, graceDaysLeft: Math.ceil((stops - now) / DAY_MS) };
  return { state: daysLeft <= LICENCE_DUE_DAYS ? 'due' : 'ok', ...base };
}

/** No new parcel starts at this shop, or names it: its licence lapsed and the grace is over. */
export function licenceStopped(shop: ShopLicenceFields, now: number = Date.now()): boolean {
  return shopLicenceStanding(shop, now).state === 'stopped';
}

/**
 * THE DATE A LICENCE RUNS TO, as somebody typed it: a real calendar day, and one still ahead. A date already past is a
 * typo — recorded, it would stop the shop the moment it was saved. Refused by name before anything is written.
 */
export function requireLicenceDate(expiresAt: string | undefined, now: number = Date.now(), field = 'licenceExpiresAt'): string {
  const day = expiresAt?.trim();
  if (!day) throw new GlosError('FIELD_REQUIRED', 'Note the date the trading licence runs to, read off the licence', { field });
  const real = /^\d{4}-\d{2}-\d{2}$/.test(day) && isoDay(Date.parse(`${day}T00:00:00Z`)) === day;
  if (!real) throw new GlosError('VALIDATION_FAILED', 'The date the licence runs to is a day of the calendar, as 2027-12-31', { field });
  if (paperLapsesAt(day) <= now) throw new GlosError('VALIDATION_FAILED', 'That date has already passed — a licence in force runs into the future', { field });
  return day;
}

/** "31 Dec 2026" — the one way a licence day is said, in a refusal, a notification and a list. */
export function licenceDay(day: string): string {
  return paperDay(day);
}
