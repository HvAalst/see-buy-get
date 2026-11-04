import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'preact-render-to-string';
/** Tests run from the frontend folder (as SignedOutBar.test.tsx reads the screens). */
const SRC = 'src';
import { AppsSheet, LAUNCHER_APPS, appHere, launcherIcon, launcherTile } from './AppLauncher';

/*
 * "ALL SEEBUYGET APPS" AS THE APPS THEMSELVES (the owner, 2026-11-04: "it redirects to the homepage. that is a bit cheap way
 * out. can't we make it more like google's 'all of SBG apps' and then show the distinct icons as how they show in the
 * homescreen").
 */
describe('the sheet of apps', () => {
  it('knows which app a page is, from its address — a page of the site is none of them', () => {
    expect(appHere('/mdp/')).toBe('mdp');
    expect(appHere('/mdp/sort')).toBe('mdp');
    expect(appHere('/send/')).toBe('genesis');
    expect(appHere('/')).toBe('home');
    expect(appHere('/market')).toBeNull();
    expect(appHere('/help/signing-in')).toBeNull();
  });

  it('shows every app a person can install, with the very icon it installs with — and not the staff console', () => {
    expect(LAUNCHER_APPS.map((a) => a.id)).toEqual(['home', 'agent', 'mdp', 'vendor', 'driver', 'fleet', 'business', 'genesis']);
    for (const a of LAUNCHER_APPS) {
      const icons = readdirSync(join(SRC, 'apps', a.id, 'public/icons'), { withFileTypes: true }).map((e) => e.name);
      expect(icons, a.id).toContain('icon-192.png');
      expect(launcherIcon(a.path)).toBe(`/${a.path}icons/icon-192.png`);
    }
    // Each path is where vite.config.ts builds that app.
    const vite = readFileSync('vite.config.ts', 'utf8');
    for (const a of LAUNCHER_APPS) expect(vite, a.id).toContain(`base: '/${a.path}'`);
  });

  it('opens this app where it stands, the email’s own kinds signed in, and everything else as a link', () => {
    const hub = LAUNCHER_APPS.find((a) => a.id === 'mdp')!;
    const shop = LAUNCHER_APPS.find((a) => a.id === 'agent')!;
    const driver = LAUNCHER_APPS.find((a) => a.id === 'driver')!;
    expect(launcherTile(hub, 'mdp', new Set(['pudo']))).toEqual({ does: 'here' });
    expect(launcherTile(shop, 'mdp', new Set(['pudo']))).toEqual({ does: 'own', role: 'pudo' });
    expect(launcherTile(shop, 'mdp', new Set())).toEqual({ does: 'link', href: '/agent/' });
    // A driver is never one of the email's kinds: a link, whatever is linked.
    expect(launcherTile(driver, 'mdp', new Set(['pudo', 'mdp', 'vendor']))).toEqual({ does: 'link', href: '/driver/' });
  });

  it('draws them as a grid of icons and names, this app marked', () => {
    const html = renderToString(<AppsSheet open onClose={() => undefined} here="mdp" />);
    expect(html).toContain('All SeeBuyGet apps');
    expect(html.match(/class="apps-grid__icon"/g)).toHaveLength(8);
    for (const name of ['SeeBuyGet', 'Shop', 'Hub', 'Store', 'Driver', 'Fleet', 'Business', 'Send']) expect(html).toContain(`>${name}</span>`);
    expect(html).toContain('aria-current="page"');
    expect(html).toContain('This app');
    expect(html).toContain('href="/agent/"');
    expect(html).toContain('src="/business/icons/icon-192.png"');
    expect(html).not.toContain('href="/mdp/"');
    expect(html).not.toContain('Opens signed in');
  });
});
