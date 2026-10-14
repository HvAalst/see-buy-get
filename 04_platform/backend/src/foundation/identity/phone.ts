import { createHash } from 'crypto';
import { deploymentSecret } from '../runtime/secrets';

/**
 * Phone normalization + hashing — the identity spine's join key (S20).
 *
 * ONE normalizer, shared. The OTP service, the Person identity, and the parcel sender/receiver
 * linkage MUST agree on what "the same number" is, or a person verified by OTP would never match
 * the parcel that was addressed to them. This is the extracted, single source of that truth (it was
 * private to OtpService before S20); OtpService now calls it so the two can never drift.
 *
 * The HASH is what the Operational Core stores — never the cleartext number. Peppered SHA-256 keeps
 * the pseudonymous firewall intact: the hash is a stable join key, but a stolen core snapshot cannot
 * be reversed to phone numbers without the server pepper. (A future central account service owns the
 * real number; SBG's core only ever needs the match.)
 */

/** Dial code applied to national-format numbers (leading 0 / bare). Matches the OTP service default. */
const DEFAULT_DIAL_CODE = process.env.GLOS_DEFAULT_DIAL_CODE || '+254';

/**
 * Server-side pepper for the phone hash. A dev default keeps the sandbox working; outside one the server does not
 * start without a real secret (`deploymentSecret`): phone numbers are few enough to try them all against a known pepper. Rotating it re-keys every phoneHash (a deliberate, operator-gated migration), so it is
 * kept out of the data and read once here.
 */
const PHONE_PEPPER = deploymentSecret('GLOS_PHONE_PEPPER', 'glos-dev-phone-pepper-change-me');

/**
 * Normalize a phone to E.164. Without this, the verified set, rate limits and the identity join key are
 * trivially bypassed by re-typing the same number in a different format (`0712 345 678`,
 * `+254712345678`, `254712345678` are one person, not three).
 */
export function normalizePhone(phone: string, dialCode: string = DEFAULT_DIAL_CODE): string {
  let p = (phone || '').replace(/[\s\-()./]/g, '').trim();
  if (p.startsWith('00')) p = `+${p.slice(2)}`;
  if (p.startsWith('+')) return `+${p.slice(1).replace(/\D/g, '')}`;
  p = p.replace(/\D/g, '');
  if (!p) return '';
  if (p.startsWith('0')) return `${dialCode}${p.slice(1)}`;
  const bare = dialCode.replace(/\D/g, '');
  if (p.startsWith(bare)) return `+${p}`;
  return `${dialCode}${p}`;
}

/**
 * The pseudonymous join key for a phone: `sha256(pepper : e164)`, hex. Returns '' for an empty/blank
 * number so callers can treat "no phone" as "no link" without a special case. Deterministic — the same
 * number always yields the same key, which is exactly what makes retroactive linking work.
 */
export function hashPhone(phone: string): string {
  const e164 = normalizePhone(phone);
  if (!e164) return '';
  return createHash('sha256').update(`${PHONE_PEPPER}:${e164}`).digest('hex');
}

/**
 * The same kind of key for an EMAIL ADDRESS — lower-cased, trimmed, peppered. It is how one inbox is known to be one
 * account's without the address itself sitting in the operational core.
 */
export function hashEmail(email: string): string {
  const e = (email || '').trim().toLowerCase();
  return e ? createHash('sha256').update(`${PHONE_PEPPER}:email:${e}`).digest('hex') : '';
}

/** A phone is usable as an identity key only if it normalizes to a plausible E.164 (≥ 9 digits). */
export function isPlausiblePhone(phone: string): boolean {
  return normalizePhone(phone).replace(/\D/g, '').length >= 9;
}
