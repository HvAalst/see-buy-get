/**
 * Loud feedback — the compendium's "beep + vibrate + colour flash on every scan"
 * (Ch 15: "Green beep on match; red on mismatch"). Three channels fire together so the
 * signal lands whatever the environment takes from you: a beep for a noisy shop where the
 * screen is glared out, a vibration for a loud market where the beep is lost, and a screen
 * flash for a deaf worker or a phone on silent. No two participants lose the same channel.
 *
 * Split into a PURE core (the tone/vibration specs, and a flash pub/sub) that is unit
 * tested, and thin side-effecting emitters guarded for every environment — a $40 Android
 * with no vibrator, an iOS Safari with a suspended AudioContext, a test runner with
 * neither. A feedback call must NEVER throw into the caller: it runs inside a barcode
 * detection loop and a mis-fire there would wedge scanning.
 */

export type Signal = 'ok' | 'warn' | 'error';

/* -------------------------------------------------------------------- tone -- */

export interface Tone {
  /** Hz. */
  freq: number;
  /** Milliseconds. */
  ms: number;
  /** Gap before the NEXT tone in a sequence, ms. */
  gap: number;
}

/**
 * The sound of each signal, as a short sequence.
 *  - ok    — one clean high note: "yes".
 *  - warn  — a single mid note: "noted, nothing to do".
 *  - error — two low notes: a human "uh-uh".
 * Kept well inside a phone-speaker's honest range (400–1000 Hz) so a cheap driver doesn't
 * turn a 1500 Hz "beep" into a rattle.
 */
export function toneFor(signal: Signal): Tone[] {
  switch (signal) {
    case 'ok':
      return [{ freq: 880, ms: 110, gap: 0 }];
    case 'warn':
      return [{ freq: 560, ms: 130, gap: 0 }];
    case 'error':
      return [
        { freq: 300, ms: 130, gap: 70 },
        { freq: 240, ms: 170, gap: 0 },
      ];
  }
}

/** The buzz of each signal, as a navigator.vibrate pattern (ms on/off). */
export function vibrationFor(signal: Signal): number[] {
  switch (signal) {
    case 'ok':
      return [45];
    case 'warn':
      return [30, 40, 30];
    case 'error':
      return [120, 70, 120];
  }
}

/* ------------------------------------------------------------------- audio -- */

type WebAudioCtor = typeof AudioContext;

function audioCtor(): WebAudioCtor | undefined {
  if (typeof window === 'undefined') return undefined;
  const w = window as unknown as { AudioContext?: WebAudioCtor; webkitAudioContext?: WebAudioCtor };
  return w.AudioContext ?? w.webkitAudioContext;
}

let ctx: AudioContext | null = null;

/**
 * Create/resume the AudioContext from inside a user gesture.
 *
 * WebAudio starts SUSPENDED until a gesture resumes it, and a scan's beep fires from an
 * async detection callback that is no longer "a gesture". So the moment a worker taps
 * "Scan" (which IS a gesture) we prime the context here; by the time a code is decoded it
 * is already running and the beep is heard. Idempotent and swallow-all — a browser that
 * refuses audio must not break the tap that opened the camera.
 */
export function primeAudio(): void {
  try {
    const Ctor = audioCtor();
    if (!Ctor) return;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* audio unavailable — the vibration and the flash still carry the signal */
  }
}

/** Play a signal's tone sequence. A no-op wherever WebAudio is absent or blocked. */
export function beep(signal: Signal): void {
  try {
    const Ctor = audioCtor();
    if (!Ctor) return;
    if (!ctx) ctx = new Ctor();
    if (ctx.state === 'suspended') void ctx.resume();
    const c = ctx;
    let at = c.currentTime;
    for (const tone of toneFor(signal)) {
      const osc = c.createOscillator();
      const gain = c.createGain();
      osc.type = 'sine';
      osc.frequency.value = tone.freq;
      const dur = tone.ms / 1000;
      // A 6 ms attack and a 24 ms release keep it a beep, not a click (a hard edge on a
      // square-ish envelope pops on small speakers).
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.22, at + 0.006);
      gain.gain.setValueAtTime(0.22, at + Math.max(0.006, dur - 0.024));
      gain.gain.exponentialRampToValueAtTime(0.0001, at + dur);
      osc.connect(gain).connect(c.destination);
      osc.start(at);
      osc.stop(at + dur + 0.02);
      at += dur + tone.gap / 1000;
    }
  } catch {
    /* never let audio throw into a detection loop */
  }
}

/* ------------------------------------------------------------------ vibrate -- */

/** Vibrate the signal's pattern. A no-op wherever the Vibration API is absent. */
export function buzz(signal: Signal): void {
  try {
    if (typeof navigator === 'undefined') return;
    navigator.vibrate?.(vibrationFor(signal));
  } catch {
    /* unsupported */
  }
}

/* ------------------------------------------------------------------- flash -- */

type FlashListener = (signal: Signal) => void;
const flashListeners = new Set<FlashListener>();

/** Subscribe a flash host to signals; returns an unsubscribe. */
export function onFlash(fn: FlashListener): () => void {
  flashListeners.add(fn);
  return () => flashListeners.delete(fn);
}

function emitFlash(signal: Signal): void {
  for (const fn of flashListeners) {
    try {
      fn(signal);
    } catch {
      /* one bad host must not stop the others */
    }
  }
}

/* ------------------------------------------------------------------ signal -- */

/**
 * Fire all three channels for a signal. This is what a scan, a mismatch, or a completed
 * void calls. Every channel is independently guarded, so a phone missing two of them still
 * gets the third.
 */
export function signal(sig: Signal): void {
  beep(sig);
  buzz(sig);
  emitFlash(sig);
}
