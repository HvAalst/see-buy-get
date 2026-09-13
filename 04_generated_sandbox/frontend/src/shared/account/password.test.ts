import { describe, expect, it } from 'vitest';
import { passwordChangeBlocker, pinChangeBlocker } from './password';

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
