import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/*
 * 2026-11-02 — EVERY APP GOES BACK THE SAME WAY (the owner: "make it as native as today can be"). An app that moves
 * between its screens without the shared navigation (shared/nav.ts) closes on the phone's Back from three screens deep
 * — the thing this was built to end. So every app a phone opens is read off disk and asked: does it hand its screens to
 * `useScreenNav` before it draws anything, does its screen arrive through `NavScreen`, and does its top bar's arrow do
 * what Back does rather than jump home on its own.
 */

const read = (p: string) => readFileSync(p, 'utf8');

/** The apps a phone opens. The business app is a desk's too: its sections swap in place, so it has no `NavScreen`. */
const APPS = ['agent', 'mdp', 'driver', 'fleet', 'vendor', 'genesis', 'business'] as const;
const SLIDES = new Set(['agent', 'mdp', 'driver', 'fleet', 'vendor', 'genesis']);

describe('every app hands its screens to the shared navigation', () => {
  for (const app of APPS) {
    it(`${app}: Back walks its screens`, () => {
      const src = read(`src/apps/${app}/app.tsx`);
      const start = src.indexOf('export function App(');
      // The guard proves it read the shell it is guarding.
      expect(src.length).toBeGreaterThan(1000);
      expect(start).toBeGreaterThan(-1);
      const body = src.slice(start);
      const call = body.search(/useScreenNav<\w+>\(/);
      expect(call, `${app} never calls useScreenNav`).toBeGreaterThan(-1);
      // Before the first return: a hook after an early return is skipped in the sign-in shell, and runs later.
      const firstReturn = body.search(/\breturn\b/);
      expect(call).toBeLessThan(firstReturn);
      if (SLIDES.has(app)) expect(body).toMatch(/<NavScreen nav=\{nav\}>/);
      // The top bar's arrow is the phone's Back — never its own jump home, which leaves an entry behind.
      for (const m of body.matchAll(/onBack=\{([^\n]*)\}/g)) expect(m[1], `${app}'s arrow`).toMatch(/\bnav\.back\b/);
      expect(body).not.toMatch(/onBack=\{[^\n]*actions\.go\(/);
    });
  }
});

describe('every shortcut on an app icon opens a screen the app accepts', () => {
  // The manifest names an app by what people call it; its folder keeps the older name.
  const FOLDER: Record<string, string> = { Shop: 'agent', Hub: 'mdp', Driver: 'driver', Fleet: 'fleet', Store: 'vendor', Send: 'genesis', Business: 'business' };
  const config = read('vite.config.ts');
  const blocks = config.split(/name: 'SeeBuyGet /).slice(1);
  const shortcuts = blocks
    .map((b) => ({ app: FOLDER[b.slice(0, b.indexOf("'"))], keys: [...b.matchAll(/\{ go: '([a-z]+)'/g)].map((m) => m[1]) }))
    .filter((s) => s.app && s.keys.length);

  it('reads the shortcuts of all seven installable apps', () => {
    // The Business app installs since 2026-11-02: its shortcuts open its sections.
    expect(shortcuts.map((s) => s.app).sort()).toEqual(['agent', 'business', 'driver', 'fleet', 'genesis', 'mdp', 'vendor']);
  });

  for (const { app, keys } of shortcuts) {
    it(`${app}: ${keys.join(', ')}`, () => {
      const src = read(`src/apps/${app}/app.tsx`);
      // The Business app's sections are its screens, and the same list is what a shortcut may open (useScreenNav's launch).
      const launch = app === 'business' ? src.match(/const SECTIONS = screensOf<Section>\(\{([^}]*)\}\)([^;\n]*)/) : src.match(/const LAUNCH = screensOf<Screen>\(\{([^}]*)\}\)([^;\n]*)/);
      if (app === 'business') expect(src).toMatch(/useScreenNav<Section>\(\{[^\n]*launch: SECTIONS/);
      expect(launch, `${app} has no LAUNCH`).not.toBeNull();
      for (const key of keys) {
        expect(launch![1], `${app} does not list ${key}`).toMatch(new RegExp(`\\b${key}: true`));
        expect(launch![2], `${app} leaves ${key} out`).not.toContain(`'${key}'`);
      }
    });
  }
});

describe('what is drawn over a screen closes on Back', () => {
  it('a sheet, the account menu and the camera each hold an entry while open', () => {
    const sheet = read('src/shared/ui/Sheet.tsx');
    expect(sheet).toMatch(/useBackLayer\(open, [^\n]*dismissible\)/);
    expect(sheet).toMatch(/useSheetDrag\(panelRef, backdropRef, open && dismissible,/);
    expect(read('src/shared/account/AccountMenu.tsx')).toMatch(/useBackLayer\(open, /);
    expect(read('src/shared/ui/Scanner.tsx')).toMatch(/useBackLayer\(open, /);
  });

  it('the motion is CSS, and reduced motion takes it away', () => {
    const css = read('src/shared/ui/ui.css');
    expect(css).toMatch(/\.navscreen--push \{\s*animation: sbg-screen-push/);
    expect(css).toMatch(/\.navscreen--pop \{\s*animation: sbg-screen-pop/);
    expect(css).toMatch(/@media \(prefers-reduced-motion: reduce\) \{\s*\.navscreen--push,\s*\.navscreen--pop \{\s*animation: none;/);
  });
});
