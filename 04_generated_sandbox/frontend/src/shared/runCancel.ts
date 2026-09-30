import type { components } from '../lib/sbg/schema';
import type { MessageKey, Translate } from './i18n';

/**
 * WHY A CARRIER CALLED OFF A WHOLE RUN — in the fleet's sheet and on the shipper's booking alike.
 *
 * Keyed by the CONTRACT's own list, so a reason added on the server fails the typecheck here. The truck and the
 * driver reasons use the SAME words as a single booking given back — the same act, described once.
 */
export type RunCancelReason = NonNullable<components['schemas']['DepartureStatusDto']['reason']>;

const WORDS = {
  vehicle_unavailable: 'giveBack.vehicle_unavailable',
  no_driver: 'giveBack.no_driver',
  road_closed: 'runOff.road_closed',
  border_closed: 'runOff.border_closed',
  not_enough_loads: 'runOff.not_enough_loads',
  other: 'giveBack.other',
} as const satisfies Record<RunCancelReason, MessageKey>;

/** The order offered: the truck, the driver, the road, the border, the bookings — then anything else. */
export const RUN_CANCEL_ORDER: RunCancelReason[] = ['vehicle_unavailable', 'no_driver', 'road_closed', 'border_closed', 'not_enough_loads', 'other'];

/** About the ROUTE rather than this carrier: every truck there meets it, so nobody is sent to another run on it. */
export function isRouteReason(reason: RunCancelReason | undefined): boolean {
  return reason === 'road_closed' || reason === 'border_closed';
}

export function runCancelLabel(reason: RunCancelReason, t: Translate): string {
  return t(WORDS[reason]);
}

/** The reason as the shipper reads it: the coded words, then the carrier's own. For `other` the sentence IS the reason. */
export function runCancelWords(c: { reason?: RunCancelReason; note?: string } | undefined, t: Translate): string {
  if (!c) return '';
  const coded = c.reason && c.reason !== 'other' ? runCancelLabel(c.reason, t) : '';
  const note = c.note?.trim() ? `“${c.note.trim()}”` : '';
  return [coded, note].filter(Boolean).join(' — ');
}
