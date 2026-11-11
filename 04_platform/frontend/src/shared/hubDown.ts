import type { MessageKey } from './i18n';

/**
 * 2026-11-11 — why a hub is down (ISO 28000 gap 12), as the server knows them (backend hub-down.types.ts), and how each is
 * said. Shared by the Hub app (its own "the hub is down") and the console (staff saying it when the hub cannot be reached).
 */
export const HUB_DOWN_REASONS = ['power', 'flood', 'security', 'no_staff', 'authority', 'other'] as const;
export type HubDownReason = (typeof HUB_DOWN_REASONS)[number];
export const HUB_DOWN_WORDS: Readonly<Record<HubDownReason, MessageKey>> = {
  power: 'common.hubDown.reason.power',
  flood: 'common.hubDown.reason.flood',
  security: 'common.hubDown.reason.security',
  no_staff: 'common.hubDown.reason.no_staff',
  authority: 'common.hubDown.reason.authority',
  other: 'common.hubDown.reason.other',
};

/** The hub's word on its reopening counts in the last day before the time it gave (the server's HUB_DOWN_CONFIRM_WINDOW_H). */
export const HUB_DOWN_CONFIRM_WINDOW_H = 24;

type Down = { until?: string; confirmedAt?: string } | null | undefined;

/** Whether the hub said, in the last day before it, that it opens at the time it gave. */
export function confirmedInTime(down: Down): boolean {
  if (!down?.until || !down.confirmedAt) return false;
  return Date.parse(down.confirmedAt) >= Date.parse(down.until) - HUB_DOWN_CONFIRM_WINDOW_H * 3_600_000;
}

/** Whether it may confirm now: from a day before the time it gave. */
export function confirmOpen(down: Down, now = Date.now()): boolean {
  return Boolean(down?.until && now >= Date.parse(down.until) - HUB_DOWN_CONFIRM_WINDOW_H * 3_600_000);
}

/** Past the time it gave and never confirmed: it stays closed (the owner, 2026-11-11), and staff are told. */
export function unconfirmedPast(down: Down, now = Date.now()): boolean {
  return Boolean(down?.until && Date.parse(down.until) <= now && !confirmedInTime(down));
}

/** Down now: said so, and not past a time it confirmed it opens at. */
export function isDownNow(down: Down, now = Date.now()): boolean {
  return Boolean(down && !(down.until && Date.parse(down.until) <= now && confirmedInTime(down)));
}
