import { describe, expect, it } from 'vitest';
import { credentialAge, credentialAgeKey, passwordChangeBlocker, pinChangeBlocker } from './password';

describe('changing a password or a PIN', () => {
  it('asks for the current password, a long enough new one typed twice, and a real change', () => {
    expect(passwordChangeBlocker({ current: '', next: 'long-enough', again: 'long-enough' })).toBe('account.password.needCurrent');
    expect(passwordChangeBlocker({ current: 'old-pass', next: 'short', again: 'short' })).toBe('account.password.tooShort');
    expect(passwordChangeBlocker({ current: 'old-pass', next: 'eight-chr', again: 'eight-chr' }, 10)).toBe('account.password.tooShort10');
    expect(passwordChangeBlocker({ current: 'old-pass', next: 'long-enough', again: 'long-enougH' })).toBe('account.password.mismatch');
    expect(passwordChangeBlocker({ current: 'same-pass-1', next: 'same-pass-1', again: 'same-pass-1' })).toBe('account.password.same');
    expect(passwordChangeBlocker({ current: 'old-pass', next: 'long-enough', again: 'long-enough' })).toBeNull();
  });

  it('asks for four digits, the current PIN, and a different one', () => {
    expect(pinChangeBlocker({ current: '12', next: '5678' })).toBe('account.pin.needCurrent');
    expect(pinChangeBlocker({ current: '1234', next: '56a8' })).toBe('account.pin.fourDigits');
    expect(pinChangeBlocker({ current: '1234', next: '5678', again: '5679' })).toBe('account.pin.mismatch');
    expect(pinChangeBlocker({ current: '1234', next: '1234' })).toBe('account.pin.same');
    expect(pinChangeBlocker({ current: '1234', next: '5678', again: '5678' })).toBeNull();
  });
});

describe('how old a credential is', () => {
  const now = Date.parse('2026-09-13T12:00:00Z');

  it('counts whole days, and calls a machine secret due only after 90 of them', () => {
    expect(credentialAge('2026-09-13T08:00:00Z', now)).toEqual({ days: 0, due: false });
    expect(credentialAge('2026-06-15T12:00:00Z', now)).toEqual({ days: 90, due: false });
    expect(credentialAge('2026-06-14T11:00:00Z', now)).toEqual({ days: 91, due: true });
  });

  it('says nothing rather than guessing when there is no date', () => {
    expect(credentialAge(undefined, now)).toBeNull();
    expect(credentialAge('not a date', now)).toBeNull();
  });

  it('words today and yesterday as people say them', () => {
    expect(credentialAgeKey(0).key).toBe('account.age.today');
    expect(credentialAgeKey(1).key).toBe('account.age.yesterday');
    expect(credentialAgeKey(12)).toEqual({ key: 'account.age.days', n: 12 });
  });
});
