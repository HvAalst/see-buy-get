import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderToString } from 'preact-render-to-string';
import type { InstallState } from '../install';
import { InstallSheet, guideSteps } from './InstallBar';

/*
 * THE SHEET THE CALL OPENS (the owner, 2026-11-02: "open a slide up and give a short introduction with images in a precise
 * way how to set the notification settings for android (or Apple if that works) — tapping the app in android for 2
 * seconds gives the app's permission settings and notification can be turned on").
 */
const state = (over: Partial<InstallState> = {}): InstallState => ({
  offer: true,
  installed: false,
  platform: 'android',
  canPrompt: false,
  install: async () => 'unavailable',
  markInstalled: () => undefined,
  ...over,
});
const render = (over: Partial<InstallState> = {}) => renderToString(<InstallSheet open onClose={() => undefined} app="agent" install={state(over)} />);
const pictures = (html: string) => (html.match(/class="ipic"/g) ?? []).length;

describe('getting the most out of the app', () => {
  it('shows an Android phone how to install, allow, put a refusal right by holding the icon, and keep the battery from holding it back', () => {
    expect(guideSteps('android', false)).toEqual(['home', 'allow', 'fix', 'battery']);
    const html = render();
    expect(html).toContain('Get the most out of the Shop app');
    expect(html).toContain('In Chrome, tap ⋮ at the top right, then Install app');
    expect(html).toContain('Hold the app’s icon on your home screen for two seconds, then tap ⓘ, App info.');
    expect(html).toContain('Tap Notifications.');
    expect(html).toContain('then Unrestricted');
    // A picture beside every instruction: install, allow, hold, App info, the switch, the battery.
    expect(pictures(html)).toBe(6);
    // Opening the sheet installs nothing: the browser is asked only from its own button.
    expect(html).not.toContain('Install now');
  });

  it('offers to install with one tap where the browser can', () => {
    expect(render({ canPrompt: true })).toContain('Install now');
  });

  it('shows an iPhone Safari’s way, and its Settings — with no battery step', () => {
    expect(guideSteps('ios', false)).toEqual(['home', 'allow', 'fix']);
    const html = render({ platform: 'ios' });
    expect(html).toContain('In Safari, tap Share at the bottom of the screen, then Add to Home Screen, then Add.');
    expect(html).toContain('Open Settings, then Notifications, then Shop, and turn on Allow Notifications.');
    expect(html).toContain('iOS 16.4');
    expect(html).not.toContain('Unrestricted');
    expect(pictures(html)).toBe(3);
  });

  it('leaves out installing once it is installed, and the button that says so', () => {
    expect(guideSteps('android', true)).toEqual(['allow', 'fix', 'battery']);
    const html = render({ installed: true, offer: false });
    expect(html).not.toContain('Put it on your home screen');
    expect(html).not.toContain('It is on my home screen');
    expect(html).toContain('It is on your home screen. Make sure it can tell you');
  });
});

describe('the call to install, in every app that installs', () => {
  it('stands first in every scroll area of the shop, hub, driver, fleet, store and Send apps', () => {
    const vite = readFileSync('vite.config.ts', 'utf8');
    // Proof the list was read: the apps the build makes, less the ones that do not install and the front page.
    const apps = readdirSync(join('src', 'apps'), { withFileTypes: true })
      .filter((e) => e.isDirectory() && !['home', 'tower', 'business'].includes(e.name))
      .map((e) => e.name);
    expect(apps.sort()).toEqual(['agent', 'driver', 'fleet', 'genesis', 'mdp', 'vendor']);
    // The console does not install; the Business app does since 2026-11-02, and has its bar on its home (below).
    expect(vite).toMatch(/tower: \{[\s\S]*?installable: false/);
    expect(/\n {2}business: \{([\s\S]*?)\n {2}\},/.exec(vite)?.[1]).not.toMatch(/installable: false/);
    // The call lives in the app layer (shared/ui/AppLayer.tsx), first in each scroll area.
    expect(readFileSync(join('src', 'shared', 'ui', 'AppLayer.tsx'), 'utf8')).toMatch(/<InstallBar app=\{app\} \/>/);
    for (const app of apps) {
      const src = readFileSync(join('src', 'apps', app, 'app.tsx'), 'utf8');
      const mains = (src.match(/<main class=/g) ?? []).length;
      const bars = (src.match(/<main class=[^\n]*\n[^\n]*\n\s*<AppLayer app="(agent|mdp|driver|fleet|vendor|send)"/g) ?? []).length;
      expect({ app, mains, bars }).toEqual({ app, mains, bars: mains });
    }
  });

  it('stands first on the Business app’s home, pinned under the console’s mast, with its guide in the menu', () => {
    const home = readFileSync(join('src', 'apps', 'business', 'screens', 'HomeScreen.tsx'), 'utf8');
    const drawn = home.slice(home.indexOf('export function HomeScreen('));
    // The first thing the home draws, before its heading.
    expect(drawn).toMatch(/return \(\s*<>\s*(\{\/\*[\s\S]*?\*\/\}\s*)?<InstallBar app="business" \/>\s*<header class="cons__head">/);
    const css = readFileSync(join('src', 'apps', 'business', 'business.css'), 'utf8');
    expect(css).toMatch(/\.biz \.installbar \{\s*top: var\(--c-mast-h\);/);
    // The main area scrolls a wide table sideways; while the bar is there it must not, or the bar scrolls away.
    expect(css).toMatch(/\.biz \.cons__main:has\(> \.installbar\) \{\s*overflow-x: clip;/);
    // The mast's menu keeps "Get the most out of the app", opening the same guide.
    const shell = readFileSync(join('src', 'apps', 'business', 'app.tsx'), 'utf8');
    expect(shell).toMatch(/\{ key: 'install', icon: 'bell', label: t\('install\.menu'\), onGo: \(\) => setGuide\(true\) \}/);
    expect(shell).toMatch(/<InstallGuideSheet open=\{guide\} onClose=\{\(\) => setGuide\(false\)\} app="business" \/>/);
    expect(renderToString(<InstallSheet open onClose={() => undefined} app="business" install={state()} />)).toContain('Get the most out of the Business app');
  });
});
