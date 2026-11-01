import { describe, expect, it } from 'vitest';
import { CODE_GOOD_MS, rememberSent, sentEarlier } from './sentCode';

/* The owner, 2026-11-01: back from the mail app, the page reloaded, and the code from the earlier email had nowhere to go. */
const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const T0 = Date.UTC(2026, 10, 1, 9, 0);

describe('a code already sent, remembered through a reload', () => {
  it('says when a code went to the same address — whatever its case and spaces — for fifteen minutes', () => {
    const store = memory();
    rememberSent(' Me@Example.com ', T0, store);
    expect(sentEarlier('me@example.com', T0 + 5 * 60_000, store)).toBe(T0);
    expect(sentEarlier('ME@EXAMPLE.COM', T0 + CODE_GOOD_MS - 1, store)).toBe(T0);
    expect(sentEarlier('me@example.com', T0 + CODE_GOOD_MS, store)).toBeNull();
  });

  it('says nothing for another address, an empty one, or where nothing was kept', () => {
    const store = memory();
    rememberSent('me@example.com', T0, store);
    expect(sentEarlier('you@example.com', T0 + 60_000, store)).toBeNull();
    expect(sentEarlier('', T0 + 60_000, store)).toBeNull();
    expect(sentEarlier('me@example.com', T0, memory())).toBeNull();
    expect(sentEarlier('me@example.com', T0, undefined)).toBeNull();
  });
});
