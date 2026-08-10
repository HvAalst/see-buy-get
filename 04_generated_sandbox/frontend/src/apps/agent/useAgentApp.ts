import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  isMintSourced,
  isSignInRequired,
  narrow,
  sbgForgot,
  sbgLogin,
  sbgReset,
  type SbgError,
} from '../../lib/sbg';
import type { MediaKind } from '../../lib/sbg/personas/media';
import { downscaleImage } from '../../shared/media';
import { errorSentence } from '../../shared/ui';
import type { IconName } from '../../shared/ui/Icon';
import { agentConfig, clearDid, createAgentClient, purgeAgentTokens, readDid, readEmail, saveDid, saveEmail } from './api';
import { signal } from '../../shared/feedback';
import { triggerDownload } from '../../shared/download';
import { bookFreightMissing, EMPTY_ACCEPT, otpValid, parseBudget, parseDims, plannedPickupIso, type AcceptForm, type DimsForm } from './logic';
import type { GeoPoint } from '../../shared/geo';
import type {
  AgentLedgerRow,
  AgentParcelRow,
  AgentView,
  ArriveView,
  ClassifyView,
  CollectView,
  GateView,
  GeocodeView,
  HandoverView,
  IntakePreview,
  LedgerSummary,
  NetworkPoint,
  ParcelView,
  RatesView,
  ReceiveBagView,
} from './types';

export type Screen = 'home' | 'accept' | 'handover' | 'release' | 'collect' | 'receivebag' | 'rates' | 'void' | 'records';
export type Phase = 'boot' | 'signin' | 'ready' | 'outdated';

/* --- R4 registers: the shop's parcel history + earnings, server-side searched / filtered / paged --- */

export interface HistQuery {
  q: string;
  status: string;
  role: '' | 'origin' | 'dest';
  from: string;
  to: string;
  sort: 'newest' | 'oldest';
  offset: number;
}
export const HIST_LIMIT = 20;
export const INITIAL_HIST_QUERY: HistQuery = { q: '', status: '', role: '', from: '', to: '', sort: 'newest', offset: 0 };
export function histApiQuery(q: HistQuery) {
  return { q: q.q || undefined, status: q.status || undefined, role: q.role || undefined, from: q.from || undefined, to: q.to || undefined, sort: q.sort, limit: String(HIST_LIMIT), offset: String(q.offset) };
}

export interface EarnQuery {
  q: string;
  type: '' | 'TOP_UP' | 'FEE' | 'LABOR_PAYOUT' | 'REFUND' | 'OVERDRAFT';
  direction: '' | 'in' | 'out';
  from: string;
  to: string;
  sort: 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';
  offset: number;
}
export const EARN_LIMIT = 20;
export const INITIAL_EARN_QUERY: EarnQuery = { q: '', type: '', direction: '', from: '', to: '', sort: 'newest', offset: 0 };
export function earnApiQuery(q: EarnQuery) {
  return { q: q.q || undefined, type: q.type || undefined, direction: q.direction || undefined, from: q.from || undefined, to: q.to || undefined, sort: q.sort, limit: String(EARN_LIMIT), offset: String(q.offset) };
}

export interface Toast {
  id: number;
  tone: 'ok' | 'info' | 'warn' | 'danger';
  icon?: IconName;
  title: string;
  detail?: string;
}

export interface AgentState {
  phase: Phase;
  screen: Screen;
  agent: AgentView | null;
  gate: GateView | null;
  /** Parcels waiting at this shop for the bus (loaded when the handover screen opens). */
  shopParcels: ParcelView[];
  shopParcelsState: 'idle' | 'loading' | 'ready' | 'error';
  rates: RatesView | null;
  ratesState: 'idle' | 'loading' | 'ready' | 'error';
  /** R4 — the shop's parcel-history register (a filtered/paged page). */
  parcelHist: AgentParcelRow[];
  parcelHistTotal: number;
  parcelHistState: 'idle' | 'loading' | 'ready' | 'error';
  parcelHistQuery: HistQuery;
  /** R4 — the shop's earnings register (a filtered/paged page + the current view's totals). */
  ledger: AgentLedgerRow[];
  ledgerTotal: number;
  ledgerState: 'idle' | 'loading' | 'ready' | 'error';
  ledgerQuery: EarnQuery;
  ledgerSummary: LedgerSummary | null;
  error: SbgError | null;
  toasts: Toast[];
  busy: string | null;
  refreshing: boolean;
  stale: boolean;

  accept: AcceptForm;
  /** The destination-PUDO directory for the walk-up picker (Map/Address). */
  acceptPoints: NetworkPoint[];
  acceptPointsState: 'idle' | 'loading' | 'ready' | 'error';
  /** The derived tier + cargo class for the measured dims (null until all four are entered). */
  acceptDerived: ClassifyView | null;
  /** The geocoded point for the Address mode's nearest-first sort (+ a plain note on the match/quality). */
  acceptNear: GeoPoint | null;
  acceptGeoBusy: boolean;
  acceptGeoNote: string | null;
  /** DT — the label the last accept produced, shown to print + stick on the parcel (null once dismissed). */
  acceptedLabel: { parcelId: string; trackingKey?: string; svg?: string } | null;
  /** F2 — the freight the last counter booking produced: the FRT code + tracking key to print for the
   *  customer, plus the site-equipment advisory. Null until a booking succeeds / once dismissed. */
  bookedFreight: {
    code: string;
    trackingKey?: string;
    status: string;
    scheduledPickupAt?: string;
    destLabel: string;
    cargoClass: string;
    equipmentGaps?: Array<'origin' | 'dest'>;
    maxSpend?: number;
  } | null;
  /** PG4 — the scanned sticker resolved to an EXISTING parcel (a pre-minted send, a store order, or an
   *  in-use sticker); null/idle = a fresh sticker → the walk-up form. */
  preMint: IntakePreview | null;
  preMintState: 'idle' | 'loading' | 'ready' | 'error';
  preMintError: SbgError | null;
  /** Bumped to re-fire the preview for an unchanged code (a retry after a transient failure). */
  previewNonce: number;
  intakePhotoRef: string;
  /** The last completed intake — drives the "taken in, cash collected" sheet. */
  intakeDone: { parcelId: string; kind: IntakePreview['kind']; cashDue: number; destShopName?: string } | null;
  /** `missed` is the last server verdict of parcels for this bus still waiting (the S25 gate). */
  handover: { badge: string; selected: string[]; missed: string[] };
  release: { stickerId: string; parcel: ParcelView | null; otp: string; issuedOtp: string | null; stars: number; photoRef: string };
  collect: { code: string; found: CollectView | null; disputing: boolean; reason: string; photoRef: string };
  receivebag: { code: string };
  /** The reverse-logistics window: which recent drop-off is being undone, + its torn-label photo. */
  void: { parcelId: string | null; photoRef: string };
}

