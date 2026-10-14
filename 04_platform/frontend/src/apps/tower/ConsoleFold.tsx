import type { ComponentChildren, Ref } from 'preact';
import { useState } from 'preact/hooks';
import { Icon } from '../../shared/ui';

/**
 * A SECTION FOLDED INTO ITS OWN HEADLINE.
 *
 * The user, on the container detail: *"the container info on the slide up is lengthy and not intuitive...
 * we should follow the principle of information folded in a title and subtitle with an arrow btn."*
 *
 * Twelve sections opened at once is not a detail view, it is a document — and one somebody scrolls past
 * eleven times to reach the twelfth. Folded, the whole container fits on a screen as a list of headlines,
 * and the question the reader actually has ("is there anything here for me?") is answered by the SUBTITLE
 * without opening anything. That is the same discipline as the container list itself: a row exists to tell
 * you whether to open it.
 *
 * SO THE SUBTITLE IS STATE, NEVER PROSE. "0 of 2 accepted", "Nothing on record", "Nobody appointed" —
 * a fact that changes. The paragraph explaining what a section is for stays inside it, where somebody who
 * opened it is asking; an explanation in the closed row would be the same sentence on every container,
 * which is a row that says nothing while looking like it says something.
 *
 * AND A FOLD OPENS ITSELF WHEN SOMETHING IS WAITING. A warning behind a click is a warning nobody reads,
 * which is a rule this console already keeps for the unverified masthead tag — so an open customs hold or
 * a paper waiting on the reader arrives open, and the rest arrive shut.
 */
export function ConsoleFold({
  title,
  hint,
  aside,
  defaultOpen = false,
  open: openProp,
  onOpenChange,
  panelRef,
  children,
}: {
  title: ComponentChildren;
  /** One line of STATE — what is in here now, so the row can be skipped without opening it. */
  hint?: ComponentChildren;
  /** Tags that belonged to the old panel heading; they read on the closed row too. */
  aside?: ComponentChildren;
  defaultOpen?: boolean;
  /** Controlled, for the rare caller that opens a fold from somewhere else on the screen. */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** So a caller can scroll to this section after opening it. */
  panelRef?: Ref<HTMLElement>;
  children: ComponentChildren;
}) {
  const [self, setSelf] = useState(defaultOpen);
  const open = openProp ?? self;
  // Uncontrolled by default — a controlled caller owns the state, and telling it about a change it
  // already made is how two sources of truth start disagreeing.
  const setOpen = (next: boolean) => {
    if (openProp === undefined) setSelf(next);
    onOpenChange?.(next);
  };
  return (
    <section class={`cons__panel${open ? ' cfold--open' : ''}`} ref={panelRef}>
      <button type="button" class="cfold" aria-expanded={open} onClick={() => setOpen(!open)}>
        <span class="cfold__body">
          <span class="cons__panelt">{title}</span>
          {hint ? <span class="cfold__sub">{hint}</span> : null}
        </span>
        {aside ? <span class="cfold__aside">{aside}</span> : null}
        <Icon name="chevronRight" size={18} class="cfold__go" />
      </button>
      {/* Mounted only while open, so a section nobody opened costs nothing — and anything inside that
          fetches on mount (a consignment note, a document list) does not fetch until it is read. */}
      {open ? <div class="cfold__open">{children}</div> : null}
    </section>
  );
}
