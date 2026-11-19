import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Read from the frontend folder, as the other tests that read sources do (no __dirname in the browser's types). */
const here = join('src', 'shared', 'ui');

/*
 * 2026-11-19 — THE SHEET IS FITTED ABOVE THE KEYBOARD (sheetKeyboard.ts). The fit runs in an effect, which these tests do not
 * run; so it is checked where it is wired: every sheet uses it, and its look stands on what it sets.
 */
describe('every slide-up sheet stays above the keyboard', () => {
  it('uses the fit while open', () => {
    const sheet = readFileSync(join(here, 'Sheet.tsx'), 'utf8');
    expect(sheet).toMatch(/useKeyboardFit\(panelRef, open\)/);
  });

  it('stands on the keyboard and is no taller than what is still seen; a whole-screen one fills what is seen', () => {
    const css = readFileSync(join(here, 'ui.css'), 'utf8').replace(/\r\n/g, '\n');
    const sheet = css.slice(css.indexOf('\n.sheet {'), css.indexOf('}', css.indexOf('\n.sheet {')));
    expect(sheet).toContain('bottom: var(--kb, 0px);');
    expect(sheet).toContain('max-height: calc(var(--vvh, 100dvh) * 0.88);');
    const full = css.slice(css.indexOf('\n.sheet--full {'), css.indexOf('}', css.indexOf('\n.sheet--full {')));
    expect(full).toContain('top: var(--vvt, 0px);');
    expect(full).toContain('height: var(--vvh, 100dvh);');
  });
});
