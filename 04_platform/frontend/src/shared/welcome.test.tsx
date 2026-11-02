import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { renderToString } from 'preact-render-to-string';
import { t } from './i18n';
import { followLink, intentOf, onLaunch, resetLaunchForTests, withoutIntent } from './launch';
import type { InboxItem } from './push';
import { NotificationRow, noticeAction } from './ui/NotificationBell';

/*
 * 2026-11-02 — THE BELL'S FIRST NOTICE (the owner: "I want the business app to get a welcome notification with a short
 * text describing what the bell will be used for and a tooltip on how to get more out of the app"; every bell starts
 * empty). Its link, `/?guide=1`, opens the app's guide to getting the most out of it — on one tap.
 */
afterEach(() => resetLaunchForTests());

const welcome = (over: Partial<InboxItem> = {}): InboxItem => ({
  id: 'w',
  kind: 'welcome',
  title: 'Your business’s notices arrive here',
  body: 'A carrier taking a load, a problem on the road, a delivery, a claim answered, papers checked: each is told here. Tap one and it opens where you act on it.',
  link: '/?guide=1',
  createdAt: '2026-11-02T08:00:00.000Z',
  data: { app: 'business' },
  ...over,
});

describe('the welcome’s way to the guide', () => {
  it('is its own kind of link, and nothing a hand-made address could add', () => {
    expect(intentOf('/?guide=1')).toEqual({ guide: '1' });
    expect(intentOf('/?guide=yes')).toBeNull();
    expect(withoutIntent('https://x.test/driver/?guide=1&x=2')).toBe('/driver/?x=2');
  });

  it('a tap on the welcome opens the guide, said as the guide’s own name in the menu', () => {
    const opened: string[] = [];
    onLaunch('guide', (v) => opened.push(v));
    const action = noticeAction(welcome(), undefined, t);
    expect(action?.label).toBe(t('install.menu'));
    action?.run?.();
    expect(opened).toEqual(['1']);
    // The row says it: one big target, "Get the most out of the app ›".
    expect(renderToString(<NotificationRow item={welcome()} open={false} onToggle={() => undefined} onRead={() => undefined} />)).toContain(`<span class="nitem__go">${t('install.menu')}`);
  });

  it('where nothing keeps the guide (a hub’s people at its floor), the welcome opens in full and leads nowhere', () => {
    onLaunch('go', () => undefined);
    expect(noticeAction(welcome(), undefined, t)).toBeNull();
    expect(followLink('/?guide=1')).toBe(false);
  });
});

describe('where each app keeps its guide, the welcome opens it', () => {
  const read = (p: string) => readFileSync(`src/${p}`, 'utf8');
  it('the shared account menu (shop, hub, driver, fleet, store), the Business app’s menu, the Send app’s account', () => {
    expect(read('shared/account/AccountMenu.tsx')).toMatch(/onLaunch\('guide', \(\) => setSheet\('install'\)\)/);
    expect(read('apps/business/app.tsx')).toMatch(/onLaunch\('guide', \(\) => setGuide\(true\)\)/);
    expect(read('apps/genesis/app.tsx')).toMatch(/onLaunch\(\s*'guide'/);
    expect(read('apps/genesis/screens/AccountScreen.tsx')).toMatch(/setGuideOpen\(true\);\s*onGuideShown\?\.\(\);/);
  });

  it('the welcome has an icon of its own in the bell', () => {
    expect(read('shared/ui/NotificationBell.tsx')).toMatch(/welcome: 'star'/);
  });
});
