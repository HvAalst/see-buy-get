import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

/*
 * A TAPPED NOTICE LANDS IN ITS OWN APP (2026-11-02): the push worker's own script, run in a sandbox.
 */
type Win = { url: string; focused?: boolean; navigatedTo?: string; failNavigate?: boolean };

async function tap(scope: string, windows: Win[], link = 'parcels') {
  const handlers: Record<string, (e: unknown) => void> = {};
  const opened: string[] = [];
  let waited: Promise<unknown> = Promise.resolve();
  const clients = windows.map((w) => ({
    url: w.url,
    focus: async () => void (w.focused = true),
    navigate: async (to: string) => {
      if (w.failNavigate) throw new Error('not controlled');
      w.navigatedTo = to;
    },
  }));
  const self = {
    navigator: {},
    registration: { scope, showNotification: () => Promise.resolve() },
    addEventListener: (type: string, fn: (e: unknown) => void) => (handlers[type] = fn),
    clients: { matchAll: async () => clients, openWindow: async (u: string) => void opened.push(u) },
    location: { origin: 'https://x.test' },
  };
  runInNewContext(readFileSync('scripts/push-sw.js', 'utf8'), { self, URL, Promise, fetch: () => Promise.resolve(), console });
  handlers.notificationclick({ notification: { close: () => undefined, data: { link } }, action: '', waitUntil: (p: Promise<unknown>) => (waited = p) });
  await waited;
  return { opened, windows };
}

describe('a tapped notice', () => {
  it('brings its own app’s open window forward, at the notice’s place', async () => {
    const { opened, windows } = await tap('https://x.test/driver/', [{ url: 'https://x.test/agent/' }, { url: 'https://x.test/driver/' }]);
    expect(windows[0].focused).toBeUndefined();
    expect(windows[1]).toMatchObject({ focused: true, navigatedTo: 'https://x.test/driver/parcels' });
    expect(opened).toEqual([]);
  });

  it('on the front page, never takes over another app’s window (its scope is the root every app starts with)', async () => {
    const { opened, windows } = await tap('https://x.test/', [{ url: 'https://x.test/driver/' }]);
    expect(windows[0].focused).toBeUndefined();
    expect(opened).toEqual(['https://x.test/parcels']);
  });

  it('opens the link when the open window cannot be sent there, rather than dropping it', async () => {
    const { opened } = await tap('https://x.test/send/', [{ url: 'https://x.test/send/', failNavigate: true }]);
    expect(opened).toEqual(['https://x.test/send/parcels']);
  });
});
