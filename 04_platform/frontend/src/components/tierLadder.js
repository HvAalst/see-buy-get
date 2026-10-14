// TierLadder — the identity tier shown as a visual ladder (T-108, M1-U4).
// Each rung pairs an icon + plain words for what it unlocks, so a low-literacy user
// can see where they are and what the next step gives them. Reached rungs are checked.

import { el } from './dom.js';

export const DEFAULT_TIERS = [
  { tier: 1, label: 'Browser', unlocks: 'Track & send small parcels', icon: '📱' },
  { tier: 2, label: 'Verified you', unlocks: 'Deliver as a courier', icon: '🪪' },
  { tier: 3, label: 'Verified business', unlocks: 'Freight & developer access', icon: '🏢' },
  { tier: 4, label: 'Certified operator', unlocks: 'Dangerous goods & audits', icon: '🛡️' },
];

/**
 * @param {object} props
 * @param {number} props.currentTier
 * @param {Array<{tier:number,label:string,unlocks:string,icon:string}>} [props.tiers]
 */
export function TierLadder({ currentTier = 1, tiers = DEFAULT_TIERS } = {}) {
  const rungs = tiers.map((t) => {
    let state = 'upcoming';
    if (t.tier < currentTier) state = 'done';
    else if (t.tier === currentTier) state = 'current';

    const marker = el('span', {
      className: 'ws-rung__marker',
      attrs: { 'aria-hidden': 'true' },
      text: state === 'done' ? '✓' : String(t.tier),
    });
    const body = el('div', { className: 'ws-rung__body' }, [
      el('div', { className: 'ws-rung__label' }, [
        el('span', { className: 'ws-rung__icon', attrs: { 'aria-hidden': 'true' }, text: t.icon }),
        el('span', { text: ` ${t.label}` }),
      ]),
      el('div', { className: 'ws-rung__unlocks', text: t.unlocks }),
    ]);

    return el(
      'li',
      {
        className: `ws-rung ws-rung--${state}`,
        attrs: { 'aria-current': state === 'current' ? 'step' : null },
      },
      [marker, body],
    );
  });

  return el(
    'ol',
    { className: 'ws-ladder', attrs: { 'aria-label': `You are at tier ${currentTier} of ${tiers.length}` } },
    rungs,
  );
}
