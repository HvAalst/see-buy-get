import { useEffect, useState } from 'preact/hooks';

/**
 * ONE ANSWER TO "DO WE HAVE A SIGNAL?", fed by the two parties that know.
 *
 * The browser knows when the radio is formally off (`navigator.onLine`, the `online`/`offline` events). It does not
 * know when the radio is on and carrying nothing, which is what a bad signal actually looks like here — so the
 * client also reports here: a request that could not leave the phone marks us offline, and any real answer from
 * the server marks us back. Every app reads this one store, so "No signal" means the same thing on every screen.
 */
export interface Connectivity {
  online: boolean;
  /** When the signal was last known to be gone; null while it is not. */
  offlineSince: string | null;
  /** The last moment a real answer came back from the server — what "what we last knew" is dated from. */
  lastAnswerAt: string | null;
  /** The last spell without a signal, once it is over: from the first failure to the first answer after it. */
  lastDarkSpell: { from: string; to: string } | null;
}

const state: Connectivity = { online: true, offlineSince: null, lastAnswerAt: null, lastDarkSpell: null };
/** Whether the spell out of reach now began with the browser saying the radio went off, rather than a request failing. */
let browserSpell = false;
const listeners = new Set<() => void>();

function announce(): void {
  for (const l of listeners) l();
}

/** The browser's own word: the radio is off. The one case where a failure can honestly be called "you are offline". */
export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Re-derive `online`; true when it changed (and listeners were told). */
function recompute(): boolean {
  const online = !isBrowserOffline() && state.offlineSince === null;
  if (online === state.online) return false;
  state.online = online;
  announce();
  return true;
}

/** A request could not leave the phone. */
export function markOffline(now: number = Date.now()): void {
  if (state.offlineSince === null) state.offlineSince = new Date(now).toISOString();
  recompute();
}

/** A real answer came back — whatever the browser thinks, the network is carrying. */
export function markOnline(now: number = Date.now()): void {
  browserSpell = false;
  state.lastAnswerAt = new Date(now).toISOString();
  const was = state.offlineSince;
  state.offlineSince = null;
  if (was !== null) state.lastDarkSpell = { from: was, to: state.lastAnswerAt };
  // Told once: either the flag flipped (recompute said so) or a spell ended with the browser still claiming offline.
  if (!recompute() && was !== null) announce();
}

export function connectivity(): Connectivity {
  return { ...state };
}

/** Is a connection missing RIGHT NOW, as best we know? Used to word a failure honestly. */
export function isOfflineNow(): boolean {
  return isBrowserOffline() || state.offlineSince !== null;
}

export function onConnectivityChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Test seam. */
export function resetConnectivity(): void {
  browserSpell = false;
  state.online = true;
  state.offlineSince = null;
  state.lastAnswerAt = null;
  state.lastDarkSpell = null;
}

/** The browser says the radio went off. */
export function browserWentOffline(now: number = Date.now()): void {
  if (state.offlineSince === null) browserSpell = true;
  markOffline(now);
}

/**
 * The browser says the radio is back. A spell that began with the browser's own word ends with it — a screen that makes
 * no request (signing in) must not go on saying there is no signal. One that began with a request failing waits for a
 * real answer: a radio that is on can still carry nothing, which is what a bad signal looks like here.
 */
export function browserCameOnline(now: number = Date.now()): void {
  if (browserSpell && state.offlineSince !== null) {
    const from = state.offlineSince;
    state.offlineSince = null;
    state.lastDarkSpell = { from, to: new Date(now).toISOString() };
    browserSpell = false;
  }
  if (!recompute()) announce();
}

if (typeof addEventListener === 'function') {
  addEventListener('online', () => browserCameOnline());
  addEventListener('offline', () => browserWentOffline());
}

// Opened with the radio off: said from the first screen, not only once a first request has failed (a sign-in screen
// makes none before the person types).
if (isBrowserOffline()) browserWentOffline();

/** Re-render when the signal comes or goes. */
export function useConnectivity(): Connectivity {
  const [snap, setSnap] = useState<Connectivity>(() => connectivity());
  useEffect(() => onConnectivityChange(() => setSnap(connectivity())), []);
  return snap;
}
