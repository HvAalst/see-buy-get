// PhotoCapture — "show, don't type" (WS-UX). Capture proof/documents with the
// camera instead of typing. Used for PoD (M4), bank micro-deposit read, documents.

import { el } from './dom.js';
import { BigButton } from './bigButton.js';

/**
 * @param {object} props
 * @param {string} [props.label]      Button text, e.g. "Take photo".
 * @param {(file: File, dataUrl: string) => void} [props.onCapture]
 */
export function PhotoCapture({ label = 'Take photo', onCapture } = {}) {
  const preview = el('img', { className: 'ws-photo__preview', attrs: { alt: '', hidden: 'hidden' } });

  const input = el('input', {
    className: 'ws-photo__input',
    attrs: { type: 'file', accept: 'image/*', capture: 'environment', 'aria-label': label },
  });

  input.addEventListener('change', () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      preview.src = String(reader.result);
      preview.alt = 'Photo you just took';
      preview.hidden = false;
      if (onCapture) onCapture(file, String(reader.result));
    };
    reader.readAsDataURL(file);
  });

  const trigger = BigButton({
    label,
    icon: '📷',
    variant: 'secondary',
    onClick: () => input.click(),
  });

  return el('div', { className: 'ws-photo' }, [trigger, input, preview]);
}
