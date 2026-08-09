import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isSignInRequired, narrow, type SbgError } from '../../lib/sbg';
import type { MediaKind } from '../../lib/sbg/personas/media';
import { downscaleImage, type MediaView } from '../../shared/media';
import { openChannel, pickContacts, type PickedContact, type ShareChannel } from '../../shared/device';
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
  readInviteMap,
  readPhone,
  recentKeys,
  rememberKey,
  requestOtp,
  saveDid,
  savePhone,
  verifyOtp,
  writeInviteMap,
  type ConsumerClient,
  type InviteEntry,
} from './api';
import { pickPhoneFromContacts, readSmsOtp } from '../../shared/device';
import { classifyParcel } from './api';
import { cleanPhone, codeReady, normalizeKey, parseDims, phoneReady, EMPTY_DIMS, type DimsForm } from './logic';
import type { AuthResult, ClassifyView, ConsumerParcelView, InviteSummary, InviteView, MintResult, MyParcels, NetworkPoint, PersonRole, PersonView, QuoteView, SwitchResult, TrackView } from './types';

export type Screen = 'send' | 'track' | 'parcels' | 'account';
export type WizardStep = 'parcel' | 'from' | 'to' | 'quote' | 'book' | 'done';
/** The consumer sign-in flow: enroll walks phone → code → pin; login is phone + pin together. */
export type AuthMode = 'login' | 'enroll';
export type AuthStep = 'phone' | 'code' | 'pin';

export interface SendState {
  screen: Screen;

  /* --- the send wizard, one decision per step --- */
  step: WizardStep;
  /** PG3: what the sender MEASURED — the size tier is derived from this, never tapped. */
  dims: DimsForm;
  fragile: boolean;
  derived: ClassifyView | null; // the server-derived tier + cargo class for the typed dims
  deriveBusy: boolean;
  deriveError: SbgError | null;
  fromDid: string | null;
  toDid: string | null;
  points: NetworkPoint[];
  pointsState: 'idle' | 'loading' | 'ready' | 'error';
  pointsError: SbgError | null;
  quote: QuoteView | null;
  quoteState: 'idle' | 'loading' | 'ready' | 'error';
  quoteError: SbgError | null;
  /** PG3: the booking half (signed-in only) — receiver + the mint result. */
  receiverMobile: string;
  mintBusy: boolean;
  mintError: SbgError | null;
  minted: MintResult | null;
  /** The drop-off shop name snapshotted at mint (so the done screen names the RIGHT shop after back-nav). */
  mintedFromName: string | null;

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
  /** True only when the phone was REMEMBERED from a prior session (device storage) → login is PIN-only.
   *  A first-time typist keeps the editable field; typing a digit must never flip the input to read-only. */
  phoneKnown: boolean;
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

  /* --- profile (S29): the person's own name + avatar --- */
  savingProfile: boolean; // a display-name save is in flight
  avatarBusy: boolean; // an avatar image is being uploaded + saved

  /* --- invites (S24) --- */
  invites: InviteSummary | null;
  invitesState: 'idle' | 'loading' | 'ready' | 'error';
  inviteBusy: boolean;
  inviteNote: string | null; // "Invite sent" / "Link copied" feedback
  inviteToken: string | null; // captured from a ?invite= landing
  invited: boolean; // the landing token validated → show the welcome
  /** S28 — the on-device token→contact map (names/numbers NEVER sent to the server). */
  inviteMap: InviteEntry[];
  inviteSending: string | null; // the contact key (tel|name) currently being sent, for a per-row spinner

  /* --- media library (S27) --- */
  media: MediaView[];
  mediaState: 'idle' | 'loading' | 'ready' | 'error';
  mediaRemoving: string | null;
}

