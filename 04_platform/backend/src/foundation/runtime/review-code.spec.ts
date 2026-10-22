import { OtpService } from '../../modules/pudo/otp.service';
import { EmailCodeService } from '../../modules/pudo/email-code.service';
import type { PersonService } from '../../modules/pudo/person.service';
import { REVIEW_CODE, reviewCodeOn, reviewCodeState, reviewCodeUntil } from './review-code';

/*
 * THE REVIEW CODE (the user, 2026-10-22: "feature flag the twillio requirement and make every sign up pass with 000000
 * for now"). What is held to here: it is on only off a sandbox, only with a real day, only until the end of that day;
 * and a verification made with it counts for nothing once its number — or address — belongs to somebody.
 */
describe('the review code', () => {
  const live = (more: Record<string, string> = {}) => ({ GLOS_ENV: 'production', ...more }) as NodeJS.ProcessEnv;
  const at = (iso: string) => new Date(iso).getTime();
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it('is on, off a sandbox, through the end of the day it names (UTC) — and off the moment after', () => {
    process.env.GLOS_ENV = 'production';
    const e = live({ GLOS_REVIEW_CODE_UNTIL: '2026-11-30' });
    expect(reviewCodeOn(at('2026-10-22T12:00:00Z'), e)).toBe(true);
    expect(reviewCodeOn(at('2026-11-30T23:59:59Z'), e)).toBe(true);
    expect(reviewCodeOn(at('2026-12-01T00:00:00Z'), e)).toBe(false);
    expect(reviewCodeState(at('2026-10-22T12:00:00Z'), e)).toEqual({ until: '2026-11-30' });
    expect(reviewCodeState(at('2026-12-01T00:00:00Z'), e)).toBeNull();
  });

  it('is off without a day, with something that is not one, and on a sandbox whatever is set', () => {
    process.env.GLOS_ENV = 'production';
    const now = at('2026-10-22T12:00:00Z');
    for (const raw of ['', '  ', 'yes', 'true', '30-11-2026', '2026-11-31', '2026-13-01', '2026-11-30T00:00:00Z']) {
      expect([raw, reviewCodeOn(now, live({ GLOS_REVIEW_CODE_UNTIL: raw }))]).toEqual([raw, false]);
    }
    expect(reviewCodeUntil(live())).toBeUndefined();
    process.env.GLOS_ENV = 'sandbox';
    expect(reviewCodeOn(now, { GLOS_REVIEW_CODE_UNTIL: '2026-11-30' } as NodeJS.ProcessEnv)).toBe(false);
  });

  describe('a verification made with it', () => {
    const phone = '+254711223344';
    let held: Set<string>;
    const persons = { findByPhone: (p: string) => (held.has(p) ? {} : undefined), findByEmail: (e: string) => (held.has(e) ? {} : undefined) } as unknown as PersonService;
    beforeEach(() => {
      held = new Set();
    });

    it('a number: 000000 verifies it, and the verification counts for nothing once somebody holds the number', () => {
      const otp = new OtpService(persons);
      expect(otp.request(phone, { review: true }).code).toBe(REVIEW_CODE);
      expect(otp.verify(phone, '000000').verified).toBe(true);
      expect(otp.isVerified(phone)).toBe(true);
      // Somebody signed up with the number meanwhile: a code to a number is how its person signs in.
      held.add(phone);
      expect(otp.isVerified(phone)).toBe(false);
    });

    it('a number: a texted code is not affected — and 000000 is no code of its own', () => {
      const otp = new OtpService(persons);
      const { code } = otp.request(phone);
      held.add(phone);
      if (code !== REVIEW_CODE) expect(() => otp.verify(phone, REVIEW_CODE)).toThrow('Wrong or expired code');
      expect(otp.verify(phone, code).verified).toBe(true);
      expect(otp.isVerified(phone)).toBe(true);
    });

    it('a number: with no way to ask who holds it, a review verification counts for nothing', () => {
      const otp = new OtpService();
      otp.request(phone, { review: true });
      otp.verify(phone, REVIEW_CODE);
      expect(otp.isVerified(phone)).toBe(false);
    });

    it('an address: 000000 confirms it, and never once somebody holds it', () => {
      const codes = new EmailCodeService(undefined, persons);
      const mail = 'reviewer@example.com';
      expect(codes.request(mail, Date.now(), { review: true }).code).toBe(REVIEW_CODE);
      codes.verify(mail, REVIEW_CODE);
      expect(codes.isVerified(mail)).toBe(true);
      held.add(mail);
      expect(codes.isVerified(mail)).toBe(false);
      // A review code asked while it was free, typed after somebody took it: refused.
      const other = 'second@example.com';
      codes.request(other, Date.now(), { review: true });
      held.add(other);
      expect(() => codes.verify(other, REVIEW_CODE)).toThrow('Wrong or expired code');
    });
  });
});
