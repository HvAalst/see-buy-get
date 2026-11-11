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

/** Down now: said so, and not past the time it was said to open again. */
export function isDownNow(down: { until?: string } | null | undefined, now = Date.now()): boolean {
  return Boolean(down && !(down.until && Date.parse(down.until) <= now));
}
