import { makeConfig, publicRequest, type Result, type SbgConfig } from '../../lib/sbg';
import type { NetworkPoint, ParcelSize, QuoteView, TrackView } from './types';

const APP_VERSION = '1.0.0';

/**
 * The Send app is the ANONYMOUS surface of the network: every endpoint it touches is
 * @Public (S13), so there is no session, no token, no sign-in — the whole api layer is
 * four typed public requests through the shared timeout/envelope machinery. The tracking
 * KEY is the only credential this app ever holds.
 */
export function sendConfig(): SbgConfig {
  return makeConfig('genesis', APP_VERSION);
}

export function fetchPoints(): Promise<Result<NetworkPoint[]>> {
  return publicRequest<NetworkPoint[]>(sendConfig(), '/v1/sbg/network/points');
}

export function fetchQuote(originDid: string, destDid: string, size: ParcelSize): Promise<Result<QuoteView>> {
  const q = new URLSearchParams({ origin: originDid, dest: destDid, size });
  return publicRequest<QuoteView>(sendConfig(), `/v1/sbg/quote?${q.toString()}`);
}

export function fetchTrack(key: string): Promise<Result<TrackView>> {
  return publicRequest<TrackView>(sendConfig(), `/v1/sbg/track/${encodeURIComponent(key)}`);
}

/* ------------------------------------------------------------ recent keys -- */

/**
 * The GET half of See-Buy-Get on a phone that loses its SMS thread: the last few tracking
 * keys this device looked up, newest first, so "where is my parcel" is one tap. Keys only —
 * no PII lives here, and the key is already the bearer credential for the public track view.
 */
const RECENT_KEY = 'glos-send-recent';
const RECENT_MAX = 5;

export function recentKeys(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberKey(key: string): string[] {
  const next = [key, ...recentKeys().filter((k) => k !== key)].slice(0, RECENT_MAX);
  try {
    globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — recall just won't survive a cold start */
  }
  return next;
}
