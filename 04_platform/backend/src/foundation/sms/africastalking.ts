import { isSandbox } from '../runtime/sandbox';
import type { RouteState } from './code-routes.types';
import { OutgoingSms, SmsFailure } from './sms.types';

/**
 * 2026-11-16 — AFRICA'S TALKING, AS PLAIN FUNCTIONS (the plan "Sign-in codes beyond Twilio SMS", D1: a local route in
 * Kenya, Uganda, Tanzania, Rwanda and, until AfroMessage's own API is in hand, Ethiopia — under $0.01 a text where Twilio
 * charges $0.31–$0.43). `AfricasTalkingSender` does the sending; this file knows no socket.
 *
 * What the wire looks like, as Africa's Talking's own connector reference (Microsoft Learn, updated 2025-04-22) and its
 * help pages and developer guides (read 2026-11-16) give it — its developer documentation refuses automated reads:
 *   POST https://api.africastalking.com/version1/messaging (its sandbox: api.sandbox.africastalking.com, username
 *   `sandbox`), header `apiKey`, `Accept: application/json`, a form of `username`, `to`, `message` and, where a sender
 *   name is registered, `from`. The answer: `SMSMessageData.Recipients[]` with `statusCode`, `status`, `messageId`,
 *   `number`, `cost`. A recipient taken reads `status: "Success"` (statusCode 101 in its own example).
 *   A delivery report is POSTed to the callback set in its dashboard: `id`, `status` (Success, Failed, Rejected,
 *   Buffered, Sent, Submitted), `failureReason`.
 *
 * NEVER SENT THROUGH THE REAL PROVIDER FROM HERE. Its table of status codes is not published where it could be read, so a
 * recipient is judged by the status WORD it carries, never by a number guessed at.
 */
type Env = Record<string, string | undefined>;

export const AT_API = 'https://api.africastalking.com/version1/messaging';
export const AT_SANDBOX_API = 'https://api.sandbox.africastalking.com/version1/messaging';

export interface AfricasTalkingConfig {
  state: RouteState;
  /** Delivery reports are set up in its dashboard to come to this server (AT_DELIVERY_REPORTS=on). */
  reports: boolean;
  // There ONLY when it can be used.
  endpoint?: string;
  username?: string;
  apiKey?: string;
  from?: string;
}

const set = (v: string | undefined) => (v ?? '').trim();

/**
 * WHAT THE SERVER WAS GIVEN: `AT_USERNAME` (the application's username) and `AT_API_KEY`; `AT_SENDER_ID`, the sender name
 * registered with the networks, where there is one; `AT_DELIVERY_REPORTS=on` once its dashboard sends delivery reports to
 * `/v1/sms/status/africastalking`. A SANDBOX DOES NOT SEND, with everything set.
 */
export function africasTalkingConfig(env: Env = process.env, sandbox: boolean = isSandbox()): AfricasTalkingConfig {
  const username = set(env.AT_USERNAME);
  const apiKey = set(env.AT_API_KEY);
  const from = set(env.AT_SENDER_ID);
  const reports = set(env.AT_DELIVERY_REPORTS).toLowerCase() === 'on';
  if (!username && !apiKey) return { state: 'not_set_up', reports };
  if (!username || !apiKey) return { state: 'half_set_up', reports };
  if (sandbox) return { state: 'sandbox', reports };
  return { state: 'ready', reports, endpoint: username === 'sandbox' ? AT_SANDBOX_API : AT_API, username, apiKey, ...(from ? { from } : {}) };
}

/** The form Africa's Talking is sent. */
export function toAtForm(config: AfricasTalkingConfig, sms: OutgoingSms): string {
  const form = new URLSearchParams();
  form.set('username', config.username ?? '');
  form.set('to', sms.to);
  form.set('message', sms.body);
  if (config.from) form.set('from', config.from);
  return form.toString();
}

export type AtAnswer = { ok: true; ref?: string } | { ok: false; kind: SmsFailure; code?: string };

/** Status words that say THE NUMBER cannot be texted — the person's to put right. */
const BAD_NUMBER = new Set(['InvalidPhoneNumber', 'UnsupportedNumberType', 'UserInBlacklist', 'DoNotDisturbRejection']);
/** Status words that say how WE are set up: the balance, the sender name, a hold on the account. */
const OURS = new Set(['InsufficientBalance', 'InvalidSenderId', 'RiskHold']);
/** Taken: sent on, or queued to be. */
const TAKEN = new Set(['Success', 'Sent', 'Queued', 'Processed']);
const CODE = /^\d{3}$/;

/**
 * WHAT AN ANSWER MEANS. Taken only when it is Africa's Talking's own answer — JSON with a recipient whose status says it
 * was taken. A page from a proxy that says 200 is not a text taken. Only a number is kept: its words may name the phone.
 */
export function readAtAnswer(status: number, body: string): AtAnswer {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  const data = (json as { SMSMessageData?: { Recipients?: unknown } } | undefined)?.SMSMessageData;
  const first = Array.isArray(data?.Recipients) ? (data!.Recipients as Array<Record<string, unknown>>)[0] : undefined;
  const word = typeof first?.status === 'string' ? first.status : '';
  const raw = first?.statusCode;
  const code = typeof raw === 'number' || typeof raw === 'string' ? (CODE.test(String(raw)) ? String(raw) : undefined) : undefined;
  const failed = (kind: SmsFailure): AtAnswer => ({ ok: false, kind, ...(code ? { code } : {}) });

  if (status === 401) return failed('refused');
  if (status === 429) return failed('limit');
  if (status >= 200 && status < 300 && first) {
    if (TAKEN.has(word)) return { ok: true, ...(typeof first.messageId === 'string' && first.messageId ? { ref: first.messageId } : {}) };
    if (BAD_NUMBER.has(word)) return failed('rejected');
    if (OURS.has(word)) return failed('refused');
    return failed('failed');
  }
  if (status === 400 || status === 403 || status === 404) return failed('refused');
  return failed('failed');
}

/** A delivery report: which text, and whether it was delivered. Undefined while it is still on its way, or not a report. */
export function readAtReport(body: unknown): { ref: string; outcome: 'delivered' | 'failed' } | undefined {
  const b = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const ref = typeof b.id === 'string' ? b.id : '';
  const status = typeof b.status === 'string' ? b.status : '';
  if (!ref) return undefined;
  if (status === 'Success') return { ref, outcome: 'delivered' };
  if (status === 'Failed' || status === 'Rejected') return { ref, outcome: 'failed' };
  return undefined;
}
