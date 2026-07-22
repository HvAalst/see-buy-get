import type { ComponentChildren } from 'preact';
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
}

/** Fixed 60px bar, extended upward by the top safe-area inset so it clears a notch. */
export function TopBar({ title, subtitle, onBack, backLabel = 'Back', end }: TopBarProps) {
  return (
    <header class="topbar">
      {onBack ? (
        <button type="button" class="topbar__lead" onClick={onBack} aria-label={backLabel}>
          <Icon name="arrowLeft" size={24} />
        </button>
      ) : null}
      <div class="topbar__id">
        <p class="topbar__brand">{title}</p>
        {subtitle ? <p class="topbar__sub">{subtitle}</p> : null}
      </div>
      {end ? <div class="topbar__end">{end}</div> : null}
    </header>
  );
}
