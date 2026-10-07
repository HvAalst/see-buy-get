import { createHmac, timingSafeEqual } from 'crypto';

/*
 * A BOUNCE, AS THE PROVIDER TELLS US OF ONE — read from its notice, and believed only when the notice is signed.
 *
 * "Handed over" is not "arrived". When an email comes back, the provider posts a notice to an address we give it. It is
 * the only thing on this server that is told from outside which addresses to stop writing to — so it is treated as
 * what it is: an unauthenticated request until proved otherwise.
 *
 * WHAT ITS DOCUMENTATION SAYS (read 2026-10-07), and what it does not. The notice carries a header,
 * `producer-signature: ts=<ms>;s=<base64 HMAC-SHA256, URL-encoded>;s-algorithm=HmacSHA256`, made with the
 * "authentication key" set on the webhook. Its own sample code URL-decodes the body, takes what follows the first
 * `=`, and signs THAT — so the body is form-wrapped (`<name>=<the notice, as JSON>`) — but no page says what the
 * field is called, whether the body is always wrapped, or whether the key is used as its characters or decoded. And
 * the timestamp is NOT part of what is signed.
 *
 * So this does not lean on one reading. A notice is accepted when the signature matches the body in ANY of the forms
 * the documentation implies; every one of them needs the key. None has ever been received from the real provider: the
 * console's Connections screen counts the ones refused, and says why, so that a wrong guess here is seen the first day.
 */

/** How old a notice may be. Its timestamp is not signed, so this stops nothing determined — it stops a stale retry. */
export const EVENT_MAX_AGE_MS = 15 * 60_000;
/** How far ahead of this server's clock its timestamp may be. */
export const EVENT_MAX_AHEAD_MS = 5 * 60_000;

/**
 * WHY A NOTICE WAS REFUSED. `unsigned` — no signature header, or not one we can read · `algorithm` — signed some
 * other way than the one documented · `stale` — its time is not now · `mismatch` — the signature is not the key's
 * over this body, in any form · `unreadable` — signed, and not a notice · `not_raw` — this server was not started to
 * read such a request as the bytes it arrived in, so nothing can be checked (ours to put right, not the provider's).
 */
export const EVENT_REFUSALS = ['unsigned', 'algorithm', 'stale', 'mismatch', 'unreadable', 'not_raw'] as const;
export type EventRefusal = (typeof EVENT_REFUSALS)[number];

export interface ProducerSignature {
  ts: number;
  s: string;
  algorithm: string;
}

/** `ts=…;s=…;s-algorithm=…` — in any order, and nothing else. */
export function readProducerSignature(header: string | undefined): ProducerSignature | undefined {
  if (!header || typeof header !== 'string' || header.length > 600) return undefined;
  const parts = new Map<string, string>();
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at > 0) parts.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim());
  }
  const ts = Number(parts.get('ts'));
  const s = parts.get('s');
  const algorithm = parts.get('s-algorithm');
  if (!Number.isFinite(ts) || ts <= 0 || !s || !algorithm) return undefined;
  return { ts, s, algorithm };
}

function decoded(text: string): string | undefined {
  try {
    const out = decodeURIComponent(text.replace(/\+/g, ' '));
    return out === text ? undefined : out;
  } catch {
    return undefined;
  }
}

/** Every form of the body the documentation's sample could have signed: as it came, URL-decoded, and what follows a field's `=`. */
export function bodyForms(raw: Buffer): string[] {
  const forms = new Set<string>();
  const add = (text: string | undefined) => {
    if (!text) return;
    forms.add(text);
    const plain = decoded(text);
    if (plain) forms.add(plain);
  };
  const text = raw.toString('utf8');
  add(text);
  for (const form of [...forms]) {
    const at = form.indexOf('=');
    // A field's name, then its value. A notice that is plain JSON has no such prefix: a `=` inside it is not one.
    if (at > 0 && at <= 64 && /^[A-Za-z0-9_.-]+$/.test(form.slice(0, at))) add(form.slice(at + 1));
  }
  return [...forms];
}

/**
 * IS THIS NOTICE THE PROVIDER'S? And if it is, what does it say.
 *
 * Nothing about the body is read — not even parsed — until a signature has matched it.
 */
