import { useEffect, useRef, useState } from 'preact/hooks';
import { useT } from '../i18n';
import { Icon } from './Icon';

/**
 * 2026-11-02 — PULL DOWN TO REFRESH (the owner: "make it as native as today can be").
 *
 * The browser's own pull-to-refresh is switched off in every app (tokens.css: it reloads the whole app, sign-in and
 * all). This is the native app's gesture instead: at the top of a screen, pull down past the mark and let go, and the
 * app fetches its screen again — a circle under the top bar turns as you pull and spins while it loads. Not over an
 * open sheet, a map or anything that scrolls on its own, and not when the move is sideways.
 */
export const PULL_MARK = 72; // px of (damped) pull that arms a refresh
const MAX_PULL = 110;

/** How far the circle has come for a finger moved `dy` down: a damped pull, as a native list resists. */
export function pulled(dy: number): number {
  if (dy <= 0) return 0;
  return Math.min(MAX_PULL, dy * 0.5);
}

/** Whether a touch may start a pull: at the very top, one finger, not on something that handles its own moves. */
export function mayPull(s: { scrollY: number; touches: number; overSheet: boolean; inOwnScroller: boolean; busy: boolean }): boolean {
  return s.scrollY <= 0 && s.touches === 1 && !s.overSheet && !s.inOwnScroller && !s.busy;
}

/** The finger is on something that moves by itself: a map, a slider, or a box scrolled away from its own top. */
function ownScroller(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null;
  while (el && el !== document.body) {
    if (el.matches('.pmap, .pmap-wrap, .leaflet-container, input[type="range"], .sheet, .acct__menu')) return true;
    const style = getComputedStyle(el);
    if (/(auto|scroll)/.test(style.overflowY) && el.scrollHeight > el.clientHeight && el.scrollTop > 0) return true;
    el = el.parentElement;
  }
  return false;
}

export function PullToRefresh({ onRefresh }: { onRefresh?: () => unknown }) {
  const t = useT();
  const [pull, setPull] = useState(0);
  const [busy, setBusy] = useState(false);
  const start = useRef<{ x: number; y: number } | null>(null);
  const live = useRef({ pull: 0, busy: false });
  live.current = { pull, busy };

  useEffect(() => {
    if (!onRefresh || typeof document === 'undefined') return;
    const down = (e: TouchEvent) => {
      const ok = mayPull({
        scrollY: window.scrollY,
        touches: e.touches.length,
        overSheet: Boolean(document.querySelector('.sheet')),
        inOwnScroller: ownScroller(e.target),
        busy: live.current.busy,
      });
      start.current = ok ? { x: e.touches[0].clientX, y: e.touches[0].clientY } : null;
    };
    const move = (e: TouchEvent) => {
      const s = start.current;
      if (!s) return;
      const dx = e.touches[0].clientX - s.x;
      const dy = e.touches[0].clientY - s.y;
      // Sideways first, or scrolled meanwhile: not a pull.
      if ((Math.abs(dx) > Math.abs(dy) && live.current.pull === 0) || window.scrollY > 0) {
        start.current = null;
        setPull(0);
        return;
      }
      setPull(pulled(dy));
    };
    const up = () => {
      const armed = start.current !== null && live.current.pull >= PULL_MARK;
      start.current = null;
      setPull(0);
      if (!armed) return;
      setBusy(true);
      void Promise.resolve()
        .then(() => onRefresh())
        .catch(() => undefined)
        .finally(() => setBusy(false));
    };
    document.addEventListener('touchstart', down, { passive: true });
    document.addEventListener('touchmove', move, { passive: true });
    document.addEventListener('touchend', up);
    document.addEventListener('touchcancel', up);
    return () => {
      document.removeEventListener('touchstart', down);
      document.removeEventListener('touchmove', move);
      document.removeEventListener('touchend', up);
      document.removeEventListener('touchcancel', up);
    };
  }, [onRefresh]);

  if (!onRefresh || (pull === 0 && !busy)) return null;
  const armed = pull >= PULL_MARK;
  return (
    <div
      class={`ptr${busy ? ' ptr--busy' : ''}${armed ? ' ptr--armed' : ''}`}
      style={busy ? undefined : `transform: translate(-50%, ${pull}px)`}
      role="status"
      aria-label={busy ? t('common.refreshing') : armed ? t('common.releaseToRefresh') : t('common.pullToRefresh')}
    >
      <span class="ptr__ic" data-spin={busy ? "" : undefined} style={busy ? undefined : `transform: rotate(${pull * 4}deg)`}>
        <Icon name="refresh" size={20} />
      </span>
    </div>
  );
}
