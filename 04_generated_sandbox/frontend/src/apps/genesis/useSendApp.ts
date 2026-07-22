import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { SbgError } from '../../lib/sbg';
import { fetchPoints, fetchQuote, fetchTrack, recentKeys, rememberKey } from './api';
import { normalizeKey } from './logic';
import type { NetworkPoint, ParcelSize, QuoteView, TrackView } from './types';

export type Screen = 'send' | 'track';
export type WizardStep = 'size' | 'from' | 'to' | 'quote';

export interface SendState {
  screen: Screen;

  /* --- the send wizard, one decision per step --- */
  step: WizardStep;
  size: ParcelSize | null;
  fromDid: string | null;
  toDid: string | null;
  points: NetworkPoint[];
  pointsState: 'idle' | 'loading' | 'ready' | 'error';
  pointsError: SbgError | null;
  quote: QuoteView | null;
  quoteState: 'idle' | 'loading' | 'ready' | 'error';
  quoteError: SbgError | null;

  /* --- track --- */
  key: string;
  result: TrackView | null;
  trackState: 'idle' | 'loading' | 'ready' | 'error';
  trackError: SbgError | null;
  recent: string[];
}

const INITIAL: SendState = {
  screen: 'send',
  step: 'size',
  size: null,
  fromDid: null,
  toDid: null,
  points: [],
  pointsState: 'idle',
  pointsError: null,
  quote: null,
  quoteState: 'idle',
  quoteError: null,
  key: '',
  result: null,
  trackState: 'idle',
  trackError: null,
  recent: [],
};

/**
 * The Send app's state — deliberately simpler than the signed-in apps: no phases, no
 * session, no toasts. Every surface is a public GET, every failure renders inline next
 * to its retry, and the only thing that persists is the recent-keys list.
 */
export function useSendApp() {
  const [state, setState] = useState<SendState>(INITIAL);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  useEffect(() => {
    setState((s) => ({ ...s, recent: recentKeys() }));
  }, []);

  /* ----------------------------------------------------------------- points */

  const pointsEpoch = useRef(0);

  const loadPoints = useCallback(async () => {
    const epoch = ++pointsEpoch.current;
    setState((s) => ({ ...s, pointsState: 'loading', pointsError: null }));
    const r = await fetchPoints();
    if (epoch !== pointsEpoch.current) return;
    if (r.error) {
      setState((s) => ({ ...s, pointsState: 'error', pointsError: r.error }));
      return;
    }
    setState((s) => ({ ...s, points: r.data ?? [], pointsState: 'ready' }));
  }, []);

  /* ----------------------------------------------------------------- wizard */

  const pickSize = useCallback(
    (size: ParcelSize) => {
      setState((s) => ({ ...s, size, step: 'from' }));
      if (stateRef.current.pointsState === 'idle' || stateRef.current.pointsState === 'error') void loadPoints();
    },
    [loadPoints],
  );

  const quoteEpoch = useRef(0);

  const runQuote = useCallback(async (fromDid: string, toDid: string, size: ParcelSize) => {
    const epoch = ++quoteEpoch.current;
    setState((s) => ({ ...s, step: 'quote', quote: null, quoteState: 'loading', quoteError: null }));
    const r = await fetchQuote(fromDid, toDid, size);
    if (epoch !== quoteEpoch.current) return;
    if (r.error) {
      setState((s) => ({ ...s, quoteState: 'error', quoteError: r.error }));
      return;
    }
    setState((s) => ({ ...s, quote: r.data, quoteState: 'ready' }));
  }, []);

  const pickFrom = useCallback((did: string) => {
    setState((s) => ({ ...s, fromDid: did, step: 'to', toDid: s.toDid === did ? null : s.toDid }));
  }, []);

  const pickTo = useCallback(
    (did: string) => {
      setState((s) => ({ ...s, toDid: did }));
      const { fromDid, size } = stateRef.current;
      if (fromDid && size) void runQuote(fromDid, did, size);
    },
    [runQuote],
  );

  const retryQuote = useCallback(() => {
    const { fromDid, toDid, size } = stateRef.current;
    if (fromDid && toDid && size) void runQuote(fromDid, toDid, size);
  }, [runQuote]);

  const backTo = useCallback((step: WizardStep) => {
    setState((s) => ({ ...s, step, quoteState: step === 'quote' ? s.quoteState : 'idle', quote: step === 'quote' ? s.quote : null }));
  }, []);

  const startAgain = useCallback(() => {
    setState((s) => ({ ...INITIAL, screen: 'send', points: s.points, pointsState: s.pointsState, recent: s.recent }));
  }, []);

  /* ------------------------------------------------------------------ track */

  const trackEpoch = useRef(0);

  const runTrack = useCallback(async (rawKey?: string) => {
    const key = normalizeKey(rawKey ?? stateRef.current.key);
    if (!key) return;
    const epoch = ++trackEpoch.current;
    setState((s) => ({ ...s, key, screen: 'track', trackState: 'loading', trackError: null }));
    const r = await fetchTrack(key);
    if (epoch !== trackEpoch.current) return;
    if (r.error) {
      setState((s) => ({ ...s, trackState: 'error', trackError: r.error, result: null }));
      return;
    }
    setState((s) => ({ ...s, result: r.data, trackState: 'ready', recent: rememberKey(key) }));
  }, []);

  const setKey = useCallback((key: string) => {
    setState((s) => ({ ...s, key }));
  }, []);

  /* ------------------------------------------------------------------- nav */

  const go = useCallback((screen: Screen) => {
    setState((s) => ({ ...s, screen }));
  }, []);

  return {
    state,
    actions: { go, pickSize, pickFrom, pickTo, retryQuote, backTo, startAgain, loadPoints, runTrack, setKey },
  };
}

export type SendActions = ReturnType<typeof useSendApp>['actions'];
