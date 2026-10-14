import type { ComponentChildren } from 'preact';

export interface CardProps {
  children: ComponentChildren;
  /** 18px / 700 / navy, per the card-heading step of the type scale. */
  title?: string;
  /** Sits opposite the title — a Pill, a text-link Button, a timer. */
  aside?: ComponentChildren;
  /** Muted trailing line, 15px. */
  note?: string;
  tone?: 'default' | 'flat' | 'soft';
  class?: string;
  /** Renders as <section aria-label> so a card is a landmark for a screen reader. */
  label?: string;
}

export function Card({ children, title, aside, note, tone = 'default', class: cls, label }: CardProps) {
  const classes = ['card', tone === 'flat' ? 'card--flat' : '', tone === 'soft' ? 'card--soft' : '', cls ?? '']
    .filter(Boolean)
    .join(' ');

  return (
    <section class={classes} aria-label={label ?? title}>
      {title || aside ? (
        <div class="card__head">
          {title ? <h2 class="card__title">{title}</h2> : <span />}
          {aside ?? null}
        </div>
      ) : null}
      {children}
      {note ? <p class="card__note">{note}</p> : null}
    </section>
  );
}
