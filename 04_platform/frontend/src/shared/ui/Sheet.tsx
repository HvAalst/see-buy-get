import type { ComponentChildren, JSX } from 'preact';
import { useEffect, useRef } from 'preact/hooks';

export interface SheetProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ComponentChildren;
  /** Set false when a confirmation must be answered by a button, not by a tap-away. */
  dismissible?: boolean;
}

const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

/**
 * The slide-up sheet: detail and confirmation live here, never in a browser dialog.
 * Bottom-anchored so it lands under the thumb, 22px top corners, a 44x5 grabber that
 * says "this came from below", and a navy-tinted backdrop.
 *
 * Behaviour that makes it a real dialog rather than a floating div: the page behind is
 * scroll-locked, focus moves in and is trapped for the whole lifetime, Escape closes,
 * and focus returns to whatever opened it. The travel animation is CSS, so
 * prefers-reduced-motion (in ui.css) removes the motion without removing the sheet.
 */
export function Sheet({ open, onClose, title, children, dismissible = true }: SheetProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  // `onClose` is almost always an inline arrow, so it has a new identity on every parent
  // render. Kept in a ref rather than in the dependency list: otherwise the effect tears
  // down and re-runs whenever the parent re-renders (a busy flag flipping, a countdown
  // ticking), and the teardown's focus-restore would yank focus straight back out of the
  // open sheet mid-interaction.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!open) return;

    restoreTo.current = document.activeElement as HTMLElement | null;

    // Scroll-lock the page behind: a sheet that lets the body scroll under it reads as
    // a broken overlay on a phone.
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && dismissible) {
        e.preventDefault();
        onCloseRef.current();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
        (n) => n.offsetParent !== null || n === document.activeElement,
      );
      if (items.length === 0) {
        e.preventDefault();
        return;
      }
      const firstItem = items[0];
      const lastItem = items[items.length - 1];
      if (e.shiftKey && document.activeElement === firstItem) {
        e.preventDefault();
        lastItem.focus();
      } else if (!e.shiftKey && document.activeElement === lastItem) {
        e.preventDefault();
        firstItem.focus();
      }
    };

    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      restoreTo.current?.focus?.();
    };
  }, [open, dismissible]);

  if (!open) return null;

  const stop = (e: JSX.TargetedMouseEvent<HTMLDivElement>) => e.stopPropagation();

  return (
    <>
      <div
        class="sheet__backdrop"
        onClick={dismissible ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        class="sheet"
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        onClick={stop}
      >
        <div class="sheet__grab" aria-hidden="true" />
        <h2 class="sheet__title">{title}</h2>
        <div class="sheet__body">{children}</div>
      </div>
    </>
  );
}
