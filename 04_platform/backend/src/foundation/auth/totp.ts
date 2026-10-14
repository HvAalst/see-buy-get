import { createHmac, randomBytes } from 'crypto';

/**
 * TIME-BASED ONE-TIME CODES (RFC 6238) — the six digits an authenticator app shows.
 *
 * Any authenticator works: Google Authenticator, Microsoft Authenticator, 1Password, Aegis, a password manager. The
 * app and this server share a secret once, by QR code, and from then on each derives the same code from the clock.
 * Nothing is sent, nobody's cloud is involved, and no account with any provider is needed.
 *
 * HMAC-SHA1, 30-second steps, 6 digits: the defaults every authenticator assumes when the URI says nothing else.
 */
export const TOTP_STEP_SECONDS = 30;
const DIGITS = 6;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** A new shared secret: 20 random bytes (160 bits, what RFC 4226 recommends), in base32 for a person or a QR code. */
export function newTotpSecret(): string {
  return toBase32(randomBytes(20));
}

export function toBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function fromBase32(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const i = ALPHABET.indexOf(ch);
    if (i < 0) throw new Error('not base32');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The step a moment falls in. */
export function totpStep(now: number = Date.now()): number {
  return Math.floor(now / 1000 / TOTP_STEP_SECONDS);
}

/** The code for one step (RFC 4226 dynamic truncation over the step counter). */
export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', fromBase32(secret)).update(counter).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const bin = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(bin % 10 ** DIGITS).padStart(DIGITS, '0');
}

/**
 * Check a typed code. One step either side is accepted, because a phone's clock drifts and a person types slowly.
 *
 * Returns the STEP the code matched, so the caller can refuse it a second time: a code seen over somebody's shoulder
 * must not open a second session in the same half-minute. `usedStep` is the last step already accepted.
 */
export function verifyTotp(secret: string, code: string, now: number = Date.now(), usedStep = -1): number | null {
  const typed = (code || '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(typed)) return null;
  const at = totpStep(now);
  for (const step of [at - 1, at, at + 1]) {
    if (step <= usedStep) continue;
    if (safeEqual(totpCode(secret, step), typed)) return step;
  }
  return null;
}

/** What an authenticator app reads from the QR code. */
export function otpauthUri(issuer: string, account: string, secret: string): string {
  // Issuer and account encoded apart, the colon between them literal — the form every authenticator parses.
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(TOTP_STEP_SECONDS) });
  return `otpauth://totp/${label}?${params.toString()}`;
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
