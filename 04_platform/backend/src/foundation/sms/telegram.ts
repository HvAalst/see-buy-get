import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { isSandbox } from '../runtime/sandbox';
import type { RouteState } from './code-routes.types';
import { SmsFailure } from './sms.types';
import { statusCallbackFor } from './twilio';

/**
 * 2026-11-16 — A CODE BY TELEGRAM, AS PLAIN FUNCTIONS (the plan, D3: a choice on the code screen, offered first in Ethiopia;
 * $0.01 a code, refunded when it is not delivered). `TelegramSender` does the sending.
 *
 * Read from Telegram's Gateway API reference on 2026-11-16 (core.telegram.org/gateway/api):
 *   POST https://gatewayapi.telegram.org/sendVerificationMessage, `Authorization: Bearer <token>`, JSON { phone_number
 *   (E.164), code (our own, 4–8 digits), ttl (30–3600 s), callback_url (https) } → { ok, result: RequestStatus } or
 *   { ok: false, error: "PHONE_NUMBER_INVALID" | "ACCESS_TOKEN_INVALID" | … }. RequestStatus: request_id, delivery_status
 *   { status: sent | delivered | read | expired | revoked }.
 *   A report is POSTed to callback_url as a RequestStatus, with `X-Request-Timestamp` and `X-Request-Signature`: the hex
 *   HMAC-SHA-256 of "<timestamp>\n<raw body>", keyed with the SHA-256 of the token. It is retried until answered 200.
 *
 * NEVER SENT THROUGH THE REAL PROVIDER FROM HERE.
 */
type Env = Record<string, string | undefined>;

export const TELEGRAM_GATEWAY = 'https://gatewayapi.telegram.org/sendVerificationMessage';
/** A report older than this is not believed: its timestamp is signed, and an old one is a replay. */
export const TELEGRAM_REPORT_MAX_AGE_S = 300;

export interface TelegramConfig {
  state: RouteState;
  reports: boolean;
  token?: string;
  callbackUrl?: string;
}

/** `TELEGRAM_GATEWAY_TOKEN`. Its reports come by themselves where the site is known over https. A SANDBOX DOES NOT SEND. */
export function telegramConfig(env: Env = process.env, sandbox: boolean = isSandbox()): TelegramConfig {
  const token = (env.TELEGRAM_GATEWAY_TOKEN ?? '').trim();
  if (!token) return { state: 'not_set_up', reports: false };
  if (sandbox) return { state: 'sandbox', reports: false, token };
  const callbackUrl = statusCallbackFor('telegram', env);
  return { state: 'ready', reports: Boolean(callbackUrl), token, ...(callbackUrl ? { callbackUrl } : {}) };
}

/** What Telegram is sent: the number, OUR code, how long it works, and where to report. */
export function toTelegramBody(config: TelegramConfig, to: string, code: string, minutes: number): string {
  return JSON.stringify({ phone_number: to, code, ttl: Math.max(30, Math.min(3600, Math.round(minutes * 60))), ...(config.callbackUrl ? { callback_url: config.callbackUrl } : {}) });
}

export type TelegramAnswer = { ok: true; ref?: string } | { ok: false; kind: SmsFailure; code?: string };

/** WHAT AN ANSWER MEANS: taken only on `ok: true` with a request id. Its error words name no phone, and are kept as the code. */
export function readTelegramAnswer(status: number, body: string): TelegramAnswer {
  let json: { ok?: unknown; result?: { request_id?: unknown }; error?: unknown } | undefined;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  const error = typeof json?.error === 'string' && /^[A-Z_0-9]{3,64}$/.test(json.error) ? json.error : undefined;
  const failed = (kind: SmsFailure): TelegramAnswer => ({ ok: false, kind, ...(error ? { code: error } : {}) });
  if (status >= 200 && status < 300 && json?.ok === true) {
    const id = json.result?.request_id;
    return typeof id === 'string' && id ? { ok: true, ref: id } : failed('failed');
  }
  if (error === 'PHONE_NUMBER_INVALID' || error === 'PHONE_NUMBER_NOT_AVAILABLE') return failed('rejected');
  if (status === 429 || error?.startsWith('FLOOD_WAIT')) return failed('limit');
  if (error === 'ACCESS_TOKEN_INVALID' || error === 'ACCESS_TOKEN_REQUIRED' || error === 'BALANCE_NOT_ENOUGH' || status === 401 || status === 403) return failed('refused');
  return failed('failed');
}

/** A report: which request, and delivered or not. Undefined while it is still on its way. */
export function readTelegramReport(body: unknown): { ref: string; outcome: 'delivered' | 'failed' } | undefined {
  const b = body as { request_id?: unknown; delivery_status?: { status?: unknown } } | undefined;
  const ref = typeof b?.request_id === 'string' ? b.request_id : '';
  const status = b?.delivery_status?.status;
  if (!ref) return undefined;
  if (status === 'delivered' || status === 'read') return { ref, outcome: 'delivered' };
  if (status === 'expired' || status === 'revoked') return { ref, outcome: 'failed' };
  return undefined;
}

/** The report's signature, as Telegram's reference gives it, and a timestamp no older than five minutes. */
export function telegramSigned(raw: Buffer, timestamp: string | undefined, signature: string | undefined, token: string | undefined, now: number = Date.now()): boolean {
  if (!token || !timestamp || !signature || !/^\d{1,12}$/.test(timestamp)) return false;
  if (Math.abs(now / 1000 - Number(timestamp)) > TELEGRAM_REPORT_MAX_AGE_S) return false;
  const key = createHash('sha256').update(token).digest();
  const want = createHmac('sha256', key).update(Buffer.concat([Buffer.from(`${timestamp}\n`), raw])).digest();
  const given = Buffer.from(signature, 'hex');
  return given.length === want.length && timingSafeEqual(given, want);
}
