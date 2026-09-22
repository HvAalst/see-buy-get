import { drain, outboxItems } from '../../shared/outbox';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { SbgError } from '../../lib/sbg';
import type { IconName } from '../../shared/ui/Icon';
import { choosePin, createDriverClient, driverConfig, driverSession, isMintSourced, isSignInRequired, narrow, purgeDriverTokens, requestPhoneCode, verifyPhoneCode } from './api';
import { adoptDidFromUrl, clearDid, saveDid, saveRadius, saveRoute, savedRadius, savedRoute } from './storage';
import type {
  AgentRow,
  BoardRow,
  ClaimsView,
  DriverJobRow,
  DriverJobsSummary,
  DriverRecord,
  LoadBagView,
  MdpRow,
  NodeOption,
  DeclaredLegView,
  GeocodeResult,
  RecentVehicleView,
  ExpectedLoadView,
  OfferView,
  RatesView,
  RoadConstraint,
  SavedRoute,
  SessionView,
  SuggestView,
  VehicleView,
} from './types';
import { boardOriginPin, DEFAULT_WORK_RADIUS_KM, defaultWorkMode, lastReadingBreached, minEarnFilter, nodeOptions, originReady } from './logic';
import { pinAfterRename, type GeoPoint, type PinSource } from '../../shared/geo';
import { currentPosition, watchPosition } from '../../shared/position';
import { t } from '../../shared/i18n';
import { downscaleImage } from '../../shared/media';
import { triggerDownload } from '../../shared/download';
import type { MediaKind } from '../../lib/sbg/personas/media';
import type { DeclaredLegBody } from '../../lib/sbg/personas/driver';

export type Screen = 'home' | 'route' | 'offers' | 'loads' | 'earnings' | 'board';

/** FB1 — the operator's own reach on the board. `null` is not "no filter chosen yet": it IS the choice, and
 *  it means the whole market. There is no platform clamp here; 15 km governs interruptions, not browsing. */
export type BoardReach = number | null;
export const BOARD_REACHES: BoardReach[] = [25, 100, 300, null];

/* --- R5: the driver jobs + earnings register query --- */
export interface JobsQuery {
  q: string;
  status: '' | 'available' | 'claimed' | 'in_transit' | 'delivered';
  paid: '' | 'paid' | 'unpaid';
  from: string;
  to: string;
  sort: 'newest' | 'oldest' | 'earn_desc' | 'earn_asc';
  offset: number;
}
export const JOBS_LIMIT = 20;
export const INITIAL_JOBS_QUERY: JobsQuery = { q: '', status: '', paid: '', from: '', to: '', sort: 'newest', offset: 0 };
export function jobsApiQuery(q: JobsQuery) {
  return { q: q.q || undefined, status: q.status || undefined, paid: q.paid || undefined, from: q.from || undefined, to: q.to || undefined, sort: q.sort, limit: String(JOBS_LIMIT), offset: String(q.offset) };
}
export type Phase = 'boot' | 'signin' | 'ready' | 'outdated';

export interface Toast {
  id: number;
  tone: 'ok' | 'info' | 'warn' | 'danger';
  /** A name from the monoline set — never a glyph, so an emoji cannot reach the icon slot. */
  icon?: IconName;
  title: string;
  detail?: string;
}

export interface DriverState {
  phase: Phase;
  /* No `did` here on purpose: identity lives in the `did` useState alone. Two copies of the
     same fact drift, and the copy nothing reads drifts silently. */
  screen: Screen;
  driver: DriverRecord | null;
  session: SessionView;
  vehicle: VehicleView | null;
  remaining: number;
  /** Bag spaces left in the hold — on a line-haul this is usually what binds, not the kilos. */
  remainingTotes: number | null;
  claims: ClaimsView['claims'];
  rates: RatesView | null;
  nodes: NodeOption[];
  nodesState: 'idle' | 'loading' | 'ready' | 'error';
  offers: OfferView[];
  /** F3 — lots still filling along the declared route. Advisory: nothing here can be claimed. */
  expected: ExpectedLoadView[];
  offerIndex: number;
  route: SavedRoute | null;
  /** The roads this driver has declared before, newest first — offered instead of naming two places daily. */
  legs: DeclaredLegView[];
  /** The vehicles this driver has driven before — so the day can start over a coffee, not at the bus. */
  vehicles: RecentVehicleView[];
  /** R5 — the driver jobs + earnings register (a filtered/paged page + the current view's totals). */
  jobs: DriverJobRow[];
  jobsTotal: number;
  jobsState: 'idle' | 'loading' | 'ready' | 'error';
  jobsQuery: JobsQuery;
  jobsSummary: DriverJobsSummary | null;
  /** FB1 — the open board: the whole market, each row carrying why it can or cannot be taken. */
  board: BoardRow[];
  boardState: 'idle' | 'loading' | 'ready' | 'error';
  /** The operator's own reach. null = the whole market, which is the default: we do not narrow it for them. */
  boardReach: BoardReach;
  /** Where the board was priced FROM — the browsing origin, which is NOT necessarily where the driver is.
   *  Null until one is available: the board cannot be honest without one, because every distance, price and
   *  the whole sort order are relative to it. */
  boardFrom: { lat: number; lng: number } | null;
  /**
   * FB3a — the place the operator chose to look from. `null` means "wherever I am", which is the default.
   *
   * The board's whole subject is REPOSITIONING — take the marginal load because it puts you where the good
   * one is — and an operator cannot ask that question about anywhere but their own doorstep while the origin
   * is the GPS. Deciding whether to run to Mombasa happens at the coffee table in Nairobi.
   */
  boardOrigin: CustomPlace | null;
  /** The half-typed place in the origin picker. Separate from `boardOrigin` so the board is not refetched
   *  against a pin the operator is still moving. */
  boardPlace: CustomPlace;
  /** The crowd-sourced road map around the driver: what other drivers have reported, never a survey. */
  road: RoadConstraint[];
  roadState: 'idle' | 'loading' | 'error' | 'ready';
  /**
   * CL5 — whether a photograph of an official document may be kept in this country, and the notice the
   * person must agree to. Absent until asked; NEVER assumed true, because assuming it invites a picture
   * we then have to refuse.
   */
  observationNotice: { country?: string; mayHoldEvidence: boolean; version: string; text: string } | null;
  observations: Array<{ observationId: string; subject: string; place: string; happenedOn: string; tier: 'told' | 'evidenced' }>;
  /** Where that list was read from. Null until the phone gives a fix — the distances need one. */
  roadAt: { lat: number; lng: number } | null;
  /** Screen-level failure — rendered as an ErrorNote, never as a raw string. */
  error: SbgError | null;
  toasts: Toast[];
  /** Key of the single in-flight mutation. Every mutating control reads this. */
  busy: string | null;
  refreshing: boolean;
  /** A refresh failed for want of network; what is on screen is the last known truth. */
  stale: boolean;
  /**
   * `fromId`/`toId` name a place on the network. `CUSTOM_PLACE` means "somewhere else" — a market, a
   * junction, a depot gate — and then the matching `fromPlace`/`toPlace` carries the name and the pin,
   * because the roads this network runs have ends that are not PUDOs.
   */
  form: {
    vehicleQr: string;
    fromId: string;
    toId: string;
    minEarn: string;
    fromPlace: CustomPlace;
    toPlace: CustomPlace;
    /** How work is searched for: along a declared road, or within a radius of the rider. */
    mode: 'route' | 'near';
    /** The patch, in km. Only meaningful in 'near' mode. */
    radiusKm: number;
  };
}

/** A road end the driver named and pinned themselves. `from` records whether the pin outlives a rename. */
export interface CustomPlace {
  label: string;
  pin: GeoPoint | null;
  from: PinSource;
}

/** The sentinel `fromId`/`toId` take when the end is not a network place. */
export const CUSTOM_PLACE = '__custom';

const EMPTY_PLACE: CustomPlace = { label: '', pin: null, from: null };
const EMPTY_FORM = {
  vehicleQr: '',
  fromId: '',
  toId: '',
  minEarn: '',
  fromPlace: { ...EMPTY_PLACE },
  toPlace: { ...EMPTY_PLACE },
  mode: 'route' as 'route' | 'near',
  radiusKm: DEFAULT_WORK_RADIUS_KM,
};

