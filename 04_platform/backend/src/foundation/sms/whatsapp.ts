import { createHmac, timingSafeEqual } from 'crypto';
import { isSandbox } from '../runtime/sandbox';
import type { RouteState } from './code-routes.types';
import { SmsFailure } from './sms.types';

/**
 * 2026-11-16 — A CODE BY WHATSAPP, AS PLAIN FUNCTIONS (the plan "Sign-in codes beyond Twilio SMS", D2: a choice on the code
 * screen, never the default; $0.004 a code in East Africa, $0.05 in the Netherlands). `WhatsAppSender` does the sending.
 *
 * Read from Meta's own pages on 2026-11-16 (authentication templates, copy-code button):
 *   POST https://graph.facebook.com/v27.0/<phone number id>/messages, `Authorization: Bearer <token>`, JSON
 *   { messaging_product: "whatsapp", recipient_type: "individual", to: "<number, no +>", type: "template",
 *     template: { name, language: { code }, components: [ { type: "body", parameters: [{ type: "text", text: CODE }] },
 *     { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: CODE }] } ] } } — the code twice.
 *   The answer: { contacts: [{ wa_id }], messages: [{ id: "wamid…" }] }; an error: { error: { code, message } } —
 *   131026: the number is not on WhatsApp.
 *   What became of it is posted to the webhook set in Meta, signed `X-Hub-Signature-256: sha256=<hex HMAC of the raw body
 *   with the app secret>`: entry[].changes[].value.statuses[] { id, status: sent | delivered | read | failed }.
 *
 * The template (an "authentication" one with a copy-code button) is made and approved in Meta first. NEVER SENT THROUGH THE
 * REAL PROVIDER FROM HERE.
 */
type Env = Record<string, string | undefined>;

export const WHATSAPP_API = 'https://graph.facebook.com';

export interface WhatsAppConfig {
  state: RouteState;
  /** Meta posts what became of each message to this server, and it can be checked: the app secret and verify token are set. */
  reports: boolean;
  appSecret?: string;
  verifyToken?: string;
  // There ONLY when it can be used.
  endpoint?: string;
  token?: string;
  template?: string;
  language?: string;
}

const set = (v: string | undefined) => (v ?? '').trim();

/**
 * `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` and `WHATSAPP_TEMPLATE` (the approved template's name) send;
 * `WHATSAPP_TEMPLATE_LANG` (default `en`) and `WHATSAPP_API_VERSION` (default `v27.0`) say which; `WHATSAPP_APP_SECRET` and
 * `WHATSAPP_VERIFY_TOKEN` let its webhook in. A SANDBOX DOES NOT SEND.
 */
export function whatsAppConfig(env: Env = process.env, sandbox: boolean = isSandbox()): WhatsAppConfig {
  const token = set(env.WHATSAPP_TOKEN);
  const phoneId = set(env.WHATSAPP_PHONE_NUMBER_ID);
  const template = set(env.WHATSAPP_TEMPLATE);
  const language = set(env.WHATSAPP_TEMPLATE_LANG) || 'en';
  const version = set(env.WHATSAPP_API_VERSION) || 'v27.0';
  const appSecret = set(env.WHATSAPP_APP_SECRET);
  const verifyToken = set(env.WHATSAPP_VERIFY_TOKEN);
  const webhook = { ...(appSecret ? { appSecret } : {}), ...(verifyToken ? { verifyToken } : {}) };
  const sends = Boolean(token && phoneId && template);
  const reports = sends && Boolean(appSecret && verifyToken);
  if (!token && !phoneId && !template) return { state: 'not_set_up', reports: false, ...webhook };
  if (!sends || !/^v\d+\.\d+$/.test(version) || !/^\d+$/.test(phoneId)) return { state: 'half_set_up', reports: false, ...webhook };
  if (sandbox) return { state: 'sandbox', reports: false, ...webhook };
  return { state: 'ready', reports, ...webhook, endpoint: `${WHATSAPP_API}/${version}/${phoneId}/messages`, token, template, language };
}

