import { postSigned } from './send';

/**
 * ONE MESSAGE TO ANOTHER COMPANY'S SYSTEM, TRIED ONCE — the same for a store's and a business's (round 10: "Businesses
 * first"). Posted with the EXACT body that was signed, byte for byte: re-serialising would change the whitespace and the
 * signature a receiver checks would not match. The same `x-sbg-delivery` on every try, so a handler can be idempotent
 * on it. A failure is backed off — five minutes, a quarter hour, then hours, the last wait a day — and given up after
 * eight tries, about two days on, in our words: never the receiver's own answer.
 */

/** Give up after this many tries — about two days of backoff, the last wait a day — and say so. */
export const MAX_HOOK_ATTEMPTS = 8;

/** A minute, five, a quarter hour, then hours. */
export function backoffMinutes(attempt: number): number {
  return [1, 5, 15, 60, 180, 360, 720, 1440][Math.min(attempt, 7)];
}

export type HookState = 'pending' | 'delivered' | 'failed';

export interface HookMessage {
  id: string;
  url: string;
  event: string;
  /** HMAC-SHA256 of the body, with the receiver's own secret. */
  signature: string;
  body: string;
  at: string;
  state: HookState;
  attempts: number;
  /** When the next try is due; backs off so a dead endpoint is not hammered. */
  nextTryAt: string;
  deliveredAt?: string;
  /** Our words for the last failure. Never the receiver's own response body. */
  lastError?: string;
  /** How many times the receiver sent it again itself. */
  resent?: number;
}

/** Try it once. Never throws: one receiver's dead endpoint must not hold up another's. The message as it stands after. */
export async function tryDelivery<T extends HookMessage>(message: T, now: number = Date.now()): Promise<T> {
  const result = await postSigned(message.url, Buffer.from(message.body, 'utf8'), {
    'content-type': 'application/json',
    'x-sbg-signature': message.signature,
    'x-sbg-event': message.event,
    'x-sbg-delivery': message.id,
  });
  const after: T = { ...message, attempts: message.attempts + 1 };
  if (result.ok) {
    after.state = 'delivered';
    after.deliveredAt = new Date(now).toISOString();
    delete after.lastError;
  } else if (after.attempts >= MAX_HOOK_ATTEMPTS) {
    after.state = 'failed';
    after.lastError = result.detail;
  } else {
    after.nextTryAt = new Date(now + backoffMinutes(after.attempts) * 60_000).toISOString();
    after.lastError = result.detail;
  }
  return after;
}
