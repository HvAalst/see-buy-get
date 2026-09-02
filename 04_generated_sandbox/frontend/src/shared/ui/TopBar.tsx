import type { ComponentChildren } from 'preact';
import { BrandMark } from './BrandMark';
import { Icon } from './Icon';

export interface TopBarProps {
  /** App/brand name, or the screen name once you are inside one. */
  title: string;
  /**
   * THE LIVE LINE: what is on this person's plate right now, and it changes as that changes.
   *
   * It used to hold who you are — the shop's name, the driver's name, the company. That is fixed for
   * the whole session, so the one slot in the bar that could move was spent on the one thing that
   * never did. Identity moved to `subtitleHint`, where a pointer can still reach it.
   *
   * It reflects COMMITTED state — my shift, my shelf, my orders — and never an incoming event. A
   * header that changes because an offer just arrived pulls a driver's eyes off the road and competes
   * with the nudge, which this product deliberately restrains to one pop-up and one decision.
   */
  subtitle?: string;
  /** What hovering the live line reveals — normally who you are. Falls back to the line itself. */
  subtitleHint?: string;
  /** Renders a 48px back target in the leading slot. */
  onBack?: () => void;
  backLabel?: string;
  /** Status pill, sync state — chrome only, never a call to action. */
  end?: ComponentChildren;
  /** Set false on a screen that must not carry the mark. See the note below for why it is otherwise
   *  automatic rather than something every app remembers to pass. */
  mark?: boolean;
}

/**
 * Fixed 60px bar, extended upward by the top safe-area inset so it clears a notch.
 *
 * THE LEADING SLOT ANSWERS "WHERE AM I". Deeper in, that answer is a way back, so it holds the back
 * arrow. At the root there is no way back and the answer is whose app this is, so it holds the mark.
 * They are never both right at once, which is why this is one slot and not two — and why the mark
 * needs no per-app opt-in: every app is at its own root on its first screen, sign-in included, and
 * that is exactly where identity is worth spending space on.
 */
export function TopBar({ title, subtitle, subtitleHint, onBack, backLabel = 'Back', end, mark = true }: TopBarProps) {
  return (
    <header class="topbar">
      {onBack ? (
        <button type="button" class="topbar__lead" onClick={onBack} aria-label={backLabel}>
          <Icon name="arrowLeft" size={24} />
        </button>
      ) : mark ? (
        <span class="topbar__mark">
          <BrandMark />
        </span>
      ) : null}
      {/* Both lines are nowrap + ellipsis, so on a narrow screen either can be cut. `title` makes the
          cut RECOVERABLE: a pointer reveals the whole string. Truncating is acceptable, losing is not —
          and the full text is in the DOM either way, so a screen reader was never the one missing it.
          A touch device has no hover and gets nothing from this, which is why the bar must also be
          worth reading at the width it has. */}
      <div class="topbar__id">
        <p class="topbar__brand" title={title}>
          {title}
        </p>
        {subtitle ? (
          <p class="topbar__sub" title={subtitleHint ?? subtitle}>
            {subtitle}
          </p>
        ) : null}
      </div>
      {end ? <div class="topbar__end">{end}</div> : null}
    </header>
  );
}
