import { useEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';

/**
 * 2026-11-02 — SWIPE A SHEET DOWN TO CLOSE IT (the owner: "make it as native as today can be"). A sheet that slides up
 * from the bottom is pulled back down by the thumb that opened it: from its handle and title, or from anywhere in it
 * once its own content is at the top. It follows the finger; let go past a third of its height, or flick it, and it
 * goes; otherwise it springs back. A sheet that must be answered does not move.
 */

/** How far a finger moves before it is a pull and not a tap. */
export const SLOP = 6;
/** A flick: fast enough downward (px per ms) to close from any distance past `MIN_FLICK`. */
export const FLICK = 0.5;
export const MIN_FLICK = 24;

/** What a finger that has moved (dx, dy) from where it went down is doing: pulling the sheet, not yet clear, or not pulling. */
export function pullOf(dx: number, dy: number, canPull: boolean): 'pull' | 'wait' | 'leave' {
  if (!canPull) return 'leave';
  if (Math.abs(dx) < SLOP && Math.abs(dy) < SLOP) return 'wait';
  // Down, and more down than sideways. Up is the sheet's own scroll; sideways is a list that slides.
  return dy > 0 && dy >= Math.abs(dx) ? 'pull' : 'leave';
}

/** Let go `dy` below where it rests, at `velocity` px/ms (down positive), on a sheet `height` tall. */
export function releaseOf(dy: number, height: number, velocity: number): 'close' | 'stay' {
  if (height > 0 && dy > height / 3) return 'close';
  if (velocity > FLICK && dy > MIN_FLICK) return 'close';
  return 'stay';
}

export interface Sample {
  t: number;
  y: number;
}

/** Speed over the last tenth of a second of the move, so a pause before letting go is not a flick. */
export function velocityOf(samples: readonly Sample[]): number {
  if (samples.length < 2) return 0;
  const last = samples[samples.length - 1];
  let first = samples[samples.length - 2];
  for (let i = samples.length - 2; i >= 0 && last.t - samples[i].t <= 100; i--) first = samples[i];
  const dt = last.t - first.t;
  return dt > 0 ? (last.y - first.y) / dt : 0;
}

/** Where a pull never starts: what takes its own drags, or where a drag means choosing text. */
const NO_PULL = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], canvas, video, .leaflet-container, .pmap, [data-sheet-nodrag]';

