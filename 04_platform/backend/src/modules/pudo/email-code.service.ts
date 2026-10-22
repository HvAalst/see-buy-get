import { forwardRef, Inject, Injectable, Optional } from '@nestjs/common';
import { randomInt, timingSafeEqual } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { MailService } from '../../foundation/mail/mail.service';
import { REVIEW_CODE } from '../../foundation/runtime/review-code';
import { PersonService } from './person.service';

const CODE_TTL_MS = 15 * 60 * 1000;
/** A confirmed address does not stay confirmed for ever — what it was confirmed FOR has to follow promptly. */
const VERIFIED_TTL_MS = 30 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/** One spelling of an address: trimmed, lower-cased. `Amina@Example.com ` and `amina@example.com` are one inbox. */
export function normalizeEmail(email: string | undefined): string {
  return (email ?? '').trim().toLowerCase();
}

/** Plausible, not deliverable: one @, something either side, a dot in the domain. The code is the real test. */
export function isPlausibleEmail(email: string | undefined): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email));
}

interface CodeEntry {
  code: string;
  expires: number;
  attempts: number;
  /** The review code (000000), not one that was mailed: it may confirm a new address, never open an account. */
  review?: boolean;
}

/**
 * A code sent to an EMAIL ADDRESS — the phone code's twin, for the second channel.
 *
 * The user, 2026-10-01: "we need an email for account recovery and safety. Anyone with a phone has an email." A
 * phone number can be lost, deregistered or handed to somebody else by an operator; an inbox is the one thing a
 * person still holds when that happens. So every account confirms one, with a code, before it is relied on —
 * an address nobody proved they read is a recovery channel into somebody else's inbox.
 *
 * Same hardening as the phone code: six digits, five wrong tries burn it, a minute between requests, ten a day
 * per address. The service only makes and checks codes; who is told the code (the inbox — and, in a sandbox, the
 * caller) is the controller's decision.
 */
@Injectable()
export class EmailCodeService {
  private readonly codes = new Map<string, CodeEntry>();
  private readonly verified = new Map<string, number>(); // address -> expiry
  private readonly rates = new Map<string, { lastAt: number; windowStart: number; count: number }>();

  /** Addresses confirmed with the review code, not a mailed one. */
  private readonly byReview = new Set<string>();

  // Optional so the specs that build this with nothing keep compiling.
  constructor(
    @Optional() private readonly mail?: MailService,
    // The review code's last guard reads it: an address somebody holds is never confirmed by 000000. A forward reference:
    // person.service.ts imports this file (normalizeEmail), and without it this would be injected as nothing.
    @Optional() @Inject(forwardRef(() => PersonService)) private readonly persons?: PersonService,
  ) {}

  /** Make a code for this address. The caller mails it — or, `review`, it is 000000 and mailed nowhere (the caller decides). */
  request(email: string, now: number = Date.now(), opts: { review?: boolean } = {}): { code: string; minutes: number } {
    const e = normalizeEmail(email);
    if (!isPlausibleEmail(e)) throw new GlosError('VALIDATION_FAILED', 'Enter a valid email address', { field: 'email' });
    this.assertWithinRate(e, now);
    const code = opts.review ? REVIEW_CODE : String(randomInt(0, 1_000_000)).padStart(6, '0');
    this.codes.set(e, { code, expires: now + CODE_TTL_MS, attempts: 0, ...(opts.review ? { review: true } : {}) });
    return { code, minutes: CODE_TTL_MS / 60_000 };
  }

  /** An address held by somebody now, confirmed by the review code: proves nothing about them, so counts for nothing. */
  private reviewVoid(e: string, review: boolean | undefined): boolean {
    return Boolean(review) && (!this.persons || Boolean(this.persons.findByEmail(e)));
  }

  /** Check a code. Right: the address counts as confirmed for the next half hour. Five wrong: the code is burned. */
  verify(email: string, code: string, now: number = Date.now()): { verified: true } {
    const e = normalizeEmail(email);
    const entry = this.codes.get(e);
    if (!entry || entry.expires < now || this.reviewVoid(e, entry.review)) {
      this.codes.delete(e);
      throw new GlosError('OTP_INVALID', 'Wrong or expired code');
    }
    if (!safeEqual(entry.code, (code || '').trim())) {
      entry.attempts += 1;
      if (entry.attempts >= MAX_ATTEMPTS) {
        this.codes.delete(e);
        throw new GlosError('OTP_LOCKED', 'Too many wrong codes. Ask for a new one.');
      }
      throw new GlosError('OTP_INVALID', 'Wrong or expired code');
    }
    this.codes.delete(e);
    this.verified.set(e, now + VERIFIED_TTL_MS);
    if (entry.review) this.byReview.add(e);
    else this.byReview.delete(e);
    // Somebody read what we sent there: whatever came back from this address before, it works now.
    this.mail?.addressWorks(e);
    return { verified: true };
  }

  isVerified(email: string, now: number = Date.now()): boolean {
    const e = normalizeEmail(email);
    const expires = this.verified.get(e);
    if (!expires) return false;
    if (expires < now) {
      this.verified.delete(e);
      return false;
    }
    if (this.byReview.has(e) && this.reviewVoid(e, true)) return false;
    return true;
  }

  /** One confirmation, one use. */
  consume(email: string): void {
    this.verified.delete(normalizeEmail(email));
    this.byReview.delete(normalizeEmail(email));
  }

  private assertWithinRate(e: string, now: number): void {
    const rate = this.rates.get(e);
    if (!rate) {
      this.rates.set(e, { lastAt: now, windowStart: now, count: 1 });
      return;
    }
    if (now - rate.windowStart > DAY_MS) {
      rate.windowStart = now;
      rate.count = 0;
    }
    if (now - rate.lastAt < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - rate.lastAt)) / 1000);
      throw new GlosError('RATE_LIMITED', `Wait ${wait}s before asking for another code`);
    }
    if (rate.count >= MAX_PER_DAY) throw new GlosError('RATE_LIMITED', 'Too many codes requested for this address today');
    rate.lastAt = now;
    rate.count += 1;
  }
}

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
