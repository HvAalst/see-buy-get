// StatusBadge — status as pictogram + word + color + SHAPE together (WS-UX).
// Never color alone: each tone has a distinct icon and a distinct outline shape,
// so colorblind and low-literacy users both get the meaning.

import { el } from './dom.js';

// Default vocabulary. Extend per-domain by passing a custom map to renderStatus.
export const STATUS_MAP = {
  verified: { label: 'Verified', icon: '✓', tone: 'success', shape: 'circle' },
  complete: { label: 'Done', icon: '✓', tone: 'success', shape: 'circle' },
  active: { label: 'In progress', icon: '●', tone: 'info', shape: 'pill' },
  pending: { label: 'Waiting', icon: '⏳', tone: 'warn', shape: 'diamond' },
  late: { label: 'Late', icon: '!', tone: 'warn', shape: 'diamond' },
  failed: { label: 'Problem', icon: '✕', tone: 'danger', shape: 'square' },
  held: { label: 'On hold', icon: '⛔', tone: 'danger', shape: 'square' },
};

/**
 * @param {string} statusKey
 * @param {object} [opts]  { map, labelOverride }
 */
export function StatusBadge(statusKey, { map = STATUS_MAP, labelOverride } = {}) {
  const def = map[statusKey] || { label: statusKey, icon: '•', tone: 'neutral', shape: 'pill' };
  const label = labelOverride || def.label;

  return el(
    'span',
    {
      className: `ws-badge ws-badge--${def.tone} ws-badge--${def.shape}`,
      attrs: { role: 'status' },
    },
    [
      el('span', { className: 'ws-badge__icon', attrs: { 'aria-hidden': 'true' }, text: def.icon }),
      el('span', { className: 'ws-badge__label', text: label }),
    ],
  );
}
