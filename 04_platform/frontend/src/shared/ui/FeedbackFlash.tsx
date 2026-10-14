import { useEffect, useRef, useState } from 'preact/hooks';
import { onFlash, type Signal } from '../feedback';

/**
 * The screen-flash channel of the loud-feedback trio. Mounted once per app (beside the
 * toast host); it subscribes to `signal()` and washes the viewport green/navy/red for a
 * beat — the channel that reaches a deaf worker, or a phone face-down on a counter with
 * the ringer off.
 *
 * Two safety choices:
 *  - It clears on a TIMER, not on animationend. Under prefers-reduced-motion the global
 *    animation reset in tokens.css kills the keyframes, so animationend would never fire
 *    and a full-colour overlay would stick on screen forever.
 *  - It renders NOTHING under reduced-motion. A person who turned motion off may have done
 *    so for photosensitivity, and a screen flash is exactly what they are avoiding — the
 *    beep and the vibration still carry the signal for them.
 */
export function FeedbackFlash() {
  const [flash, setFlash] = useState<{ id: number; signal: Signal } | null>(null);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => {
    const reduce =
      typeof window !== 'undefined' && typeof window.matchMedia === 'function'
        ? window.matchMedia('(prefers-reduced-motion: reduce)')
        : null;

    const off = onFlash((sig) => {
      if (reduce?.matches) return; // beep + vibrate cover it; no flash for this cohort
      setFlash((prev) => ({ id: (prev?.id ?? 0) + 1, signal: sig }));
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setFlash(null), 460);
    });

    return () => {
      off();
      window.clearTimeout(timer.current);
    };
  }, []);

  if (!flash) return null;
  return <div key={flash.id} class={`flash flash--${flash.signal}`} aria-hidden="true" />;
}
