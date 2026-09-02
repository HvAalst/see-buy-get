import type { ComponentChildren } from 'preact';
import { BrandMark } from './BrandMark';
import { Icon } from './Icon';

export interface TopBarProps {
  /** App/brand name, or the screen name once you are inside one. */
  title: string;
  /** Who is signed in, or where you are. */
  subtitle?: string;
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
export function TopBar({ title, subtitle, onBack, backLabel = 'Back', end, mark = true }: TopBarProps) {
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
      <div class="topbar__id">
        <p class="topbar__brand">{title}</p>
        {subtitle ? <p class="topbar__sub">{subtitle}</p> : null}
      </div>
      {end ? <div class="topbar__end">{end}</div> : null}
    </header>
  );
}