const INITIAL: DriverState = {
  phase: 'boot',
  screen: 'home',
  driver: null,
  session: { active: false },
  vehicle: null,
  remaining: 0,
  remainingTotes: null,
  claims: [],
  rates: null,
  nodes: [],
  nodesState: 'idle',
  offers: [],
  expected: [],
  offerIndex: 0,
  route: null,
  legs: [],
  vehicles: [],
  jobs: [],
  jobsTotal: 0,
  jobsState: 'idle',
  jobsQuery: INITIAL_JOBS_QUERY,
  jobsSummary: null,
  board: [],
  boardState: 'idle',
  boardReach: null, // the whole market until the operator says otherwise
  boardFrom: null,
  boardOrigin: null, // …and from where they are, until they say otherwise
  boardPlace: { ...EMPTY_PLACE },
  road: [],
  roadState: 'idle',
  observationNotice: null,
  observations: [],
  roadAt: null,
  error: null,
  toasts: [],
  busy: null,
  refreshing: false,
  stale: false,
  form: { ...EMPTY_FORM },
};

const isOffline = (e: SbgError) => e.code === 'NETWORK' || e.code === 'OFFLINE' || e.code === 'TIMEOUT';

/**
 * Where a failure leaves the shell.
 *
 * 'boot' renders a bare spinner — no error, no retry, no sign-out. Leaving the app there was the
 * boot hang: ANY non-NOT_FOUND failure of the first `me()` (offline cold start, timeout, 500, 403,
 * a failed mint) pinned it forever, because nothing ever re-entered `refresh`. A failure must
 * always land on a screen that can explain itself and offer a way out, so 'boot' is promoted to
 * 'ready': the shell then renders the ErrorNote (with its Try again) and the sign-out control.
 *
 * Exported and pure so the rule is unit-tested rather than trusted.
 */
export function phaseAfterFailure(phase: Phase, code: string): Phase {
  if (code === 'CLIENT_OUTDATED') return 'outdated'; // a 426 is a full-screen gate, never a note
  return phase === 'boot' ? 'ready' : phase;
}

/** Haptic confirmation for a completed mutation — audible feedback a driver feels, not reads. */
function buzz(): void {
  try {
    navigator.vibrate?.(120);
  } catch {
    /* unsupported */
  }
}

