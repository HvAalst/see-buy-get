import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { randomInt, timingSafeEqual } from 'crypto';
import { normalizePhone } from '../../foundation/identity/phone';

/** 429 — a retryable rate-limit rejection (RATE_LIMITED carries status 429 + retryable in the registry). */
const tooManyRequests = (message: string) => new GlosError('RATE_LIMITED', message);

/** How long a code works, in minutes. The text that carries it says so. */
export const OTP_TTL_MINUTES = 10;
const OTP_TTL_MS = OTP_TTL_MINUTES * 60 * 1000;
/** A verified phone does not stay verified forever — sign-up must follow verification promptly. */
const VERIFIED_TTL_MS = 30 * 60 * 1000;
/** Wrong-code attempts before the code is burned. */
const MAX_ATTEMPTS = 5;
/** Minimum gap between two code requests for the same number. */
const RESEND_COOLDOWN_MS = 60 * 1000;
/** Codes per number per rolling day. */
const MAX_PER_DAY = 10;
/**
 * Sign-ups a verification may have refused because the details belong to an existing account. A typo is
 * human, so it is more than one; after that the verification is spent — otherwise one verified phone could
 * ask the register about every national ID there is, and a refusal that names the field is an answer.
 */
export const MAX_REFUSALS_PER_VERIFICATION = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
interface CodeEntry {
  code: string;
  expires: number;
  attempts: number;
}

interface RateEntry {
  lastRequestAt: number;
  windowStart: number;
  count: number;
  /** How it stood before the newest request — `null` when that request was the number's first. See `notSent`. */
  before?: { lastRequestAt: number; windowStart: number; count: number } | null;
}

/**
 * OtpService — phone-number verification for participant onboarding. A field operator's phone is
 * mandatory: the control tower uses it to reach them on escalation, and it anchors GPS tracking. We
 * issue a short numeric code (returned in the sandbox — texted by the door that asked, `auth/phone/request`,
 * anywhere else), then mark the number verified once the code is confirmed. Account sign-up will not provision an entity for an
 * unverified phone.
 *
 * Hardened in S0: 6-digit codes, attempt lockout, resend cooldown, a daily cap, E.164 normalization
 * (so `0712 345 678`, `+254712345678` and `254712345678` are one number rather than three) and an
 * expiry on the verified set.
 */
@Injectable()
export class OtpService {
  private readonly codes = new Map<string, CodeEntry>();
  private readonly verified = new Map<string, number>(); // phone -> expiry
  private readonly rates = new Map<string, RateEntry>();
  private readonly refusals = new Map<string, number>(); // phone -> sign-ups refused on this verification

  /**
   * Normalize to E.164 via the shared normalizer (foundation/identity/phone). Without this, rate limits
   * and the verified set are trivially bypassed by re-typing the same number in a different format — and,
   * since S20, the OTP-verified number must hash to the SAME identity key the Person is stored under, so
   * the two paths share one normalizer rather than each keeping their own.
   */
  private norm(phone: string): string {
    return normalizePhone(phone);
  }

  /** The number a code would go to, as E.164 — or the refusal a number that cannot be one gets. Nothing is counted. */
  phoneFor(phone: string): string {
    const p = this.norm(phone);
    if (p.replace(/\D/g, '').length < 9) throw new GlosError('PHONE_INVALID', 'Enter a valid phone number');
    return p;
  }

  /** Issue a 6-digit code for a phone (returned here; the door that asked texts it). */
  request(phone: string): { sent: boolean; code: string } {
    const p = this.phoneFor(phone);
    this.assertWithinRate(p);

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.codes.set(p, { code, expires: Date.now() + OTP_TTL_MS, attempts: 0 });
    return { sent: true, code };
  }

  /**
   * THE CODE JUST ISSUED COULD NOT BE TEXTED. The try is given back: the person may ask again at once, and it does
   * not count against the number's day — a provider's bad minute is not theirs to wait out, and ten of them must
   * not lock a number until tomorrow.
   *
   * The code itself STAYS GOOD. "Could not be sent" includes "got no answer in time", and a text that only seemed
   * to fail may still arrive: it should then work. Asking again replaces it, as asking again always does.
   */
  notSent(phone: string): void {
    const p = this.norm(phone);
    const rate = this.rates.get(p);
    if (!rate || rate.before === undefined) return;
    if (rate.before === null) this.rates.delete(p);
    else this.rates.set(p, { ...rate.before });
  }

  /** Confirm the code → marks the phone verified. Burns the code after MAX_ATTEMPTS wrong tries. */
  verify(phone: string, code: string): { verified: boolean } {
    const p = this.norm(phone);
    const entry = this.codes.get(p);
    if (!entry || entry.expires < Date.now()) {
      this.codes.delete(p);
      throw new GlosError('OTP_INVALID', 'Wrong or expired code');
    }

    if (!OtpService.safeEqual(entry.code, (code || '').trim())) {
      entry.attempts += 1;
      if (entry.attempts >= MAX_ATTEMPTS) {
        this.codes.delete(p); // burn it — a 6-digit code must not be brute-forceable
        throw new GlosError('OTP_LOCKED', 'Too many wrong codes. Request a new one.');
      }
      throw new GlosError('OTP_INVALID', 'Wrong or expired code');
    }

    this.codes.delete(p);
    this.verified.set(p, Date.now() + VERIFIED_TTL_MS);
    this.refusals.delete(p); // a fresh verification, a fresh allowance
    return { verified: true };
  }

  isVerified(phone: string): boolean {
    const p = this.norm(phone);
    const expires = this.verified.get(p);
    if (!expires) return false;
    if (expires < Date.now()) {
      this.verified.delete(p);
      return false;
    }
    return true;
  }

  /** Used by sign-up to consume the verification (a phone verifies one account). */
  consume(phone: string): void {
    const p = this.norm(phone);
    this.verified.delete(p);
    this.refusals.delete(p);
  }

  /**
   * A sign-up on this verification was refused because its details are already registered. Counted, and
   * the verification spent once the allowance is used — the next attempt is asked to verify again.
   */
  noteRefusal(phone: string): void {
    const p = this.norm(phone);
    const count = (this.refusals.get(p) ?? 0) + 1;
    if (count >= MAX_REFUSALS_PER_VERIFICATION) {
      this.consume(p);
      return;
    }
    this.refusals.set(p, count);
  }

  // --- internals ---

  private assertWithinRate(p: string): void {
    const now = Date.now();
    const rate = this.rates.get(p);
    if (!rate) {
      this.rates.set(p, { lastRequestAt: now, windowStart: now, count: 1, before: null });
      return;
    }
    // Taken before anything moves, a new day's reset included: what is given back is exactly how it stood.
    const before = { lastRequestAt: rate.lastRequestAt, windowStart: rate.windowStart, count: rate.count };
    if (now - rate.windowStart > DAY_MS) {
      rate.windowStart = now;
      rate.count = 0;
    }
    if (now - rate.lastRequestAt < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - rate.lastRequestAt)) / 1000);
      throw tooManyRequests(`Wait ${wait}s before asking for another code`);
    }
    if (rate.count >= MAX_PER_DAY) {
      throw tooManyRequests('Too many codes requested for this number today');
    }
    rate.lastRequestAt = now;
    rate.count += 1;
    rate.before = before;
  }

  private static safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }
}
