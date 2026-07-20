// CardList — cards, not dense tables (WS-UX). Each row is a scannable card with a
// pictogram, plain title/subtitle, and an optional status badge.

import { el } from './dom.js';
import { StatusBadge } from './statusBadge.js';

/**
 * @param {object} props
 * @param {Array<{icon?:string, title:string, subtitle?:string, meta?:string, status?:string}>} props.items
 * @param {object} [props.statusMap]  Custom status vocabulary passed to StatusBadge.
 * @param {(item:object, index:number) => void} [props.onSelect]
 */
export function CardList({ items = [], statusMap, onSelect } = {}) {
  const cards = items.map((item, index) => {
    const children = [];
    if (item.icon) children.push(el('div', { className: 'ws-card__icon', attrs: { 'aria-hidden': 'true' }, text: item.icon }));

    const body = [el('div', { className: 'ws-card__title', text: item.title })];
    if (item.subtitle) body.push(el('div', { className: 'ws-card__subtitle', text: item.subtitle }));
    if (item.meta) body.push(el('div', { className: 'ws-card__meta', text: item.meta }));
    children.push(el('div', { className: 'ws-card__body' }, body));

    if (item.status) children.push(StatusBadge(item.status, { map: statusMap }));

    const interactive = Boolean(onSelect);
    return el(
      interactive ? 'button' : 'div',
      {
        className: `ws-card${interactive ? ' ws-card--button' : ''}`,
        ...(interactive ? { onClick: () => onSelect(item, index), attrs: { type: 'button' } } : {}),
      },
      children,
    );
  });

  return el('div', { className: 'ws-cardlist', attrs: { role: 'list' } }, cards);
}