export function readSignedEvent(raw: Buffer, header: string | undefined, key: string, now: number): { ok: true; event: Record<string, unknown> } | { ok: false; why: EventRefusal } {
  const signature = readProducerSignature(header);
  if (!signature || !key) return { ok: false, why: 'unsigned' };
  if (signature.algorithm.toLowerCase() !== 'hmacsha256') return { ok: false, why: 'algorithm' };
  if (now - signature.ts > EVENT_MAX_AGE_MS || signature.ts - now > EVENT_MAX_AHEAD_MS) return { ok: false, why: 'stale' };

  const given = [signature.s, decoded(signature.s)].filter((x): x is string => Boolean(x)).map((x) => Buffer.from(x, 'base64'));
  // The key as its characters; and, where it is base64 that says something else, as the bytes it stands for.
  const asBytes = Buffer.from(key, 'base64');
  const keys = [Buffer.from(key, 'utf8'), ...(asBytes.length >= 16 && asBytes.toString('base64').replace(/=+$/, '') === key.replace(/=+$/, '') ? [asBytes] : [])];
  const forms = bodyForms(raw);
  const matches = forms.some((form) =>
    keys.some((k) => {
      const mac = createHmac('sha256', k).update(form, 'utf8').digest();
      return given.some((g) => g.length === mac.length && timingSafeEqual(g, mac));
    }),
  );
  if (!matches) return { ok: false, why: 'mismatch' };

  for (const form of forms) {
    try {
      const json: unknown = JSON.parse(form);
      if (json && typeof json === 'object' && !Array.isArray(json)) return { ok: true, event: json as Record<string, unknown> };
    } catch {
      /* not this form */
    }
  }
  return { ok: false, why: 'unreadable' };
}

/** An address that came back, and how: for good (`hard`), or for now (`soft` — a full mailbox, a server having a bad hour). */
export interface Bounce {
  address: string;
  kind: 'hard' | 'soft';
  /** The provider's own short word for why, where it gave one that is only a word. Its sentences can name people. */
  reason?: string;
}

const list = (x: unknown): unknown[] => (Array.isArray(x) ? x : x === undefined || x === null ? [] : [x]);
const obj = (x: unknown): Record<string, unknown> => (x && typeof x === 'object' && !Array.isArray(x) ? (x as Record<string, unknown>) : {});
const word = (x: unknown): string => (typeof x === 'string' ? x.toLowerCase().replace(/[^a-z]/g, '') : '');
const kindOf = (name: string): Bounce['kind'] | undefined => (name === 'hardbounce' ? 'hard' : name === 'softbounce' ? 'soft' : undefined);
const ADDRESS = /^[^\s@<>"]{1,64}@[^\s@<>"]{1,255}\.[^\s@<>".]{2,}$/;

/**
 * THE BOUNCES IN A NOTICE — and nothing else in it. Opens and clicks are other notices on the same address; they are
 * not ours to act on (nothing we send is tracked) and are read as no bounces at all.
 *
 * Read by what the documentation's samples show (`event_name: ["hardbounce"]`, `event_message[].event_data[].details[]
 * .bounced_recipient`), without insisting on any of it being a list or the other: a provider that changed one of
 * those would otherwise be a provider whose bounces we silently stopped hearing.
 */
export function readBounces(event: Record<string, unknown>): { id?: string; bounces: Bounce[] } {
  const named = list(event.event_name).map(word).map(kindOf).find(Boolean);
  const bounces: Bounce[] = [];
  for (const message of list(event.event_message).map(obj)) {
    for (const data of list(message.event_data).map(obj)) {
      // What this entry says it is, first; the notice's own name where the entry does not say.
      const kind = kindOf(word(data.object)) ?? (data.object === undefined ? named : undefined);
      if (!kind) continue;
      for (const detail of list(data.details).map(obj)) {
        const address = typeof detail.bounced_recipient === 'string' ? detail.bounced_recipient.trim().toLowerCase() : '';
        if (!ADDRESS.test(address)) continue;
        const why = [detail.diagnostic_message, detail.reason].find((r): r is string => typeof r === 'string' && /^[a-z0-9][a-z0-9 _-]{0,59}$/i.test(r));
        bounces.push({ address, kind, ...(why ? { reason: why.toLowerCase() } : {}) });
      }
    }
  }
  const id = typeof event.webhook_request_id === 'string' && event.webhook_request_id ? event.webhook_request_id.slice(0, 200) : undefined;
  return { ...(id ? { id } : {}), bounces };
}

/** Sign a body as the provider's documentation says it does. For the stand-in and the tests — never for anything we send. */
export function producerSignatureFor(signed: string, key: string, ts: number): string {
  return `ts=${ts};s=${encodeURIComponent(createHmac('sha256', Buffer.from(key, 'utf8')).update(signed, 'utf8').digest('base64'))};s-algorithm=HmacSHA256`;
}
