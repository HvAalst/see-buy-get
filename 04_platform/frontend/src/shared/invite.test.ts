import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureInvite, dropInvite, heldInvite, inviteBody } from './invite';

// A stand-in for the browser's storage: the test environment has none.
function fakeStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k) };
}

describe('the invite a shared link carried (2026-11-01)', () => {
  const was = (globalThis as { localStorage?: unknown }).localStorage;
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = fakeStorage();
  });
  afterEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = was;
  });

  it('keeps the token from the landing, for the app the newcomer signs up in', () => {
    const now = Date.UTC(2026, 10, 1);
    expect(captureInvite('?invite=tok-1', now)).toBe('tok-1');
    // Later, on /send/ or /business/, with no token in the address:
    expect(heldInvite('', now + 3 * 24 * 3600 * 1000)).toBe('tok-1');
  });

  it('prefers the token in the page’s own address', () => {
    captureInvite('?invite=old', 0);
    expect(heldInvite('?invite=new', 1)).toBe('new');
  });

  it('forgets a token after thirty days, and once the device has signed up', () => {
    const now = Date.UTC(2026, 10, 1);
    captureInvite('?invite=tok-2', now);
    expect(heldInvite('', now + 31 * 24 * 3600 * 1000)).toBeUndefined();
    captureInvite('?invite=tok-3', now);
    dropInvite();
    expect(heldInvite('', now)).toBeUndefined();
  });

  it('adds nothing to a sign-up when no link was opened', () => {
    expect(captureInvite('', 0)).toBeNull();
    expect(heldInvite('', 0)).toBeUndefined();
    expect(inviteBody()).toEqual({});
  });
});
