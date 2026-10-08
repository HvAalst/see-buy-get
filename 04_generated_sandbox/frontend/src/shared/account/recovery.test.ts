import { describe, expect, it } from 'vitest';
import type { SbgError } from '../../lib/sbg';
import { asksForEmail, asksForNationalId, looksLikeEmail, oldNumberSays, recoveryEmailSays } from './recovery';

const refusal = (code: string, field?: string): SbgError => ({ code, status: 400, title: '', detail: '', retryable: false, ...(field ? { params: { field } } : {}) });

describe('what the server is asking for at a sign-in screen', () => {
  it('reads a missing recovery email as the next thing to fill in', () => {
    expect(asksForEmail(refusal('FIELD_REQUIRED', 'email'))).toBe(true);
    expect(asksForEmail(refusal('EMAIL_NOT_VERIFIED', 'emailCode'))).toBe(true);
  });

  it('does not mistake another missing field, or a refused PIN, for it', () => {
    expect(asksForEmail(refusal('FIELD_REQUIRED', 'nationalId'))).toBe(false);
    expect(asksForEmail(refusal('PIN_GUESSABLE'))).toBe(false);
    expect(asksForEmail(refusal('PHONE_NOT_VERIFIED'))).toBe(false);
    expect(asksForEmail(null)).toBe(false);
  });

  it('asks for the national ID only when the server names that field', () => {
    expect(asksForNationalId(refusal('FIELD_REQUIRED', 'nationalId'))).toBe(true);
    expect(asksForNationalId(refusal('FORBIDDEN', 'nationalId'))).toBe(true);
    expect(asksForNationalId(refusal('AUTH_FAILED'))).toBe(false);
  });

  it('lets a plausible address through and stops what cannot be one', () => {
    expect(looksLikeEmail(' amos@example.com ')).toBe(true);
    expect(looksLikeEmail('amos@example')).toBe(false);
    expect(looksLikeEmail('amos example.com')).toBe(false);
    expect(looksLikeEmail('')).toBe(false);
  });
});

describe('the recovery email row in Settings', () => {
  const say = ((key: string, vars?: Record<string, string | number>) => `${key}${vars ? ':' + Object.values(vars).join(',') : ''}`) as never;
  it('says the address, that there is none — or that email to it is coming back, for as long as that is true', () => {
    expect(recoveryEmailSays({ email: 'a…@kilima.co.ke' }, say)).toEqual({ sub: 'a…@kilima.co.ke', bounced: false });
    expect(recoveryEmailSays({}, say)).toEqual({ sub: 'account.settings.emailNone', bounced: false });
    expect(recoveryEmailSays(null, say)).toEqual({ sub: 'account.settings.emailNone', bounced: false });
    expect(recoveryEmailSays({ email: 'a…@kilima.co.ke', emailBounced: true }, say)).toEqual({ sub: 'account.settings.emailBouncedSub:a…@kilima.co.ke', bounced: true });
    // A flag with no address behind it warns of nothing: there is nothing to put right.
    expect(recoveryEmailSays({ emailBounced: true }, say)).toEqual({ sub: 'account.settings.emailNone', bounced: false });
  });
});

describe('the number an account moved off, in Settings', () => {
  const say = ((key: string, vars?: Record<string, string | number>) => `${key}${vars ? ':' + Object.values(vars).join(',') : ''}`) as never;
  const when = (iso: string) => `on ${iso.slice(0, 10)}`;
  it('says nothing when there is none', () => {
    expect(oldNumberSays({}, say, when)).toBeNull();
    expect(oldNumberSays(null, say, when)).toBeNull();
  });
  it('says until when a parcel sent to it still arrives — and offers to block it only once the move can no longer be undone', () => {
    const until = '2026-10-15T10:00:00.000Z';
    expect(oldNumberSays({ oldNumber: { until, canBlock: false } }, say, when)).toEqual({
      title: 'account.settings.oldNumber.kept:on 2026-10-15',
      detail: 'account.settings.oldNumber.notYet:on 2026-10-15',
      canBlock: false,
    });
    expect(oldNumberSays({ oldNumber: { until, canBlock: true } }, say, when)).toEqual({
      title: 'account.settings.oldNumber.kept:on 2026-10-15',
      detail: 'account.settings.oldNumber.blockWhenReady:on 2026-10-15',
      canBlock: true,
    });
  });
});
