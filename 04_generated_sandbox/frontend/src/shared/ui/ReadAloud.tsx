import { useEffect, useState } from 'preact/hooks';
import { Icon } from './Icon';

export interface ReadAloudProps {
  /**
   * A GETTER, not a string. The screen summary must reflect state at the moment of the tap
   * (capacity changes while the button sits there), which is why the legacy component took a
   * closure too — a captured string would speak yesterday's number.
   */
  text: () => string;
  label?: string;
}

export function isSpeechSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';
}

export function speak(text: string): void {
  if (!isSpeechSupported() || !text) return;
  const synth = window.speechSynthesis;
  synth.cancel(); // never queue — the newest utterance is the only relevant one
  const u = new SpeechSynthesisUtterance(text);
  u.lang = document.documentElement.lang || 'en';
  u.rate = 0.95; // slightly slower aids comprehension
  synth.speak(u);
}

export function stopSpeaking(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) window.speechSynthesis.cancel();
}

/**
 * Tap to hear the screen. Second tap stops. Where the Web Speech API is missing the control
 * is not rendered at all — a dead speaker button teaches a non-reader that the app lies.
 */
export function ReadAloud({ text, label = 'Read this screen aloud' }: ReadAloudProps) {
  const [supported] = useState(isSpeechSupported);
  const [speaking, setSpeaking] = useState(false);

  useEffect(() => () => stopSpeaking(), []);

  if (!supported) return null;

  const toggle = () => {
    if (speaking) {
      stopSpeaking();
      setSpeaking(false);
      return;
    }
    const value = text();
    speak(value);
    setSpeaking(true);
    // The utterance object is transient; poll the synth so the control resets itself when
    // the sentence finishes (onend does not fire reliably on Android WebView).
    const t = window.setInterval(() => {
      if (!window.speechSynthesis.speaking) {
        window.clearInterval(t);
        setSpeaking(false);
      }
    }, 400);
  };

  return (
    <button
      type="button"
      class={`readaloud${speaking ? ' readaloud--on' : ''}`}
      onClick={toggle}
      aria-pressed={speaking}
    >
      <Icon name={speaking ? 'speakerOff' : 'speaker'} size={22} class="readaloud__ic" />
      <span>{speaking ? 'Stop' : label}</span>
    </button>
  );
}
