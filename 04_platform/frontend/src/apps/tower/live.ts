import type { Screen } from './useTowerApp';

/**
 * ONE LIVE VIEW, the console's half: which screens read themselves again when told something changed.
 *
 * Lists and counts do. A screen showing a record somebody opened by its name — the parcel support is on the phone
 * about, a company's rates, books or record, a help topic's pictures — stays as they opened it until they press
 * Refresh: read again by itself every few seconds, it would count in what staff opened (staff-reads) as opened again
 * and again, by nobody's hand.
 */
export const LIVE_STAYS: ReadonlySet<Screen> = new Set<Screen>(['support', 'rates', 'money', 'pictures', 'companies']);

/** Whether the screen that is open reads itself again when the live view says something changed. */
export function readsAgainLive(screen: Screen): boolean {
  return !LIVE_STAYS.has(screen);
}
