import { useT } from '../i18n';

export interface StepListProps {
  /** What is being done, in words: "Signing up as a sort hub". */
  title: string;
  /** Every step, in order, by its name. */
  steps: string[];
  /** The step now, counted from 0. */
  at: number;
}

/**
 * WHERE YOU ARE, AND WHAT COMES NEXT (the owner, 2026-11-01: "an indicator of the steps and how far you are in the sign up
 * process can be more clear. now it shows a couple of dots but you don't read what is gonna come next"). Every step by
 * name: ticked when done, marked now, the rest still to come — read in order by a screen reader, the step now marked
 * as the current one.
 */
export function StepList({ title, steps, at }: StepListProps) {
  const t = useT();
  return (
    <nav class="steps" aria-label={title}>
      <p class="steps__head">
        <b>{title}</b> · {t('common.stepOf', { at: Math.min(at + 1, steps.length), total: steps.length })}
      </p>
      <ol class="steps__list">
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
    </nav>
  );
}