const EMPTY_HANDOVER = { badge: '', selected: [] as string[], missed: [] as string[] };
const EMPTY_RELEASE = { stickerId: '', parcel: null, otp: '', issuedOtp: null, stars: 0, photoRef: '' };
const EMPTY_COLLECT = { code: '', found: null, disputing: false, reason: '', photoRef: '' };

const INITIAL: AgentState = {
  phase: 'boot',
  screen: 'home',
  agent: null,
  gate: null,
  shopParcels: [],
  shopParcelsState: 'idle',
  rates: null,
  ratesState: 'idle',
  parcelHist: [],
  parcelHistTotal: 0,
  parcelHistState: 'idle',
  parcelHistQuery: INITIAL_HIST_QUERY,
  ledger: [],
  ledgerTotal: 0,
  ledgerState: 'idle',
  ledgerQuery: INITIAL_EARN_QUERY,
  ledgerSummary: null,
  error: null,
  toasts: [],
  busy: null,
  refreshing: false,
  stale: false,
  accept: { ...EMPTY_ACCEPT },
  acceptPoints: [],
  acceptPointsState: 'idle',
  acceptDerived: null,
  acceptNear: null,
  acceptGeoBusy: false,
  acceptGeoNote: null,
  acceptedLabel: null,
  bookedFreight: null,
  preMint: null,
  preMintState: 'idle',
  preMintError: null,
  previewNonce: 0,
  intakePhotoRef: '',
  intakeDone: null,
  handover: { ...EMPTY_HANDOVER },
  release: { ...EMPTY_RELEASE },
  collect: { ...EMPTY_COLLECT },
  receivebag: { code: '' },
  void: { parcelId: null, photoRef: '' },
};

const isOffline = (e: SbgError) => e.code === 'NETWORK' || e.code === 'TIMEOUT';

/** Same rule as the driver shell: a failure must always land on a screen that renders. */
export function phaseAfterFailure(phase: Phase, code: string): Phase {
  if (code === 'CLIENT_OUTDATED') return 'outdated';
  return phase === 'boot' ? 'ready' : phase;
}

function buzz(): void {
  try {
    navigator.vibrate?.(120);
  } catch {
    /* unsupported */
  }
}

