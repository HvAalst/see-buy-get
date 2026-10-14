// Read-aloud (text-to-speech) support for low-literacy users (WS-UX).
// Wraps the Web Speech API with a graceful no-op fallback where unsupported.

import { el } from './dom.js';

const synth = typeof window !== 'undefined' ? window.speechSynthesis : null;

export function isSpeechSupported() {
  return Boolean(synth && typeof window.SpeechSynthesisUtterance === 'function');
}

export function speak(text, { lang = document.documentElement.lang || 'en' } = {}) {
  if (!isSpeechSupported() || !text) return;
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(String(text));
  utterance.lang = lang;
  utterance.rate = 0.95; // slightly slower aids comprehension
  synth.speak(utterance);
}

export function stopSpeaking() {
  if (synth) synth.cancel();
}

/**
 * ReadAloud — a tap-to-listen button. Pairs with any text-bearing screen.
 * @param {string|() => string} textOrFn  Text to speak (or a getter for dynamic text).
 * @param {object} [opts]  { label }
 */
export function ReadAloud(textOrFn, { label = 'Listen' } = {}) {
  const getText = typeof textOrFn === 'function' ? textOrFn : () => textOrFn;
  let speaking = false;

  const button = el(
    'button',
    {
      className: 'ws-readaloud',
      attrs: { type: 'button', 'aria-label': label, title: label },
      onClick: () => {
        if (speaking) {
          stopSpeaking();
          speaking = false;
        } else {
          speak(getText());
          speaking = true;
        }
        button.classList.toggle('is-speaking', speaking);
      },
    },
    [el('span', { className: 'ws-readaloud__icon', attrs: { 'aria-hidden': 'true' }, text: '🔊' }), el('span', { className: 'ws-readaloud__label', text: label })],
  );

  if (!isSpeechSupported()) button.hidden = true; // hide rather than show a dead control
  return button;
}
