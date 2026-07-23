import { Injectable } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { randomInt, timingSafeEqual } from 'crypto';
import { normalizePhone } from '../../foundation/identity/phone';

/** 429 — a retryable rate-limit rejection (RATE_LIMITED carries status 429 + retryable in the registry). */
const tooManyRequests = (message: string) => new GlosError('RATE_LIMITED', message);

const OTP_TTL_MS = 10 * 60 * 1000;
/** A verified phone does not stay verified forever — sign-up must follow verification promptly. */
const VERIFIED_TTL_MS = 30 * 60 * 1000;
/** Wrong-code attempts before the code is burned. */
const MAX_ATTEMPTS = 5;
/** Minimum gap between two code requests for the same number. */
const RESEND_COOLDOWN_MS = 60 * 1000;
/** Codes per number per rolling day. */
const MAX_PER_DAY = 10;
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
}

/**
 * OtpService — phone-number verification for participant onboarding. A field operator's phone is
 * mandatory: the control tower uses it to reach them on escalation, and it anchors GPS tracking. We
 * issue a short numeric code (returned in the sandbox — would be SMS'd in production), then mark the
 * number verified once the code is confirmed. Account sign-up will not provision an entity for an
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

  /**
   * Normalize to E.164 via the shared normalizer (foundation/identity/phone). Without this, rate limits
   * and the verified set are trivially bypassed by re-typing the same number in a different format — and,
   * since S20, the OTP-verified number must hash to the SAME identity key the Person is stored under, so
   * the two paths share one normalizer rather than each keeping their own.
   */
  private norm(phone: string): string {
    return normalizePhone(phone);
  }

  /** Issue a 6-digit code for a phone (returned here; SMS'd in production). */
  request(phone: string): { sent: boolean; code: string } {
    const p = this.norm(phone);
    if (p.replace(/\D/g, '').length < 9) throw new GlosError('PHONE_INVALID', 'Enter a valid phone number');
    this.assertWithinRate(p);

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.codes.set(p, { code, expires: Date.now() + OTP_TTL_MS, attempts: 0 });
    return { sent: true, code };
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
    this.verified.delete(this.norm(phone));
  }

  // --- internals ---

  private assertWithinRate(p: string): void {
    const now = Date.now();
    const rate = this.rates.get(p);
    if (!rate) {
      this.rates.set(p, { lastRequestAt: now, windowStart: now, count: 1 });
      return;
    }
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
  }

  private static safeEqual(a: string, b: string): boolean {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
  }
}