const reduced = (): boolean => {
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

/** Something inside the sheet that scrolls on its own and is not at its top: a pull there is its scroll. */
function scrolledWithin(from: Element, panel: Element): boolean {
  for (let n: Element | null = from; n && n !== panel; n = n.parentElement) {
    if (n.scrollTop > 0) return true;
  }
  return false;
}

/** The handle and the title: a pull from here moves the sheet wherever its content is. */
function onHead(panel: HTMLElement, target: Element, y: number): boolean {
  if (target.closest('.sheet__grab, .sheet__title')) return true;
  const title = panel.querySelector('.sheet__title');
  return Boolean(title && y <= title.getBoundingClientRect().bottom);
}

interface Pull {
  id: number;
  x0: number;
  y0: number;
  head: boolean;
  pulling: boolean;
  dy: number;
  height: number;
  samples: Sample[];
}

/**
 * The gesture, on the sheet's panel. Pointer events follow the finger; a touchmove that is a pull is cancelled, so the
 * page (or the sheet's own scroll) never moves under it — `touch-action` alone cannot say "only when at the top".
 */
export function useSheetDrag(panelRef: RefObject<HTMLElement>, backdropRef: RefObject<HTMLElement>, enabled: boolean, onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const panel = panelRef.current;
    if (!enabled || !panel || typeof window === 'undefined') return;
    let g: Pull | null = null;
    let swallowUntil = 0;
    const timers: number[] = [];

    const paint = (dy: number, height: number) => {
      panel.style.transform = dy > 0 ? `translate3d(0, ${dy}px, 0)` : '';
      const back = backdropRef.current;
      if (back) back.style.opacity = height > 0 ? String(Math.max(0, 1 - dy / height)) : '';
    };
    const settle = (ms: number) => {
      timers.push(
        window.setTimeout(() => {
          panel.style.transition = '';
          panel.style.transform = '';
          panel.classList.remove('sheet--dragging');
          const back = backdropRef.current;
          if (back) {
            back.style.transition = '';
            back.style.opacity = '';
          }
        }, ms),
      );
    };
    const glide = (ms: number, ease: string) => {
      panel.style.transition = `transform ${ms}ms ${ease}`;
      const back = backdropRef.current;
      if (back) back.style.transition = `opacity ${ms}ms ${ease}`;
    };

    const down = (e: PointerEvent) => {
      if (g || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
      const target = e.target as Element | null;
      if (!target || target.closest(NO_PULL)) return;
      const head = onHead(panel, target, e.clientY);
      // A mouse pulls by the handle only: in the body, a drag is choosing text.
      if (!head && (e.pointerType === 'mouse' || panel.scrollTop > 0 || scrolledWithin(target, panel))) return;
      g = { id: e.pointerId, x0: e.clientX, y0: e.clientY, head, pulling: false, dy: 0, height: 0, samples: [{ t: e.timeStamp, y: e.clientY }] };
    };

    const move = (e: PointerEvent) => {
      if (!g || e.pointerId !== g.id) return;
      const dx = e.clientX - g.x0;
      const dy = e.clientY - g.y0;
      if (!g.pulling) {
        const what = pullOf(dx, dy, g.head || panel.scrollTop <= 0);
        if (what === 'wait') return;
        if (what === 'leave') {
          g = null;
          return;
        }
        g.pulling = true;
        g.height = panel.getBoundingClientRect().height;
        panel.classList.add('sheet--dragging');
        panel.style.transition = '';
        // The rising and the fading-in end where the finger takes over — and stay off while the sheet is open: an
        // animation given back to an element starts again, and the sheet would rise a second time after springing back.
        panel.style.animation = 'none';
        if (backdropRef.current) backdropRef.current.style.animation = 'none';
        try {
          panel.setPointerCapture(e.pointerId);
        } catch {
          /* the finger is still followed while it stays over the sheet */
        }
      }
      g.dy = Math.max(0, dy - SLOP);
      g.samples.push({ t: e.timeStamp, y: e.clientY });
      if (g.samples.length > 8) g.samples.shift();
      paint(g.dy, g.height);
    };

    const end = (e: PointerEvent, cancelled: boolean) => {
      if (!g || e.pointerId !== g.id) return;
      const was = g;
      g = null;
      if (!was.pulling) return;
      // The lift that ends a pull is not a tap on whatever it ended over.
      swallowUntil = e.timeStamp + 400;
      if (!cancelled && releaseOf(was.dy, was.height, velocityOf(was.samples)) === 'close') {
        if (reduced()) {
          close.current();
          settle(30);
          return;
        }
        glide(180, 'cubic-bezier(0.4, 0, 1, 1)');
        paint(was.height || window.innerHeight, was.height);
        timers.push(window.setTimeout(() => close.current(), 180));
        // A sheet its owner keeps open comes back rather than staying out of sight.
        settle(260);
        return;
      }
      glide(220, 'cubic-bezier(0.2, 0.8, 0.2, 1)');
      paint(0, was.height);
      settle(240);
    };
    const up = (e: PointerEvent) => end(e, false);
    const cancel = (e: PointerEvent) => end(e, true);

    const touchmove = (e: TouchEvent) => {
      if (g?.pulling && e.cancelable) e.preventDefault();
    };
    const click = (e: MouseEvent) => {
      if (e.timeStamp < swallowUntil) {
        e.preventDefault();
        e.stopPropagation();
      }
    };

    panel.addEventListener('pointerdown', down);
    panel.addEventListener('pointermove', move);
    panel.addEventListener('pointerup', up);
    panel.addEventListener('pointercancel', cancel);
    panel.addEventListener('touchmove', touchmove, { passive: false });
    panel.addEventListener('click', click, true);
    return () => {
      panel.removeEventListener('pointerdown', down);
      panel.removeEventListener('pointermove', move);
      panel.removeEventListener('pointerup', up);
      panel.removeEventListener('pointercancel', cancel);
      panel.removeEventListener('touchmove', touchmove);
      panel.removeEventListener('click', click, true);
      timers.forEach((t) => window.clearTimeout(t));
      panel.classList.remove('sheet--dragging');
      panel.style.transition = '';
      panel.style.transform = '';
    };
  }, [enabled]);
}
