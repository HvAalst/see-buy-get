import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/*
 * SHARE SEEBUYGET IN EVERY APP (the owner, 2026-11-01: "the invite a contact feature is not in every app's settings
 * (hub)"). The account menu offered it only to an app that passed its own invite flow — none did — so it showed nowhere
 * but the Send app. Every signed-in app reaches a share sheet now: through the shared account menu, whose row is always
 * there, or its own menu. Not the front page (nobody is signed in there) nor the staff console (staff are not inviting).
 */
const APPS = join('src', 'apps');
const NOT_SIGNED_IN_AS_A_PERSON = ['home', 'tower'];

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? sources(join(dir, e.name)) : /\.tsx?$/.test(e.name) && !/\.test\./.test(e.name) ? [join(dir, e.name)] : []));
}

describe('share SeeBuyGet, from every app', () => {
  it('the shared account menu always offers it, and opens the share sheet', () => {
    const menu = readFileSync(join('src', 'shared', 'account', 'AccountMenu.tsx'), 'utf8');
    const row = menu.split('\n').find((l) => l.includes("label={t('account.share.title')}"));
    expect(row, 'the share row in the account menu').toBeTruthy();
    // Not behind an app's own invite flow: the row stands on its own.
    expect(row!.trim().startsWith('<MenuRow')).toBe(true);
    expect(menu).toMatch(/<ShareSheet open=\{sheet === 'share'\}/);
  });

  it('every signed-in app reaches a share sheet', () => {
    const apps = readdirSync(APPS, { withFileTypes: true })
      .filter((e) => e.isDirectory() && !NOT_SIGNED_IN_AS_A_PERSON.includes(e.name))
      .map((e) => e.name);
    // Proof the list was read: the shop and hub apps and the business app are among them.
    expect(apps).toEqual(expect.arrayContaining(['agent', 'mdp', 'business', 'driver', 'fleet', 'vendor', 'genesis']));
    const without = apps.filter((app) => !sources(join(APPS, app)).some((f) => /<(AccountMenu|ShareSheet|InviteSheet)\b/.test(readFileSync(f, 'utf8'))));
    expect(without).toEqual([]);
  });
});
