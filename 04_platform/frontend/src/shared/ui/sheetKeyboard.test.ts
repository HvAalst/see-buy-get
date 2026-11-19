import { describe, expect, it } from 'vitest';
import { fitAboveKeyboard, keyboardInset } from './sheetKeyboard';

/*
 * 2026-11-19 — A SHEET ABOVE THE KEYBOARD (the owner: the keyboard hid the foot of a sheet with a field in it, and it could not
 * be slid further). While a sheet is open it stands on the keyboard and is no taller than what is still seen; the field typed in
 * is scrolled into sight.
 */
function fakes(innerHeight = 800) {
  const props = new Map<string, string>();
  const vvListeners = new Map<string, () => void>();
  let focusin: ((e: { target: unknown }) => void) | undefined;
  const panel = {
    style: { setProperty: (n: string, v: string) => props.set(n, v), removeProperty: (n: string) => props.delete(n) },
    addEventListener: (_t: 'focusin', fn: (e: { target: unknown }) => void) => (focusin = fn),
    removeEventListener: () => (focusin = undefined),
  };
  const vv = {
    height: innerHeight,
    offsetTop: 0,
    addEventListener: (t: 'resize' | 'scroll', fn: () => void) => vvListeners.set(t, fn),
    removeEventListener: (t: 'resize' | 'scroll') => vvListeners.delete(t),
  };
  return { props, vv, vvListeners, panel, win: { innerHeight, visualViewport: vv }, focus: (target: unknown) => focusin?.({ target }) };
}

describe('a sheet above the keyboard', () => {
  it('reads what the keyboard takes from the bottom, and what is still seen', () => {
    expect(keyboardInset(800, { height: 800, offsetTop: 0 })).toEqual({ kb: 0, vvh: 800, vvt: 0 });
    expect(keyboardInset(800, { height: 480, offsetTop: 0 })).toEqual({ kb: 320, vvh: 480, vvt: 0 });
    // The page scrolled up under the keyboard (iOS): the keyboard is what is below the seen part.
    expect(keyboardInset(800, { height: 480, offsetTop: 40.4 })).toEqual({ kb: 280, vvh: 480, vvt: 40 });
    // Zoomed in, the seen part is smaller than the page and nothing is under a keyboard that is not there.
    expect(keyboardInset(800, { height: 900, offsetTop: 0 }).kb).toBe(0);
  });

  it('follows the keyboard while open, and lets go when the sheet closes', () => {
    const f = fakes();
    const stop = fitAboveKeyboard(f.panel, f.win, (fn) => fn());
    expect(f.props.get('--kb')).toBe('0px');
    f.vv.height = 480;
    f.vvListeners.get('resize')!();
    expect([f.props.get('--kb'), f.props.get('--vvh')]).toEqual(['320px', '480px']);
    stop();
    expect(f.props.size).toBe(0);
    expect(f.vvListeners.size).toBe(0);
  });

  it('scrolls the field typed in into sight once the keyboard is up — a button is not a field', () => {
    const f = fakes();
    fitAboveKeyboard(f.panel, f.win, (fn) => fn());
    const seen: string[] = [];
    f.focus({ tagName: 'INPUT', scrollIntoView: () => seen.push('input') });
    f.focus({ tagName: 'TEXTAREA', scrollIntoView: () => seen.push('textarea') });
    f.focus({ tagName: 'BUTTON', scrollIntoView: () => seen.push('button') });
    expect(seen).toEqual(['input', 'textarea']);
  });

  it('where the browser cannot say what is seen, leaves the sheet as it was', () => {
    const f = fakes();
    const stop = fitAboveKeyboard(f.panel, { innerHeight: 800, visualViewport: null });
    expect(f.props.size).toBe(0);
    stop();
  });
});
