import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useRef, useState } from 'preact/hooks';

/**
 * 2026-11-02 — A LONG RECORD IN SECTIONS, SWIPED THROUGH (the owner: "some fields are pretty data heavy like historical
 * freight, it carries attachments, numbers, time, names of drivers and we don't want to mush scrolling. In that case a
 * sticky but swipable subheader could appear and the content could also be navigated with swiping").
 *
 * The section names stand in a row pinned to the top of the detail while it scrolls; tapping one, or swiping the content
 * left or right, moves to the next — as a native app's tabs do. Every section stays mounted (a half-typed answer in one
 * survives a look at another); a section with nothing in it has no tab. Whatever waits for the reader's answer belongs in
 * the first section, so nothing urgent hides behind a name. A swipe that starts at the screen's edge is the phone's own
 * Back gesture and is left alone, as is one on a map, a field being typed in, or a row that scrolls sideways itself.
 */
export interface SectionSpec {
  key: string;
  label: string;
  /** A count beside the name — papers held, seals, attempts. */
  count?: number;
  /** Something in it waits for the reader: a dot beside the name. */
  attention?: boolean;
  content: ComponentChildren;
}

const EDGE = 24; // px from the screen's side where the phone's own Back gesture starts
const SWIPE = 56; // px of sideways travel that turns the section

/** The section a swipe lands on: one along in the swipe's direction, never past either end. */
export function swipeTo(at: number, keys: string[], dx: number): number {
  if (Math.abs(dx) < SWIPE) return at;
  return Math.max(0, Math.min(keys.length - 1, at + (dx < 0 ? 1 : -1)));
}

/** Whether a touch may start a sideways swipe here. */
export function maySwipe(s: { x: number; width: number; onOwnGesture: boolean }): boolean {
  return s.x > EDGE && s.x < s.width - EDGE && !s.onOwnGesture;
}

function ownGesture(target: EventTarget | null): boolean {
  let el = target instanceof Element ? target : null;
  while (el && !el.classList.contains('secs__panes')) {
    if (el.matches('input, textarea, select, [contenteditable="true"], .pmap, .pmap-wrap, .leaflet-container, .secs__tabs')) return true;
    if (el.scrollWidth > el.clientWidth + 4 && /(auto|scroll)/.test(getComputedStyle(el).overflowX)) return true;
    el = el.parentElement;
  }
  return false;
}

export function Sections({ label, sections }: { label: string; sections: SectionSpec[] }) {
  const [now, setNow] = useState(sections[0]?.key ?? '');
  const [empty, setEmpty] = useState<string[]>([]);
  const [drag, setDrag] = useState(0);
  const panes = useRef<HTMLDivElement | null>(null);
  const strip = useRef<HTMLDivElement | null>(null);
  const start = useRef<{ x: number; y: number; dir: 'x' | 'y' | null } | null>(null);

  // A section whose content drew nothing has no tab: known only once drawn.
  useLayoutEffect(() => {
    const root = panes.current;
    if (!root) return;
    const none = sections.filter((s) => {
      const pane = root.querySelector(`[data-sec="${s.key}"]`);
      return !pane || (pane.childElementCount === 0 && !pane.textContent?.trim());
    });
    const keys = none.map((s) => s.key);
    if (keys.join() !== empty.join()) setEmpty(keys);
  });

  const shown = sections.filter((s) => !empty.includes(s.key));
  const keys = shown.map((s) => s.key);
  const at = Math.max(0, keys.indexOf(now));
  const current = keys[at] ?? sections[0]?.key;

  const go = (key: string) => {
    setNow(key);
    // Keep the names in sight: a section starts at its top, under the pinned row.
    const bar = strip.current;
    bar?.querySelector(`[data-tab="${key}"]`)?.scrollIntoView?.({ block: 'nearest', inline: 'center' });
    if (bar && bar.getBoundingClientRect().top <= 1) bar.scrollIntoView?.({ block: 'start' });
  };

  const onDown = (e: PointerEvent) => {
    if (e.pointerType === 'mouse' || !maySwipe({ x: e.clientX, width: window.innerWidth, onOwnGesture: ownGesture(e.target) })) return;
    start.current = { x: e.clientX, y: e.clientY, dir: null };
  };
  const onMove = (e: PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (!s.dir && Math.max(Math.abs(dx), Math.abs(dy)) > 10) s.dir = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    if (s.dir === 'x') setDrag(Math.max(-80, Math.min(80, dx * 0.4)));
    else if (s.dir === 'y') start.current = null;
  };
  const onUp = (e: PointerEvent) => {
    const s = start.current;
    start.current = null;
    setDrag(0);
    if (!s || s.dir !== 'x') return;
    const to = swipeTo(at, keys, e.clientX - s.x);
    if (to !== at) go(keys[to]);
  };

  return (
    <div class="secs">
      <div class="secs__tabs" role="tablist" aria-label={label} ref={strip}>
        {shown.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            id={`sec-tab-${s.key}`}
            data-tab={s.key}
            aria-selected={s.key === current}
            aria-controls={`sec-pane-${s.key}`}
            tabIndex={s.key === current ? 0 : -1}
            class={`secs__tab${s.key === current ? ' secs__tab--on' : ''}`}
            onClick={() => go(s.key)}
            onKeyDown={(e) => {
              const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
              if (!step) return;
              e.preventDefault();
              const to = keys[Math.max(0, Math.min(keys.length - 1, at + step))];
              go(to);
              (e.currentTarget.parentElement?.querySelector(`[data-tab="${to}"]`) as HTMLElement | null)?.focus();
            }}
          >
            {s.label}
            {s.count ? <span class="secs__count">{s.count}</span> : null}
            {s.attention ? <span class="secs__dot" aria-hidden="true" /> : null}
          </button>
        ))}
      </div>
      <div
        class="secs__panes"
        ref={panes}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => {
          start.current = null;
          setDrag(0);
        }}
        style={drag ? `transform: translateX(${drag}px)` : undefined}
      >
        {sections.map((s) => (
          <div key={s.key} role="tabpanel" id={`sec-pane-${s.key}`} aria-labelledby={`sec-tab-${s.key}`} data-sec={s.key} class="secs__pane" hidden={s.key !== current}>
            {s.content}
          </div>
        ))}
      </div>
    </div>
  );
}
