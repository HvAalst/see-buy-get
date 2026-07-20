// AmountHero — money shown large and concrete (WS-UX). The payout/amount is the
// hero element on wallet and courier-task screens; real currency symbol, big type.

import { el } from './dom.js';

/**
 * @param {object} props
 * @param {number} props.amount
 * @param {string} [props.currency]   ISO 4217 (default USD).
 * @param {string} [props.caption]    Plain label under the amount, e.g. "You earn".
 * @param {string} [props.locale]
 */
export function AmountHero({ amount = 0, currency = 'USD', caption, locale } = {}) {
  const resolvedLocale = locale || document.documentElement.lang || 'en';
  let formatted;
  try {
    formatted = new Intl.NumberFormat(resolvedLocale, { style: 'currency', currency }).format(amount);
  } catch {
    formatted = `${currency} ${amount.toFixed(2)}`;
  }

  const children = [];
  if (caption) children.push(el('div', { className: 'ws-amount__caption', text: caption }));
  children.push(
    el('div', {
      className: 'ws-amount__value',
      attrs: { 'aria-label': `${caption ? caption + ': ' : ''}${formatted}` },
      text: formatted,
    }),
  );

  return el('div', { className: 'ws-amount' }, children);
}
