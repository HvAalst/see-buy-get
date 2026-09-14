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
}

const state: Connectivity = { online: true, offlineSince: null, lastAnswerAt: null };
const listeners = new Set<() => void>();

function announce(): void {
  for (const l of listeners) l();
}

/** The browser's own word: the radio is off. The one case where a failure can honestly be called "you are offline". */
export function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

function recompute(): void {
  const online = !isBrowserOffline() && state.offlineSince === null;
  if (online !== state.online) {
    state.online = online;
    announce();
  }
}

/** A request could not leave the phone. */
export function markOffline(now: number = Date.now()): void {
  if (state.offlineSince === null) state.offlineSince = new Date(now).toISOString();
  recompute();
}

/** A real answer came back — whatever the browser thinks, the network is carrying. */
export function markOnline(now: number = Date.now()): void {
  state.lastAnswerAt = new Date(now).toISOString();
  const was = state.offlineSince;
  state.offlineSince = null;
  recompute();
  if (was !== null && state.online) announce(); // the banner reads lastAnswerAt too
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
  state.online = true;
  state.offlineSince = null;
  state.lastAnswerAt = null;
}

if (typeof addEventListener === 'function') {
  addEventListener('online', () => recompute());
  addEventListener('offline', () => markOffline());
}

/** Re-render when the signal comes or goes. */
export function useConnectivity(): Connectivity {
  const [snap, setSnap] = useState<Connectivity>(() => connectivity());
  useEffect(() => onConnectivityChange(() => setSnap(connectivity())), []);
  return snap;
}
