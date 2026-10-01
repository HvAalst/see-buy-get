import { describe, expect, it } from 'vitest';
import type { SbgError } from '../../lib/sbg';
import { asksForEmail, asksForNationalId, looksLikeEmail } from './recovery';

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
