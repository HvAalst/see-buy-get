// BigButton — one large, high-contrast action per screen (WS-UX).
// Large tap target (>=56px), icon + word, clear primary/secondary variants.

import { el } from './dom.js';

/**
 * @param {object} props
 * @param {string} props.label        Visible text (also the accessible name).
 * @param {() => void} props.onClick
 * @param {'primary'|'secondary'} [props.variant]
 * @param {string} [props.icon]       Optional leading pictogram.
 * @param {boolean} [props.fullWidth]
 * @param {boolean} [props.disabled]
 * @param {string} [props.ariaLabel]  Override accessible name if label is not enough.
 */
export function BigButton({ label, onClick, variant = 'primary', icon, fullWidth = true, disabled = false, ariaLabel } = {}) {
  const children = [];
  if (icon) children.push(el('span', { className: 'ws-bigbtn__icon', attrs: { 'aria-hidden': 'true' }, text: icon }));
  children.push(el('span', { className: 'ws-bigbtn__label', text: label }));

  return el(
    'button',
    {
      className: `ws-bigbtn ws-bigbtn--${variant}${fullWidth ? ' ws-bigbtn--full' : ''}`,
      onClick: disabled ? undefined : onClick,
      attrs: { type: 'button', 'aria-label': ariaLabel || label, ...(disabled ? { disabled: 'disabled', 'aria-disabled': 'true' } : {}) },
    },
    children,
  );
}
