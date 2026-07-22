import type { ComponentChildren } from 'preact';

export type PillTone = 'ok' | 'info' | 'idle' | 'warn' | 'danger';

export interface PillProps {
  children: ComponentChildren;
  tone?: PillTone;
  /** Leading status dot — colour is inherited, so it never needs its own token. */
  dot?: boolean;
}

export function Pill({ children, tone = 'idle', dot = false }: PillProps) {
  return (
    <span class={`pill pill--${tone}`}>
      {dot ? <span class="pill__dot" aria-hidden="true" /> : null}
      {children}
    </span>
  );
}
