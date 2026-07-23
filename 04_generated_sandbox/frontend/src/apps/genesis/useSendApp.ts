import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isSignInRequired, narrow, type SbgError } from '../../lib/sbg';
import {
  clearDid,
  createConsumerClient,
  enroll,
  fetchPoints,
  fetchQuote,
  fetchTrack,
  handoffToRole,
  pinLogin,
  purgeConsumerTokens,
  readDid,
  readPhone,
  recentKeys,
  rememberKey,
  requestOtp,
  saveDid,
  savePhone,
  verifyOtp,
  type ConsumerClient,
} from './api';
import { cleanPhone, codeReady, normalizeKey, phoneReady } from './logic';
import type { AuthResult, MyParcels, NetworkPoint, ParcelSize, PersonRole, PersonView, QuoteView, SwitchResult, TrackView } from './types';

export type Screen = 'send' | 'track' | 'parcels' | 'account';
export type WizardStep = 'size' | 'from' | 'to' | 'quote';
/** The consumer sign-in flow: enroll walks phone → code → pin; login is phone + pin together. */
export type AuthMode = 'login' | 'enroll';
export type AuthStep = 'phone' | 'code' | 'pin';

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

  /* --- consumer identity (S20/S21) --- */
  identity: PersonView | null; // null = not signed in
  restoring: boolean; // a stored session is being silently restored on boot
  authMode: AuthMode;
  authStep: AuthStep;
  authPhone: string;
  authCode: string; // the 6-digit OTP
  authPin: string; // the 4-digit PIN
  authBusy: boolean;
  authError: SbgError | null;
  authDevCode: string | null; // sandbox convenience: the OTP echoed back, shown as a hint

  /* --- my parcels (the receiver/sender home) --- */
  parcels: MyParcels | null;
  parcelsState: 'idle' | 'loading' | 'ready' | 'error';
  parcelsError: SbgError | null;
  openParcelId: string | null; // detail view; the twin is read from the loaded list

  /* --- account / role switch --- */
  switchBusy: PersonRole | null;
  accountBusy: boolean;
  accountError: SbgError | null;
  accountNote: string | null;
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
  identity: null,
  restoring: false,
  authMode: 'login',
  authStep: 'phone',
  authPhone: '',
  authCode: '',
  authPin: '',
  authBusy: false,
  authError: null,
  authDevCode: null,
  parcels: null,
  parcelsState: 'idle',
  parcelsError: null,
  openParcelId: null,
  switchBusy: null,
  accountBusy: false,
  accountError: null,
  accountNote: null,
};

/**
 * The Send app's state. The anonymous half (send wizard + public track) is unchanged and never needs
 * an account. S21 layers the AUTHENTICATED consumer on top: a phone+PIN identity, a seeded bearer
 * session (per-personDid, sessionStorage), the receiver/sender "my parcels" home, and the role switcher.
 * Only the parcels/account surfaces are gated — Send and Track stay open to everyone (signed-off O1).
 */