export function useDriverApp() {
  const [state, setState] = useState<DriverState>(INITIAL);

  const [did, setDid] = useState<string | null>(null);
  const client = useMemo(() => (did ? createDriverClient(did) : null), [did]);
  const toastSeq = useRef(0);
  const toastTimers = useRef(new Set<number>());

  /* ---------------------------------------------------------------- toasts */

  const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = ++toastSeq.current;
    setState((s) => ({ ...s, toasts: [...s.toasts, { ...toast, id }] }));
    // A queue, not the legacy one-shot banner: the old `state.msg` was spliced in at render
    // and cleared immediately, so any unrelated re-render ate the message before it was read.
    // The handle is tracked so unmount can cancel it — an uncancelled 5.2s timer fires setState
    // on a dead component (and a sign-out leaves a queue of them still pending).
    const handle = window.setTimeout(() => {
      toastTimers.current.delete(handle);
      setState((s) => ({ ...s, toasts: s.toasts.filter((x) => x.id !== id) }));
    }, 5200);
    toastTimers.current.add(handle);
  }, []);

  useEffect(() => {
    const timers = toastTimers.current;
    return () => {
      for (const h of timers) window.clearTimeout(h);
      timers.clear();
    };
  }, []);

  const dismissToast = useCallback((id: number) => {
    setState((s) => ({ ...s, toasts: s.toasts.filter((x) => x.id !== id) }));
  }, []);

  /* ---------------------------------------------------------------- errors */

  /**
   * One place decides what a failure means to the shell:
   *  - 426 CLIENT_OUTDATED is a full-screen gate, never a toast — the app is not usable;
   *  - offline/timeout marks the screen stale and KEEPS the last known data, because
   *    wiping a driver's claimed loads because a tunnel ate one request is unacceptable;
   *  - anything else becomes a rendered ErrorNote;
   *  - and it ALWAYS lands on a screen that renders (see `phaseAfterFailure`).
   *
   * It deliberately does NOT touch `busy`. Releasing the single-flight lock here freed every
   * control while the action was still running — a failed claim re-enabled the deck during its
   * own trailing refresh, so a second claim could be fired into the same offer. `run()`'s
   * `finally` owns that lock, from first tap to last await, and nothing else may clear it.
   */
  const fail = useCallback((error: SbgError) => {
    // A shift that ended (or a PIN changed on another phone) is not an error on this screen: back to sign-in,
    // with nothing of the last driver's left behind on a phone that may be changing hands.
    if (isSignInRequired(error)) {
      purgeDriverTokens(null);
      clearDid();
      setDid(null);
      setState((s) => ({ ...INITIAL, phase: 'signin', error, toasts: s.toasts }));
      return;
    }
    setState((s) => {
      const phase = phaseAfterFailure(s.phase, error.code);
      if (phase === 'outdated') return { ...s, phase, refreshing: false };
      return { ...s, phase, error, stale: isOffline(error) ? true : s.stale, refreshing: false };
    });
  }, []);

  /* --------------------------------------------------------------- refresh */

  /** Ticket of the newest refresh. An older one that finishes late is not allowed to commit. */
  const refreshEpoch = useRef(0);
  /** How many refreshes are on the wire — background recovery never stacks another one. */
  const refreshesRunning = useRef(0);

  /**
   * The boot/refresh sequence, in the legacy order: me → session → (claims, rates) → ping.
   * Rates soft-fail (the screen is still usable without a benchmark) and ping is
   * fire-and-forget (it feeds the fleet map; a driver never waits on it).
   *
   * Re-entrancy: refreshes DO overlap — a mutation's trailing refresh can race a foreground or
   * `online` retry — so each takes an epoch and only the newest may write. Without that, an
   * older refresh reaching its terminal setState after a newer one resurrects the data it read
   * before the mutation landed (claims that are gone, capacity that is wrong).
   */
  /** A shift end still in the outbox: the driver ended it with no signal, and the phone is the record until it sends. */
  const endQueued = useCallback(() => outboxItems().some((i) => i.path === `/v1/sbg/fleet/drivers/${encodeURIComponent(did ?? '')}/end-session` && i.state !== 'blocked'), [did]);

  const refresh = useCallback(async () => {
    if (!client || !did) return;
    const epoch = ++refreshEpoch.current;
    const superseded = () => epoch !== refreshEpoch.current;

    refreshesRunning.current += 1;
    setState((s) => ({ ...s, refreshing: true }));
    try {
      const meR = await client.api.me(did);
      if (superseded()) return;
      if (meR.error) {
        /**
         * Erasing the driver's ID is destructive, so it must fire ONLY on a real identity problem:
         *  - the endpoint itself answered NOT_FOUND (the driver record is genuinely gone), or
         *  - the MINT rejected the ID as unknown (the backend answers 400 there, not 404).
         * A mint-sourced 404 must NOT qualify: a wrong VITE_SBG_API, a moved proxy path or an HTML
         * 404 page looks identical to a deleted driver, and one misrouted deploy would then sign out
         * every driver in the field and delete the ID they signed in with.
         */
        const identityGone = meR.error.code === 'NOT_FOUND' && !isMintSourced(meR.error);
        if (identityGone) {
          clearDid();
          client.client.session.clear();
          purgeDriverTokens(null);
          setState((s) => ({ ...INITIAL, phase: 'signin', error: meR.error, toasts: s.toasts }));
          setDid(null);
          return;
        }
        fail(meR.error);
        return;
      }
      const driver = narrow<DriverRecord>(meR.data);

      const sesR = await client.api.session(did);
      if (superseded()) return;
      if (sesR.error) {
        setState((s) => ({ ...s, driver, phase: 'ready' }));
        fail(sesR.error);
        return;
      }
      // A read from memory still says "on shift" after the driver ended it in a dead spot; the queued end wins.
      const session = endQueued() ? { active: false } : (narrow<SessionView>(sesR.data) ?? { active: false });

      let vehicle: VehicleView | null = null;
      let remaining = 0;
      let remainingTotes: number | null = null;
      let claims: ClaimsView['claims'] = [];
      let rates: RatesView | null = null;

      if (session.active && session.vehicle) {
        vehicle = session.vehicle;
        const clR = await client.api.claims(did);
        if (superseded()) return;
        if (clR.error) {
          setState((s) => ({ ...s, driver, session, vehicle, phase: 'ready' }));
          fail(clR.error);
          return;
        }
        const cv = narrow<ClaimsView>(clR.data);
        remaining = cv?.remainingCapacityKg ?? 0;
        remainingTotes = cv?.remainingTotes ?? null;
        claims = cv?.claims ?? [];

        // Network per-km benchmark (vehicles roam, so no lat/lng). Soft-fail by design.
        const rtR = await client.api.vehicleRates();
        if (superseded()) return;
        rates = rtR.error ? null : narrow<RatesView>(rtR.data);
      }

      // The roads and the vehicles this driver has used before. Soft-fail both: not knowing the history only
      // costs them the shortcut, so it must never take down the boot that tells them whether they are on shift.
      const legsR = await client.api.driverLegs(did);
      if (superseded()) return;
      const legs = legsR.error ? [] : narrow<{ legs: DeclaredLegView[] }>(legsR.data)?.legs ?? [];

      const vehR = session.active ? null : await client.api.driverVehicles(did); // only the morning screen needs it
      if (superseded()) return;
      const vehicles = !vehR || vehR.error ? [] : narrow<{ vehicles: RecentVehicleView[] }>(vehR.data)?.vehicles ?? [];

      setState((s) => ({
        ...s,
        phase: 'ready',
        driver,
        session,
        vehicle,
        remaining,
        remainingTotes,
        claims,
        rates,
        route: savedRoute(did),
        legs,
        vehicles,
        // The right search for what they are driving, and the patch they used last — a rider should find
        // their own screen already set up rather than configuring it every morning.
        form: {
          ...s.form,
          mode: s.form.mode === 'route' && vehicle ? defaultWorkMode(vehicle.vehicleClass) : s.form.mode,
          radiusKm: savedRadius(did) ?? s.form.radiusKm,
        },
        error: null,
        stale: false,
        refreshing: false,
        // A stale tab can still be sitting on offers/loads after the shift ended — send it home. Earnings is
        // exempt (a driver reviews jobs + pay OFF shift), matching the ScreenRouter guard in app.tsx.
        screen: !session.active && s.screen !== 'home' && s.screen !== 'earnings' ? 'home' : s.screen,
        offers: session.active ? s.offers : [],
        expected: session.active ? s.expected : [],
      }));

      void client.api.ping(did);
    } finally {
      refreshesRunning.current -= 1;
    }
  }, [client, did, fail, endQueued]);

  /**
   * Follow the phone while the shift lasts.
   *
   * Until now this app never told the server where it was: the only fix it ever sent was the START of a
   * route the driver typed, which meant the live fleet map, the market's read on supply, and the whole
   * "a load on the road you are on" nudge were all running on a position nobody was reporting. A driver on
   * shift is the one person whose position is genuinely operational, so it is reported while they are on
   * shift and never a moment longer — the watch is released the instant the shift ends or the app unmounts.
   *
   * A refusal is a normal outcome. Everything degrades to what it was: they can still name a place, still
   * find work, still be offered loads at the moment those loads appear.
   */
  useEffect(() => {
    if (!client || !did || !state.session.active) return;
    const stop = watchPosition((p) => {
      void client.api.locate(did, p);
    });
    return stop;
  }, [client, did, state.session.active]);

  /**
   * A notification tap lands here: `?offer=<id>` opens THAT offer and nothing else.
   *
   * The point of the pop-up is one decision in one view, so arriving from it must not dump the driver on a
   * home screen to go and find the load again. The offer already lives on the server, so this works on a cold
   * start with no route declared — we fetch what is still awaiting an answer and open the card. The parameter
   * is stripped once used: a later refresh (or the driver simply re-opening the app) must not re-jump them
   * onto a load they have already dealt with.
   */
  const openOfferFromLink = useCallback(async () => {
    if (!client || !did || typeof location === 'undefined') return;
    const offerId = new URLSearchParams(location.search).get('offer');
    if (!offerId) return;
    try {
      const url = new URL(location.href);
      url.searchParams.delete('offer');
      history.replaceState(null, '', url.toString());
    } catch {
      /* a browser that refuses the rewrite still gets the right screen — it just may re-jump on reload */
    }
    const r = await client.api.activeOffers(did);
    if (r.error) return; // the offer lapsed, or we are offline: the app opens where it normally would
    const offers = narrow<OfferView[]>(r.data) ?? [];
    const index = offers.findIndex((o) => o.offerId === offerId);
    if (index < 0) return; // someone else took it, or it expired while the phone was in a pocket
    setState((s) => ({ ...s, offers, offerIndex: index, screen: 'offers' }));
  }, [client, did]);

  /* -------------------------------------------------------------- recovery */

  // Always-current handles, so the recovery listeners can be attached ONCE and still call the
  // newest refresh and read the newest state. Re-subscribing on every state change would
  // otherwise add and remove two window listeners on every keystroke.
  const refreshRef = useRef(refresh);
  const stateRef = useRef(state);
  useEffect(() => {
    refreshRef.current = refresh;
    stateRef.current = state;
  });

  /**
   * The way back in.
   *
   * A driver who opens the app in a dead spot, or whose phone slept through the failure, gets a
   * screen that has already given up. Coming back online, or bringing the app to the front, is
   * the moment to try again — and it costs one request. It stands down while a mutation owns the
   * app (its own trailing refresh is coming) and while a refresh is already on the wire.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const retry = () => {
      const s = stateRef.current;
      if (s.phase === 'signin' || s.phase === 'outdated') return; // nothing to retry into
      if (s.busy || refreshesRunning.current > 0) return;
      void refreshRef.current();
    };
    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      retry();
    };

    window.addEventListener('online', retry);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', retry);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  /* ------------------------------------------------------------- identity */

  useEffect(() => {
    // A DID arriving in `?driver=` is a (re-)sign-in — a shared phone may be changing hands — so
    // no token from an earlier driver may survive it. `adoptDidFromUrl()` also returns the STORED
    // DID on an ordinary cold start, which must keep its token (that is what makes the token
    // survive a navigation), hence the explicit look at the query string first.
    const fromUrl = typeof location !== 'undefined' ? new URLSearchParams(location.search).get('driver') : null;
    const stored = adoptDidFromUrl();
    if (fromUrl) purgeDriverTokens(null);
    if (stored) setDid(stored);
    else setState((s) => ({ ...s, phase: 'signin' }));
  }, []);

  useEffect(() => {
    // Identity settled: drop every other driver's stored token. The per-DID key already stops a
    // foreign token being read; this stops it being kept.
    //
    // Guarded on `did`: this effect also runs on the FIRST render, when `did` is still null and
    // purging "all but null" would wipe the very token we just persisted — defeating the
    // survives-navigation guarantee and forcing a fresh mint on every cold start, which is a second
    // failure point on exactly the flaky links this app is built for.
    if (did) purgeDriverTokens(did);
    // Boot, then honour a notification tap — in that order, so the offer screen opens over a loaded app
    // rather than being overwritten by the refresh that follows it.
    if (client && did) void refresh().then(() => openOfferFromLink());
    // refresh is stable per (client, did)
  }, [client, did, refresh, openOfferFromLink]);

  /**
   * Phone + PIN. The SERVER finds the driver this phone was registered to and mints the token; it is seeded into
   * that driver's session. Resolves to whether it worked, so the screen can keep what was typed on a failure.
   */
  const signIn = useCallback(async (phone: string, pin: string): Promise<boolean> => {
    if (!phone.trim() || !pin.trim()) return false;
    const r = await driverSession(phone.trim(), pin.trim());
    if (r.error) {
      setState((s) => ({ ...s, error: r.error }));
      return false;
    }
    const signedIn = r.data!;
    // Whatever is in sessionStorage belongs to whoever used this phone before.
    client?.client.session.clear();
    purgeDriverTokens(null);
    saveDid(signedIn.did);
    await createDriverClient(signedIn.did).client.seed(signedIn.token);
    setState((s) => ({ ...INITIAL, phase: 'boot', toasts: s.toasts }));
    setDid(signedIn.did);
    return true;
  }, [client]);

  /** First time, or a forgotten PIN: send a code. Resolves to the code itself in a sandbox, `''` when it was sent, null on failure. */
  const sendPinCode = useCallback(async (phone: string): Promise<string | null> => {
    const r = await requestPhoneCode(phone.trim());
    if (r.error) {
      setState((s) => ({ ...s, error: r.error }));
      return null;
    }
    setState((s) => ({ ...s, error: null }));
    return r.data?.code ?? '';
  }, []);

  /** The code proves the phone; the new PIN replaces any old one; then sign in with it. */
  const setPinAndSignIn = useCallback(async (phone: string, code: string, pin: string): Promise<boolean> => {
    const verified = await verifyPhoneCode(phone.trim(), code.trim());
    const chosen = verified.error ? verified : await choosePin(phone.trim(), pin.trim());
    if (chosen.error) {
      setState((s) => ({ ...s, error: chosen.error }));
      return false;
    }
    return signIn(phone, pin);
  }, [signIn]);

  const signOut = useCallback(() => {
    client?.client.session.clear();
    purgeDriverTokens(null);
    clearDid();
    setDid(null);
    setState(() => ({ ...INITIAL, phase: 'signin' }));
  }, [client]);

  /* ------------------------------------------------------------ navigation */

  const loadNodes = useCallback(async () => {
    if (!client) return;
    setState((s) => ({ ...s, nodesState: 'loading' }));
    const [mdpR, agentR] = await Promise.all([client.api.mdps(), client.api.agents()]);
    if (mdpR.error && agentR.error) {
      // Two empty selects and a button that always fails is not an empty state — say so.
      setState((s) => ({ ...s, nodes: [], nodesState: 'error' }));
      fail(mdpR.error);
      return;
    }
    const nodes = nodeOptions(narrow<MdpRow[]>(mdpR.data), narrow<AgentRow[]>(agentR.data), t);
    setState((s) => ({ ...s, nodes, nodesState: nodes.length ? 'ready' : 'error' }));

    // Half a list is not a list. If only /mdps failed, the pick-list silently loses every hub —
    // a driver standing IN one would scroll past shops looking for it and conclude the app is
    // broken. Keep what arrived, and say what is missing (RouteScreen's note retries this).
    const partial = mdpR.error ?? agentR.error;
    if (partial) fail(partial);
  }, [client, fail]);

  /* ------------------------------------------------- jobs + earnings register (R5) */

  const jobsEpoch = useRef(0);
  const fetchJobsWith = useCallback(
    async (query: JobsQuery) => {
      if (!client || !did) return;
      const epoch = ++jobsEpoch.current;
      setState((s) => (s.jobsState === 'ready' ? s : { ...s, jobsState: 'loading' }));
      const [pageR, sumR] = await Promise.all([client.api.jobs(did, jobsApiQuery(query)), client.api.jobsSummary(did, jobsApiQuery(query))]);
      if (epoch !== jobsEpoch.current) return;
      if (pageR.error) {
        setState((s) => ({ ...s, jobsState: 'error', jobsSummary: null }));
        fail(pageR.error);
        return;
      }
      const page = narrow<{ items?: DriverJobRow[]; total?: number }>(pageR.data);
      const items = page.items ?? [];
      const total = page.total ?? 0;
      if (items.length === 0 && total > 0 && query.offset >= total) {
        const lastOffset = Math.max(0, (Math.ceil(total / JOBS_LIMIT) - 1) * JOBS_LIMIT);
        setState((s) => (s.jobsQuery.offset === query.offset ? { ...s, jobsQuery: { ...s.jobsQuery, offset: lastOffset } } : s));
        void fetchJobsWith({ ...query, offset: lastOffset });
        return;
      }
      const summary = sumR.error ? null : narrow<DriverJobsSummary>(sumR.data);
      setState((s) => ({ ...s, jobs: items, jobsTotal: total, jobsState: 'ready', jobsSummary: summary }));
    },
    [client, did, fail],
  );
  const queryJobs = useCallback(
    (patch: Partial<JobsQuery>) => {
      const offsetOnly = Object.keys(patch).length === 1 && 'offset' in patch;
      const next: JobsQuery = { ...stateRef.current.jobsQuery, ...patch, offset: offsetOnly ? (patch.offset ?? 0) : 0 };
      setState((s) => ({ ...s, jobsQuery: next, jobsState: 'loading' }));
      void fetchJobsWith(next);
    },
    [fetchJobsWith],
  );
  const loadJobs = useCallback(() => {
    void fetchJobsWith(stateRef.current.jobsQuery);
  }, [fetchJobsWith]);

  /* ------------------------------------------------------------ the open board (FB1) */

  const boardEpoch = useRef(0);
  /**
   * Load the market from where the operator is standing.
   *
   * The position is not optional garnish: every distance, every price and the whole sort order are relative
   * to it, so without a fix there is nothing honest to show. A default pin would produce a board that looks
   * complete and is wrong in every number — worse than an empty screen that says why.
   */
  const fetchBoard = useCallback(
    async (reach: BoardReach) => {
      if (!client) return;
      const epoch = ++boardEpoch.current;
      setState((s) => ({ ...s, boardState: s.boardState === 'ready' ? s.boardState : 'loading' }));
      // FB3a — a named origin is used AS GIVEN and never waits on the GPS. Asking the device where it is in
      // order to answer a question about somewhere else would fail the browse for the one operator most
      // likely to be indoors, at a desk, deciding where to work next.
      const chosen = stateRef.current.boardOrigin;
      const at = boardOriginPin(chosen, chosen?.pin ? null : await currentPosition());
      if (epoch !== boardEpoch.current) return;
      if (!at) {
        setState((s) => ({ ...s, boardState: 'error', boardFrom: null }));
        return;
      }
      const res = await client.api.freightBoard(at, reach ?? undefined);
      if (epoch !== boardEpoch.current) return;
      if (res.error) {
        setState((s) => ({ ...s, boardState: 'error' }));
        fail(res.error);
        return;
      }
      const page = narrow<{ items?: BoardRow[] }>(res.data);
      setState((s) => ({ ...s, board: page.items ?? [], boardState: 'ready', boardFrom: at }));
    },
    [client, fail],
  );
  const loadBoard = useCallback(() => {
    void fetchBoard(stateRef.current.boardReach);
  }, [fetchBoard]);

  /* ------------------------------------------- the counter, as drivers are asked at it */

  /**
   * CL5 — ASK WHETHER WE MAY KEEP A PHOTOGRAPH HERE, BEFORE OFFERING A CAMERA.
   *
   * The answer is about a jurisdiction, not about this moment, so it is read when the form opens and not
   * on any timer. The notice travels with it: the screen shows the server's words and hands the version
   * back with the consent, so there is never a second copy of a consent text in the world.
   */
  const loadObservationNotice = useCallback(
    async (country: string) => {
      if (!client || !country) return;
      const [notice, list] = await Promise.all([client.api.observationNotice(country), client.api.fieldObservations(country)]);
      setState((s) => ({
        ...s,
        // A failure leaves it NULL, which the screen reads as "no camera". Defaulting to yes on an error
        // would invite exactly the photograph we then have to refuse.
        observationNotice: notice.error ? null : (narrow<{ country?: string; mayHoldEvidence: boolean; version: string; text: string }>(notice.data) ?? null),
        observations: list.error ? s.observations : (narrow<{ items: DriverState['observations'] }>(list.data)?.items ?? []),
      }));
    },
    [client],
  );

  /** The atlas, read once when the form first opens. Public, and it does not change while somebody looks. */
  const countries = useCallback(async (): Promise<Array<{ code: string; name: string }>> => {
    if (!client) return [];
    const r = await client.api.countryCatalogue();
    if (r.error) return [];
    return narrow<{ items: Array<{ code: string; name: string }> }>(r.data)?.items ?? [];
  }, [client]);

  /**
   * CL5 — record what you were asked for. Answers whether it took, so the sheet can shut itself.
   *
   * A refusal is SHOWN rather than swallowed: the server's refusals here are the rules of the feature —
   * not first-hand, the country will not allow a photograph, the notice has moved on — and each one tells
   * the person something they need in order to try again.
   */
  const recordObservation = useCallback(
    async (body: {
      country: string;
      place: string;
      subject: string;
      note?: string;
      happenedOn: string;
      firstHand: boolean;
      evidenceMediaId?: string;
      consentAgreed?: boolean;
      consentNoticeVersion?: string;
    }): Promise<boolean> => {
      if (!client) return false;
      setState((s) => ({ ...s, busy: 'observation' }));
      const r = await client.api.recordObservation(body);
      setState((s) => ({ ...s, busy: null }));
      if (r.error) {
        pushToast({ tone: 'danger', icon: 'warning', title: t('driver.counter.refused'), detail: r.error.detail || r.error.title });
        return false;
      }
      pushToast({ tone: 'ok', icon: 'check', title: t('driver.counter.saved') });
      await loadObservationNotice(body.country);
      return true;
    },
    [client, pushToast, loadObservationNotice],
  );

  /**
   * FP4 — a courier without a fleet sends their renewed licence: the photo, and the date they read off it.
   *
   * Until this existed the app told them to "show the fleet office", which they do not have. Nothing
   * switches on here: the date waits beside the photo until network staff read the same card. Refreshes
   * the driver's own record so the home screen says "sent" the moment it is, not on the next poll.
   */
  const sendLicenceRenewal = useCallback(
    async (body: { copyRef: string; expiresAt: string; number?: string }): Promise<boolean> => {
      if (!client || !did) return false;
      setState((s) => ({ ...s, busy: 'licence' }));
      const r = await client.api.sendLicenceRenewal(did, body);
      setState((s) => ({ ...s, busy: null }));
      if (r.error) {
        pushToast({ tone: 'danger', icon: 'warning', title: t('driver.licence.refused'), detail: r.error.detail || r.error.title });
        return false;
      }
      pushToast({ tone: 'ok', icon: 'check', title: t('driver.licence.sent') });
      await refresh();
      return true;
    },
    [client, did, pushToast, refresh],
  );

  /* ------------------------------------------------- the road, as drivers report it */

  /**
   * What other drivers have reported around here.
   *
   * Needs the phone's own fix and says so when it cannot get one, rather than falling back to a guessed
   * point: a hazard list drawn around the wrong village is worse than none, because it reads as a survey
   * of a road the driver is not on.
   */
  const loadRoad = useCallback(async () => {
    if (!client) return;
    setState((s) => ({ ...s, roadState: s.roadState === 'ready' ? s.roadState : 'loading' }));
    const at = await currentPosition();
    if (!at) {
      setState((s) => ({ ...s, roadState: 'error', roadAt: null }));
      return;
    }
    const r = await client.api.roadNear(at);
    if (r.error) {
      setState((s) => ({ ...s, roadState: 'error' }));
      return;
    }
    const page = narrow<{ items?: RoadConstraint[] }>(r.data);
    setState((s) => ({ ...s, road: page.items ?? [], roadState: 'ready', roadAt: at }));
  }, [client]);
  const setBoardReach = useCallback(
    (reach: BoardReach) => {
      setState((s) => ({ ...s, boardReach: reach, boardState: 'loading' }));
      void fetchBoard(reach);
    },
    [fetchBoard],
  );

  /* --- FB3a: where the operator is looking from --- */

  /** Edit the origin DRAFT. Renaming a pinned place carries the pin or drops it by the shared rule, so a
   *  typo over a found name cannot leave the map pointing at the old town under the new one's label. */
  const setBoardPlace = useCallback((patch: Partial<CustomPlace> & { from?: PinSource }) => {
    setState((s) => {
      const next: CustomPlace = { ...s.boardPlace, ...patch };
      if (patch.label !== undefined && patch.pin === undefined) next.pin = pinAfterRename(s.boardPlace.pin, s.boardPlace.from);
      return { ...s, boardPlace: next };
    });
  }, []);

  /** Commit the draft and re-read the market from there. Needs both halves: a name nobody can place is not
   *  an origin, and a pin with no name cannot be said back to the operator on the row above the list. */
  const applyBoardOrigin = useCallback(() => {
    const draft = stateRef.current.boardPlace;
    if (!originReady(draft)) return false;
    const origin: CustomPlace = { ...draft, label: draft.label.trim() };
    setState((s) => ({ ...s, boardOrigin: origin, boardState: 'loading' }));
    void fetchBoard(stateRef.current.boardReach);
    return true;
  }, [fetchBoard]);

  /** Back to wherever the device is. The draft is kept: an operator toggling between home and a corridor
   *  they are considering should not have to type the corridor's name twice. */
  const useMyPosition = useCallback(() => {
    setState((s) => ({ ...s, boardOrigin: null, boardState: 'loading' }));
    void fetchBoard(stateRef.current.boardReach);
  }, [fetchBoard]);

  /**
   * FB0c — name a price for a load posted for negotiation.
   *
   * Proposing reserves nothing, so the board is NOT optimistically mutated: the row stays exactly where it
   * is, available to everyone, because that is the truth until the shipper accepts. The board is reloaded
   * afterwards for the same reason — the market may have moved while the driver was typing.
   *
   * FB3a — `from` is asked of the DEVICE, never taken from the board's browsing origin. Since the operator
   * can now look at Mombasa from Nairobi, the two have come apart: the origin says where they were LOOKING,
   * and only the device says where they will actually drive from. Sending the browsed point would book a
   * 480 km empty run as if it were nothing, understating the deadhead on the load and in the market series
   * both — the exact "never invent a split" failure the loaded/deadhead work exists to prevent.
   */
  const proposePrice = useCallback(
    async (row: BoardRow, price: number, note?: string) => {
      if (!client) return false;
      const from = await currentPosition();
      if (!from) {
        const err: SbgError = { code: 'FIELD_REQUIRED', status: 0, title: t('driver.board.proposeNeedsPosition'), detail: t('driver.board.proposeNeedsPositionWhy'), retryable: true };
        fail(err);
        return false;
      }
      const key = `propose:${row.freightId}`;
      setState((s) => ({ ...s, busy: key, error: null }));
      const res = await client.api.proposeForFreight(row.freightId, { from, price, note: note || undefined });
      setState((s) => ({ ...s, busy: null }));
      if (res.error) {
        fail(res.error);
        return false;
      }
      pushToast({ tone: 'ok', icon: 'wallet', title: t('driver.board.proposeSent'), detail: row.code });
      void fetchBoard(stateRef.current.boardReach);
      return true;
    },
    [client, fail, fetchBoard, pushToast, t],
  );

  const go = useCallback(
    (screen: Screen) => {
      setState((s) => ({ ...s, screen, error: null, form: screen === 'route' ? { ...s.form } : s.form }));
      if (screen === 'route') void loadNodes();
      if (screen === 'earnings') void fetchJobsWith(stateRef.current.jobsQuery);
      if (screen === 'board') void fetchBoard(stateRef.current.boardReach);
    },
    [loadNodes, fetchJobsWith, fetchBoard],
  );

  const setForm = useCallback(
    (p: Partial<DriverState['form']>) => setState((s) => ({ ...s, form: { ...s.form, ...p } })),
    [],
  );

  /* -------------------------------------------------------------- mutations */

  const run = useCallback(
    async (key: string, fn: () => Promise<void>) => {
      // Single-flight: every mutating control in this app is double-tappable on a slow
      // network, and a duplicate start-session or claim is a real dispatch incident.
      let blocked = false;
      setState((s) => {
        if (s.busy) {
          blocked = true;
          return s;
        }
        return { ...s, busy: key, error: null };
      });
      if (blocked) return;
      try {
        await fn();
      } finally {
        // Never leave the app wedged: an unexpected throw must still free the control.
        setState((s) => (s.busy === key ? { ...s, busy: null } : s));
      }
    },
    [],
  );

  /** Export the whole current-filter jobs set (every page) as a CSV download — server-rendered. */
  const exportJobs = useCallback(async () => {
    if (!client || !did) return;
    await run('export-jobs', async () => {
      const q = stateRef.current.jobsQuery;
      const r = await client.api.jobsExport(did, { q: q.q || undefined, status: q.status || undefined, paid: q.paid || undefined, from: q.from || undefined, to: q.to || undefined, sort: q.sort });
      if (r.error) return fail(r.error);
      triggerDownload('jobs.csv', narrow<string>(r.data));
      pushToast({ tone: 'ok', icon: 'check', title: t('driver.toast.jobsExported'), detail: t('driver.toast.jobsExportedDetail') });
    });
  }, [client, did, run, fail, pushToast]);

  /**
   * Start the shift — and, in the same breath, say where it is going. The leg is optional here on purpose:
   * a driver who does not yet know is not blocked, and Find work declares it for them when they pick a route.
   */
  const startShift = useCallback(async (vehicleId?: string, leg?: DeclaredLegBody) => {
    if (!client || !did) return;
    const qr = state.form.vehicleQr.trim();
    // One of the two: the vehicle they picked from their own history, or the QR on a dashboard in front of them.
    if (!vehicleId && !qr) {
      pushToast({ tone: 'warn', icon: 'scan', title: t('driver.toast.scanQrFirst') });
      return;
    }
    await run('start', async () => {
            // An end still in the pocket goes first: the server must hear "ended" before "started" or it refuses the second.
      if (endQueued()) await drain({ baseUrl: driverConfig().baseUrl, token: () => client.client.session.getToken() });
const r = await client.api.startSession(did, vehicleId ? { vehicleId } : { vehicleQr: qr }, leg);
      if (r.error) return fail(r.error);
      buzz();
      setState((s) => ({ ...s, form: { ...EMPTY_FORM } }));
      pushToast({ tone: 'ok', icon: 'truck', title: t('driver.toast.shiftStarted'), detail: t('driver.toast.shiftStartedDetail') });
      await refresh();
    });
  }, [client, did, state.form.vehicleQr, run, fail, pushToast, refresh]);

  /**
   * Hold new offers for a while — chosen with the duration in the same breath, because the only moment
   * anyone knows how long they need is when they are stopping.
   */
  const snoozeWork = useCallback(
    async (minutes?: number) => {
      if (!client || !did) return;
      await run('snooze', async () => {
        const r = await client.api.snoozeWork(did, minutes);
        if (r.error) return fail(r.error);
        buzz();
        pushToast({ tone: 'ok', icon: 'clock', title: t('driver.toast.snoozed'), detail: minutes ? t('driver.toast.snoozedFor', { count: minutes }) : t('driver.toast.snoozedOpen') });
        await refresh();
      });
    },
    [client, did, run, fail, pushToast, refresh],
  );

  /**
   * Set (or clear) the standing floor under an interruption.
   *
   * Deliberately NOT the minimum on the work-search screen. That one narrows a list the driver is already
   * reading; this one decides whether the phone is allowed to speak first, and it is the only one the
   * lock-screen nudge can see. Clearing is the same call with nothing in it, so a driver can never end up
   * with a silencer whose off switch lives somewhere else.
   */
  const setMinEarn = useCallback(
    async (amount?: number) => {
      if (!client || !did) return;
      await run('min-earn', async () => {
        const r = await client.api.setMinEarn(did, amount);
        if (r.error) return fail(r.error);
        buzz();
        pushToast({
          tone: 'ok',
          icon: 'wallet',
          title: amount ? t('driver.toast.minEarnSet', { amount: String(amount) }) : t('driver.toast.minEarnCleared'),
        });
        await refresh();
      });
    },
    [client, did, run, fail, pushToast, refresh],
  );

  /**
   * Switch off (or back on) the road worked out from a load the driver took.
   *
   * A switch rather than a prompt, and off is honoured for the shift: without that, turning it off would
   * clear a road the very next claim puts straight back, which is an argument rather than a control.
   */
  const setDerivedLeg = useCallback(
    async (on: boolean) => {
      if (!client || !did) return;
      await run('derived-leg', async () => {
        const r = await client.api.setDerivedLeg(did, on);
        if (r.error) return fail(r.error);
        buzz();
        pushToast({ tone: 'ok', icon: 'route', title: on ? t('driver.toast.derivedLegOn') : t('driver.toast.derivedLegOff') });
        await refresh();
      });
    },
    [client, did, run, fail, pushToast, refresh],
  );

  /** Take work again, now. Always available — a snooze must never be a state you cannot leave. */
  const resumeWork = useCallback(async () => {
    if (!client || !did) return;
    await run('snooze', async () => {
      const r = await client.api.resumeWork(did);
      if (r.error) return fail(r.error);
      buzz();
      pushToast({ tone: 'ok', icon: 'check', title: t('driver.toast.resumed'), detail: t('driver.toast.resumedDetail') });
      await refresh();
    });
  }, [client, did, run, fail, pushToast, refresh]);

  const endShift = useCallback(async () => {
    if (!client || !did) return;
    await run('end', async () => {
      const r = await client.api.endSession(did);
      if (r.error) return fail(r.error);
      buzz();
      // A 202 is the outbox: the end is recorded here and goes when there is signal. Said as such, and the shift
      // shows as over from now — the refresh reads the queue before it believes what it last knew.
      if (r.status === 202) pushToast({ tone: 'ok', icon: 'offline', title: t('driver.toast.shiftClosed'), detail: t('driver.toast.shiftEndQueued') });
      else pushToast({ tone: 'ok', icon: 'check', title: t('driver.toast.shiftClosed'), detail: t('driver.toast.shiftClosedDetail') });
      await refresh();
    });
  }, [client, did, run, fail, pushToast, refresh]);

  const matchRate = useCallback(
    async (vehicleId: string, price: number) => {
      if (!client) return;
      await run('rate', async () => {
        const r = await client.api.setVehiclePrice(vehicleId, price);
        if (r.error) return fail(r.error);
        buzz();
        pushToast({ tone: 'ok', icon: 'wallet', title: t('driver.toast.rateUpdated'), detail: t('driver.toast.rateUpdatedDetail') });
        await refresh();
      });
    },
    [client, run, fail, pushToast, refresh],
  );

  const runSuggest = useCallback(
    async (from: { lat: number; lng: number }, to: { lat: number; lng: number }, minEarn?: number) => {
      if (!client || !did) return;
      await run('suggest', async () => {
        const r = await client.api.suggestWork(did, { from, to, ...(minEarn ? { minEarn } : {}) });
        if (r.error) return fail(r.error);
        const v = narrow<SuggestView>(r.data);
        setState((s) => ({
          ...s,
          // REP4 — keep the freight-pause flag in lock-step with THESE offers (suggest returns the live verdict),
          // so the "freight is paused" note never lags the marketplace it explains.
          driver: s.driver && v?.freightPaused != null ? { ...s.driver, freightPaused: v.freightPaused } : s.driver,
          remaining: v?.remainingCapacityKg ?? s.remaining,
          remainingTotes: v?.remainingTotes ?? s.remainingTotes,
          offers: v?.offers ?? [],
          expected: v?.expected ?? [],
          offerIndex: 0,
          screen: 'offers',
        }));
      });
    },
    [client, did, run, fail],
  );

  const submitRoute = useCallback(async () => {
    // Either end may be a place on the network OR one the driver named and pinned. Both arrive here as the
    // same thing — a label and a point — because that is all a road end has ever been to the matcher.
    const endOf = (id: string, place: CustomPlace) => {
      if (id === CUSTOM_PLACE) return place.pin && place.label.trim() ? { label: place.label.trim(), lat: place.pin.lat, lng: place.pin.lng } : undefined;
      return state.nodes.find((n) => n.id === id);
    };
    const from = endOf(state.form.fromId, state.form.fromPlace);
    const to = endOf(state.form.toId, state.form.toPlace);
    if (!from || !to) {
      pushToast({ tone: 'warn', icon: 'pin', title: t('driver.toast.pickRoute') });
      return;
    }
    if (did) {
      const route: SavedRoute = {
        from: { lat: from.lat, lng: from.lng },
        to: { lat: to.lat, lng: to.lng },
        fromLabel: from.label,
        toLabel: to.label,
      };
      saveRoute(did, route);
      setState((s) => ({ ...s, route }));
      // Naming a route to find work IS declaring where you are going — so tell the server, and the loads it
      // pushes at this driver from now on are the ones on THIS road. Best-effort: a failure costs them the
      // heading filter (they fall back to proximity, as before), never the work they came here to look for.
      // Off shift there is no coupling to hang it on, which the server says plainly; the offers still stand.
      if (client) void client.api.declareLeg(did, { fromLabel: from.label, from: { lat: from.lat, lng: from.lng }, toLabel: to.label, to: { lat: to.lat, lng: to.lng } });
    }
    await runSuggest({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng }, minEarnFilter(state.form.minEarn));
  }, [state.nodes, state.form.fromId, state.form.toId, state.form.fromPlace, state.form.toPlace, state.form.minEarn, did, client, pushToast, runSuggest]);

  /** Edit one end of a hand-named road. A pin the geocoder found dies with the name it came from. */
  const setPlace = useCallback((end: 'fromPlace' | 'toPlace', patch: Partial<CustomPlace>) => {
    setState((s) => {
      const cur = s.form[end];
      const next: CustomPlace = { ...cur, ...patch };
      if (patch.label !== undefined && patch.pin === undefined) next.pin = pinAfterRename(cur.pin, cur.from);
      return { ...s, form: { ...s.form, [end]: next } };
    });
  }, []);

  /** Resolve a typed place to a point + how sure we are — the driver's half of the shared place picker. */
  const geocodePlace = useCallback(
    async (q: string): Promise<GeocodeResult | null> => {
      const query = q.trim();
      if (!client || !query) return null;
      const r = await client.api.geocode(query);
      if (r.error || !r.data) return null;
      return narrow<GeocodeResult>(r.data);
    },
    [client],
  );

  /**
   * Find work AROUND me — the bike/bajaj search, and the one the rider will pull up all day.
   *
   * It asks the phone where it is rather than making them name a place, because for a rider there is no
   * place to name: there is here, and how far they will ride. The radius is also DECLARED, so the pop-ups
   * that reach them for the rest of the shift use the same number they just chose — one decision, not two.
   */
  const findNearby = useCallback(async () => {
    if (!client || !did) return;
    const radiusKm = stateRef.current.form.radiusKm;
    await run('suggest', async () => {
      const at = await currentPosition();
      if (!at) {
        // No permission, or no signal: say so once, and leave them the route search that needs no GPS.
        pushToast({ tone: 'warn', icon: 'pin', title: t('driver.toast.noLocation'), detail: t('driver.toast.noLocationDetail') });
        return;
      }
      saveRadius(did, radiusKm);
      void client.api.declareArea(did, radiusKm); // best-effort: the search still stands if this fails
      const r = await client.api.suggestNearby(did, { at, radiusKm, ...(minEarnFilter(stateRef.current.form.minEarn) ? { minEarn: minEarnFilter(stateRef.current.form.minEarn) } : {}) });
      if (r.error) return fail(r.error);
      const v = narrow<SuggestView>(r.data);
      setState((s) => ({
        ...s,
        driver: s.driver && v?.freightPaused != null ? { ...s.driver, freightPaused: v.freightPaused } : s.driver,
        remaining: v?.remainingCapacityKg ?? s.remaining,
        remainingTotes: v?.remainingTotes ?? s.remainingTotes,
        offers: v?.offers ?? [],
        expected: v?.expected ?? [],
        offerIndex: 0,
        screen: 'offers',
      }));
    });
  }, [client, did, run, fail, pushToast]);

  const repeatRoute = useCallback(async () => {
    const r = did ? savedRoute(did) : null;
    if (!r) return go('route');
    await runSuggest(r.from, r.to, minEarnFilter(stateRef.current.form.minEarn));
  }, [did, go, runSuggest]);

  const setOfferIndex = useCallback((offerIndex: number) => setState((s) => ({ ...s, offerIndex })), []);

  const dropOffer = (offerId: string) =>
    setState((s) => {
      const offers = s.offers.filter((o) => o.offerId !== offerId);
      return { ...s, offers, offerIndex: Math.max(0, Math.min(s.offerIndex, offers.length - 1)) };
    });

  const answerOffer = useCallback(
    async (offer: OfferView, take: boolean) => {
      if (!client) return;
      await run(`${take ? 'claim' : 'ignore'}:${offer.offerId}`, async () => {
        const r = take ? await client.api.claimOffer(offer.offerId) : await client.api.ignoreOffer(offer.offerId);
        if (r.error) {
          // A lapsed or already-taken offer is DEAD: the legacy page left the card on screen,
          // so the next tap failed the same way. Drop it and say why.
          if (r.error.code === 'WINDOW_EXPIRED' || r.error.code === 'INVALID_STATE' || r.error.code === 'CONFLICT') {
            dropOffer(offer.offerId);
          }
          // Reconcile FIRST, then report. A successful refresh ends with `error: null`, so
          // failing before it erased the whole explanation: the card vanished from the deck and
          // the driver was never told why their claim was refused.
          await refresh();
          fail(r.error);
          return;
        }
        buzz();
        dropOffer(offer.offerId);
        if (take) {
          pushToast({
            tone: 'ok',
            icon: 'box',
            title: t('driver.toast.claimed', { kg: offer.weightKg }),
            detail: t('driver.toast.claimedDetail', { dest: offer.destLabel }),
          });
          await refresh();
        }
      });
    },
    [client, run, fail, pushToast, refresh],
  );

  const loadBag = useCallback(
    async (ref: string) => {
      if (!client || !state.driver?.badgeId) return;
      await run(`load:${ref}`, async () => {
        const r = await client.api.loadBag(ref, state.driver!.badgeId!);
        if (r.error) return fail(r.error);
        buzz();
        const moved = narrow<LoadBagView>(r.data)?.moved?.length ?? 0;
        pushToast({
          tone: 'ok',
          icon: 'box',
          title: t('driver.toast.onBoard', { ref }),
          detail: moved === 1 ? t('driver.toast.parcelsLoadedOne', { count: moved }) : t('driver.toast.parcelsLoadedMany', { count: moved }),
        });
        await refresh();
      });
    },
    [client, state.driver, run, fail, pushToast, refresh],
  );

  /** S26/S33 — downscale + EXIF-strip + upload a captured securement photo → its mediaId (null on failure). */
  const uploadPhoto = useCallback(
    async (kind: MediaKind, file: File): Promise<string | null> => {
      if (!client) return null;
      try {
        const { dataUrl, thumbDataUrl } = await downscaleImage(file);
        const r = await client.api.uploadMedia(kind, dataUrl, thumbDataUrl);
        if (r.error) {
          pushToast({ tone: 'danger', icon: 'camera', title: t('driver.toast.photoFailed'), detail: t('driver.toast.photoFailedDetail') });
          return null;
        }
        return narrow<{ mediaId: string }>(r.data)?.mediaId ?? null;
      } catch {
        pushToast({ tone: 'danger', icon: 'camera', title: t('driver.toast.photoUnreadable') });
        return null;
      }
    },
    [client, pushToast],
  );

  /**
   * Authenticated byte loader for another driver's ROAD photo — a media endpoint needs the bearer, so no
   * plain <img src> can reach one.
   *
   * Thumbnails by default, and that is deliberate: this runs on a connection the driver pays for by the
   * megabyte, and the road list is read at a junction. Nothing here loads until a photo is asked for.
   */
  const loadRoadPhoto = useCallback(
    (mediaId: string, variant: 'full' | 'thumb' = 'thumb') =>
      client ? client.api.mediaBlob(mediaId, variant) : Promise.resolve({ data: null, error: {} as unknown }),
    [client],
  );

  /** S32b/S33 — pick up a claimed dedicated-freight job (claimed → in_transit), through the load-safety gate:
   *  the confirmed checklist keys + the securement photo mediaId. */
  const pickupFreight = useCallback(
    async (ref: string, check: { confirmed: string[]; securementPhotoId: string; reservations?: string }) => {
      const did = stateRef.current.driver?.did;
      if (!client || !did) return;
      await run(`freight:${ref}`, async () => {
        const r = await client.api.pickupFreight(ref, did, check);
        if (r.error) {
          // Reconcile FIRST, then report (mirror answerOffer): if the job moved on elsewhere the stale
          // 'Pick up' row would loop the same 400 on every re-tap — a refresh flips it to its true control.
          // Skip it while offline so the row stays and the driver can retry when the network returns.
          if (!isOffline(r.error)) await refresh();
          return fail(r.error);
        }
        buzz();
        pushToast({ tone: 'ok', icon: 'truck', title: t('driver.toast.freightPickedUp'), detail: t('driver.toast.freightPickedUpDetail') });
        await refresh();
      });
    },
    [client, run, fail, pushToast, refresh],
  );

  /** S32b/S33 — deliver an in-transit dedicated-freight job (in_transit → delivered), with the confirmed
   *  unload-checklist keys. */
  const deliverFreight = useCallback(
    async (ref: string, check: { confirmed: string[]; receiverName: string; podPhotoId: string; remarks?: string }) => {
      const did = stateRef.current.driver?.did;
      if (!client || !did) return;
      await run(`freight:${ref}`, async () => {
        const r = await client.api.deliverFreight(ref, did, check);
        if (r.error) {
          if (!isOffline(r.error)) await refresh(); // reconcile a moved-on job before showing the error
          return fail(r.error);
        }
        buzz();
        pushToast({ tone: 'ok', icon: 'check', title: t('driver.toast.freightDelivered'), detail: t('driver.toast.freightDeliveredDetail') });
        await refresh();
      });
    },
    [client, run, fail, pushToast, refresh],
  );

  /** FP3b — the driver was at the door and could not hand over: the attempt is written down, the sender is told,
   *  and the load stays on the van (nothing moves in the list — the same row keeps its Deliver control). */
  const failDelivery = useCallback(
    async (ref: string, input: { outcome: 'absent' | 'refused' | 'unreachable'; note?: string }) => {
      const did = stateRef.current.driver?.did;
      if (!client || !did) return;
      await run(`freight:${ref}`, async () => {
        const r = await client.api.failDelivery(ref, did, input);
        if (r.error) {
          if (!isOffline(r.error)) await refresh();
          return fail(r.error);
        }
        pushToast({ tone: 'info', icon: 'truck', title: t('driver.toast.attemptRecorded'), detail: t('driver.toast.attemptRecordedDetail') });
        await refresh();
      });
    },
    [client, run, fail, pushToast, refresh],
  );

  /** FP8 — the driver gives a claimed load back before pickup. It goes back on the market, the sender's charge
   *  comes back, and the sender (and the office that put it on them) is told why. Their list loses the row. */
  const handBack = useCallback(
    async (ref: string, reason: string) => {
      const did = stateRef.current.driver?.did;
      if (!client || !did) return;
      await run(`freight:${ref}`, async () => {
        const r = await client.api.handBack(ref, reason);
        if (r.error) {
          if (!isOffline(r.error)) await refresh();
          return fail(r.error);
        }
        pushToast({ tone: 'info', icon: 'truck', title: t('driver.toast.handedBack'), detail: t('driver.toast.handedBackDetail') });
        await refresh();
      });
    },
    [client, run, fail, pushToast, refresh],
  );

  /** S33b — log a temperature reading for a cold-chain freight in transit. An out-of-band reading warns the
   *  driver (and flags the load for the control tower). */
  const logTemp = useCallback(
    async (ref: string, celsius: number) => {
      const did = stateRef.current.driver?.did;
      if (!client || !did) return;
      await run(`temp:${ref}`, async () => {
        const r = await client.api.recordTemp(ref, did, celsius);
        if (r.error) {
          if (!isOffline(r.error)) await refresh();
          return fail(r.error);
        }
        buzz();
        // Warn on THIS reading's own verdict, not the sticky freight flag (which stays true after any past
        // breach) — an in-band reading logged after a recovery must read as fine, not as a fresh alert.
        const breach = lastReadingBreached(narrow<{ tempReadings?: Array<{ breach: boolean }> }>(r.data)?.tempReadings);
        pushToast(
          breach
            ? { tone: 'warn', icon: 'warning', title: t('driver.toast.tempOutOfRange'), detail: t('driver.toast.tempOutOfRangeDetail') }
            : { tone: 'ok', icon: 'check', title: t('driver.toast.tempLogged') },
        );
        await refresh();
      });
    },
    [client, run, fail, pushToast, refresh],
  );

  /**
   * One tap from the cab.
   *
   * The position comes from the phone, never from a form — the whole premise is that nobody fills in a
   * form at a junction with a truck behind them. Without a fix there is nothing to report ABOUT, so this
   * says so and changes nothing.
   */
  const reportRoad = useCallback(
    async (kind: string, value?: number, note?: string, photoRef?: string) => {
      if (!client) return;
      await run('report-road', async () => {
        const at = await currentPosition();
        if (!at) {
          pushToast({ tone: 'warn', icon: 'pin', title: t('driver.toast.noLocation'), detail: t('driver.toast.noLocationDetail') });
          return;
        }
        const r = await client.api.reportRoad({ kind, at, ...(value != null ? { value } : {}), ...(note?.trim() ? { note: note.trim() } : {}), ...(photoRef ? { photoRef } : {}) });
        if (r.error) return fail(r.error);
        buzz();
        pushToast({ tone: 'ok', icon: 'check', title: t('driver.toast.roadReported'), detail: t('driver.toast.roadReportedDetail') });
        await loadRoad();
      });
    },
    [client, run, fail, pushToast, loadRoad],
  );

  /**
   * A later passer-by answers: still there, or gone.
   *
   * "Gone" DISPUTES it — it does not remove it, and the toast says so out loud. A driver who taps that
   * expects the warning to disappear, and the one thing this screen must never do is let them believe it
   * has: being wrong about a bridge that is still standing is the failure the whole feature exists around.
   */
  const answerRoad = useCallback(
    async (constraintId: string, stillThere: boolean, note?: string, photoRef?: string) => {
      if (!client) return;
      await run(`road:${constraintId}`, async () => {
        const body = { ...(note?.trim() ? { note: note.trim() } : {}), ...(photoRef ? { photoRef } : {}) };
        const r = stillThere ? await client.api.confirmRoad(constraintId, body) : await client.api.refuteRoad(constraintId, body);
        if (r.error) return fail(r.error);
        buzz();
        pushToast(
          stillThere
            ? { tone: 'ok', icon: 'check', title: t('driver.toast.roadConfirmed') }
            : { tone: 'warn', icon: 'warning', title: t('driver.toast.roadRefuted'), detail: t('driver.toast.roadRefutedDetail') },
        );
        await loadRoad();
      });
    },
    [client, run, fail, pushToast, loadRoad],
  );
  return {
    state,
    // The Web Push controls (N1b) — surfaced for the TopBar NotificationBell; null while signed out.
    notifications: client?.notifications ?? null,
    actions: {
      /** The same controls, inside actions so a SCREEN can ask for permission where somebody sees the ask. */
      notifications: client?.notifications ?? null,
      refresh,
      signIn,
      sendPinCode,
      setPinAndSignIn,
      signOut,
      go,
      setForm,
      setPlace,
      geocodePlace,
      findNearby,
      snoozeWork,
      resumeWork,
      setMinEarn,
      setDerivedLeg,
      queryJobs,
      loadJobs,
      loadBoard,
      loadObservationNotice,
      recordObservation,
      sendLicenceRenewal,
      countries,
      loadRoad,
      reportRoad,
      answerRoad,
      setBoardReach,
      setBoardPlace,
      applyBoardOrigin,
      useMyPosition,
      proposePrice,
      /** CV1 — the conversations API for the signed-in driver (null until signed in). */
      chatApi: client?.conversations ?? null,
      exportJobs,
      loadNodes,
      startShift,
      endShift,
      /** FP2 — the consignment note of a load this driver carries. */
      freightNote: (freightId: string) => client!.api.freightNote(freightId),
      matchRate,
      submitRoute,
      repeatRoute,
      setOfferIndex,
      answerOffer,
      loadBag,
      uploadPhoto,
      loadRoadPhoto,
      pickupFreight,
      deliverFreight,
      failDelivery,
      handBack,
      logTemp,
      pushToast,
      dismissToast,
    },
  };
}

export type DriverActions = ReturnType<typeof useDriverApp>['actions'];
