import type { components } from '../lib/sbg/schema';
import type { MessageKey, Translate } from './i18n';

/**
 * WHY A CARRIER GAVE A SHIPPER'S SPACE BACK — in the fleet's picker and on the shipper's booking alike.
 *
 * Keyed by the CONTRACT's own list, so a reason added on the server fails the typecheck here instead of
 * printing its code on somebody's screen. Shared, because the fleet choosing a reason and the shipper
 * reading it must use the same words: the same act, described once.
 */
export type GiveBackReason = NonNullable<components['schemas']['CancelBookingDto']['reason']>;

const WORDS = {
  vehicle_unavailable: 'giveBack.vehicle_unavailable',
  no_driver: 'giveBack.no_driver',
  goods_not_as_booked: 'giveBack.goods_not_as_booked',
  overbooked: 'giveBack.overbooked',
  other: 'giveBack.other',
} as const satisfies Record<GiveBackReason, MessageKey>;

/** The order the fleet is offered them: the truck, the driver, the goods, the promise — then anything else. */
export const GIVE_BACK_ORDER: GiveBackReason[] = ['vehicle_unavailable', 'no_driver', 'goods_not_as_booked', 'overbooked', 'other'];

export function giveBackLabel(reason: GiveBackReason, t: Translate): string {
  return t(WORDS[reason]);
}

/**
 * The reason as the shipper reads it: the coded words, then the carrier's own sentence. For `other` the
 * sentence IS the reason. Nothing at all when neither was given — a booking given back before reasons were
 * kept says so by saying no reason, never by inventing one.
 */
export function giveBackWords(c: { reason?: GiveBackReason; note?: string } | undefined, t: Translate): string {
  if (!c) return '';
  const coded = c.reason && c.reason !== 'other' ? giveBackLabel(c.reason, t) : '';
  const note = c.note?.trim() ? `“${c.note.trim()}”` : '';
  return [coded, note].filter(Boolean).join(' — ');
}
