// StepProgress — numbered wizard progress for one-task-per-screen flows (WS-UX).
// Conveys position by number + check + color + label (not color alone).

import { el } from './dom.js';

/**
 * @param {object} props
 * @param {Array<{label:string}>|string[]} props.steps
 * @param {number} props.currentIndex  Zero-based index of the active step.
 */
export function StepProgress({ steps = [], currentIndex = 0 } = {}) {
  const items = steps.map((step, i) => {
    const label = typeof step === 'string' ? step : step.label;
    let state = 'upcoming';
    if (i < currentIndex) state = 'done';
    else if (i === currentIndex) state = 'current';

    const marker = el('span', {
      className: 'ws-step__marker',
      attrs: { 'aria-hidden': 'true' },
      text: state === 'done' ? '✓' : String(i + 1),
    });

    return el(
      'li',
      {
        className: `ws-step ws-step--${state}`,
        attrs: { 'aria-current': state === 'current' ? 'step' : null },
      },
      [marker, el('span', { className: 'ws-step__label', text: label })],
    );
  });

  const total = steps.length;
  return el(
    'ol',
    {
      className: 'ws-steps',
      attrs: { 'aria-label': `Step ${currentIndex + 1} of ${total}` },
    },
    items,
  );
}
