import type { MessageKey, Translate } from '../../shared/i18n';

/*
 * A BUSINESS'S OWN SYSTEM, TOLD OF ITS LOADS (backend business-hook.types.ts; the user, round 10: "Businesses first";
 * "Only what it sees in its app"; "The company, once a day"). What its system hears, and what became of each message.
 */

export interface SystemMessage {
  id: string;
  event: string;
  at: string;
  state: 'pending' | 'delivered' | 'failed';
  attempts: number;
  nextTryAt: string;
  deliveredAt?: string;
  lastError?: string;
  resent?: number;
  /** The exact body that was signed and sent: the load as the Loads screen reads it. */
  body: string;
}

export interface SystemView {
  url?: string;
  setAt?: string;
  hasSecret: boolean;
  secretTurnedAt?: string;
  /** Only in the answer that made it. */
  secret?: string;
  events: string[];
  messages: SystemMessage[];
}

const EVENT_WORDS: Record<string, MessageKey> = {
  'load.taken': 'business.system.event.taken',
  'load.handed_back': 'business.system.event.handedBack',
  'load.picked_up': 'business.system.event.pickedUp',
  'load.at_border': 'business.system.event.atBorder',
  'load.border_cleared': 'business.system.event.borderCleared',
  'load.at_hub': 'business.system.event.atHub',
  'load.seal_broken': 'business.system.event.sealBroken',
  'load.cold_chain_broken': 'business.system.event.coldChainBroken',
  'load.delivery_failed': 'business.system.event.deliveryFailed',
  'load.delivered': 'business.system.event.delivered',
  'load.cancelled': 'business.system.event.cancelled',
  'load.claim_opened': 'business.system.event.claimOpened',
  'load.claim_decided': 'business.system.event.claimDecided',
  test: 'business.system.event.test',
};

/** "A carrier took it" — or the event's own name for one this screen has no words for yet. */
export function eventWords(event: string, t: Translate): string {
  return EVENT_WORDS[event] ? t(EVENT_WORDS[event]) : event;
}

/** The load a message is about, by its code, read from the body that was sent. */
export function loadCodeOf(m: SystemMessage): string | undefined {
  try {
    const code = (JSON.parse(m.body) as { data?: { load?: { code?: unknown } } }).data?.load?.code;
    return typeof code === 'string' ? code : undefined;
  } catch {
    return undefined;
  }
}

/** What became of it, in words: arrived; being sent; tried again by itself, how often and when; given up — and why. */
export function systemLine(m: SystemMessage, t: Translate): { text: string; warn: boolean } {
  const when = (iso?: string) => (iso ? new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }) : '');
  const why = m.lastError ? ` ${t('business.system.msg.why', { why: m.lastError.replace(/\.+$/, '') })}` : '';
  if (m.state === 'delivered') return { text: t('business.system.msg.arrived', { when: when(m.deliveredAt) }), warn: false };
  if (m.state === 'failed') return { text: t('business.system.msg.gaveUp', { count: m.attempts }) + why, warn: true };
  if (!m.attempts) return { text: t('business.system.msg.sending'), warn: false };
  return { text: t('business.system.msg.retrying', { count: m.attempts, next: when(m.nextTryAt) }) + why, warn: true };
}
