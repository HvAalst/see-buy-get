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

  it('uses the in-hand openers only where nothing is awaited first', () => {
    const files = [...sources(join('src', 'apps')), ...sources(join('src', 'shared'))];
    const using = files
      .filter((f) => !f.endsWith('openPage.ts'))
      .filter((f) => /import \{[^}]*\bopen(Page|Svg)\b[^}]*\} from '[./]*shared\/openPage'|from '\.\/openPage'/.test(readFileSync(f, 'utf8')) && /\bopen(Page|Svg)\(/.test(readFileSync(f, 'utf8')))
      .map((f) => f.split(/[\\/]/).slice(1).join('/'))
      .sort();
    // Labels drawn when the parcel was made: in hand, opened straight from the tap.
    expect(using).toEqual(['apps/agent/screens/TakenInLabel.tsx', 'apps/genesis/screens/SendScreen.tsx', 'apps/vendor/screens/MintScreen.tsx']);
  });
});
