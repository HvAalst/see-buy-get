import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { setIconCount } from './appBadge';

/*
 * THE COUNT ON THE APP'S ICON (the owner, 2026-11-02: "make it as native as today can be").
 */
function fakeNav() {
  const calls: Array<['set', number | undefined] | ['clear']> = [];
  return {
    calls,
    setAppBadge: (n?: number) => {
      calls.push(['set', n]);
      return Promise.resolve();
    },
    clearAppBadge: () => {
      calls.push(['clear']);
      return Promise.resolve();
    },
  };
}

describe('the count on the app’s icon', () => {
  it('shows the unread count, and clears at none', () => {
    const nav = fakeNav();
    setIconCount(3, nav);
    setIconCount(0, nav);
    expect(nav.calls).toEqual([['set', 3], ['clear']]);
  });

  it('does nothing, and breaks nothing, where the phone draws no badges', () => {
    expect(() => setIconCount(2, {})).not.toThrow();
    expect(() => setIconCount(2, undefined)).not.toThrow();
    expect(() =>
      setIconCount(2, {
        setAppBadge: () => {
          throw new Error('not in an installed app');
        },
      }),
    ).not.toThrow();
  });

  it('is marked by the push worker when a notice arrives with the app closed — the count when the message has one', async () => {
    const src = readFileSync('scripts/push-sw.js', 'utf8');
    const run = async (payload: unknown) => {
      const nav = fakeNav();
      const handlers: Record<string, (e: unknown) => void> = {};
      const shown: string[] = [];
      let waited: Promise<unknown> = Promise.resolve();
      const self = {
        navigator: nav,
        registration: { scope: 'https://x.test/agent/', showNotification: (title: string) => (shown.push(title), Promise.resolve()) },
        addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
        clients: {},
        location: { origin: 'https://x.test' },
      };
      runInNewContext(src, { self, URL, Promise, fetch: () => Promise.resolve(), console });
      handlers.push({ data: { json: () => payload }, waitUntil: (p: Promise<unknown>) => (waited = p) });
      await waited;
      return { calls: nav.calls, shown };
    };
    const counted = await run({ title: 'Parcel waiting', unread: 4 });
    expect(counted.shown).toEqual(['Parcel waiting']);
    expect(counted.calls).toEqual([['set', 4]]);
    // No count in the message: a plain mark, set right when the app next opens.
    expect((await run({ title: 'Hello' })).calls).toEqual([['set', undefined]]);
  });
});
