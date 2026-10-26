import { formatDate, type Translate } from './i18n';

/**
 * A HUB'S HOURS AND HOW TO REACH IT, as the apps read it (backend hub-contact.service.ts; the user, 2026-10-26: "hub has
 * open hours as well? and a contact page for anyone (drivers) wanting to contact the hub"). Whether it is open now is the
 * server's, read on the hub's own clock; the words are here, said the same in every app.
 */
export interface HubOpenNow {
  open: boolean;
  until?: string;
  opensDay?: string;
  opensAt?: string;
  opensToday?: boolean;
}

export type HubDay = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
export const HUB_WEEK: readonly HubDay[] = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
export type HubWeek = Partial<Record<HubDay, { open: string; close: string } | null>>;

/** A hub where a driver or a store meets it: whether it is open, who to ask for, where to come in, a number to call. */
export interface HubReachView {
  mdpId?: string;
  name: string;
  handle?: string;
  phone?: string;
  askFor?: string;
  gate?: string;
  openingHours?: HubWeek;
  openNow?: HubOpenNow;
}

/** A day's name in the reader's language — "Mon", "Monday" — from the calendar, not a word list: Sun 1 Nov 2026 onwards. */
export function dayName(day: string, style: 'short' | 'long' = 'short'): string {
  const i = HUB_WEEK.indexOf(day as HubDay);
  if (i < 0) return day;
  return formatDate(Date.UTC(2026, 10, 1 + i, 12), { weekday: style, timeZone: 'UTC' });
}

/** "Open until 18:00" — "Closed · opens at 07:00" — "Closed · opens Mon 07:00". Null where the hub keeps no hours. */
export function openNowLine(o: HubOpenNow | undefined, t: Translate): string | null {
  if (!o) return null;
  if (o.open) return o.until ? t('common.hub.openUntil', { until: o.until }) : t('common.hub.openNow');
  if (!o.opensDay || !o.opensAt) return t('common.hub.closedWeek');
  return o.opensToday ? t('common.hub.opensToday', { at: o.opensAt }) : t('common.hub.opensOn', { day: dayName(o.opensDay), at: o.opensAt });
}

/** A number as the phone app takes it: digits and a leading +. */
export function telOf(phone: string): string {
  return `tel:${phone.replace(/[^+\d]/g, '')}`;
}
