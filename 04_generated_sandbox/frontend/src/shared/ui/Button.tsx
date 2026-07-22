import type { ComponentChildren, JSX } from 'preact';
import { Icon } from './Icon';

/**
 * The button hierarchy, enforced by type rather than by discipline:
 *
 *   primary  — the ONE solid blue full-width call to action on a screen, with a right
 *              chevron. If a screen wants two, the second one is wrong.
 *   outline  — the second choice. White ground, blue text, 1.5px blue border.
 *   link     — everything after that. Plain blue text, still a 48px target.
 *
 * `busy` disables the control and swaps the chevron for a spinner: every mutating call in
 * this app is single-flight, because the field network makes double-taps routine.
 */
export type ButtonVariant = 'primary' | 'outline' | 'link';

export interface ButtonProps {
  children: ComponentChildren;
  variant?: ButtonVariant;
  onClick?: (e: JSX.TargetedMouseEvent<HTMLButtonElement>) => void;
  disabled?: boolean;
  busy?: boolean;
  /** Primary defaults to full width; link defaults to inline. */
  full?: boolean;
  /** Primary shows a chevron by default; set false for a terminal confirm. */
  chevron?: boolean;
  danger?: boolean;
  type?: 'button' | 'submit';
  class?: string;
  'aria-label'?: string;
}

export function Button({
  children,
  variant = 'primary',
  onClick,
  disabled,
  busy,
  full,
  chevron,
  danger,
  type = 'button',
  class: cls,
  'aria-label': ariaLabel,
}: ButtonProps) {
  const isFull = full ?? variant !== 'link';
  const showChev = (chevron ?? (variant === 'primary')) && !busy;

  const classes = [
    'btn',
    `btn--${variant}`,
    isFull ? 'btn--full' : '',
    danger && variant === 'link' ? 'btn--danger-link' : '',
    cls ?? '',
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      type={type}
      class={classes}
      onClick={onClick}
      disabled={disabled || busy}
      aria-busy={busy ? 'true' : undefined}
      aria-label={ariaLabel}
    >
      {busy ? <span class="btn__spin" aria-hidden="true" /> : null}
      <span>{children}</span>
      {showChev ? <Icon name="chevronRight" size={20} class="btn__chev" /> : null}
    </button>
  );
}
