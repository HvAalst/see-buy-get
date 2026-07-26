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
  previewInvite,
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
import { pickPhoneFromContacts, readSmsOtp, shareLink } from '../../shared/device';
import { cleanPhone, codeReady, normalizeKey, phoneReady } from './logic';
import type { AuthResult, ConsumerParcelView, InviteSummary, InviteView, MyParcels, NetworkPoint, ParcelSize, PersonRole, PersonView, QuoteView, SwitchResult, TrackView } from './types';

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
  openParcelId: string | null; // detail view
  openParcelDetail: ConsumerParcelView | null; // the single-parcel twin (carries the S22 collect token)
  openParcelState: 'idle' | 'loading' | 'ready' | 'error';
  openParcelError: SbgError | null;
  podBusy: boolean; // S23: attaching the delivered-state photo
  disputeBusy: boolean; // S23: filing a dispute
  disputeError: SbgError | null;

  /* --- account / role switch --- */
  switchBusy: PersonRole | null;
  accountBusy: boolean;
  accountError: SbgError | null;
  accountNote: string | null;

  /* --- invites (S24) --- */
  invites: InviteSummary | null;
  invitesState: 'idle' | 'loading' | 'ready' | 'error';
  inviteBusy: boolean;
  inviteNote: string | null; // "Invite sent" / "Link copied" feedback
  inviteToken: string | null; // captured from a ?invite= landing
  invited: boolean; // the landing token validated → show the welcome
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
  openParcelDetail: null,
  openParcelState: 'idle',
  openParcelError: null,
  podBusy: false,
  disputeBusy: false,
  disputeError: null,
  switchBusy: null,
  accountBusy: false,
  accountError: null,
  accountNote: null,
  invites: null,
  invitesState: 'idle',
  inviteBusy: false,
  inviteNote: null,
  inviteToken: null,
  invited: false,
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

  // S24: opened via an invite link (/send/?invite=<token>). A device that already holds a session is a
  // member — the invite is a no-op for them, so we leave their restore alone (readDid is sync, so this is
  // race-safe against the async session restore). For a fresh device we validate the token and welcome the
  // newcomer straight into the enrol flow. A TRANSIENT preview failure keeps the token (enrol accept is
  // best-effort anyway); only a definitive "invalid" drops it.
  useEffect(() => {
    const token = new URLSearchParams(globalThis.location?.search ?? '').get('invite');
    if (!token || readDid()) return;
    setState((s) => ({ ...s, inviteToken: token }));
    void previewInvite(token).then((r) => {
      if (r.data?.valid) setState((s) => ({ ...s, screen: 'account', authMode: 'enroll', invited: true }));
      else if (r.data && !r.data.valid) setState((s) => ({ ...s, inviteToken: null }));
    });
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
      inviteToken: null, // the invite (if any) was credited on the server at enrol; done with it now
      invited: false,
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

  const submitCode = useCallback(async (codeOverride?: string) => {
    const phone = cleanPhone(stateRef.current.authPhone);
    const code = codeOverride ?? stateRef.current.authCode;
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
    const r = await enroll(phone, pin, stateRef.current.inviteToken ?? undefined);
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

  // WebOTP (mobile): on the enroll code step, auto-read the SMS one-time code on Android and submit it.
  // Feature-detected + aborted when the user leaves the step; the manual CodeBoxes is always the fallback.
  useEffect(() => {
    if (state.authStep !== 'code' || state.authMode !== 'enroll') return;
    const ac = new AbortController();
    void readSmsOtp(ac.signal).then((code) => {
      if (!code || ac.signal.aborted) return;
      setAuthCode(code);
      void submitCode(code);
    });
    return () => ac.abort();
  }, [state.authStep, state.authMode, setAuthCode, submitCode]);

  /** Confirm the number by picking it from the address book (Android Contact Picker) instead of typing. */
  const pickContact = useCallback(async () => {
    const tel = await pickPhoneFromContacts();
    if (tel) setState((s) => ({ ...s, authPhone: tel, authError: null }));
  }, []);

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
        inviteToken: null, // a stale invite must not survive sign-out and credit the next person to enrol
        invited: false,
      }));
    },
    [client],
  );
  const signOutRef = useRef(signOut);
  useEffect(() => {
    signOutRef.current = signOut;
  }, [signOut]);

  /* -------------------------------------------------- my parcels + account */

  // Open the detail AND fetch the single-parcel twin — only that endpoint carries the S22 collect token.
  // The list row shows instantly; the fetched twin enriches it (the QR + code) when it lands.
  const openParcelEpoch = useRef(0);
  const openParcel = useCallback(
    async (id: string) => {
      const epoch = ++openParcelEpoch.current;
      setState((s) => ({ ...s, openParcelId: id, openParcelDetail: null, openParcelState: 'loading', openParcelError: null }));
      if (!client) return;
      const r = await client.api.parcel(id);
      if (epoch !== openParcelEpoch.current) return;
      if (r.error) {
        if (isSignInRequired(r.error)) {
          signOutRef.current(r.error);
          return;
        }
        setState((s) => ({ ...s, openParcelState: 'error', openParcelError: r.error }));
        return;
      }
      setState((s) => ({ ...s, openParcelDetail: narrow<ConsumerParcelView>(r.data), openParcelState: 'ready', openParcelError: null }));
    },
    [client],
  );
  const closeParcel = useCallback(() => {
    openParcelEpoch.current++;
    setState((s) => ({ ...s, openParcelId: null, openParcelDetail: null, openParcelState: 'idle', openParcelError: null, disputeError: null }));
  }, []);

  /** S23: attach the receiver's delivered-state photo to the open parcel (returns the updated twin). */
  const submitPod = useCallback(
    async (photoRef: string) => {
      const id = stateRef.current.openParcelId;
      if (!client || !id || !photoRef) return;
      setState((s) => ({ ...s, podBusy: true, disputeError: null }));
      const r = await client.api.pod(id, photoRef);
      if (r.error) {
        if (isSignInRequired(r.error)) return signOutRef.current(r.error);
        setState((s) => ({ ...s, podBusy: false, disputeError: r.error }));
        return;
      }
      setState((s) => ({ ...s, podBusy: false, openParcelDetail: narrow<ConsumerParcelView>(r.data) }));
    },
    [client],
  );

  /** S23: file a delivery dispute (reason + photo) on the open parcel → routed to vendor / sender + tower. */
  const submitDispute = useCallback(
    async (reason: string, photoRef: string) => {
      const id = stateRef.current.openParcelId;
      if (!client || !id || !reason.trim() || !photoRef) return;
      setState((s) => ({ ...s, disputeBusy: true, disputeError: null }));
      const r = await client.api.dispute(id, reason, photoRef);
      if (r.error) {
        if (isSignInRequired(r.error)) return signOutRef.current(r.error);
        setState((s) => ({ ...s, disputeBusy: false, disputeError: r.error }));
        return;
      }
      setState((s) => ({ ...s, disputeBusy: false, openParcelDetail: narrow<ConsumerParcelView>(r.data) }));
      void loadParcels(); // the status flips to Disputed on the list (and the sender sees it on theirs)
    },
    [client, loadParcels],
  );

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

  /* -------------------------------------------------- invites (S24) */

  const loadInvites = useCallback(async () => {
    if (!client) return;
    setState((s) => ({ ...s, invitesState: 'loading' }));
    const r = await client.api.myInvites();
    if (r.error) {
      if (isSignInRequired(r.error)) return signOutRef.current(r.error);
      setState((s) => ({ ...s, invitesState: 'error' }));
      return;
    }
    setState((s) => ({ ...s, invites: narrow<InviteSummary>(r.data), invitesState: 'ready' }));
  }, [client]);

  /** Create an invite → a shareable /send/ link, opened in the OS share sheet (or copied). */
  const createInvite = useCallback(async () => {
    if (!client) return;
    setState((s) => ({ ...s, inviteBusy: true, inviteNote: null }));
    const r = await client.api.createInvite(['app']);
    if (r.error) {
      if (isSignInRequired(r.error)) return signOutRef.current(r.error);
      setState((s) => ({ ...s, inviteBusy: false, inviteNote: 'Could not create an invite' }));
      return;
    }
    const inv = narrow<InviteView>(r.data);
    const url = `${globalThis.location?.origin ?? ''}/send/?invite=${inv.token}`;
    const how = await shareLink('Join me on SeeBuyGet — send, track and collect parcels.', url);
    setState((s) => ({
      ...s,
      inviteBusy: false,
      inviteNote: how === 'copied' ? 'Link copied — paste it to a friend' : how === 'shared' ? 'Invite ready to send' : 'Could not share — try again',
    }));
    void loadInvites();
  }, [client, loadInvites]);

  /* ------------------------------------------------------------------- nav */

  const go = useCallback((screen: Screen) => {
    // Leaving a screen abandons any open parcel detail + its in-flight fetch, so returning to My parcels
    // lands on the list and refetches the twin — never re-showing a stale (possibly already-collected) token.
    openParcelEpoch.current++;
    setState((s) => ({ ...s, screen, openParcelId: null, openParcelDetail: null, openParcelState: 'idle', openParcelError: null, accountError: null, accountNote: null }));
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
      pickContact,
      requestCode,
      submitCode,
      submitEnroll,
      submitLogin,
      signOut,
      // my parcels + account
      loadParcels,
      openParcel,
      closeParcel,
      submitPod,
      submitDispute,
      switchRole,
      changePin,
      loadInvites,
      createInvite,
    },
  };
}

export type SendActions = ReturnType<typeof useSendApp>['actions'];