const INITIAL: SendState = {
  screen: 'send',
  step: 'parcel',
  dims: EMPTY_DIMS,
  fragile: false,
  derived: null,
  deriveBusy: false,
  deriveError: null,
  fromDid: null,
  toDid: null,
  points: [],
  pointsState: 'idle',
  pointsError: null,
  quote: null,
  quoteState: 'idle',
  quoteError: null,
  receiverMobile: '',
  mintBusy: false,
  mintError: null,
  minted: null,
  mintedFromName: null,
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
  phoneKnown: false,
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
  savingProfile: false,
  avatarBusy: false,
  invites: null,
  invitesState: 'idle',
  inviteBusy: false,
  inviteNote: null,
  inviteToken: null,
  invited: false,
  inviteMap: [],
  inviteSending: null,
  media: [],
  mediaState: 'idle',
  mediaRemoving: null,
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
    const remembered = readPhone();
    setState((s) => ({ ...s, recent: recentKeys(), authPhone: remembered ?? '', phoneKnown: Boolean(remembered) }));
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

  const setDims = useCallback((patch: Partial<DimsForm>) => {
    // Any edit invalidates the derived tier — it belongs to the previous measurements.
    setState((s) => ({ ...s, dims: { ...s.dims, ...patch }, derived: null, deriveError: null }));
  }, []);

  const setFragile = useCallback((fragile: boolean) => setState((s) => ({ ...s, fragile })), []);

  const deriveEpoch = useRef(0);

  /** Classify the typed dims (the ONLY way a size exists here), then move to the drop-off picker —
   *  unless the load needs dedicated freight, in which case the step stays and explains. */
  const submitParcel = useCallback(async () => {
    const parsed = parseDims(stateRef.current.dims);
    if (!parsed) return;
    const epoch = ++deriveEpoch.current;
    setState((s) => ({ ...s, deriveBusy: true, deriveError: null }));
    const r = await classifyParcel({ l: parsed.l, w: parsed.w, h: parsed.h }, parsed.kg);
    if (epoch !== deriveEpoch.current) return;
    if (r.error || !r.data) {
      setState((s) => ({ ...s, deriveBusy: false, deriveError: r.error ?? null }));
      return;
    }
    const derived = r.data;
    setState((s) => ({ ...s, deriveBusy: false, derived, step: derived.dedicated ? s.step : 'from' }));
    if (!derived.dedicated && (stateRef.current.pointsState === 'idle' || stateRef.current.pointsState === 'error')) void loadPoints();
  }, [loadPoints]);

  const quoteEpoch = useRef(0);

  const runQuote = useCallback(async (fromDid: string, toDid: string) => {
    const size = stateRef.current.derived?.size;
    if (!size) return;
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
      const { fromDid } = stateRef.current;
      if (fromDid) void runQuote(fromDid, did);
    },
    [runQuote],
  );

  const retryQuote = useCallback(() => {
    const { fromDid, toDid } = stateRef.current;
    if (fromDid && toDid) void runQuote(fromDid, toDid);
  }, [runQuote]);

  const mintEpoch = useRef(0);

  const backTo = useCallback((step: WizardStep) => {
    mintEpoch.current++; // abandoning the book step invalidates any in-flight mint (it must not yank us to 'done')
    setState((s) => ({ ...s, step, quoteState: step === 'quote' ? s.quoteState : 'idle', quote: step === 'quote' ? s.quote : null, mintError: null }));
  }, []);

  const startAgain = useCallback(() => {
    mintEpoch.current++;
    // Keep the public wizard scaffolding AND a not-yet-redeemed invite token (resetting the wizard must not
    // consume it — only signOut deliberately drops it).
    setState((s) => ({ ...INITIAL, screen: 'send', points: s.points, pointsState: s.pointsState, recent: s.recent, identity: s.identity, authPhone: s.authPhone, inviteToken: s.inviteToken, invited: s.invited }));
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
      identity: { personId: data.personId, roles: data.roles ?? [], hasPin: data.hasPin ?? true, createdAt: data.createdAt ?? '', displayName: data.displayName, avatarMediaId: data.avatarMediaId },
      // A guest who tapped "Sign in to book it" mid-wizard returns to their booking (the quote survives sign-in
      // and the CTA becomes "Book this send"); every other sign-in lands on My parcels.
      screen: (s.step === 'quote' || s.step === 'book') && s.quote ? 'send' : 'parcels',
      mintBusy: false, // a session that died mid-mint must not leave the CTA spinning after re-sign-in
      authBusy: false,
      authError: null,
      authCode: '',
      authPin: '',
      authStep: 'phone',
      savingProfile: false, // a prior person's in-flight profile save must not leave a stuck spinner
      avatarBusy: false,
      accountError: null,
      accountNote: null,
      parcels: null,
      parcelsState: 'idle',
      media: [], // a fresh person: never show the previous account's media (its bytes would 403 anyway)
      mediaState: 'idle',
      mediaRemoving: null,
      invites: null,
      invitesState: 'idle',
      inviteMap: [], // hydrated per-person from device storage when the invite sheet opens
      inviteSending: null,
      inviteToken: null, // the invite (if any) was credited on the server at enrol; done with it now
      invited: false,
    }));
    setDid(data.personId); // triggers restore() → loadParcels()
  }, []);

  // Any manual edit (typing, "Not you?", pick-from-contacts) means the number is no longer the remembered
  // one → drop PIN-only mode so the editable field stays put while they type.
  const setAuthPhone = useCallback((v: string) => setState((s) => ({ ...s, authPhone: v, phoneKnown: false, authError: null })), []);
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
      // A booking is bound to the signed-in person: their receiver number (PII) + the minted label (a
      // drop-off credential) must not survive to the next person on a shared phone, and the wizard must
      // never strand a guest on a dead "Make my label". Reset the whole wizard/booking half to INITIAL and
      // bump the epochs so an in-flight classify/quote/mint can't resurrect state after sign-out.
      deriveEpoch.current++;
      quoteEpoch.current++;
      mintEpoch.current++;
      setState((s) => ({
        ...s,
        identity: null,
        restoring: false,
        parcels: null,
        parcelsState: 'idle',
        openParcelId: null,
        savingProfile: false, // drop any in-flight profile-save spinner from the signed-out person
        avatarBusy: false,
        accountError: null,
        accountNote: null,
        media: [], // clear the signed-out person's media (bytes are owner-gated, but don't show stale cells)
        mediaState: 'idle',
        mediaRemoving: null,
        // The wizard/booking half back to INITIAL (public points/recent/track survive).
        step: 'parcel',
        dims: EMPTY_DIMS,
        fragile: false,
        derived: null,
        deriveBusy: false,
        deriveError: null,
        fromDid: null,
        toDid: null,
        quote: null,
        quoteState: 'idle',
        quoteError: null,
        receiverMobile: '',
        mintBusy: false,
        mintError: null,
        minted: null,
        mintedFromName: null,
        screen: error ? s.screen : 'send',
        authMode: 'login',
        authStep: 'phone',
        authCode: '',
        authPin: '',
        authError: error,
        inviteToken: null, // a stale invite must not survive sign-out and credit the next person to enrol
        invited: false,
        invites: null,
        invitesState: 'idle',
        inviteMap: [], // the next person re-hydrates their own map from device storage
        inviteSending: null,
      }));
    },
    [client],
  );
  const signOutRef = useRef(signOut);
  useEffect(() => {
    signOutRef.current = signOut;
  }, [signOut]);

  /* ------------------------------------------------------------ booking (PG3) */

  const setReceiver = useCallback((v: string) => setState((s) => ({ ...s, receiverMobile: v, mintError: null })), []);

  /** Confirm the receiver's number from the address book instead of typing it (Android Contact Picker). */
  const pickReceiverContact = useCallback(async () => {
    const tel = await pickPhoneFromContacts();
    if (tel) setState((s) => ({ ...s, receiverMobile: tel, mintError: null }));
  }, []);

  const toBook = useCallback(() => setState((s) => ({ ...s, step: 'book', mintError: null })), []);

  /** The mint: the SAME genesis the vendor console gets, from the sender's own phone. On success the
   *  wizard lands on the label (their drop-off credential) and My Parcels refreshes underneath. */
  const submitMint = useCallback(async () => {
    const { dims, fragile, fromDid, toDid, receiverMobile, quote, points } = stateRef.current;
    const parsed = parseDims(dims);
    const receiver = cleanPhone(receiverMobile);
    if (!client || !parsed || !fromDid || !toDid || !phoneReady(receiver)) return;
    // Snapshot the drop-off shop name NOW: the done screen must name the shop the parcel was actually
    // minted at, even if the user back-navigates and re-picks a different shop while this is in flight.
    const fromName = points.find((p) => p.did === fromDid)?.shopName ?? null;
    const expectedTotal = quote?.locked.total; // consent to THIS price; the server fails closed if it drifted
    const epoch = ++mintEpoch.current;
    setState((s) => ({ ...s, mintBusy: true, mintError: null }));
    const r = await client.api.createParcel({
      receiverMobile: receiver,
      originPudoDid: fromDid,
      destPudoDid: toDid,
      dimensionsCm: { l: parsed.l, w: parsed.w, h: parsed.h },
      weightKg: parsed.kg,
      fragile: fragile || undefined,
      expectedTotal,
    });
    if (epoch !== mintEpoch.current) return; // the booking was abandoned (back / start again) — don't teleport
    if (r.error) {
      if (isSignInRequired(r.error)) return signOutRef.current(r.error);
      // The market moved between the quote and the mint: bounce the sender back to the fresh price to re-consent.
      if (r.error.code === 'PRICE_CHANGED') {
        setState((s) => ({ ...s, mintBusy: false, mintError: r.error }));
        if (fromDid && toDid) void runQuote(fromDid, toDid);
        return;
      }
      setState((s) => ({ ...s, mintBusy: false, mintError: r.error }));
      return;
    }
    setState((s) => ({ ...s, mintBusy: false, minted: narrow<MintResult>(r.data), mintedFromName: fromName, step: 'done' }));
    void loadParcels(); // the new send is already in their home
  }, [client, loadParcels, runQuote]);

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

  /** S26: downscale + EXIF-strip + upload a captured photo → its mediaId (null on failure). */
  const uploadPhoto = useCallback(
    async (kind: MediaKind, file: File): Promise<string | null> => {
      if (!client) return null;
      try {
        const { dataUrl, thumbDataUrl } = await downscaleImage(file);
        const r = await client.api.uploadMedia(kind, dataUrl, thumbDataUrl);
        if (r.error) {
          if (isSignInRequired(r.error)) signOutRef.current(r.error);
          return null;
        }
        return narrow<{ mediaId: string }>(r.data)?.mediaId ?? null;
      } catch {
        return null;
      }
    },
    [client],
  );

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
      setState((s) => ({ ...s, podBusy: false, openParcelDetail: narrow<ConsumerParcelView>(r.data), mediaState: 'idle' })); // new photo → refresh the library next visit
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
      setState((s) => ({ ...s, disputeBusy: false, openParcelDetail: narrow<ConsumerParcelView>(r.data), mediaState: 'idle' })); // new photo → refresh the library next visit
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

  /* -------------------------------------------------- profile (S29) */

  /** Save the person's display name (→ the Identity Vault). Resolves true on success so the caller can
   *  keep the edit sheet open (and the typed name) on a failure. */
  const saveDisplayName = useCallback(
    async (name: string): Promise<boolean> => {
      const trimmed = name.trim();
      if (!client || !trimmed) return false;
      const startDid = readDid(); // guard: if the person signs out / switches mid-save, drop the result
      setState((s) => ({ ...s, savingProfile: true, accountError: null, accountNote: null }));
      const r = await client.api.setProfile({ displayName: trimmed });
      if (readDid() !== startDid) return false; // a different (or no) person now — never splice A's name onto B
      if (r.error) {
        if (isSignInRequired(r.error)) { signOutRef.current(r.error); return false; }
        setState((s) => ({ ...s, savingProfile: false, accountError: r.error }));
        return false;
      }
      const view = narrow<PersonView>(r.data);
      setState((s) => ({ ...s, savingProfile: false, accountNote: 'Name saved', identity: s.identity ? { ...s.identity, displayName: view?.displayName } : s.identity }));
      return true;
    },
    [client],
  );

  /**
   * Set the avatar: downscale + upload the image (kind 'avatar'), then point the profile at the new
   * mediaId. The server purges the previous avatar's bytes, so a person keeps exactly one. A failed
   * upload leaves the old avatar untouched.
   */
  const saveAvatar = useCallback(
    async (file: File) => {
      if (!client) return;
      const startDid = readDid(); // guard: if the person signs out / switches mid-upload, drop the result
      setState((s) => ({ ...s, avatarBusy: true, accountError: null, accountNote: null }));
      const mediaId = await uploadPhoto('avatar', file);
      if (readDid() !== startDid) return; // a different (or no) person now
      if (!mediaId) {
        const err: SbgError = { code: 'INVALID_INPUT', status: 0, title: 'Photo not saved', detail: 'Could not upload that image — try a different photo.', retryable: true };
        setState((s) => ({ ...s, avatarBusy: false, accountError: err }));
        return;
      }
      const r = await client.api.setProfile({ avatarMediaId: mediaId });
      if (readDid() !== startDid) return; // person changed mid-save — never splice A's avatar onto B
      if (r.error) {
        if (isSignInRequired(r.error)) return signOutRef.current(r.error);
        setState((s) => ({ ...s, avatarBusy: false, accountError: r.error }));
        return;
      }
      const view = narrow<PersonView>(r.data);
      setState((s) => ({
        ...s,
        avatarBusy: false,
        accountNote: 'Photo updated',
        identity: s.identity ? { ...s.identity, avatarMediaId: view?.avatarMediaId } : s.identity,
        mediaState: 'idle', // the new avatar (and the purge of the old) → refresh the library next visit
      }));
    },
    [client, uploadPhoto],
  );

  /* -------------------------------------------------- media library (S27) */

  /** Load this person's media (the library source — PII-free views). */
  const loadMyMedia = useCallback(async () => {
    if (!client) return;
    const startDid = readDid(); // guard: if the person signs out / switches mid-fetch, don't write stale media
    setState((s) => ({ ...s, mediaState: 'loading' }));
    const r = await client.api.myMedia();
    if (readDid() !== startDid) return; // a different (or no) person now — drop this result
    if (r.error) {
      if (isSignInRequired(r.error)) return signOutRef.current(r.error);
      setState((s) => ({ ...s, mediaState: 'error' }));
      return;
    }
    setState((s) => ({ ...s, media: narrow<MediaView[]>(r.data) ?? [], mediaState: 'ready' }));
  }, [client]);

  /** Authenticated byte loader for <MediaLibrary>/<AuthImage> (media is owner-gated — no plain <img src>). */
  const loadMedia = useCallback(
    (mediaId: string) => (client ? client.api.mediaBlob(mediaId) : Promise.resolve({ data: null, error: {} as unknown })),
    [client],
  );

  /** Remove one of the person's own asset images (evidence bins are locked server-side → MEDIA_LOCKED). */
  const removeMedia = useCallback(
    async (mediaId: string) => {
      if (!client) return;
      setState((s) => ({ ...s, mediaRemoving: mediaId }));
      const r = await client.api.deleteMedia(mediaId);
      if (r.error) {
        if (isSignInRequired(r.error)) return signOutRef.current(r.error);
        setState((s) => ({ ...s, mediaRemoving: null }));
        return;
      }
      setState((s) => ({ ...s, mediaRemoving: null, media: s.media.filter((m) => m.mediaId !== mediaId) }));
    },
    [client],
  );

  /* -------------------------------------------------- invites (S24 → S28) */

  /** Load the server's per-token join counts AND hydrate the on-device token→contact map + the sender name. */
  const loadInvites = useCallback(async () => {
    if (!client) return;
    const personId = stateRef.current.identity?.personId ?? '';
    setState((s) => ({ ...s, invitesState: 'loading', inviteMap: personId ? readInviteMap(personId) : [] }));
    const r = await client.api.myInvites();
    if (r.error) {
      if (isSignInRequired(r.error)) return signOutRef.current(r.error);
      setState((s) => ({ ...s, invitesState: 'error' }));
      return;
    }
    setState((s) => ({ ...s, invites: narrow<InviteSummary>(r.data), invitesState: 'ready' }));
  }, [client]);

  /** Open the OS contact multi-picker (Android). Numbers stay on-device; the sheet stages the chosen ones. */
  const pickInviteContacts = useCallback((): Promise<PickedContact[]> => pickContacts(), []);

  /**
   * Invite ONE contact via a channel: mint (or reuse) that contact's token, map it to the contact
   * ON-DEVICE, and open the channel's deep link straight to them. The server only ever sees an opaque
   * token; the name/number never leave the phone.
   */
  const inviteContact = useCallback(
    async (contact: { name: string; tel: string; email?: string }, channel: ShareChannel) => {
      if (!client) return;
      const personId = stateRef.current.identity?.personId;
      if (!personId) return;
      if (stateRef.current.inviteSending) return; // single-flight: one send at a time, so no map races
      const key = contact.tel || contact.name || 'link';
      setState((s) => ({ ...s, inviteSending: key, inviteNote: null }));

      // Reuse this contact's existing token (a re-send) or mint a fresh one so re-sending never spams tokens.
      const existing = stateRef.current.inviteMap.find((e) => (contact.tel && e.tel === contact.tel) || (!contact.tel && contact.name && e.name === contact.name));
      let token = existing?.token ?? '';
      if (!token) {
        const r = await client.api.createInvite([channel]);
        if (r.error) {
          if (isSignInRequired(r.error)) return signOutRef.current(r.error);
          setState((s) => ({ ...s, inviteSending: null, inviteNote: r.error.code === 'INVITE_LIMIT' ? 'You have too many open invites' : 'Could not create the invite' }));
          return;
        }
        token = narrow<InviteView>(r.data)?.token ?? '';
        if (!token) {
          setState((s) => ({ ...s, inviteSending: null, inviteNote: 'Could not create the invite' }));
          return;
        }
      }

      const url = `${globalThis.location?.origin ?? ''}/send/?invite=${token}`;
      // S29: personalise the card with the sender's own display name when they've set one ("Join Hans on
      // SeeBuyGet"); a person who hasn't named themselves still gets the zero-friction "Join me" text.
      const senderName = stateRef.current.identity?.displayName?.trim();
      const text = senderName
        ? `Join ${senderName} on SeeBuyGet — send, track & collect parcels.`
        : 'Join me on SeeBuyGet — send, track & collect parcels.';
      const how = await openChannel(channel, { text, url, tel: contact.tel || undefined, email: contact.email || undefined });

      // Persist the token→contact map ON DEVICE. Re-read at write time + a functional state update so a
      // stale snapshot can never clobber another entry, and dedupe by token so a re-send updates in place.
      // `delivered` gates the "Sent" pill: a failed open keeps the token (reusable) but shows Send to retry.
      const entry: InviteEntry = { token, name: contact.name || contact.tel || 'Shared link', tel: contact.tel, at: new Date().toISOString(), delivered: how !== 'failed' };
      writeInviteMap(personId, [...readInviteMap(personId).filter((e) => e.token !== token), entry]);
      setState((s) => ({
        ...s,
        inviteSending: null,
        inviteMap: [...s.inviteMap.filter((e) => e.token !== token), entry],
        inviteNote: how === 'copied' ? 'Link copied' : how === 'failed' ? 'Could not open that app — try another way' : 'Invite sent — they show as joined once they sign up',
      }));
      void loadInvites();
    },
    [client, loadInvites],
  );

  /* ------------------------------------------------------------------- nav */

  const go = useCallback((screen: Screen) => {
    // Leaving a screen abandons any open parcel detail + its in-flight fetch, so returning to My parcels
    // lands on the list and refetches the twin — never re-showing a stale (possibly already-collected) token.
    openParcelEpoch.current++;
    setState((s) => ({ ...s, screen, openParcelId: null, openParcelDetail: null, openParcelState: 'idle', openParcelError: null, accountError: null, accountNote: null }));
  }, []);

  return {
    state,
    // The Web Push controls (N1b) — surfaced for the TopBar NotificationBell; null while signed out.
    notifications: client?.notifications ?? null,
    actions: {
      go,
      setDims,
      setFragile,
      submitParcel,
      pickFrom,
      pickTo,
      retryQuote,
      backTo,
      startAgain,
      loadPoints,
      runTrack,
      setKey,
      // booking (PG3)
      setReceiver,
      pickReceiverContact,
      toBook,
      submitMint,
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
      uploadPhoto,
      submitPod,
      submitDispute,
      switchRole,
      changePin,
      saveDisplayName,
      saveAvatar,
      loadMyMedia,
      loadMedia,
      removeMedia,
      loadInvites,
      pickInviteContacts,
      inviteContact,
    },
  };
}

export type SendActions = ReturnType<typeof useSendApp>['actions'];