export function useAgentApp() {
  const [state, setState] = useState<AgentState>(INITIAL);
  const [did, setDid] = useState<string | null>(null);
  const client = useMemo(() => (did ? createAgentClient(did) : null), [did]);
  const toastSeq = useRef(0);
  const toastTimers = useRef(new Set<number>());

  /* ---------------------------------------------------------------- toasts */

  const pushToast = useCallback((t: Omit<Toast, 'id'>) => {
    const id = ++toastSeq.current;
    setState((s) => ({ ...s, toasts: [...s.toasts, { ...t, id }] }));
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

  const signOutRef = useRef<() => void>(() => undefined);

  /**
   * One place decides what a failure means to the shell (the driver's rules, plus one):
   * a mint-sourced UNAUTHORIZED from the seeded session means the shift token died and the
   * password is not on this device — the only way forward is the sign-in screen, so route
   * there with the error instead of a dead retry loop.
   */
  const fail = useCallback((error: SbgError) => {
    if (isSignInRequired(error)) {
      signOutRef.current();
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

  const refreshEpoch = useRef(0);
  const refreshesRunning = useRef(0);

  /** Boot/refresh: me → can-transact → corridors (soft) → ping (fire-and-forget). */
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
        // Only a real identity verdict erases the stored shop: the endpoint's own 404.
        // (A mint-sourced 404 is a misrouted deploy; sign-in-required is handled by fail.)
        if (meR.error.code === 'NOT_FOUND' && !isMintSourced(meR.error)) {
          clearDid();
          client.client.session.clear();
          purgeAgentTokens(null);
          setState((s) => ({ ...INITIAL, phase: 'signin', error: meR.error, toasts: s.toasts }));
          setDid(null);
          return;
        }
        fail(meR.error);
        return;
      }
      const agent = narrow<AgentView>(meR.data);

      const gateR = await client.api.canTransact(did);
      if (superseded()) return;
      if (gateR.error) {
        setState((s) => ({ ...s, agent, phase: 'ready' }));
        fail(gateR.error);
        return;
      }
      const gate = narrow<GateView>(gateR.data);

      setState((s) => ({
        ...s,
        phase: 'ready',
        agent,
        gate,
        error: null,
        stale: false,
        refreshing: false,
      }));

      void client.api.ping(did);
    } finally {
      refreshesRunning.current -= 1;
    }
  }, [client, did, fail]);

  /* -------------------------------------------------------------- recovery */

  const refreshRef = useRef(refresh);
  const stateRef = useRef(state);
  useEffect(() => {
    refreshRef.current = refresh;
    stateRef.current = state;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const retry = () => {
      const s = stateRef.current;
      if (s.phase === 'signin' || s.phase === 'outdated') return;
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
    const stored = readDid();
    if (stored) setDid(stored);
    else setState((s) => ({ ...s, phase: 'signin' }));
  }, []);

  useEffect(() => {
    // Identity settled: drop every other shop's stored token — never on first render
    // while did is still null, which would wipe the token that survives a cold start.
    if (did) purgeAgentTokens(did);
    if (client && did) void refresh();
  }, [client, did, refresh]);

  const signIn = useCallback(
    async (email: string, password: string) => {
      const mail = email.trim().toLowerCase();
      if (!mail || !password) return;
      setState((s) => ({ ...s, busy: 'signin', error: null }));
      const r = await sbgLogin(agentConfig(), mail, password);
      if (r.error) {
        setState((s) => ({ ...s, busy: null, error: r.error }));
        return;
      }
      const login = r.data!;
      if (login.role !== 'pudo') {
        setState((s) => ({
          ...s,
          busy: null,
          error: {
            code: 'FORBIDDEN',
            status: 403,
            title: 'Not a shop account',
            detail: `This sign-in belongs to a ${login.role} account — open the ${login.role} app instead.`,
            retryable: false,
          },
        }));
        return;
      }
      // A fresh sign-in may be a different shop on a shared tablet: purge everything,
      // seed the new token under the new DID, then boot.
      purgeAgentTokens(null);
      saveDid(login.did);
      saveEmail(mail);
      const next = createAgentClient(login.did);
      await next.client.seed({ access_token: login.token.access_token, expires_in: login.token.expires_in ?? 3600 });
      setState((s) => ({ ...INITIAL, phase: 'boot', toasts: s.toasts }));
      setDid(login.did);
    },
    [],
  );

  const signOut = useCallback(() => {
    client?.client.session.clear();
    purgeAgentTokens(null);
    clearDid();
    setDid(null);
    setState(() => ({ ...INITIAL, phase: 'signin' }));
  }, [client]);
  useEffect(() => {
    signOutRef.current = signOut;
  }, [signOut]);

  const forgot = useCallback(async (email: string) => {
    const r = await sbgForgot(agentConfig(), email.trim().toLowerCase());
    if (r.error) return { error: r.error, resetToken: null as string | null, sent: false };
    return { error: null, resetToken: r.data?.resetToken ?? null, sent: Boolean(r.data?.sent) };
  }, []);

  const reset = useCallback(async (token: string, password: string) => {
    const r = await sbgReset(agentConfig(), token.trim(), password);
    return r.error ?? null;
  }, []);

  /* ----------------------------------------------------------- navigation */

  /**
   * S26: prepare + upload a captured photo, returning its mediaId (or null on failure, with a toast).
   * The downscale/EXIF-strip happens on-device; the contract field then holds this mediaId, not a filename.
   */
  const uploadPhoto = useCallback(
    async (kind: MediaKind, file: File): Promise<string | null> => {
      if (!client) return null;
      try {
        const { dataUrl, thumbDataUrl } = await downscaleImage(file);
        const r = await client.api.uploadMedia(kind, dataUrl, thumbDataUrl);
        if (r.error) {
          pushToast({ tone: 'danger', icon: 'camera', title: 'Photo upload failed', detail: errorSentence(r.error) });
          return null;
        }
        return narrow<{ mediaId: string }>(r.data)?.mediaId ?? null;
      } catch {
        pushToast({ tone: 'danger', icon: 'camera', title: 'Could not read that photo', detail: 'Try taking it again.' });
        return null;
      }
    },
    [client, pushToast],
  );

  const loadShopParcels = useCallback(async () => {
    if (!client || !did) return;
    setState((s) => ({ ...s, shopParcelsState: 'loading' }));
    const r = await client.api.parcelsAtShop(did);
    if (r.error) {
      setState((s) => ({ ...s, shopParcelsState: 'error' }));
      fail(r.error);
      return;
    }
    const rows = narrow<ParcelView[]>(r.data) ?? [];
    setState((s) => ({ ...s, shopParcels: rows, shopParcelsState: 'ready' }));
  }, [client, did, fail]);

  /** The destination directory for the walk-up picker (Map/Address). Loaded when the accept screen opens. */
  const loadAcceptPoints = useCallback(async () => {
    if (!client) return;
    if (stateRef.current.acceptPointsState === 'loading' || stateRef.current.acceptPointsState === 'ready') return;
    setState((s) => ({ ...s, acceptPointsState: 'loading' }));
    const r = await client.api.networkPoints();
    if (r.error) {
      setState((s) => ({ ...s, acceptPointsState: 'error' }));
      return;
    }
    setState((s) => ({ ...s, acceptPoints: narrow<NetworkPoint[]>(r.data) ?? [], acceptPointsState: 'ready' }));
  }, [client]);

  const loadRates = useCallback(async () => {
    if (!client) return;
    setState((s) => ({ ...s, ratesState: 'loading' }));
    const at = stateRef.current.agent?.location;
    const r = await client.api.ratesNear(at ?? undefined);
    if (r.error) {
      setState((s) => ({ ...s, rates: null, ratesState: 'error' }));
      fail(r.error);
      return;
    }
    setState((s) => ({ ...s, rates: narrow<RatesView>(r.data), ratesState: 'ready' }));
  }, [client, fail]);

  /* ----------------------------------------------------- registers (R4) */

  const histEpoch = useRef(0);
  const fetchHistoryWith = useCallback(
    async (query: HistQuery) => {
      if (!client || !did) return;
      const epoch = ++histEpoch.current;
      setState((s) => (s.parcelHistState === 'ready' ? s : { ...s, parcelHistState: 'loading' }));
      const r = await client.api.parcels(did, histApiQuery(query));
      if (epoch !== histEpoch.current) return;
      if (r.error) {
        setState((s) => ({ ...s, parcelHistState: 'error' }));
        fail(r.error);
        return;
      }
      const page = narrow<{ items?: AgentParcelRow[]; total?: number }>(r.data);
      const items = page.items ?? [];
      const total = page.total ?? 0;
      if (items.length === 0 && total > 0 && query.offset >= total) {
        const lastOffset = Math.max(0, (Math.ceil(total / HIST_LIMIT) - 1) * HIST_LIMIT);
        setState((s) => (s.parcelHistQuery.offset === query.offset ? { ...s, parcelHistQuery: { ...s.parcelHistQuery, offset: lastOffset } } : s));
        void fetchHistoryWith({ ...query, offset: lastOffset });
        return;
      }
      setState((s) => ({ ...s, parcelHist: items, parcelHistTotal: total, parcelHistState: 'ready' }));
    },
    [client, did, fail],
  );
  const queryHistory = useCallback(
    (patch: Partial<HistQuery>) => {
      const offsetOnly = Object.keys(patch).length === 1 && 'offset' in patch;
      const next: HistQuery = { ...stateRef.current.parcelHistQuery, ...patch, offset: offsetOnly ? (patch.offset ?? 0) : 0 };
      setState((s) => ({ ...s, parcelHistQuery: next, parcelHistState: 'loading' }));
      void fetchHistoryWith(next);
    },
    [fetchHistoryWith],
  );
  const loadHistory = useCallback(() => {
    void fetchHistoryWith(stateRef.current.parcelHistQuery);
  }, [fetchHistoryWith]);

  const ledgerEpoch = useRef(0);
  const fetchLedgerWith = useCallback(
    async (query: EarnQuery) => {
      if (!client || !did) return;
      const epoch = ++ledgerEpoch.current;
      setState((s) => (s.ledgerState === 'ready' ? s : { ...s, ledgerState: 'loading' }));
      const [pageR, sumR] = await Promise.all([client.api.ledger(did, earnApiQuery(query)), client.api.ledgerSummary(did, earnApiQuery(query))]);
      if (epoch !== ledgerEpoch.current) return;
      if (pageR.error) {
        // Blank the filter-dependent summary too (a failed load must not leave a stale total on the header).
        setState((s) => ({ ...s, ledgerState: 'error', ledgerSummary: null }));
        fail(pageR.error);
        return;
      }
      const page = narrow<{ items?: AgentLedgerRow[]; total?: number }>(pageR.data);
      const items = page.items ?? [];
      const total = page.total ?? 0;
      if (items.length === 0 && total > 0 && query.offset >= total) {
        const lastOffset = Math.max(0, (Math.ceil(total / EARN_LIMIT) - 1) * EARN_LIMIT);
        setState((s) => (s.ledgerQuery.offset === query.offset ? { ...s, ledgerQuery: { ...s.ledgerQuery, offset: lastOffset } } : s));
        void fetchLedgerWith({ ...query, offset: lastOffset });
        return;
      }
      const summary = sumR.error ? null : narrow<LedgerSummary>(sumR.data);
      setState((s) => ({ ...s, ledger: items, ledgerTotal: total, ledgerState: 'ready', ledgerSummary: summary }));
    },
    [client, did, fail],
  );
  const queryLedger = useCallback(
    (patch: Partial<EarnQuery>) => {
      const offsetOnly = Object.keys(patch).length === 1 && 'offset' in patch;
      const next: EarnQuery = { ...stateRef.current.ledgerQuery, ...patch, offset: offsetOnly ? (patch.offset ?? 0) : 0 };
      setState((s) => ({ ...s, ledgerQuery: next, ledgerState: 'loading' }));
      void fetchLedgerWith(next);
    },
    [fetchLedgerWith],
  );
  const loadEarnings = useCallback(() => {
    void fetchLedgerWith(stateRef.current.ledgerQuery);
  }, [fetchLedgerWith]);

  const go = useCallback(
    (screen: Screen) => {
      setState((s) => ({
        ...s,
        screen,
        error: null,
        // A fresh visit to the handover screen starts with no stale "still waiting" highlight.
        handover: screen === 'handover' ? { ...s.handover, missed: [] } : s.handover,
        void: screen === 'void' ? { parcelId: null, photoRef: '' } : s.void,
      }));
      if (screen === 'handover' || screen === 'void') void loadShopParcels();
      if (screen === 'rates') void loadRates();
      if (screen === 'accept') void loadAcceptPoints();
    },
    [loadShopParcels, loadRates, loadAcceptPoints],
  );

  /* ---------------------------------------------------------------- forms */

  const setAccept = useCallback((p: Partial<AcceptForm>) => {
    setState((s) => ({ ...s, accept: { ...s.accept, ...p } }));
  }, []);

  /* --- walk-up intake: measure + destination picker (Map | Address) --- */

  // A dims edit invalidates the derived tier AND supersedes any classify already in flight for the old
  // dims — bump the epoch so a stale result can't repopulate the just-cleared tier (and flip the P4+ warn).
  const deriveEpoch = useRef(0);
  const setDims = useCallback((patch: Partial<DimsForm>) => {
    deriveEpoch.current++;
    setState((s) => ({ ...s, accept: { ...s.accept, dims: { ...s.accept.dims, ...patch } }, acceptDerived: null }));
  }, []);

  // Classify the measured dims → the tier + cargo class (shown as a pill; P4+ warns + blocks). Epoch-guarded.
  const deriveSize = useCallback(async () => {
    const parsed = parseDims(stateRef.current.accept.dims);
    if (!client || !parsed) return;
    const epoch = ++deriveEpoch.current;
    const r = await client.api.classify(parsed.l, parsed.w, parsed.h, parsed.kg);
    if (epoch !== deriveEpoch.current || r.error) return;
    setState((s) => ({ ...s, acceptDerived: narrow<ClassifyView>(r.data) }));
  }, [client]);

  // The typed area drives the nearest-first sort + the confidence note — but ONLY after Find geocodes it.
  // Editing the text (or switching mode) drops the stale near-point/note so the list + distances can never
  // lag behind what the box says.
  const setAddress = useCallback((v: string) => {
    setState((s) => ({ ...s, accept: { ...s.accept, addressText: v }, acceptNear: null, acceptGeoNote: null }));
  }, []);

  const setDestMode = useCallback((mode: 'map' | 'address') => {
    setState((s) => ({ ...s, accept: { ...s.accept, destMode: mode }, acceptNear: null, acceptGeoNote: null }));
  }, []);

  const pickDest = useCallback((point: { did: string; zone: string; shopName: string }) => {
    setState((s) => ({ ...s, accept: { ...s.accept, destPudoDid: point.did, destZone: point.zone, destShopName: point.shopName } }));
  }, []);

  // Geocode the typed area → a point the destination list sorts nearest-first around, with a plain note on
  // the match quality (exact / approximate / best-guess) so an approximate pin isn't mistaken for exact.
  const geocodeEpoch = useRef(0);
  const geocodeAddress = useCallback(async () => {
    const q = stateRef.current.accept.addressText.trim();
    if (!client || !q) return;
    const epoch = ++geocodeEpoch.current;
    setState((s) => ({ ...s, acceptGeoBusy: true, acceptGeoNote: null }));
    const r = await client.api.geocode(q);
    if (epoch !== geocodeEpoch.current) return;
    if (r.error || !r.data) {
      setState((s) => ({ ...s, acceptGeoBusy: false, acceptGeoNote: 'Could not find that place — try a nearby area, or use the map.' }));
      return;
    }
    const g = narrow<GeocodeView>(r.data);
    const where = g.matched ?? q;
    const note = g.confidence === 'exact' ? `Nearest shops to ${where} first.` : g.confidence === 'approx' ? `Nearest shops near ${where} first (approximate).` : 'That place is not on our map — showing a best guess. Use the map if it looks off.';
    setState((s) => ({ ...s, acceptGeoBusy: false, acceptNear: g.location, acceptGeoNote: note }));
  }, [client]);
  const setHandover = useCallback((p: Partial<AgentState['handover']>) => {
    setState((s) => ({ ...s, handover: { ...s.handover, ...p } }));
  }, []);
  const toggleHandover = useCallback((parcelId: string) => {
    setState((s) => {
      const has = s.handover.selected.includes(parcelId);
      const selected = has ? s.handover.selected.filter((x) => x !== parcelId) : [...s.handover.selected, parcelId];
      // Selecting a parcel the gate flagged as missing resolves it — drop it from the highlight.
      const missed = has ? s.handover.missed : s.handover.missed.filter((x) => x !== parcelId);
      return { ...s, handover: { ...s.handover, selected, missed } };
    });
  }, []);
  const setRelease = useCallback((p: Partial<AgentState['release']>) => {
    setState((s) => ({ ...s, release: { ...s.release, ...p } }));
  }, []);
  const setCollect = useCallback((p: Partial<AgentState['collect']>) => {
    setState((s) => ({ ...s, collect: { ...s.collect, ...p } }));
  }, []);
  const setReceiveBag = useCallback((code: string) => {
    setState((s) => ({ ...s, receivebag: { code } }));
  }, []);
  const openVoid = useCallback((parcelId: string | null) => {
    setState((s) => ({ ...s, void: { parcelId, photoRef: '' }, error: null }));
  }, []);
  const setVoidPhoto = useCallback((photoRef: string) => {
    setState((s) => ({ ...s, void: { ...s.void, photoRef } }));
  }, []);

  /* ------------------------------------------------------------ mutations */

  const run = useCallback(async (key: string, fn: () => Promise<void>) => {
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
      setState((s) => (s.busy === key ? { ...s, busy: null } : s));
    }
  }, []);

  /** Export the whole current-filter parcel history (every page) as a CSV download — server-rendered. */
  const exportHistory = useCallback(async () => {
    if (!client || !did) return;
    await run('export-history', async () => {
      const q = stateRef.current.parcelHistQuery;
      const r = await client.api.parcelsExport(did, { q: q.q || undefined, status: q.status || undefined, role: q.role || undefined, from: q.from || undefined, to: q.to || undefined, sort: q.sort });
      if (r.error) return fail(r.error);
      triggerDownload('parcels.csv', narrow<string>(r.data));
      pushToast({ tone: 'ok', icon: 'check', title: 'History exported', detail: 'Saved parcels.csv to your device.' });
    });
  }, [client, did, run, fail, pushToast]);

  /** Export the whole current-filter earnings ledger (every page) as a CSV download — server-rendered. */
  const exportLedger = useCallback(async () => {
    if (!client || !did) return;
    await run('export-ledger', async () => {
      const q = stateRef.current.ledgerQuery;
      const r = await client.api.ledgerExport(did, { q: q.q || undefined, type: q.type || undefined, direction: q.direction || undefined, from: q.from || undefined, to: q.to || undefined, sort: q.sort });
      if (r.error) return fail(r.error);
      triggerDownload('earnings.csv', narrow<string>(r.data));
      pushToast({ tone: 'ok', icon: 'check', title: 'Earnings exported', detail: 'Saved earnings.csv to your device.' });
    });
  }, [client, did, run, fail, pushToast]);

  const topUp = useCallback(
    async (amount: number) => {
      if (!client || !did || !(amount > 0)) return;
      await run('topup', async () => {
        const r = await client.api.topUp(did, amount);
        if (r.error) return fail(r.error);
        buzz();
        pushToast({ tone: 'ok', icon: 'wallet', title: 'Wallet topped up', detail: `Added ${amount.toFixed(2)}.` });
        await refresh();
      });
    },
    [client, did, run, fail, pushToast, refresh],
  );

  const setOpen = useCallback(
    async (open: boolean) => {
      if (!client || !did) return;
      await run('open', async () => {
        const r = await client.api.setAvailability(did, open);
        if (r.error) return fail(r.error);
        buzz();
        pushToast(
          open
            ? { tone: 'ok', icon: 'check', title: 'Shop is open', detail: 'You will get parcels again.' }
            : { tone: 'info', icon: 'clock', title: 'Shop marked closed', detail: 'No new parcels will be routed here.' },
        );
        await refresh();
      });
    },
    [client, did, run, fail, pushToast, refresh],
  );

  const setPrice = useCallback(
    async (price: number) => {
      if (!client || !did || !(price >= 0)) return;
      await run('price', async () => {
        const r = await client.api.setPrice(did, price);
        if (r.error) return fail(r.error);
        buzz();
        pushToast({ tone: 'ok', icon: 'wallet', title: 'Price updated', detail: `You now charge ${price.toFixed(2)} per parcel.` });
        await refresh();
        if (stateRef.current.screen === 'rates') await loadRates();
      });
    },
    [client, did, run, fail, pushToast, refresh, loadRates],
  );

  const submitAccept = useCallback(async () => {
    if (!client || !did) return;
    const f = stateRef.current.accept;
    const dims = parseDims(f.dims);
    // A dedicated (P4+) load can't ride the bus — the server refuses it, so don't even send it.
    if (!dims || !f.destPudoDid || stateRef.current.acceptDerived?.dedicated) return;
    await run('accept', async () => {
      const r = await client.api.accept({
        agentDid: did,
        // The created id becomes the canonical Map key; uppercase it so it matches the
        // printed (uppercase) sticker on every later scan/lookup.
        parcelId: f.parcelId.trim().toUpperCase(),
        // The tier is DERIVED server-side from these measurements (no manual size).
        dimensionsCm: { l: dims.l, w: dims.w, h: dims.h },
        weightKg: dims.kg,
        destZone: f.destZone.trim(),
        destPudoDid: f.destPudoDid,
        senderMobile: f.senderMobile.trim() || 'n/a',
        receiverMobile: f.receiverMobile.trim() || 'n/a',
        dropoffPhotoRef: f.photoRef,
        fragile: f.fragile || undefined,
        natureCode: f.natureCode,
      });
      if (r.error) return fail(r.error);
      buzz();
      // DT — capture the label the parcel was born with so the agent can print it and stick it on the parcel
      // (peer-send parcels never had one). Clearing the form but staying on the accept screen; a Sheet shows it.
      const p = narrow<{ parcelId: string; trackingKey?: string; label?: { svg?: string } }>(r.data);
      setState((s) => ({ ...s, accept: { ...EMPTY_ACCEPT }, acceptDerived: null, acceptNear: null, acceptGeoNote: null, acceptedLabel: p ? { parcelId: p.parcelId, trackingKey: p.trackingKey, svg: p.label?.svg } : null }));
      pushToast({ tone: 'ok', icon: 'box', title: 'Parcel accepted', detail: 'A tracking message has been sent.' });
      await refresh();
    });
  }, [client, did, run, fail, pushToast, refresh]);

  /** DT — dismiss the printed-label sheet and return to the shop home. */
  const dismissAcceptedLabel = useCallback(() => setState((s) => ({ ...s, acceptedLabel: null, screen: 'home' })), []);

  /**
   * F2 — book a too-big (dedicated/P4+) walk-up as FREIGHT. Only fires for a dedicated load with a valid
   * booking (dims + destination PUDO + a cash cap, and a future date when planned); the same guard the CTA
   * uses, re-checked here so a stale click can't send. The agent is the originator; the customer's cash cap
   * becomes the freight's ceiling and settles off-platform — no wallet is billed.
   */
  const submitBookFreight = useCallback(async () => {
    if (!client || !did) return;
    const f = stateRef.current.accept;
    const dims = parseDims(f.dims);
    const cap = parseBudget(f.budgetCap);
    if (!dims || !cap || !f.destPudoDid || !stateRef.current.acceptDerived?.dedicated) return;
    if (bookFreightMissing(f, Date.now())) return;
    await run('book-freight', async () => {
      const r = await client.api.bookFreight({
        agentDid: did,
        dimensionsCm: { l: dims.l, w: dims.w, h: dims.h },
        weightKg: dims.kg,
        natureCode: f.natureCode,
        fragile: f.fragile || undefined,
        destPudoDid: f.destPudoDid,
        customerMobile: f.customerMobile.trim() || undefined,
        budgetCap: cap,
        scheduledPickupAt: plannedPickupIso(f),
        // Only meaningful for a planned load; omit it for an immediate one so the server keeps its default.
        allowEarlyClaim: f.freightWhen === 'planned' ? f.allowEarlyClaim : undefined,
      });
      if (r.error) return fail(r.error);
      buzz();
      const fr = narrow<AgentState['bookedFreight']>(r.data);
      setState((s) => ({ ...s, accept: { ...EMPTY_ACCEPT }, acceptDerived: null, acceptNear: null, acceptGeoNote: null, bookedFreight: fr }));
      pushToast({ tone: 'ok', icon: 'truck', title: 'Freight booked', detail: fr ? `Collect the cash, hand the customer code ${fr.code}.` : 'A driver will be found for this load.' });
      await refresh();
    });
  }, [client, did, run, fail, pushToast, refresh]);

  /** F2 — dismiss the booked-freight receipt and return to the shop home. */
  const dismissBookedFreight = useCallback(() => setState((s) => ({ ...s, bookedFreight: null, screen: 'home' })), []);

  /* -------------------------------------------------- pre-minted intake (PG4) */

  // The scanned sticker might already BE a parcel — a peer send booked in the Send app (cash due at this
  // counter), a store order, or a sticker that is simply in use. Resolve it as the id is typed/scanned;
  // 404 = a fresh sticker → the walk-up form stays. Debounced; a re-scan clears the PREVIOUS parcel's
  // preview + its proof photo SYNCHRONOUSLY (so A's cash card + A's photo can never sit under B's code —
  // charging or evidencing the wrong parcel), and the async result is epoch-guarded against abandonment.
  const previewEpoch = useRef(0);
  useEffect(() => {
    const id = state.accept.parcelId.trim().toUpperCase();
    const epoch = ++previewEpoch.current;
    if (!client || id.length < 6) {
      setState((s) => (s.preMint || s.preMintState !== 'idle' || s.intakePhotoRef ? { ...s, preMint: null, preMintState: 'idle', preMintError: null, intakePhotoRef: '' } : s));
      return;
    }
    // Drop the stale parcel + its photo the instant a new code is scheduled, not when the fetch lands.
    setState((s) => (s.preMint || s.preMintState !== 'loading' || s.intakePhotoRef ? { ...s, preMint: null, preMintState: 'loading', preMintError: null, intakePhotoRef: '' } : s));
    const t = setTimeout(async () => {
      const r = await client.api.intakePreview(id);
      if (epoch !== previewEpoch.current) return;
      if (r.error) {
        if (isSignInRequired(r.error)) return fail(r.error); // an expired shift → the shell's one sign-in route
        const fresh = r.error.status === 404; // an unknown id IS the normal walk-up case, not an error
        setState((s) => ({ ...s, preMint: null, preMintState: fresh ? 'idle' : 'error', preMintError: fresh ? null : r.error }));
        return;
      }
      setState((s) => ({ ...s, preMint: narrow<IntakePreview>(r.data), preMintState: 'ready', preMintError: null }));
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, state.accept.parcelId, state.previewNonce]);

  const setIntakePhoto = useCallback((ref: string) => setState((s) => ({ ...s, intakePhotoRef: ref })), []);

  /** Re-run the preview for the current code (an unchanged id won't re-fire the effect on its own). */
  const retryPreview = useCallback(() => setState((s) => ({ ...s, previewNonce: s.previewNonce + 1 })), []);

  /** Take in a pre-minted parcel: cash (peer send, photo required) or prepaid (store order). */
  const submitIntake = useCallback(async () => {
    if (!client || !did) return;
    const pm = stateRef.current.preMint;
    const photo = stateRef.current.intakePhotoRef;
    // Only ever act on a SETTLED preview — never a stale one still on screen during a re-scan's fetch.
    if (!pm || stateRef.current.preMintState !== 'ready' || (pm.kind === 'peer_send' && !photo)) return;
    await run('intake', async () => {
      const r = await client.api.intake(pm.parcelId, pm.kind === 'peer_send' ? photo : undefined);
      if (r.error) return fail(r.error);
      buzz();
      previewEpoch.current++; // the form reset below must not race a stale preview into the cleared state
      setState((s) => ({
        ...s,
        accept: { ...EMPTY_ACCEPT },
        intakePhotoRef: '',
        preMint: null,
        preMintState: 'idle',
        preMintError: null,
        intakeDone: { parcelId: pm.parcelId, kind: pm.kind, cashDue: pm.cashDue, destShopName: pm.destShopName },
      }));
      pushToast({ tone: 'ok', icon: 'wallet', title: 'Parcel taken in', detail: pm.kind === 'peer_send' ? `Collect ${pm.cashDue.toFixed(2)} in cash from the sender.` : 'Prepaid by the store — nothing to collect.' });
      await refresh();
    });
  }, [client, did, run, fail, pushToast, refresh]);

  const dismissIntakeDone = useCallback(() => setState((s) => ({ ...s, intakeDone: null })), []);

  /**
   * Hand the selected parcels to the bus. `shortShipReason` opts into the S25 short-ship: it is passed
   * only when the agent has knowingly chosen to leave the waiting parcels behind. Without it, the server
   * gate refuses a short load (INCOMPLETE_MANIFEST) and we surface exactly which parcels are still waiting
   * — the agent then loads them (and re-submits) or short-ships with a reason.
   */
  const submitHandover = useCallback(async (shortShipReason?: string) => {
    if (!client || !did) return;
    const f = stateRef.current.handover;
    if (!f.badge.trim() || f.selected.length === 0) return;
    const acknowledge = typeof shortShipReason === 'string';
    await run('handover', async () => {
      // Driver badges are DRV-<uppercase hex>, resolved by a case-sensitive Map (byBadge).
      const r = await client.api.handover(
        did,
        f.badge.trim().toUpperCase(),
        f.selected,
        acknowledge ? { acknowledgeShortShip: true, shortShipReason } : undefined,
      );
      if (r.error) {
        // The completeness gate: don't treat it as a dead failure — reconcile the list and show the
        // agent which parcels for this bus are still waiting, so they can load them or short-ship. The
        // on-screen warn Note (+ the read-aloud foot) carries the guidance, so leave the generic
        // ErrorNote banner cleared — one message, not two.
        if (r.error.code === 'INCOMPLETE_MANIFEST') {
          const missed = Array.isArray(r.error.params?.missed) ? (r.error.params!.missed as string[]) : [];
          await loadShopParcels();
          setState((s) => ({ ...s, error: null, handover: { ...s.handover, missed } }));
          return;
        }
        // Reconcile the list (some parcels may have moved), then explain.
        await loadShopParcels();
        fail(r.error);
        return;
      }
      buzz();
      const v = narrow<HandoverView>(r.data);
      const left = v?.missed?.length ?? 0;
      setState((s) => ({ ...s, handover: { ...EMPTY_HANDOVER }, screen: 'home' }));
      pushToast({
        tone: left ? 'warn' : 'ok',
        icon: 'truck',
        title: `${v?.handed?.length ?? f.selected.length} parcel(s) on the bus`,
        detail: left
          ? `${left} left behind — the control tower has been told.`
          : v?.vehicle
            ? `Loaded onto ${v.vehicle}.`
            : undefined,
      });
      await refresh();
    });
  }, [client, did, run, fail, pushToast, refresh, loadShopParcels]);

  // `override` carries a freshly scanned value: a camera read sets state AND calls here in
  // the same tick, and stateRef has not caught up yet, so the scan passes its value in.
  const findRelease = useCallback(async (override?: string) => {
    if (!client) return;
    // Parcel ids are uppercase and resolved by a case-sensitive Map — a typed lowercase
    // sticker would otherwise read as "not found".
    const id = (override ?? stateRef.current.release.stickerId).trim().toUpperCase();
    if (!id) return;
    await run('find', async () => {
      const r = await client.api.parcel(id);
      if (r.error) {
        setRelease({ parcel: null });
        return fail(r.error);
      }
      setRelease({ parcel: narrow<ParcelView>(r.data), otp: '', issuedOtp: null, stars: 0 });
    });
  }, [client, run, fail, setRelease]);

  const markArrived = useCallback(async () => {
    if (!client || !did) return;
    const f = stateRef.current.release;
    if (!f.parcel) return;
    await run('arrive', async () => {
      const r = await client.api.arrive(f.parcel!.parcelId, did);
      if (r.error) return fail(r.error);
      buzz();
      const otp = narrow<ArriveView>(r.data)?.otp ?? null;
      const again = await client.api.parcel(f.parcel!.parcelId);
      setRelease({ parcel: again.error ? f.parcel : narrow<ParcelView>(again.data), issuedOtp: otp });
      pushToast({ tone: 'ok', icon: 'keypad', title: 'Code sent to the customer' });
    });
  }, [client, did, run, fail, pushToast, setRelease]);

  const submitPickup = useCallback(async () => {
    if (!client || !did) return;
    const f = stateRef.current.release;
    if (!f.parcel || !otpValid(f.otp)) return;
    await run('pickup', async () => {
      const r = await client.api.pickup(f.parcel!.parcelId, did, f.otp.trim(), f.photoRef || undefined);
      if (r.error) return fail(r.error);
      buzz();
      const again = await client.api.parcel(f.parcel!.parcelId);
      setRelease({ parcel: again.error ? f.parcel : narrow<ParcelView>(again.data), otp: '' });
      pushToast({ tone: 'ok', icon: 'check', title: 'Delivered', detail: 'The customer has the parcel.' });
    });
  }, [client, did, run, fail, pushToast, setRelease]);

  const submitRating = useCallback(async () => {
    if (!client) return;
    const f = stateRef.current.release;
    if (!f.parcel || !f.stars) return;
    await run('rate', async () => {
      const r = await client.api.rate(f.parcel!.parcelId, f.stars, f.parcel!.receiverMobile || 'n/a');
      if (r.error) return fail(r.error);
      buzz();
      setState((s) => ({ ...s, release: { ...EMPTY_RELEASE }, screen: 'home' }));
      pushToast({ tone: 'ok', icon: 'star', title: 'Thank you', detail: 'Rating recorded.' });
    });
  }, [client, run, fail, pushToast]);

  const findCollect = useCallback(async (override?: string) => {
    if (!client || !did) return;
    // Collection codes are COL-<uppercase hex> and matched case-sensitively server-side.
    const code = (override ?? stateRef.current.collect.code).trim().toUpperCase();
    if (!code) return;
    await run('collect-find', async () => {
      const r = await client.api.collect(did, code);
      if (r.error) {
        setCollect({ found: null, disputing: false });
        return fail(r.error);
      }
      setCollect({ found: narrow<CollectView>(r.data), disputing: false });
    });
  }, [client, did, run, fail, setCollect]);

  const confirmCollect = useCallback(async () => {
    if (!client || !did) return;
    const f = stateRef.current.collect;
    if (!f.found) return;
    await run('collect-confirm', async () => {
      const r = await client.api.collectConfirm(f.found!.parcel.parcelId, did, f.code.trim());
      if (r.error) return fail(r.error);
      buzz();
      setState((s) => ({ ...s, collect: { ...EMPTY_COLLECT }, screen: 'home' }));
      pushToast({ tone: 'ok', icon: 'check', title: 'Handed over', detail: 'Order closed.' });
    });
  }, [client, did, run, fail, pushToast]);

  const submitDispute = useCallback(async () => {
    if (!client || !did) return;
    const f = stateRef.current.collect;
    if (!f.found || !f.reason.trim() || !f.photoRef) return;
    await run('dispute', async () => {
      const r = await client.api.dispute(f.found!.parcel.parcelId, did, f.reason.trim(), f.photoRef);
      if (r.error) return fail(r.error);
      buzz();
      setState((s) => ({ ...s, collect: { ...EMPTY_COLLECT }, screen: 'home' }));
      pushToast({ tone: 'info', icon: 'warning', title: 'Dispute filed', detail: 'The store has been notified.' });
    });
  }, [client, did, run, fail, pushToast]);

  const submitReceiveBag = useCallback(async (override?: string) => {
    if (!client || !did) return;
    const code = (override ?? stateRef.current.receivebag.code).trim().toUpperCase();
    if (!code) return;
    await run('receivebag', async () => {
      const r = await client.api.receiveBag(did, code);
      if (r.error) {
        signal('error');
        return fail(r.error);
      }
      signal('ok');
      const v = narrow<ReceiveBagView>(r.data);
      setState((s) => ({ ...s, receivebag: { code: '' }, screen: 'home' }));
      pushToast({
        tone: 'ok',
        icon: 'bag',
        title: 'Bag received',
        detail: `${v?.delivered?.length ?? 0} parcel(s) shelved for pickup.`,
      });
      await refresh();
    });
  }, [client, did, run, fail, pushToast, refresh]);

  /**
   * Reverse logistics (compendium Ch 16.1): undo a drop-off inside the 5-minute window with
   * a photo of the torn label, and the wallet is refunded. The server is the real clock —
   * WINDOW_EXPIRED / WRONG_PUDO come back as typed errors and fire the red signal, so a
   * worker who was a second too late hears it.
   */
  const submitVoid = useCallback(async () => {
    if (!client || !did) return;
    const { parcelId, photoRef } = stateRef.current.void;
    if (!parcelId || !photoRef) return;
    await run('void', async () => {
      const r = await client.api.voidParcel(parcelId, did, photoRef);
      if (r.error) {
        signal('error');
        await loadShopParcels();
        return fail(r.error);
      }
      signal('ok');
      setState((s) => ({ ...s, void: { parcelId: null, photoRef: '' }, screen: 'home' }));
      pushToast({ tone: 'ok', icon: 'refresh', title: 'Drop-off undone', detail: 'Your wallet was refunded.' });
      await refresh();
    });
  }, [client, did, run, fail, pushToast, refresh, loadShopParcels]);

  return {
    state,
    did,
    // The Web Push controls (N1b) — surfaced for the TopBar NotificationBell; null while signed out.
    notifications: client?.notifications ?? null,
    actions: {
      refresh,
      signIn,
      signOut,
      forgot,
      reset,
      go,
      queryHistory,
      loadHistory,
      exportHistory,
      queryLedger,
      loadEarnings,
      exportLedger,
      setAccept,
      setDims,
      deriveSize,
      setAddress,
      setDestMode,
      pickDest,
      geocodeAddress,
      setHandover,
      toggleHandover,
      setRelease,
      setCollect,
      setReceiveBag,
      topUp,
      setOpen,
      setPrice,
      submitAccept,
      dismissAcceptedLabel,
      submitBookFreight,
      dismissBookedFreight,
      setIntakePhoto,
      retryPreview,
      submitIntake,
      dismissIntakeDone,
      submitHandover,
      findRelease,
      markArrived,
      submitPickup,
      submitRating,
      findCollect,
      confirmCollect,
      submitDispute,
      submitReceiveBag,
      openVoid,
      setVoidPhoto,
      submitVoid,
      uploadPhoto,
      pushToast,
      dismissToast,
      readEmail,
    },
  };
}

export type AgentActions = ReturnType<typeof useAgentApp>['actions'];