export function useSendApp() {
  const [state, setState] = useState<SendState>(INITIAL);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  useEffect(() => {
    setState((s) => ({ ...s, recent: recentKeys(), authPhone: readPhone() ?? '' }));
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
    setState((s) => ({ ...INITIAL, screen: 'send', points: s.points, pointsState: s.pointsState, recent: s.recent, identity: s.identity, authPhone: s.authPhone }));
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

  /* -------------------------------------------------- consumer identity */

  const [did, setDid] = useState<string | null>(null);
  const client = useMemo<ConsumerClient | null>(() => (did ? createConsumerClient(did) : null), [did]);
  const parcelsEpoch = useRef(0);
  const authEpoch = useRef(0);

  const loadParcels = useCallback(async () => {
    if (!client) return;
    const epoch = ++parcelsEpoch.current;
    setState((s) => ({ ...s, parcelsState: 'loading', parcelsError: null }));
    const r = await client.api.myParcels();
    if (epoch !== parcelsEpoch.current) return;
    if (r.error) {
      if (isSignInRequired(r.error)) {
        signOutRef.current(r.error);
        return;
      }
      setState((s) => ({ ...s, parcelsState: 'error', parcelsError: r.error }));
      return;
    }
    setState((s) => ({ ...s, parcels: narrow<MyParcels>(r.data), parcelsState: 'ready' }));
  }, [client]);

  /**
   * Silent boot restore: prove the stored token still lives via me(). A real session end (mint-sourced
   * 401) signs out and surfaces the message; a TRANSIENT failure (offline/timeout/5xx) keeps the DID +
   * seeded token so a reload — or the online/visibility retry below — can restore. Never sign a
   * low-connectivity user out over a dropped connection (the reference agent's fail() draws the same line).
   */
  const restore = useCallback(async () => {
    if (!client) return;
    const r = await client.api.me();
    if (r.error) {
      if (isSignInRequired(r.error)) {
        signOutRef.current(r.error);
        return;
      }
      setState((s) => ({ ...s, restoring: false, parcelsError: r.error }));
      return;
    }
    setState((s) => ({ ...s, identity: narrow<PersonView>(r.data), restoring: false }));
    void loadParcels();
  }, [client, loadParcels]);

  useEffect(() => {
    const stored = readDid();
    if (stored) {
      setDid(stored);
      setState((s) => ({ ...s, restoring: true }));
    }
  }, []);

  useEffect(() => {
    if (did) purgeConsumerTokens(did);
    if (client && did) void restore();
  }, [client, did, restore]);

  // Recovery path after a transient boot failure: when the network or the tab comes back and we hold a
  // stored identity but no live session, re-run restore rather than stranding the user signed-out.
  useEffect(() => {
    const retry = () => {
      if (client && readDid() && !stateRef.current.identity && globalThis.document?.visibilityState !== 'hidden') void restore();
    };
    globalThis.addEventListener?.('online', retry);
    globalThis.document?.addEventListener?.('visibilitychange', retry);
    return () => {
      globalThis.removeEventListener?.('online', retry);
      globalThis.document?.removeEventListener?.('visibilitychange', retry);
    };
  }, [client, restore]);

  /* -------------------------------------------------- sign in / out */

  const completeSignIn = useCallback(async (data: AuthResult, phone: string) => {
    purgeConsumerTokens(null);
    saveDid(data.personId);
    savePhone(phone);
    const next = createConsumerClient(data.personId);
    await next.client.seed({ access_token: data.token.access_token, expires_in: data.token.expires_in ?? 3600 });
    setState((s) => ({
      ...s,
      identity: { personId: data.personId, roles: data.roles ?? [], hasPin: data.hasPin ?? true, createdAt: data.createdAt ?? '' },
      screen: 'parcels',
      authBusy: false,
      authError: null,
      authCode: '',
      authPin: '',
      authStep: 'phone',
      parcels: null,
      parcelsState: 'idle',
    }));
    setDid(data.personId); // triggers restore() → loadParcels()
  }, []);

  const setAuthPhone = useCallback((v: string) => setState((s) => ({ ...s, authPhone: v, authError: null })), []);
  const setAuthCode = useCallback((v: string) => setState((s) => ({ ...s, authCode: v, authError: null })), []);
  const setAuthPin = useCallback((v: string) => setState((s) => ({ ...s, authPin: v, authError: null })), []);
  // A navigation bumps the auth epoch so any in-flight request bails out instead of clobbering the step.
  const setAuthMode = useCallback((mode: AuthMode) => {
    authEpoch.current++;
    setState((s) => ({ ...s, authMode: mode, authStep: 'phone', authCode: '', authPin: '', authError: null }));
  }, []);
  // "Back" always returns to phone entry: the OTP is single-use (consumed on verify), so the code step is
  // never a valid place to return to — re-requesting a fresh code from phone entry is the only real path.
  const authBack = useCallback(() => {
    authEpoch.current++;
    setState((s) => ({ ...s, authStep: 'phone', authCode: '', authError: null }));
  }, []);

  const requestCode = useCallback(async () => {
    const phone = cleanPhone(stateRef.current.authPhone);
    if (!phoneReady(phone)) return;
    const epoch = ++authEpoch.current;
    setState((s) => ({ ...s, authBusy: true, authError: null }));
    const r = await requestOtp(phone);
    if (epoch !== authEpoch.current) return;
    if (r.error) {
      setState((s) => ({ ...s, authBusy: false, authError: r.error }));
      return;
    }
    setState((s) => ({ ...s, authBusy: false, authStep: 'code', authCode: '', authDevCode: r.data?.code ?? null }));
  }, []);

  const submitCode = useCallback(async () => {
    const phone = cleanPhone(stateRef.current.authPhone);
    const code = stateRef.current.authCode;
    if (!codeReady(code, 6)) return;
    const epoch = ++authEpoch.current;
    setState((s) => ({ ...s, authBusy: true, authError: null }));
    const r = await verifyOtp(phone, code);
    if (epoch !== authEpoch.current) return;
    if (r.error) {
      setState((s) => ({ ...s, authBusy: false, authError: r.error }));
      return;
    }
    // Clear the now-consumed code as we advance, so it can never be re-submitted (and rejected as stale).
    setState((s) => ({ ...s, authBusy: false, authStep: 'pin', authPin: '', authCode: '' }));
  }, []);

  const submitEnroll = useCallback(async () => {
    const phone = cleanPhone(stateRef.current.authPhone);
    const pin = stateRef.current.authPin;
    if (!codeReady(pin, 4)) return;
    const epoch = ++authEpoch.current;
    setState((s) => ({ ...s, authBusy: true, authError: null }));
    const r = await enroll(phone, pin);
    if (epoch !== authEpoch.current) return;
    if (r.error) {
      setState((s) => ({ ...s, authBusy: false, authError: r.error }));
      return;
    }
    await completeSignIn(r.data as AuthResult, phone);
  }, [completeSignIn]);

  const submitLogin = useCallback(async () => {
    const phone = cleanPhone(stateRef.current.authPhone);
    const pin = stateRef.current.authPin;
    if (!phoneReady(phone) || !codeReady(pin, 4)) return;
    const epoch = ++authEpoch.current;
    setState((s) => ({ ...s, authBusy: true, authError: null }));
    const r = await pinLogin(phone, pin);
    if (epoch !== authEpoch.current) return;
    if (r.error) {
      setState((s) => ({ ...s, authBusy: false, authError: r.error }));
      return;
    }
    await completeSignIn(r.data as AuthResult, phone);
  }, [completeSignIn]);

  const signOut = useCallback(
    (error: SbgError | null = null) => {
      client?.client.session.clear();
      purgeConsumerTokens(null);
      clearDid();
      setDid(null);
      setState((s) => ({
        ...s,
        identity: null,
        restoring: false,
        parcels: null,
        parcelsState: 'idle',
        openParcelId: null,
        screen: error ? s.screen : 'send',
        authMode: 'login',
        authStep: 'phone',
        authCode: '',
        authPin: '',
        authError: error,
      }));
    },
    [client],
  );
  const signOutRef = useRef(signOut);
  useEffect(() => {
    signOutRef.current = signOut;
  }, [signOut]);

  /* -------------------------------------------------- my parcels + account */

  const openParcel = useCallback((id: string) => setState((s) => ({ ...s, openParcelId: id })), []);
  const closeParcel = useCallback(() => setState((s) => ({ ...s, openParcelId: null })), []);

  const switchRole = useCallback(
    async (role: PersonRole) => {
      if (!client || role === 'consumer') return;
      setState((s) => ({ ...s, switchBusy: role, accountError: null }));
      const r = await client.api.switchRole(role);
      if (r.error) {
        setState((s) => ({ ...s, switchBusy: null, accountError: r.error }));
        return;
      }
      const sw = narrow<SwitchResult>(r.data);
      // Hand the actor token to the target app + navigate (page unloads). Vendor opens for its own sign-in.
      await handoffToRole(role, sw.entityDid, sw.token);
    },
    [client],
  );

  const changePin = useCallback(
    async (pin: string) => {
      if (!client || !codeReady(pin, 4)) return;
      setState((s) => ({ ...s, accountBusy: true, accountError: null, accountNote: null }));
      const r = await client.api.setPin(pin);
      if (r.error) {
        setState((s) => ({ ...s, accountBusy: false, accountError: r.error }));
        return;
      }
      setState((s) => ({ ...s, accountBusy: false, accountNote: 'PIN updated', identity: s.identity ? { ...s.identity, hasPin: true } : s.identity }));
    },
    [client],
  );

  /* ------------------------------------------------------------------- nav */

  const go = useCallback((screen: Screen) => {
    setState((s) => ({ ...s, screen, accountError: null, accountNote: null }));
  }, []);

  return {
    state,
    actions: {
      go,
      pickSize,
      pickFrom,
      pickTo,
      retryQuote,
      backTo,
      startAgain,
      loadPoints,
      runTrack,
      setKey,
      // identity
      setAuthPhone,
      setAuthCode,
      setAuthPin,
      setAuthMode,
      authBack,
      requestCode,
      submitCode,
      submitEnroll,
      submitLogin,
      signOut,
      // my parcels + account
      loadParcels,
      openParcel,
      closeParcel,
      switchRole,
      changePin,
    },
  };
}

export type SendActions = ReturnType<typeof useSendApp>['actions'];
