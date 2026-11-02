import { useState } from 'preact/hooks';
import { useT } from '../i18n';
import { Icon } from './Icon';

export interface StepListProps {
  /** What is being done, in words: "Signing up as a sort hub". */
  title: string;
  /** Every step, in order, by its name. */
  steps: string[];
  /** The step now, counted from 0. */
  at: number;
  /**
   * Pinned under the top bar for as long as the sign-up takes, folded to one bar (the owner, 2026-11-02: the list stood
   * above the step's own title, and "it scrolls under the moment you actually start the process"). The Business app's
   * card pins it too, on a phone and at a desk (2026-11-02), at the top of the card — business.css.
   */
  pinned?: boolean;
}

/**
 * WHERE YOU ARE, AND WHAT COMES NEXT (the owner, 2026-11-01: "an indicator of the steps and how far you are in the sign up
 * process can be more clear. now it shows a couple of dots but you don't read what is gonna come next"). Every step by
 * name: ticked when done, marked now, the rest still to come — read in order by a screen reader, the step now marked
 * as the current one.
 *
 * PINNED (2026-11-02): one slim bar that stays under the top bar while the form scrolls — what is being done and the
 * step count, a meter filling up, the step now and the one after it by name. Tapping it opens the whole list in place.
 * Five or six lines pinned would take half a small phone's screen from the form they describe.
 */
export function StepList({ title, steps, at, pinned = false }: StepListProps) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const now = Math.min(Math.max(at, 0), steps.length - 1);
  const head = (
    <>
      <b>{title}</b> · {t('common.stepOf', { at: Math.min(at + 1, steps.length), total: steps.length })}
    </>
  );
  const list = (
    <ol class="steps__list" id="steps-all" hidden={pinned && !open ? true : undefined}>
      {steps.map((name, i) => {
        const where = i < at ? 'done' : i === at ? 'now' : 'next';
        return (
          <li
            key={`${i}-${name}`}
            class={`steps__item steps__item--${where}`}
            aria-current={where === 'now' ? 'step' : undefined}
            aria-label={where === 'done' ? `${name}: ${t('common.stepDone')}` : undefined}
          >
            <span class="steps__mark" aria-hidden="true">
              {where === 'done' ? '✓' : where === 'now' ? '●' : '○'}
            </span>
            <span>{name}</span>
          </li>
        );
      })}
    </ol>
  );

  if (!pinned) {
    return (
      <nav class="steps" aria-label={title}>
        <p class="steps__head">{head}</p>
        {list}
      </nav>
    );
  }

  const next = steps[now + 1];
  return (
    <nav class={`steps steps--pinned${open ? ' steps--open' : ''}`} aria-label={title}>
      <button type="button" class="steps__bar" aria-expanded={open} aria-controls="steps-all" onClick={() => setOpen((o) => !o)}>
        <span class="steps__head">{head}</span>
        <span class="steps__meter" aria-hidden="true">
          {steps.map((name, i) => (
            <i key={`${i}-${name}`} class={`steps__seg steps__seg--${i < at ? 'done' : i === at ? 'now' : 'next'}`} />
          ))}
        </span>
        <span class="steps__line">
          <span class="steps__now">{steps[now]}</span>
          <span class="steps__next">{next ? t('common.stepNext', { name: next }) : t('common.stepLast')}</span>
        </span>
        <Icon name={open ? 'chevronUp' : 'chevronDown'} size={20} class="steps__chev" />
      </button>
      {list}
    </nav>
  );
}
