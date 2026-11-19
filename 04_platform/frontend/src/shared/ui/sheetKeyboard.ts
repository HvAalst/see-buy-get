import { useEffect } from 'preact/hooks';
import type { RefObject } from 'preact';

/**
 * 2026-11-19 — A SHEET ABOVE THE KEYBOARD (the owner: "When they have a text input bar, then the keyboard is hiding the bottom
 * while it can not slide further down"). On a phone the keyboard covers the bottom of the screen without making the page any
 * shorter — the browser shrinks only what can be seen (the visual viewport). A sheet fixed to the bottom of the page then had
 * its foot, with the field being typed in and its button, behind the keyboard, and it could not be scrolled further because it
 * believed it already showed everything.
 *
 * So while a sheet is open it follows what can be seen: it stands on the keyboard (`--kb`), is no taller than what is left of
 * the screen (`--vvh`, `--vvt` for a whole-screen sheet), and the field being typed in is scrolled into sight within it.
 */

/** What the keyboard takes from the bottom of the page, and the part of the screen still seen, in whole pixels. */
export function keyboardInset(innerHeight: number, viewport: { height: number; offsetTop: number }): { kb: number; vvh: number; vvt: number } {
  const kb = Math.max(0, Math.round(innerHeight - viewport.height - viewport.offsetTop));
  return { kb, vvh: Math.round(viewport.height), vvt: Math.max(0, Math.round(viewport.offsetTop)) };
}

interface Panel {
  style: { setProperty(name: string, value: string): void; removeProperty(name: string): void };
  addEventListener(type: 'focusin', fn: (e: { target: unknown }) => void): void;
  removeEventListener(type: 'focusin', fn: (e: { target: unknown }) => void): void;
}
interface Viewport {
  height: number;
  offsetTop: number;
  addEventListener(type: 'resize' | 'scroll', fn: () => void): void;
  removeEventListener(type: 'resize' | 'scroll', fn: () => void): void;
}

/** A field a keyboard comes up for. */
const TYPED = /^(INPUT|TEXTAREA|SELECT)$/;

/**
 * Keep `panel` fitted to what can be seen above the keyboard; the returned function undoes it. Where the browser cannot say
 * what is seen (no visual viewport), nothing is done and the sheet stays as it was.
 */
export function fitAboveKeyboard(panel: Panel, win: { innerHeight: number; visualViewport?: Viewport | null }, later: (fn: () => void) => void = (fn) => setTimeout(fn, 250)): () => void {
  const vv = win.visualViewport;
  if (!vv) return () => undefined;
  const apply = () => {
    const { kb, vvh, vvt } = keyboardInset(win.innerHeight, vv);
    panel.style.setProperty('--kb', `${kb}px`);
    panel.style.setProperty('--vvh', `${vvh}px`);
    panel.style.setProperty('--vvt', `${vvt}px`);
  };
  // The field being typed in, into sight once the keyboard has come up and the sheet has moved.
  const onFocus = (e: { target: unknown }) => {
    const t = e.target as { tagName?: string; isContentEditable?: boolean; scrollIntoView?: (o: { block: 'nearest' | 'center' }) => void };
    if (!t || !(TYPED.test(t.tagName ?? '') || t.isContentEditable)) return;
    later(() => {
      apply();
      t.scrollIntoView?.({ block: 'nearest' });
    });
  };
  apply();
  vv.addEventListener('resize', apply);
  vv.addEventListener('scroll', apply);
  panel.addEventListener('focusin', onFocus);
  return () => {
    vv.removeEventListener('resize', apply);
    vv.removeEventListener('scroll', apply);
    panel.removeEventListener('focusin', onFocus);
    panel.style.removeProperty('--kb');
    panel.style.removeProperty('--vvh');
    panel.style.removeProperty('--vvt');
  };
}

/** The same, for a sheet's panel while it is open. */
export function useKeyboardFit(panelRef: RefObject<HTMLElement>, open: boolean): void {
  useEffect(() => {
    const panel = panelRef.current;
    if (!open || !panel || typeof window === 'undefined') return;
    return fitAboveKeyboard(panel as unknown as Panel, window as unknown as { innerHeight: number; visualViewport?: Viewport | null });
  }, [open]);
}
