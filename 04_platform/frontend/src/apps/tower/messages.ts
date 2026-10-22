import type { components } from '../../lib/sbg';
import type { MessageKey } from '../../shared/i18n';

/** What people wrote from the help's "Write to us", as staff read it (support.types.ts on the server). */
export type SupportInbox = components['schemas']['SupportInboxView'];
export type SupportMessage = components['schemas']['SupportMessageView'];
export type SupportCategory = SupportMessage['category'];
export type SupportStatus = SupportInbox['status'];

/** Each category in the words the person chose it by — the same as the help's, so staff read what they were told. */
export const CATEGORY_LABEL: Record<SupportCategory, MessageKey> = {
  'sign-in': 'help.contact.topic.sign-in',
  parcel: 'help.contact.topic.parcel',
  damage: 'help.contact.topic.damage',
  money: 'help.contact.topic.money',
  joining: 'help.contact.topic.joining',
  business: 'help.contact.topic.business',
  safety: 'help.contact.topic.safety',
  privacy: 'help.contact.topic.privacy',
  other: 'help.contact.topic.other',
};

/** Waiting on us: every open message. Null until read — never a nought that has not been counted. */
export function messagesWaiting(inbox: SupportInbox | null): number | null {
  if (!inbox) return null;
  return inbox.counts.reduce((n, c) => n + c.open, 0);
}

/** The open messages of one category, or all of them — in the order the server sorted them (urgent, then oldest). */
export function inCategory(inbox: SupportInbox | null, category: SupportCategory | null): SupportMessage[] {
  const items = inbox?.items ?? [];
  return category ? items.filter((m) => m.category === category) : items;
}

/** How long a message has waited, in whole hours or days — what decides who is answered next. */
export function waited(iso: string, now: number = Date.now()): { n: number; unit: 'minutes' | 'hours' | 'days' } {
  const ms = Math.max(0, now - Date.parse(iso));
  if (ms < 3_600_000) return { n: Math.floor(ms / 60_000), unit: 'minutes' };
  if (ms < 86_400_000) return { n: Math.floor(ms / 3_600_000), unit: 'hours' };
  return { n: Math.floor(ms / 86_400_000), unit: 'days' };
}
