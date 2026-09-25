import type { MessageKey, Translate } from './i18n';

/**
 * HOW A SHIPPER PAYS A CARRIER DIRECTLY — the sentence, in one place, for the three apps that say it.
 *
 * F3 is not board freight. Board freight is priced BY us and books a payable to the carrier at delivery,
 * because the shipper paid us. A departure is the fleet's own price agreed directly, so there is no
 * invoice of ours and there must not be: money we never collected must not become a liability we pretend
 * to hold. What was missing was not the invoice — it was anybody SAYING so.
 *
 * A record, never a posting, in the words CV2 already settled on for two parties paying each other
 * off-platform. The vocabulary is the backend's; this only turns it into a sentence.
 */
export type SettleMethod = 'cash' | 'mobile_money' | 'bank' | 'other';
export type SettleWhen = 'on_pickup' | 'on_delivery' | 'after_delivery';

const METHOD: Record<SettleMethod, MessageKey> = {
  cash: 'settle.method.cash',
  mobile_money: 'settle.method.mobile',
  bank: 'settle.method.bank',
  other: 'settle.method.other',
};
const WHEN: Record<SettleWhen, MessageKey> = {
  on_pickup: 'settle.when.pickup',
  on_delivery: 'settle.when.delivery',
  after_delivery: 'settle.when.after',
};

/**
 * "Pay them in cash, when they collect." Absent says the fleet has NOT SAID, and says it plainly rather
 * than leaving a blank line: a shipper who reads nothing assumes the network is handling it, which is the
 * one thing that is certainly not happening.
 */
export function settleWords(settle: { method: string; when: string } | undefined, t: Translate): string {
  if (!settle) return t('settle.unsaid');
  const method = METHOD[settle.method as SettleMethod];
  const when = WHEN[settle.when as SettleWhen];
  if (!method || !when) return t('settle.unsaid');
  return t('settle.line', { method: t(method), when: t(when) });
}
