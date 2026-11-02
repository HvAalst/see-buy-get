import { beforeEach, describe, expect, it } from 'vitest';
import { allDeviceKeys, saveDeviceKey } from './pin';
import { dropUnlockMark, hasUnlockHere, markUnlock, relayUnlock, secretBody } from './unlock';

/**
 * UNLOCK WITH FINGERPRINT OR FACE — what a sign-in screen knows before it fetches anything (2026-11-02). The note that
 * it is on lives beside the device key of its number and names the key it was made under: so it is offered for that
 * number only, and stops being offered the moment the key changes (a PIN replaced by a code, a device confirmed again,
 * "forget this one"), as the server has already dropped the passkey with the device.
 */
function mockStorage(): Storage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
    removeItem: (k) => void m.delete(k),
    clear: () => m.clear(),
    key: (i) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  } as Storage;
}
const PHONE = '+254712345678';
const ticket = (c: string) => `unl_${c.repeat(64)}`;

beforeEach(() => {
  (globalThis as { localStorage?: Storage }).localStorage = mockStorage();
});

/** Turned on in Settings for the number this browser holds `key` for. */
const turnedOnFor = (phone: string, key: string, id = 'cred-1') => {
  saveDeviceKey(phone, key);
  const slot = allDeviceKeys().find((k) => k.key === key)?.slot;
  markUnlock(slot, key, id);
};

describe('where the fingerprint or face is offered', () => {
  it('for the number it was turned on for, however the number is written', () => {
    turnedOnFor(PHONE, 'dvc_this-phone');
    expect(hasUnlockHere(PHONE)).toBe(true);
    expect(hasUnlockHere('0712 345 678')).toBe(true);
    expect(hasUnlockHere('+254798765432')).toBe(false);
    expect(hasUnlockHere('')).toBe(false);
  });

  it('not without a note, and not where the device key is no longer the one it was made under', () => {
    saveDeviceKey(PHONE, 'dvc_this-phone');
    expect(hasUnlockHere(PHONE)).toBe(false);
    turnedOnFor(PHONE, 'dvc_this-phone');
    // A PIN replaced by a code hands the device a new key: the server dropped the passkey with the old one.
    saveDeviceKey(PHONE, 'dvc_after-the-code');
    expect(hasUnlockHere(PHONE)).toBe(false);
  });

  it('not once it is dropped — turned off, or the server says there is none', () => {
    turnedOnFor(PHONE, 'dvc_this-phone');
    dropUnlockMark('0712 345 678');
    expect(hasUnlockHere(PHONE)).toBe(false);
  });

  it('a note is written only beside a device key, never under another name', () => {
    markUnlock('somewhere-else', 'dvc_x', 'cred');
    markUnlock(undefined, 'dvc_x', 'cred');
    expect(globalThis.localStorage.length).toBe(0);
  });
});

describe('the ticket travels where the PIN would, as `unlock`', () => {
  it('a PIN goes as the PIN; a ticket goes as `unlock`', () => {
    expect(secretBody('48261')).toEqual({ pin: '48261' });
    expect(secretBody(ticket('a'))).toEqual({ unlock: ticket('a') });
  });

  it('a door that spent the ticket and minted nothing hands on a fresh one — used once, by the next door', () => {
    relayUnlock(ticket('a'), ticket('b'));
    expect(secretBody(ticket('a'))).toEqual({ unlock: ticket('b') });
    expect(secretBody(ticket('a'))).toEqual({ unlock: ticket('a') });
    // Nothing but a ticket is relayed.
    relayUnlock('48261', ticket('c'));
    expect(secretBody('48261')).toEqual({ pin: '48261' });
  });
});
