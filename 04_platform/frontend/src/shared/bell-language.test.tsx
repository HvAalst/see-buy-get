import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import type { NotificationsApi } from '../lib/sbg';
import { setLocale, t, wordsReady } from './i18n';
import { giveLanguageAgain, relativeTime, whenLine } from './push';
import { NotificationBell } from './ui/NotificationBell';

/*
 * 2026-11-26 — THE BELL IN THE READER'S LANGUAGE (the owner: "go ahead and translate the notices as well"). Held to here: the
 * server says each notice in the language the app asks in, so every call carries the app's language (lib/sbg/client.ts, tested
 * in client.test.ts); the bell reads its notices again when the language changes, and a device with notifications on gives its
 * language again so its phone is pushed in it; and the bell's own words — its labels, its push controls, when a notice came,
 * who read it — are said in the app's language too.
 */
const read = (p: string) => readFileSync(join('src', p), 'utf8');
const NOW = Date.parse('2026-11-26T12:00:00.000Z');

afterEach(() => setLocale('en'));

describe('the bell’s own words', () => {
  it('in English, as before', () => {
    expect(relativeTime('2026-11-26T11:59:30.000Z', NOW)).toBe('just now');
    expect(relativeTime('2026-11-26T11:55:00.000Z', NOW)).toBe('5m ago');
    expect(relativeTime('2026-11-26T09:00:00.000Z', NOW)).toBe('3h ago');
    expect(relativeTime('2026-11-25T11:00:00.000Z', NOW)).toBe('yesterday');
    expect(relativeTime('2026-11-23T12:00:00.000Z', NOW)).toBe('3d ago');
    expect(relativeTime('2026-11-05T12:00:00.000Z', NOW)).toBe('3w ago');
    expect(whenLine({ createdAt: '2026-11-26T11:55:00.000Z', readAt: '2026-11-26T11:58:00.000Z', readBy: 'Elena' }, NOW)).toBe('5m ago · read by Elena');
  });

  it('in Bulgarian, when the app speaks it — the time, who read it, and the bell’s labels', async () => {
    setLocale('bg');
    await wordsReady('bg');
    expect(relativeTime('2026-11-26T11:59:30.000Z', NOW)).toBe('току-що');
    expect(relativeTime('2026-11-26T11:59:00.000Z', NOW)).toBe('преди 1 минута');
    expect(relativeTime('2026-11-26T11:55:00.000Z', NOW)).toBe('преди 5 минути');
    expect(whenLine({ createdAt: '2026-11-26T11:55:00.000Z', readAt: '2026-11-26T11:58:00.000Z', readBy: 'Елена' }, NOW)).toBe('преди 5 минути · прочетено от Елена');
    const bell = renderToString(<NotificationBell api={null} />);
    expect(bell).toContain('Известия');
    expect(bell).not.toContain('Notifications');
  });

  it('none of the bell’s own words is written into it in English any more', () => {
    const bell = read('shared/ui/NotificationBell.tsx');
    for (const english of ['Recent', 'Mark all read', 'No notifications yet.', 'Turn on notifications', 'Send a test', 'On for this device', 'This is the business’s inbox']) {
      expect(bell).not.toContain(`>${english}<`);
      expect(bell).not.toContain(`'${english}`);
    }
    expect(read('shared/usePush.ts')).not.toMatch(/text: '[A-Z]/);
    expect(t('notify.push.turnOn')).toBe('Turn on notifications');
  });
});

describe('the notices themselves, said by the server', () => {
  it('the bell reads them again when the language changes, and a device with notifications on gives its language again', () => {
    const hook = read('shared/usePush.ts');
    expect(hook).toContain('}, [loadInboxCb, locale]);');
    expect(hook).toContain("if (api && state === 'on') void giveLanguageAgain(api, locale);");
  });

  it('a device with no push gives nothing, and asks nothing of the server', async () => {
    const subscribe = vi.fn();
    const api = { subscribe } as unknown as NotificationsApi;
    expect(await giveLanguageAgain(api, 'bg')).toBe(false);
    expect(subscribe).not.toHaveBeenCalled();
  });
});
