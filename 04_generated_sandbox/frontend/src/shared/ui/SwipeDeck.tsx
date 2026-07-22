import type { ComponentChildren, JSX } from 'preact';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import { Icon } from './Icon';

export interface SwipeDeckProps {
  /** One node per card. Keys are supplied by the caller. */
  children: ComponentChildren[];
  /** Controlled index — the parent needs it to know which card the screen CTA acts on. */
  index: number;
  onIndex: (i: number) => void;
  /** Announced as "Load 2 of 5" and used for the dot labels. */
  itemNoun?: string;
  label?: string;
}

const GAP = 12;
const PEEK = 34;
const SWIPE_THRESHOLD = 40;

/**
 * Swipeable job deck: one card at a time, the next one peeking at the right edge, progress
 * dots below. The peek is the whole affordance — it is what tells a non-reader there is
 * more without a word of instruction.
 *
 * Accessible three ways, because a swipe is the least discoverable gesture there is:
 * drag (pointer/touch), the two arrow buttons, and Left/Right arrow keys on the focused
 * deck. Every dot is itself a 48px-tall button. Position is announced via aria-live.
 */
export function SwipeDeck({ children, index, onIndex, itemNoun = 'card', label }: SwipeDeckProps) {
  const count = children.length;
  const viewportRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [drag, setDrag] = useState(0);
  const startX = useRef(0);
  const dragging = useRef(false);

  // Measure once laid out, and on every resize / rotation.
  useLayoutEffect(() => {
    const node = viewportRef.current;
    if (!node) return;
    const measure = () => setWidth(node.clientWidth);
    measure();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure);
      return () => window.removeEventListener('resize', measure);
    }
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    return () => ro.disconnect();
  }, []);

  // A card can vanish under the finger (someone else claims it) — never point past the end.
  useEffect(() => {
    if (count > 0 && index > count - 1) onIndex(count - 1);
  }, [count, index, onIndex]);

  const slideW = width > 0 ? Math.max(120, width - PEEK) : 0;
  const step = slideW + GAP;
  const trackW = count > 0 ? count * slideW + (count - 1) * GAP : 0;
  const maxOffset = Math.max(0, trackW - width);
  const offset = Math.min(index * step, maxOffset);

  const move = useCallback(
    (delta: number) => {
      const next = Math.max(0, Math.min(count - 1, index + delta));
      if (next !== index) onIndex(next);
    },
    [count, index, onIndex],
  );

  const onPointerDown = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (count < 2) return;
    dragging.current = true;
    startX.current = e.clientX;
    e.currentTarget.setPointerCapture?.(e.pointerId);
  };

  const onPointerMove = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    const dx = e.clientX - startX.current;
    // Rubber-band at both ends so the deck never feels broken at the edges.
    const damped = (index === 0 && dx > 0) || (index === count - 1 && dx < 0) ? dx * 0.28 : dx;
    setDrag(damped);
  };

  const endDrag = (e: JSX.TargetedPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return;
    dragging.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    const dx = drag;
    setDrag(0);
    if (dx <= -SWIPE_THRESHOLD) move(1);
    else if (dx >= SWIPE_THRESHOLD) move(-1);
  };

  const onKeyDown = (e: JSX.TargetedKeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      move(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      move(-1);
    }
  };

  if (count === 0) return null;

  return (
    <div class="deck">
      <div
        class="deck__viewport"
        ref={viewportRef}
        role="group"
        aria-roledescription="carousel"
        aria-label={label}
        tabIndex={0}
        onKeyDown={onKeyDown}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style="touch-action:pan-y"
      >
        <div
          class={`deck__track${dragging.current ? '' : ' deck__track--animate'}`}
          style={`transform:translateX(${-offset + drag}px)`}
        >
          {children.map((child, i) => (
            <div
              class="deck__slide"
              key={i}
              style={slideW ? `width:${slideW}px` : undefined}
              aria-hidden={i === index ? undefined : 'true'}
              /* Off-screen cards must not be reachable by Tab — a keyboard user would
                 otherwise be dragged sideways into a card they cannot see. */
              inert={i !== index}
            >
              {child}
            </div>
          ))}
        </div>
      </div>

      <p class="sr-only" aria-live="polite">
        {`${itemNoun} ${index + 1} of ${count}`}
      </p>

      {count > 1 ? (
        <div class="deck__nav">
          <button
            type="button"
            class="deck__arrow"
            onClick={() => move(-1)}
            disabled={index === 0}
            aria-label={`Previous ${itemNoun}`}
          >
            <Icon name="chevronLeft" size={22} />
          </button>

          <div class="deck__dots">
            {children.map((_, i) => (
              <button
                type="button"
                key={i}
                class={`deck__dot${i === index ? ' deck__dot--on' : ''}`}
                onClick={() => onIndex(i)}
                aria-label={`${itemNoun} ${i + 1} of ${count}`}
                aria-current={i === index ? 'true' : undefined}
              />
            ))}
          </div>

          <button
            type="button"
            class="deck__arrow"
            onClick={() => move(1)}
            disabled={index === count - 1}
            aria-label={`Next ${itemNoun}`}
          >
            <Icon name="chevronRight" size={22} />
          </button>
        </div>
      ) : null}
    </div>
  );
}