/** The message Meta is sent: the approved template, the code in its body and its copy button. */
export function toWhatsAppBody(config: WhatsAppConfig, to: string, code: string): string {
  return JSON.stringify({
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to: to.replace(/^\+/, ''),
    type: 'template',
    template: {
      name: config.template,
      language: { code: config.language },
      components: [
        { type: 'body', parameters: [{ type: 'text', text: code }] },
        { type: 'button', sub_type: 'url', index: '0', parameters: [{ type: 'text', text: code }] },
      ],
    },
  });
}

export type WhatsAppAnswer = { ok: true; ref?: string } | { ok: false; kind: SmsFailure; code?: string };

/** Meta's numbers that say THE NUMBER cannot be sent to: not on WhatsApp (or an app too old to receive it). */
const NOT_ON_WHATSAPP = new Set(['131026']);
/** Slow down: too many, or too many to one number. */
const SLOW = new Set(['130429', '131056', '80007']);
const CODE = /^\d{1,7}$/;

/** WHAT AN ANSWER MEANS. Taken only with a message id in Meta's own answer; otherwise whose it is to put right. */
export function readWhatsAppAnswer(status: number, body: string): WhatsAppAnswer {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  const answer = json && typeof json === 'object' ? (json as { messages?: Array<{ id?: unknown }>; error?: { code?: unknown } }) : undefined;
  const raw = answer?.error?.code;
  const code = typeof raw === 'number' || typeof raw === 'string' ? (CODE.test(String(raw)) ? String(raw) : undefined) : undefined;
  const failed = (kind: SmsFailure): WhatsAppAnswer => ({ ok: false, kind, ...(code ? { code } : {}) });
  if (status >= 200 && status < 300) {
    const id = answer?.messages?.[0]?.id;
    return typeof id === 'string' && id ? { ok: true, ref: id } : failed('failed');
  }
  if (code && NOT_ON_WHATSAPP.has(code)) return failed('rejected');
  if (status === 429 || (code && SLOW.has(code))) return failed('limit');
  // The token (190), what the app may do (10, 200), a template not approved or not there (132xxx), a bad request (100).
  if (status === 400 || status === 401 || status === 403 || status === 404) return failed('refused');
  return failed('failed');
}

/** Every message the webhook speaks of: which, and delivered or not. Messages still on their way are left out. */
export function readWhatsAppReports(body: unknown): Array<{ ref: string; outcome: 'delivered' | 'failed' }> {
  const out: Array<{ ref: string; outcome: 'delivered' | 'failed' }> = [];
  const entries = (body as { entry?: Array<{ changes?: Array<{ value?: { statuses?: Array<{ id?: unknown; status?: unknown }> } }> }> } | undefined)?.entry;
  for (const entry of Array.isArray(entries) ? entries : []) {
    for (const change of Array.isArray(entry?.changes) ? entry.changes : []) {
      for (const s of Array.isArray(change?.value?.statuses) ? change.value!.statuses! : []) {
        if (typeof s?.id !== 'string' || !s.id) continue;
        if (s.status === 'delivered' || s.status === 'read') out.push({ ref: s.id, outcome: 'delivered' });
        else if (s.status === 'failed') out.push({ ref: s.id, outcome: 'failed' });
      }
    }
  }
  return out;
}

/** The webhook's signature: `sha256=` and the hex HMAC of the bytes as they came, keyed with the app secret. */
export function whatsAppSigned(raw: Buffer, header: string | undefined, appSecret: string | undefined): boolean {
  if (!appSecret || !header?.startsWith('sha256=')) return false;
  const given = Buffer.from(header.slice(7), 'hex');
  const want = createHmac('sha256', appSecret).update(raw).digest();
  return given.length === want.length && timingSafeEqual(given, want);
}
