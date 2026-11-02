import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { tabAtTheTap } from './openPage';

/*
 * A TAB OPENED AT THE TAP (2026-10-28). Found on the walk of an export's papers: a tab opened only after waiting for the
 * server is blocked as a pop-up by some browsers, Safari above all, and the button seemed to do nothing. Eighteen screens
 * did it. Now the tab opens at the tap and is filled when the file arrives — and nothing opens a tab any other way.
 */
type FakeTab = { opener: unknown; closed: boolean; location: { href: string }; close: () => void };
const fakeTab = (): FakeTab => {
  const tab: FakeTab = { opener: {}, closed: false, location: { href: 'about:blank' }, close: () => (tab.closed = true) };
  return tab;
};

/** The tests run without a browser: a window with just what the opener touches. */
const aWindow = (gives: FakeTab | null) => {
  const open = vi.fn(() => gives);
  vi.stubGlobal('window', { open, location: { href: 'https://app.example/business/' } });
  return open;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('a tab opened at the tap', () => {
  it('opens before anything is awaited, cut off from our page, and is filled with the file', () => {
    const tab = fakeTab();
    const open = aWindow(tab);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:file-1');
    const waiting = tabAtTheTap();
    // Opened at once, empty — at the tap, not after the download.
    expect(open).toHaveBeenCalledWith('', '_blank');
    expect(waiting.opened).toBe(true);
    expect(tab.opener).toBeNull();
    waiting.show(new Blob(['%PDF-1.4'], { type: 'application/pdf' }));
    expect(tab.location.href).toBe('blob:file-1');
    // Shown: a later cancel (the finally) leaves it open.
    waiting.cancel();
    expect(tab.closed).toBe(false);
  });

  it('closes the empty tab when nothing came', () => {
    const tab = fakeTab();
    aWindow(tab);
    tabAtTheTap().cancel();
    expect(tab.closed).toBe(true);
  });

  it('where even the tap’s tab is refused, tries the old way once — never navigating away from the app', () => {
    const open = aWindow(null);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:page-1');
    const waiting = tabAtTheTap();
    expect(waiting.opened).toBe(false);
    const before = window.location.href;
    waiting.show('<p>note</p>');
    expect(open).toHaveBeenLastCalledWith('blob:page-1', '_blank', 'noopener');
    expect(window.location.href).toBe(before);
  });
});

/** Every source file of the apps and the shared code, read. */
function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sources(path);
    return /\.(ts|tsx)$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !e.name.endsWith('.d.ts') ? [path] : [];
  });
}

describe('nothing opens a tab any other way', () => {
  it('opens a tab only through the shared opener — or a plain link, which opens at the tap', () => {
    const files = [...sources(join('src', 'apps')), ...sources(join('src', 'shared'))];
    // The guard read something: hundreds of files, and among them the opener itself.
    expect(files.length).toBeGreaterThan(300);
    const opening = files.filter((f) => /window\.open\(/.test(readFileSync(f, 'utf8'))).map((f) => f.split(/[\\/]/).slice(1).join('/'));
    expect(opening).toContain('shared/openPage.ts');
    // The account menu opens the person's own public page by its address: a link, no waiting, so it stays.
    expect(opening.sort()).toEqual(['shared/account/AccountMenu.tsx', 'shared/openPage.ts']);
  });

});

/*
 * 2026-11-02 — NO INSTALLED APP SENDS A PERSON OUT TO THE BROWSER TO PRINT (the owner: "can we have a print preview of
 * the consignment note? and the print function in slide up"). Every paper opens in the slide-up (shared/ui/PaperSheet.tsx).
 * A tab is opened only by the sheet's own "Open to print", where a phone cannot print from the sheet, and by the staff
 * console, a desk tool.
 */
describe('every paper prints from the slide-up', () => {
  const rel = (f: string) => f.split(/[\\/]/).slice(1).join('/');
  const files = [...sources(join('src', 'apps')), ...sources(join('src', 'shared'))];
  const src = (path: string) => readFileSync(join('src', ...path.split('/')), 'utf8');
  // The places that printed in a tab until today.
  const MOVED = [
    'apps/vendor/useVendorApp.ts',
    'apps/vendor/screens/MintScreen.tsx',
    'apps/mdp/useMdpApp.ts',
    'shared/archive/useArchive.ts',
    'shared/TaxInvoicesCard.tsx',
    'apps/fleet/screens/DriversScreen.tsx',
    'apps/agent/screens/TakenInLabel.tsx',
    'apps/genesis/screens/SendScreen.tsx',
  ];

  it('opens a tab nowhere in the apps or the shared code but the sheet’s “Open to print” — the desk console aside', () => {
    // The guard read something: hundreds of files, among them every place that used to open a tab.
    expect(files.length).toBeGreaterThan(300);
    for (const f of MOVED) expect(files.map(rel)).toContain(f);
    const opening = files
      .filter((f) => !rel(f).startsWith('apps/tower/'))
      .filter((f) => /\btabAtTheTap\b|\bopen(Page|Svg)\b|window\.open\(/.test(readFileSync(f, 'utf8')))
      .map(rel)
      .sort();
    // The opener itself; the sheet's fallback; and the account menu, which opens the person's own public page by its
    // address — a web page, meant for the browser, not a paper.
    expect(opening).toEqual(['shared/account/AccountMenu.tsx', 'shared/openPage.ts', 'shared/ui/PaperSheet.tsx']);
  });

  it('the sheet opens a tab once, from the button that says so; the account menu, only the person’s page', () => {
    const sheet = src('shared/ui/PaperSheet.tsx');
    expect((sheet.match(/\btabAtTheTap\(\)/g) ?? []).length).toBe(1);
    expect(sheet).toMatch(/const openOwn = \(\) => \{\s*const tab = tabAtTheTap\(\);/);
    const menu = src('shared/account/AccountMenu.tsx');
    expect((menu.match(/window\.open\(/g) ?? []).length).toBe(1);
    expect(menu).toMatch(/if \(handleHref\) window\.open\(handleHref, '_blank', 'noopener,noreferrer'\)/);
    // The in-hand openers are gone, so nothing can reach for them.
    expect(src('shared/openPage.ts')).not.toMatch(/export function open(Page|Svg)\b/);
  });

  it('each place that printed in a tab opens its paper in the sheet now', () => {
    for (const f of MOVED) {
      const text = src(f);
      expect({ f, sheet: /\busePaper\(\)/.test(text), shown: /\b(paper\.show|showPaper)\(/.test(text) }).toEqual({ f, sheet: true, shown: true });
    }
    // Drawn where the sheet lives: the app for a hook's paper, the screen for its own.
    expect(src('apps/vendor/app.tsx')).toMatch(/<PaperSheet state=\{paper\} \/>/);
    expect(src('apps/mdp/app.tsx')).toMatch(/<PaperSheet state=\{paper\} \/>/);
    expect(src('shared/archive/ArchiveSection.tsx')).toMatch(/<PaperSheet state=\{archive\.paper\} share=\{\{ links: archive\.noteLinks/);
  });
});
