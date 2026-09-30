import { triggerDownload } from '../../shared/download';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isUnknownIdentity, narrow, type SbgError } from '../../lib/sbg';
import type { MediaKind } from '../../lib/sbg/personas/media';
import type { MarketSeriesView } from '../../shared/market';
import { t } from '../../shared/i18n';
import { downscaleImage } from '../../shared/media';
import type { IconName } from '../../shared/ui/Icon';
import { clearManager, createFleetClient, managerLookup, managerSession, managerChoices, managerSessionByFleet, changeManagerPin, purgeFleetTokens, readManager, saveManager } from './api';
import { EMPTY_DRIVER, EMPTY_LINE, EMPTY_RUN, EMPTY_VEHICLE, isHeavySelection, lineBlocker, runBlocker, type DriverForm, type LineForm, type RunForm, type VehicleForm } from './logic';
import type { FleetEarningsSummary, FleetJobRow,
  DispatchView,
  AssignmentRow,
  CorridorRow,
  DepartureRow,
  DashboardView,
  DriverRow,
  SubtypeRow,
  VehicleRow,
} from './types';
import type { PaperView } from '../../shared/papers';
import type { GiveBackReason } from '../../shared/giveBack';
import { duplicateField, type DuplicateField } from '../../shared/duplicate';
import type { RunCancelReason } from '../../shared/runCancel';

/** The fleet company's OWN papers, as GET fleet/managers/:did/papers answers. */
export interface OwnPapers {
  papers: PaperView[];
  /** Which of them its company enforces. Usually none — and the card says so, never implies it. */
  enforced: string[];
  notOffered: string[];
  recordedAt?: string;
  /** A renewed document the office sent, waiting to be read. Its date is the office's own reading. */
  sent?: Partial<Record<OwnPaperKind, { copyRef: string; expiresAt: string; reference?: string; sentAt: string }>>;
  /** Why the last one sent was turned down — the staff member's own sentence, shown as written. */
  refused?: Partial<Record<OwnPaperKind, { reason: string; at: string; by?: string }>>;
}

export type OwnPaperKind = 'operator_licence' | 'carrier_insurance';

export type Screen = 'dash' | 'vehicles' | 'drivers' | 'sessions' | 'lines' | 'runs' | 'earnings' | 'dispatch' | 'notes';
export type Phase = 'boot' | 'signin' | 'ready' | 'outdated';

export interface Toast {
  id: number;
  tone: 'ok' | 'info' | 'warn' | 'danger';
  icon?: IconName;
  title: string;
  detail?: string;
}

export interface FleetState {
  /** Step one's answer: the fleet named by the company code, before anybody has proved who they are. */
  company: { code: string; did: string; name: string } | null;
  /** The papers being gathered for one driver. `for` is the did whose sheet is open, null when closed. */
  kyc: { for: string | null; idCopyRef: string; licenceCopyRef: string; photoRef: string };
  phase: Phase;
  screen: Screen;
  manager: { did: string; company: string } | null;
  dashboard: DashboardView | null;
  vehicles: VehicleRow[];
  drivers: DriverRow[];
  assignments: AssignmentRow[];
  corridors: CorridorRow[];
  /** F3 — the departures this fleet has put on its own lines, soonest first. */
  departures: DepartureRow[];
  /**
   * The currency this fleet's prices are in, and whether the server had to guess it.
   *
   * A fleet's country is optional at registration, so "nobody said" is a real state and the fallback to
   * USD is a real guess. A Kenyan fleet typing 450 and publishing 450 USD is the money bug this exists to
   * prevent, so the form names the currency it is asking in and says when it is assumed.
   */
  runCurrency: string;
  runCurrencyAssumed: boolean;
  /**
   * Why this fleet's runs are NOT on the shipper's board, in the server's words — suspended, or a paper its
   * company enforces has lapsed. Empty while it trades. The board filters these runs out silently for the
   * shipper; the fleet is the one party that must be told, or it watches a screen where nothing arrives.
   */
  notOffered: string[];
  /** The company's own transport licence and cover. Null until read. */
  ownPapers: OwnPapers | null;
  subtypes: SubtypeRow[];
  error: SbgError | null;
  toasts: Toast[];
  busy: string | null;
  refreshing: boolean;
  stale: boolean;
  vForm: VehicleForm;
  dForm: DriverForm;
  /** The driver being added is already registered on the network — which detail matched, and this fleet's code to hand them. */
  driverDuplicate: { field: DuplicateField; code: string | null } | null;
  cForm: { driverDid: string; vehicleId: string; corridorId: string };
  /** F1 — the line this fleet is about to propose. */
  lForm: LineForm;
  /** The departure being declared. */
  rForm: RunForm;
  /* FP1 — the earnings register. */
  earnRows: FleetJobRow[];
  earnTotal: number;
  earnState: 'idle' | 'loading' | 'ready' | 'error';
  earnQuery: EarningsQuery;
  earnSummary: FleetEarningsSummary | null;
  /* FP5 — dispatch: the market as one driver on shift would see it. */
  dispatch: DispatchView | null;
  /** CL3 — the market as a whole, so an empty board can say whether that is the market or this reach.
   *  Null until the series has been read; the board never waits on it. */
  market: MarketSeriesView | null;
  /** The driver being dispatched for ('' = let the server's first driver on shift stand in). */
  dispatchDriver: string;
  /** Reach in km from where they are; 0 = the whole market. */
  dispatchRadius: number;
  dispatchState: 'idle' | 'loading' | 'ready' | 'error';
}

export interface EarningsQuery {
  q: string;
  status: '' | 'claimed' | 'in_transit' | 'delivered' | 'cancelled';
  paid: '' | 'paid' | 'unpaid';
  driver: string;
  from: string;
  to: string;
  sort: 'newest' | 'oldest' | 'earn_desc' | 'earn_asc';
  offset: number;
}
export const EARN_LIMIT = 20;
const INITIAL_EARN_QUERY: EarningsQuery = { q: '', status: '', paid: '', driver: '', from: '', to: '', sort: 'newest', offset: 0 };
/** The wire form of the query: empty strings are absent, numbers are strings. */
function earnApiQuery(q: EarningsQuery): Record<string, string | undefined> {
  return { q: q.q || undefined, status: q.status || undefined, paid: q.paid || undefined, driver: q.driver || undefined, from: q.from || undefined, to: q.to || undefined, sort: q.sort, limit: String(EARN_LIMIT), offset: String(q.offset) };
}

const EMPTY_COUPLE = { driverDid: '', vehicleId: '', corridorId: '' };

const EMPTY_KYC = { for: null, idCopyRef: '', licenceCopyRef: '', photoRef: '' } as const;

const INITIAL: FleetState = {
  dispatch: null,
  market: null,
  dispatchDriver: '',
  dispatchRadius: 50,
  dispatchState: 'idle',
  earnRows: [],
  earnTotal: 0,
  earnState: 'idle',
  earnQuery: INITIAL_EARN_QUERY,
  earnSummary: null,
  company: null,
  kyc: { ...EMPTY_KYC },
  phase: 'boot',
  screen: 'dash',
  manager: null,
  dashboard: null,
  vehicles: [],
  drivers: [],
  assignments: [],
  corridors: [],
  departures: [],
  runCurrency: 'USD',
  runCurrencyAssumed: true,
  notOffered: [],
  ownPapers: null,
  subtypes: [],
  error: null,
  toasts: [],
  busy: null,
  refreshing: false,
  stale: false,
  vForm: { ...EMPTY_VEHICLE },
  dForm: { ...EMPTY_DRIVER },
  driverDuplicate: null,
  cForm: { ...EMPTY_COUPLE },
  lForm: { ...EMPTY_LINE },
  rForm: { ...EMPTY_RUN },
};

const isOffline = (e: SbgError) => e.code === 'NETWORK' || e.code === 'OFFLINE' || e.code === 'TIMEOUT';

export function phaseAfterFailure(phase: Phase, code: string): Phase {
  if (code === 'CLIENT_OUTDATED') return 'outdated';
  return phase === 'boot' ? 'ready' : phase;
}

export function useFleetApp() {
  const [state, setState] = useState<FleetState>(INITIAL);
  const [managerDid, setManagerDid] = useState<string | null>(null);
  const client = useMemo(() => (managerDid ? createFleetClient(managerDid) : null), [managerDid]);
  const toastSeq = useRef(0);
  const toastTimers = useRef(new Set<number>());

  /* ---------------------------------------------------------------- toasts */

  const pushToast = useCallback((toast: Omit<Toast, 'id'>) => {
    const id = ++toastSeq.current;
    setState((s) => ({ ...s, toasts: [...s.toasts, { ...toast, id }] }));
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

  const fail = useCallback((error: SbgError) => {
    // The mint rejected the manager DID itself (400): the record is gone — sign out
    // rather than looping. A mint-sourced 404 (misrouted deploy) must NOT do this.
    if (isUnknownIdentity(error)) {
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

  /** One sweep loads the whole console; partial failures keep what arrived and say so. */
  const refresh = useCallback(async () => {
    if (!client || !managerDid) return;
    const epoch = ++refreshEpoch.current;
    const superseded = () => epoch !== refreshEpoch.current;

    refreshesRunning.current += 1;
    setState((s) => ({ ...s, refreshing: true }));
    try {
      const [dashR, vehR, drvR, asgR, corR, subR, depR, ownR] = await Promise.all([
        client.api.dashboard(),
        client.api.vehicles(),
        client.api.drivers(),
        client.api.assignments(),
        client.api.corridors(),
        client.api.truckSubtypes(),
        client.api.departures(managerDid),
        client.api.ownPapers(managerDid),
      ]);
      if (superseded()) return;

      const firstError = dashR.error ?? vehR.error ?? drvR.error ?? asgR.error ?? corR.error ?? subR.error;

      setState((s) => ({
        ...s,
        phase: 'ready',
        dashboard: dashR.error ? s.dashboard : narrow<DashboardView>(dashR.data),
        vehicles: vehR.error ? s.vehicles : (narrow<VehicleRow[]>(vehR.data) ?? []),
        drivers: drvR.error ? s.drivers : (narrow<DriverRow[]>(drvR.data) ?? []),
        assignments: asgR.error ? s.assignments : (narrow<AssignmentRow[]>(asgR.data) ?? []),
        corridors: corR.error ? s.corridors : (narrow<CorridorRow[]>(corR.data) ?? []),
        departures: depR.error ? s.departures : (narrow<{ items: DepartureRow[] }>(depR.data)?.items ?? []),
        runCurrency: depR.error ? s.runCurrency : (narrow<{ currency?: string }>(depR.data)?.currency ?? s.runCurrency),
        runCurrencyAssumed: depR.error ? s.runCurrencyAssumed : Boolean(narrow<{ currencyAssumed?: boolean }>(depR.data)?.currencyAssumed),
        notOffered: depR.error ? s.notOffered : (narrow<{ notOffered?: string[] }>(depR.data)?.notOffered ?? []),
        ownPapers: ownR.error ? s.ownPapers : narrow<OwnPapers>(ownR.data),
        subtypes: subR.error ? s.subtypes : (narrow<SubtypeRow[]>(subR.data) ?? []),
        error: null,
        stale: false,
        refreshing: false,
      }));

      if (firstError) fail(firstError);
    } finally {
      refreshesRunning.current -= 1;
    }
  }, [client, managerDid, fail]);

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
    const stored = readManager();
    if (stored) {
      setState((s) => ({ ...s, manager: stored }));
      setManagerDid(stored.did);
    } else {
      setState((s) => ({ ...s, phase: 'signin' }));
    }
  }, []);

  useEffect(() => {
    if (managerDid) purgeFleetTokens(managerDid);
    if (client && managerDid) void refresh();
  }, [client, managerDid, refresh]);

  /**
   * Step one: name the fleet. No token, and nothing stored yet.
   *
   * Its whole job is so the person sees they are signing into the RIGHT company before typing a PIN —
   * and so a mistyped company code is caught here rather than blamed on their PIN two fields later,
   * which is the error that makes people think they have forgotten it.
   */
  const findCompany = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setState((s) => ({ ...s, busy: 'signin', error: null }));
    const r = await managerLookup(trimmed);
    if (r.error) {
      setState((s) => ({ ...s, busy: null, error: r.error }));
      return;
    }
    setState((s) => ({ ...s, busy: null, error: null, company: { code: trimmed, did: r.data!.did, name: r.data!.companyName } }));
  }, []);

  /** Back to the code field — somebody at the wrong company must not have to reload the app. */
  const clearCompany = useCallback(() => {
    setState((s) => ({ ...s, company: null, error: null }));
  }, []);

  /**
   * Step two: the person. The SERVER mints the token, and it is seeded into the client.
   *
   * The app used to mint its own fleet_manager token for whatever DID the code resolved to, which made
   * the sign-in screen decoration: anything holding the code had access, and nothing recorded who.
   */
  const signIn = useCallback(async (phone: string, pin: string) => {
    const company = stateRef.current.company;
    if (!company || !phone.trim() || !pin.trim()) return;
    setState((s) => ({ ...s, busy: 'signin', error: null }));
    const r = await managerSession(company.code, phone.trim(), pin.trim());
    if (r.error) {
      setState((s) => ({ ...s, busy: null, error: r.error }));
      return;
    }
    const m = r.data!;
    purgeFleetTokens(null);
    saveManager(m.did, m.companyName);
    await createFleetClient(m.did).client.seed(m.token);
    setState((s) => ({ ...INITIAL, phase: 'boot', manager: { did: m.did, company: m.companyName }, toasts: s.toasts }));
    setManagerDid(m.did);
  }, []);

  /** Forgot the code: phone + PIN name the fleets this person manages. Nothing is stored and nothing is minted. */
  const findMyFleets = useCallback(async (phone: string, pin: string) => {
    if (!phone.trim() || !pin.trim()) return null;
    setState((s) => ({ ...s, busy: 'signin', error: null }));
    const r = await managerChoices(phone.trim(), pin.trim());
    if (r.error) {
      setState((s) => ({ ...s, busy: null, error: r.error }));
      return null;
    }
    setState((s) => ({ ...s, busy: null, error: null }));
    return r.data!.fleets;
  }, []);

  /** Sign in to the fleet CHOSEN from that list — the server checks the PIN and the manager role again. */
  const signInToFleet = useCallback(async (did: string, phone: string, pin: string) => {
    setState((s) => ({ ...s, busy: 'signin', error: null }));
    const r = await managerSessionByFleet(did, phone.trim(), pin.trim());
    if (r.error) {
      setState((s) => ({ ...s, busy: null, error: r.error }));
      return;
    }
    const m = r.data!;
    purgeFleetTokens(null);
    saveManager(m.did, m.companyName);
    await createFleetClient(m.did).client.seed(m.token);
    setState((s) => ({ ...INITIAL, phase: 'boot', manager: { did: m.did, company: m.companyName }, toasts: s.toasts }));
    setManagerDid(m.did);
  }, []);

  /** The fleet's own sign-in code — readable by the fleet itself only. */
  const loadFleetCode = useCallback(async (): Promise<{ code: string; changedAt?: string } | null> => {
    const did = stateRef.current.manager?.did;
    if (!client || !did) return null;
    const r = await client.client.sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}', { params: { path: { did } } }));
    if (r.error) return null;
    const m = r.data as unknown as { loginCode?: string; codeRotatedAt?: string; createdAt?: string };
    // Never changed = as old as the fleet: the code was issued when it was registered.
    return m?.loginCode ? { code: m.loginCode, changedAt: m.codeRotatedAt ?? m.createdAt } : null;
  }, [client]);

  /** Issue the fleet a new code. The old one stops naming the fleet at once; nobody is signed out. */
  const rotateFleetCode = useCallback(async (): Promise<string | null> => {
    const did = stateRef.current.manager?.did;
    if (!client || !did) return null;
    const r = await client.client.sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/code/rotate', { params: { path: { did } } }));
    setState((s) => ({ ...s, error: r.error ?? null }));
    return r.error ? null : ((r.data as unknown as { loginCode?: string })?.loginCode ?? null);
  }, [client]);

  /** Change the manager's own PIN, proven with the current one. */
  const changeMyPin = useCallback(async (phone: string, pin: string, newPin: string): Promise<boolean> => {
    const r = await changeManagerPin(phone.trim(), pin, newPin);
    setState((s) => ({ ...s, error: r.error ?? null }));
    return !r.error;
  }, []);

  const signOut = useCallback(() => {
    client?.client.session.clear();
    purgeFleetTokens(null);
    clearManager();
    setManagerDid(null);
    setState(() => ({ ...INITIAL, phase: 'signin' }));
  }, [client]);
  useEffect(() => {
    signOutRef.current = signOut;
  }, [signOut]);

  /* ------------------------------------------------- FP1: the earnings register */

  const earnEpoch = useRef(0);
  const fetchEarningsWith = useCallback(
    async (query: EarningsQuery) => {
      const did = stateRef.current.manager?.did;
      if (!client || !did) return;
      const epoch = ++earnEpoch.current;
      setState((s) => (s.earnState === 'ready' ? s : { ...s, earnState: 'loading' }));
      const [pageR, sumR] = await Promise.all([client.api.earnings(did, earnApiQuery(query)), client.api.earningsSummary(did, earnApiQuery(query))]);
      if (epoch !== earnEpoch.current) return;
      if (pageR.error) {
        setState((s) => ({ ...s, earnState: 'error', earnSummary: null }));
        fail(pageR.error);
        return;
      }
      const page = narrow<{ items?: FleetJobRow[]; total?: number }>(pageR.data);
      const items = page.items ?? [];
      const total = page.total ?? 0;
      // A page past the end (a filter shrank the set): fall back to the last real page rather than showing nothing.
      if (items.length === 0 && total > 0 && query.offset >= total) {
        const lastOffset = Math.max(0, (Math.ceil(total / EARN_LIMIT) - 1) * EARN_LIMIT);
        setState((s) => (s.earnQuery.offset === query.offset ? { ...s, earnQuery: { ...s.earnQuery, offset: lastOffset } } : s));
        void fetchEarningsWith({ ...query, offset: lastOffset });
        return;
      }
      setState((s) => ({ ...s, earnRows: items, earnTotal: total, earnState: 'ready', earnSummary: sumR.error ? null : narrow<FleetEarningsSummary>(sumR.data) }));
    },
    [client, fail],
  );
  const queryEarnings = useCallback(
    (patch: Partial<EarningsQuery>) => {
      const offsetOnly = Object.keys(patch).length === 1 && 'offset' in patch;
      const next: EarningsQuery = { ...stateRef.current.earnQuery, ...patch, offset: offsetOnly ? (patch.offset ?? 0) : 0 };
      setState((s) => ({ ...s, earnQuery: next, earnState: 'loading' }));
      void fetchEarningsWith(next);
    },
    [fetchEarningsWith],
  );
  const exportEarnings = useCallback(async () => {
    const did = stateRef.current.manager?.did;
    if (!client || !did) return;
    setState((s) => ({ ...s, busy: 'export-earnings', error: null }));
    try {
      const q = stateRef.current.earnQuery;
      const r = await client.api.earningsExport(did, { ...earnApiQuery(q), limit: undefined, offset: undefined });
      if (r.error) return fail(r.error);
      triggerDownload('fleet-earnings.csv', narrow<string>(r.data));
      pushToast({ tone: 'ok', icon: 'check', title: t('fleet.earn.exported'), detail: t('fleet.earn.exportedDetail') });
    } finally {
      setState((s) => ({ ...s, busy: null }));
    }
  }, [client, fail, pushToast]);

  /* ------------------------------------------------------ FP5: dispatch */

  const dispatchEpoch = useRef(0);
  /**
   * Read the market for one driver on shift. With no driver chosen, the first on shift stands in — the
   * office opening this screen wants the market, not a form — and the choice is kept so a refresh does not
   * silently switch whose prices are on the screen.
   */
  const fetchDispatchWith = useCallback(
    async (driver: string, radius: number) => {
      const did = stateRef.current.manager?.did;
      if (!client || !did) return;
      const epoch = ++dispatchEpoch.current;
      setState((s) => ({ ...s, dispatchState: 'loading' }));
      const r = await client.api.dispatchView(did, { driver: driver || undefined, radiusKm: radius > 0 ? String(radius) : undefined });
      if (epoch !== dispatchEpoch.current) return;
      if (r.error) {
        setState((s) => ({ ...s, dispatchState: 'error' }));
        return fail(r.error);
      }
      const view = narrow<DispatchView>(r.data);
      if (!driver && view.drivers.length) {
        setState((s) => ({ ...s, dispatch: view, dispatchDriver: view.drivers[0].did }));
        void fetchDispatchWith(view.drivers[0].did, radius);
        return;
      }
      setState((s) => ({ ...s, dispatch: view, dispatchState: 'ready' }));
      // CL3 — the market series AFTER the board, never beside it. The board is what the dispatcher came
      // for; an analytics read that is slower must not hold it up, and the line it feeds is a footnote.
      void client.api.marketSeries().then((m) => {
        if (epoch !== dispatchEpoch.current || m.error) return;
        setState((s) => ({ ...s, market: narrow<MarketSeriesView>(m.data) }));
      });
    },
    [client, fail],
  );
  /** Open the dispatch screen, for a named driver (from a shift row) or whoever was last chosen. */
  const openDispatch = useCallback(
    (driverDid?: string) => {
      const driver = driverDid ?? stateRef.current.dispatchDriver;
      setState((s) => ({ ...s, screen: 'dispatch', error: null, dispatchDriver: driver }));
      void fetchDispatchWith(driver, stateRef.current.dispatchRadius);
    },
    [fetchDispatchWith],
  );
  const setDispatchDriver = useCallback(
    (did: string) => {
      setState((s) => ({ ...s, dispatchDriver: did }));
      void fetchDispatchWith(did, stateRef.current.dispatchRadius);
    },
    [fetchDispatchWith],
  );
  const setDispatchRadius = useCallback(
    (km: number) => {
      setState((s) => ({ ...s, dispatchRadius: km }));
      void fetchDispatchWith(stateRef.current.dispatchDriver, km);
    },
    [fetchDispatchWith],
  );

  /* ----------------------------------------------------------- navigation */

  const go = useCallback(
    (screen: Screen) => {
      setState((s) => ({ ...s, screen, error: null }));
      // The register is read when it is opened, not on every refresh: it is a page of hauls, not a live gauge.
      if (screen === 'earnings') void fetchEarningsWith(stateRef.current.earnQuery);
    },
    [fetchEarningsWith],
  );

  const setVForm = useCallback((p: Partial<VehicleForm>) => {
    setState((s) => ({ ...s, vForm: { ...s.vForm, ...p } }));
  }, []);

  /** S26: downscale + EXIF-strip + upload a captured vehicle/trailer/registration photo → its mediaId. */
  const uploadPhoto = useCallback(
    async (kind: MediaKind, file: File): Promise<string | null> => {
      if (!client) return null;
      try {
        const { dataUrl, thumbDataUrl } = await downscaleImage(file);
        const r = await client.api.uploadMedia(kind, dataUrl, thumbDataUrl);
        if (r.error) {
          pushToast({ tone: 'danger', icon: 'camera', title: t('fleet.toast.photoUploadFailed'), detail: t('fleet.toast.photoUploadFailedDetail') });
          return null;
        }
        return narrow<{ mediaId: string }>(r.data)?.mediaId ?? null;
      } catch {
        pushToast({ tone: 'danger', icon: 'camera', title: t('fleet.toast.photoUnreadable') });
        return null;
      }
    },
    [client, pushToast],
  );

  /** Authenticated byte loader for <AuthImage> — a media endpoint needs the bearer, so no plain <img src>. */
  const loadMedia = useCallback(
    (mediaId: string) => (client ? client.api.mediaBlob(mediaId) : Promise.resolve({ data: null, error: {} as unknown })),
    [client],
  );

  /** Drop a not-yet-registered vehicle photo's bytes so a removed capture never orphans on the server. */
  const deleteMedia = useCallback(
    async (mediaId: string) => {
      if (client) await client.api.deleteMedia(mediaId);
    },
    [client],
  );
  const setDForm = useCallback((p: Partial<DriverForm>) => {
    // Changing what was typed answers a duplicate: the note goes until the form is sent again.
    setState((s) => ({ ...s, dForm: { ...s.dForm, ...p }, driverDuplicate: null }));
  }, []);
  const setCForm = useCallback((p: Partial<FleetState['cForm']>) => {
    setState((s) => ({ ...s, cForm: { ...s.cForm, ...p } }));
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

  const submitVehicle = useCallback(async () => {
    if (!client || !managerDid) return;
    const f = stateRef.current.vForm;
    await run('vehicle', async () => {
      const r = await client.api.registerVehicle({
        plate: f.plate.trim(),
        vehicleClass: f.vehicleClass,
        ownerName: f.ownerName.trim(),
        ownerType: f.ownerType,
        managerDid,
        ...(f.vehicleClass === 'truck' && f.truckSubtype ? { truckSubtype: f.truckSubtype } : {}),
        ...(f.capacityKg ? { capacityKg: Number(f.capacityKg) } : {}),
        // Sent only when measured. There is no class default and there must not be one — see fleet.types.
        ...(f.deckM ? { deckM: Number(f.deckM) } : {}),
        ...(f.pricePerKm ? { pricePerKm: Number(f.pricePerKm) } : {}),
        // S34 — the pricing profile; each field defaults per class when left blank.
        ...(f.baseFee ? { baseFee: Number(f.baseFee) } : {}),
        ...(f.minMultiplier ? { minMultiplier: Number(f.minMultiplier) } : {}),
        ...(f.maxMultiplier ? { maxMultiplier: Number(f.maxMultiplier) } : {}),
        ...(f.registrationPhotoRef || f.factoryId || f.insuranceRef.trim() || f.insuranceExpiresAt || f.inspectionRef.trim() || f.inspectionExpiresAt
          ? {
              documents: {
                registrationPhotoRef: f.registrationPhotoRef || undefined,
                factoryId: f.factoryId || undefined,
                // FP4 — the papers; a blank date is simply absent (it switches nothing off).
                insuranceRef: f.insuranceRef.trim() || undefined,
                insuranceExpiresAt: f.insuranceExpiresAt || undefined,
                inspectionRef: f.inspectionRef.trim() || undefined,
                inspectionExpiresAt: f.inspectionExpiresAt || undefined,
              },
            }
          : {}),
        ...(f.vehiclePhotoRefs.length ? { vehiclePhotoRefs: f.vehiclePhotoRefs } : {}),
        ...(f.trailerPhotoRefs.length ? { trailerPhotoRefs: f.trailerPhotoRefs } : {}),
        ...(f.vehicleClass === 'truck' && f.equipment.length ? { equipment: f.equipment } : {}), // equipment applies to trucks only
      });
      if (r.error) return fail(r.error);
      const v = narrow<VehicleRow>(r.data);
      setState((s) => ({ ...s, vForm: { ...EMPTY_VEHICLE } }));
      pushToast({
        tone: 'ok',
        icon: 'truck',
        title: t('fleet.toast.vehicleRegistered', { plate: v?.plate ?? f.plate }),
        detail: v ? t('fleet.toast.vehicleRegisteredDetail', { qr: v.qr, kg: v.capacityKg, verified: v.verified ? t('fleet.toast.verifiedSuffix') : '' }) : undefined,
      });
      await refresh();
    });
  }, [client, managerDid, run, fail, pushToast, refresh]);

  const submitDriver = useCallback(async () => {
    if (!client || !managerDid) return;
    const f = stateRef.current.dForm;
    await run('driver', async () => {
      const heavy = isHeavySelection(f.classes);
      const r = await client.api.onboardDriver({
        displayName: f.displayName.trim(),
        fullName: f.fullName.trim(),
        nationalId: f.nationalId.trim(),
        mobile: f.mobile.trim(),
        licenceClasses: f.classes,
        managerDid,
        ...(heavy
          ? {
              licenceNumber: f.licenceNumber.trim(),
              ...(f.licenceExpiresAt ? { licenceExpiresAt: new Date(f.licenceExpiresAt).toISOString() } : {}),
              criminalRecordClear: f.criminalRecordClear,
            }
          : {}),
      });
      if (r.error) {
        /*
         * ALREADY REGISTERED ON THE NETWORK — not an error to retry. They cannot be added a second time; what is
         * expected is that the driver joins this fleet from their own app with this fleet's code, so the note says so
         * and hands the office the code to give them. Shown beside the form, where the office is looking.
         */
        const field = duplicateField(r.error);
        if (field) {
          const own = await loadFleetCode();
          setState((s) => ({ ...s, driverDuplicate: { field, code: own?.code ?? null } }));
          return;
        }
        return fail(r.error);
      }
      const d = narrow<DriverRow>(r.data);
      setState((s) => ({ ...s, dForm: { ...EMPTY_DRIVER }, driverDuplicate: null }));
      pushToast({
        tone: 'ok',
        icon: 'person',
        title: t('fleet.toast.driverOnboarded', { name: d?.displayName ?? f.displayName }),
        detail: d?.status === 'ACTIVE' ? t('fleet.toast.driverActiveDetail', { badge: d.badgeId ?? '' }) : t('fleet.toast.driverHeavyDetail'),
      });
      await refresh();
    });
  }, [client, managerDid, run, fail, pushToast, refresh, loadFleetCode]);

  /**
   * Send a driver's papers — with the papers.
   *
   * This used to post the literal strings 'id.jpg' and 'licence.jpg'. The contract required two document
   * references and got two filenames, so an SBG admin approving a driver was approving nothing: the
   * national id, licence number and expiry a manager types are claims by the person who benefits from
   * them being wrong, and there was never anything to check them against.
   *
   * The portrait is passed only when there is one — it is the badge picture, not evidence, and it must
   * never be the reason a real driver cannot be onboarded in a yard at dusk.
   */
  const submitKyc = useCallback(
    async (did: string, idCopyRef: string, licenceCopyRef: string, photoRef?: string) => {
      if (!client || !idCopyRef || !licenceCopyRef) return;
      await run(`kyc:${did}`, async () => {
        const r = await client.api.submitDriverKyc(did, idCopyRef, licenceCopyRef, photoRef || undefined);
        if (r.error) return fail(r.error);
        setState((s) => ({ ...s, kyc: { ...EMPTY_KYC } }));
        pushToast({ tone: 'ok', icon: 'badge', title: t('fleet.toast.kycSubmitted'), detail: t('fleet.toast.kycSubmittedDetail') });
        await refresh();
      });
    },
    [client, run, fail, pushToast, refresh],
  );

  /** Which driver's papers are being gathered, and what has been captured so far. */
  const setKyc = useCallback((p: Partial<FleetState['kyc']>) => {
    setState((s) => ({ ...s, kyc: { ...s.kyc, ...p } }));
  }, []);

  const setVehiclePrice = useCallback(
    async (vehicleId: string, price: number) => {
      if (!client || !(price >= 0)) return;
      await run(`price:${vehicleId}`, async () => {
        const r = await client.api.setVehiclePrice(vehicleId, price);
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'wallet', title: t('fleet.toast.rateUpdated'), detail: t('fleet.toast.rateUpdatedDetail', { price: price.toFixed(3) }) });
        await refresh();
      });
    },
    [client, run, fail, pushToast, refresh],
  );

  /** FP4 — record a vehicle's papers. The DATE is the switch: the day after it passes, the vehicle is off the road. */
  const setVehiclePapers = useCallback(
    async (vehicleId: string, documents: { insuranceRef?: string; insuranceExpiresAt?: string; inspectionRef?: string; inspectionExpiresAt?: string }) => {
      if (!client) return;
      await run('papers:' + vehicleId, async () => {
        const r = await client.api.setVehicleDocuments(vehicleId, documents);
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'check', title: t('fleet.toast.papersSaved'), detail: t('fleet.toast.papersSavedDetail') });
        await refresh();
      });
    },
    [client, run, fail, pushToast, refresh],
  );

  /**
   * Send the company's OWN renewed licence or policy — the image and the date the office read off it.
   *
   * Answers the refusal rather than posting it to the screen's error slot: this is sent from a sheet, and
   * an error drawn behind the sheet is an error nobody sees while the button looks like it did nothing.
   */
  const sendOwnPaper = useCallback(
    async (body: { kind: 'operator_licence' | 'carrier_insurance'; copyRef: string; expiresAt: string; reference?: string }): Promise<SbgError | null> => {
      if (!client || !managerDid) return null;
      let error = null as SbgError | null;
      await run('ownPaper', async () => {
        const r = await client.api.sendOwnPaper(managerDid, body);
        if (r.error) {
          error = r.error;
          return;
        }
        pushToast({ tone: 'ok', icon: 'check', title: t('fleet.ownPapers.sentToast'), detail: t('fleet.ownPapers.sentToastDetail') });
        await refresh();
      });
      return error;
    },
    [client, managerDid, run, pushToast, refresh],
  );

  /** FP4 — record a driver's renewed licence. The new date is the whole of the renewal. */
  const renewLicence = useCallback(
    async (did: string, body: { number?: string; expiresAt: string }) => {
      if (!client || !body.expiresAt) return;
      await run('licence:' + did, async () => {
        const r = await client.api.renewLicence(did, body);
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'check', title: t('fleet.toast.licenceSaved'), detail: t('fleet.toast.licenceSavedDetail') });
        await refresh();
      });
    },
    [client, run, fail, pushToast, refresh],
  );

  /** Put a load on a driver. The server applies every gate a claim would, and tells the driver. */
  const assignLoad = useCallback(
    async (freightId: string, driverDid: string, code: string, name: string) => {
      const did = stateRef.current.manager?.did;
      if (!client || !did) return;
      await run('assign:' + freightId, async () => {
        const r = await client.api.assign(did, { freightId, driverDid });
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'truck', title: t('fleet.dispatch.assigned', { code, name }), detail: t('fleet.dispatch.assignedDetail') });
        await fetchDispatchWith(driverDid, stateRef.current.dispatchRadius);
        await refresh();
      });
    },
    [client, run, fail, pushToast, fetchDispatchWith, refresh],
  );

  const couple = useCallback(async () => {
    if (!client) return;
    const f = stateRef.current.cForm;
    if (!f.driverDid || !f.vehicleId) return;
    await run('couple', async () => {
      const r = await client.api.couple(f.driverDid, f.vehicleId, f.corridorId || undefined);
      if (r.error) return fail(r.error);
      setState((s) => ({ ...s, cForm: { ...EMPTY_COUPLE } }));
      pushToast({ tone: 'ok', icon: 'route', title: t('fleet.toast.coupled'), detail: t('fleet.toast.coupledDetail') });
      await refresh();
    });
  }, [client, run, fail, pushToast, refresh]);

  /**
   * Put a running shift onto a corridor — the repair for a shift started without one.
   *
   * Without this the only way to add a corridor was to end the shift and start it again, which loses the
   * driver's day: the snooze, the declared road, everything that lives on the coupling.
   */
  const assignCorridor = useCallback(
    async (driverDid: string, corridorId: string) => {
      if (!client || !corridorId) return;
      await run(`corridor:${driverDid}`, async () => {
        const r = await client.api.assignCorridor(driverDid, corridorId);
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'route', title: t('fleet.toast.corridorSet'), detail: t('fleet.toast.corridorSetDetail') });
        await refresh();
      });
    },
    [client, run, fail, pushToast, refresh],
  );

  const setLForm = useCallback((p: Partial<LineForm>) => setState((s) => ({ ...s, lForm: { ...s.lForm, ...p } })), []);

  /**
   * F1 — propose a line this fleet runs. Re-reads afterwards: the line comes back PROPOSED, and the list is
   * where the fleet sees it waiting for the network rather than assuming it is live.
   */
  const proposeLine = useCallback(async () => {
    if (!client) return;
    const f = stateRef.current.lForm;
    if (lineBlocker(f, stateRef.current.corridors)) return;
    await run('line', async () => {
      const r = await client.api.proposeLine({
        originZone: f.originZone.trim(),
        destZone: f.destZone.trim(),
        vehicleType: f.vehicleType,
        ...(f.name.trim() ? { name: f.name.trim() } : {}),
        ...(f.schedule.trim() ? { schedule: f.schedule.trim() } : {}),
        ...(f.note.trim() ? { note: f.note.trim() } : {}),
      });
      if (r.error) return fail(r.error);
      setState((s) => ({ ...s, lForm: { ...EMPTY_LINE } }));
      pushToast({ tone: 'ok', icon: 'route', title: t('fleet.toast.lineProposed'), detail: t('fleet.toast.lineProposedDetail') });
      await refresh();
    });
  }, [client, run, fail, pushToast, refresh]);

  const setRForm = useCallback((p: Partial<RunForm>) => setState((s) => ({ ...s, rForm: { ...s.rForm, ...p } })), []);

  /**
   * F3 — put a departure on one of this fleet's own lines.
   *
   * The datetime the form holds is a LOCAL wall-clock string, because that is what the person typing it
   * means: "leaves Tuesday at six" is six where the truck is. It converts to an instant here, once, rather
   * than being passed around half-resolved.
   */
  const declareRun = useCallback(async () => {
    if (!client || !managerDid) return;
    const f = stateRef.current.rForm;
    if (runBlocker(f)) return;
    await run('run', async () => {
      const r = await client.api.declareDeparture(managerDid, {
        corridorId: f.corridorId,
        vehicleId: f.vehicleId,
        leavesAt: new Date(f.leavesAt).toISOString(),
        // Blank means the whole truck, and the server reads that off the vehicle's own record.
        ...(Number(f.capacityKg) > 0 ? { capacityKg: Number(f.capacityKg) } : {}),
        ...(Number(f.capacityM3) > 0 ? { capacityM3: Number(f.capacityM3) } : {}),
        basis: f.basis,
        amount: Number(f.amount),
        ...(Number(f.minCharge) > 0 ? { minCharge: Number(f.minCharge) } : {}),
        ...(Number(f.km) > 0 ? { km: Number(f.km) } : {}),
        ...(Number(f.waitingPerHour) > 0 ? { freeMin: Number(f.freeMin), waitingPerHour: Number(f.waitingPerHour) } : {}),
        ...(f.settleMethod && f.settleWhen ? { settleMethod: f.settleMethod, settleWhen: f.settleWhen } : {}),
        // A blank limit means "not said"; a typed 0 means "I carry none". Two different facts, and the
        // one thing a forwarder most needs to be able to tell apart.
        ...(f.coverLimit.trim() !== '' ? { coverLimit: Number(f.coverLimit) } : {}),
        ...(f.coverPolicy.trim() ? { coverPolicy: f.coverPolicy.trim() } : {}),
        ...(f.note.trim() ? { note: f.note.trim() } : {}),
      });
      if (r.error) return fail(r.error);
      setState((s) => ({ ...s, rForm: { ...EMPTY_RUN } }));
      pushToast({ tone: 'ok', icon: 'clock', title: t('fleet.toast.runDeclared'), detail: t('fleet.toast.runDeclaredDetail') });
      await refresh();
    });
  }, [client, managerDid, run, fail, pushToast, refresh]);

  /** Say who is driving it. Separate from declaring, because space is sold before a roster exists. */
  const assignRunDriver = useCallback(
    async (departureId: string, driverDid: string) => {
      if (!client || !managerDid) return;
      await run(`run-driver:${departureId}`, async () => {
        const r = await client.api.assignDepartureDriver(managerDid, departureId, driverDid);
        if (r.error) return fail(r.error);
        await refresh();
      });
    },
    [client, managerDid, run, fail, refresh],
  );

  /**
   * Stop selling, mark it gone, or call it off — the last of which carries the reason the shippers are owed.
   *
   * Resolves TRUE only when it went through, so the confirmation sheet can stay open on a refusal with
   * everything typed into it still there.
   */
  const setRunStatus = useCallback(
    async (departureId: string, status: 'open' | 'closed' | 'departed' | 'cancelled'): Promise<boolean> => {
      if (!client || !managerDid) return false;
      let ok = false;
      await run(`run-status:${departureId}`, async () => {
        const r = await client.api.setDepartureStatus(managerDid, departureId, status);
        if (r.error) return fail(r.error);
        ok = true;
        await refresh();
      });
      return ok;
    },
    [client, managerDid, run, fail, refresh],
  );

  /*
   * THE THREE FINAL ANSWERS the call-off sheet can give: call it off, put another truck on it, or put another
   * driver on it. Each is done now or refused by name — nothing is left pending — and each answers the refusal
   * rather than posting it to the screen's error slot, because the sheet is in front of that slot.
   */
  const sheetAct = useCallback(
    async (key: string, call: () => Promise<{ error: SbgError | null }>, done: { title: string; detail?: string }): Promise<SbgError | null> => {
      let error = null as SbgError | null;
      await run(key, async () => {
        const r = await call();
        if (r.error) {
          error = r.error;
          return;
        }
        pushToast({ tone: 'ok', icon: 'check', ...done });
        await refresh();
      });
      return error;
    },
    [run, pushToast, refresh],
  );

  /** Call a run off with a coded reason, the office's words, and — for a closed road or border — where. */
  const callOffRun = useCallback(
    async (departureId: string, why: { reason?: RunCancelReason; note?: string; closureAt?: { lat: number; lng: number } }) =>
      client && managerDid
        ? sheetAct(`run-status:${departureId}`, () => client.api.setDepartureStatus(managerDid, departureId, 'cancelled', why), {
            title: t('fleet.callOff.doneToast'),
            detail: why.closureAt ? t('fleet.callOff.doneToastMapped') : t('fleet.callOff.doneToastDetail'),
          })
        : null,
    [client, managerDid, sheetAct],
  );

  /** Put another of this fleet's trucks on the run instead of calling it off. */
  const swapRunVehicle = useCallback(
    async (departureId: string, vehicleId: string, plate: string) =>
      client && managerDid
        ? sheetAct(`run-vehicle:${departureId}`, () => client.api.swapDepartureVehicle(managerDid, departureId, vehicleId), { title: t('fleet.callOff.swappedToast', { plate }) })
        : null,
    [client, managerDid, sheetAct],
  );

  /** Put another driver on the run instead of calling it off. The same roster the run card uses, answered in the sheet. */
  const rosterInstead = useCallback(
    async (departureId: string, driverDid: string, name: string) =>
      client && managerDid
        ? sheetAct(`run-driver:${departureId}`, () => client.api.assignDepartureDriver(managerDid, departureId, driverDid), { title: t('fleet.callOff.rosteredToast', { name }) })
        : null,
    [client, managerDid, sheetAct],
  );

  /**
   * ANSWERING A CLAIM, in the fleet’s own words.
   *
   * Never weighed by us and never settled through us — we did not take this payment and we carry no
   * cover. What the answer does is turn an accusation into a record both sides can take somewhere.
   */
  const answerClaim = useCallback(
    async (departureId: string, bookingId: string, answer: 'accepted' | 'refused', note: string): Promise<boolean> => {
      if (!client || !managerDid) return false;
      let ok = false;
      await run(`claim:${bookingId}`, async () => {
        const r = await client.api.answerBookingClaim(managerDid, departureId, bookingId, answer, note.trim() || undefined);
        if (r.error) return fail(r.error);
        ok = true;
        await refresh();
      });
      return ok;
    },
    [client, managerDid, run, fail, refresh],
  );

  /**
   * The office recording what its driver did at the door.
   *
   * The driver's own app is the ordinary place for this — they are the one standing there — but a run
   * finished on a phone with no signal has to be closable from a desk, and the office is already trusted
   * with the waiting clock for exactly that reason.
   */
  const markDelivered = useCallback(
    async (departureId: string, bookingId: string) => {
      if (!client) return;
      await run(`deliver:${bookingId}`, async () => {
        const r = await client.api.markDelivered(departureId, bookingId);
        if (r.error) return fail(r.error);
        await refresh();
      });
    },
    [client, run, fail, refresh],
  );

  /**
   * Give a shipper's space back, with the reason they are shown.
   *
   * Answers the refusal rather than posting it to the screen's error slot, for the same reason the papers
   * sheet does: this is sent from a sheet, and an error drawn behind it is one nobody sees.
   */
  const giveBackBooking = useCallback(
    async (departureId: string, bookingId: string, body: { reason: GiveBackReason; note?: string }): Promise<SbgError | null> => {
      if (!client) return null;
      let error = null as SbgError | null;
      await run(`giveback:${bookingId}`, async () => {
        const r = await client.api.giveBackBooking(departureId, bookingId, body);
        if (r.error) {
          error = r.error;
          return;
        }
        pushToast({ tone: 'ok', icon: 'check', title: t('fleet.giveBack.doneToast'), detail: t('fleet.giveBack.doneToastDetail') });
        await refresh();
      });
      return error;
    },
    [client, run, pushToast, refresh],
  );

  /**
   * F4 — record a load this fleet already had, so the space it fills stops being advertised.
   *
   * The form lives in the sheet rather than in this state, the way the shipper's side does: it is filled
   * and gone in one sitting, and a half-typed customer surviving a tab change would be a worse bug than
   * losing it. Resolves TRUE only when it went through, so the sheet can stay open on a refusal.
   */
  const addOwnLoad = useCallback(
    async (
      departureId: string,
      load: { customer: string; description: string; weightKg: number; volumeM3?: number; charge?: number },
    ): Promise<boolean> => {
      if (!client || !managerDid) return false;
      let ok = false;
      await run(`own-load:${departureId}`, async () => {
        const r = await client.api.addOwnLoad(managerDid, departureId, load);
        if (r.error) return fail(r.error);
        ok = true;
        pushToast({ tone: 'ok', icon: 'truck', title: t('fleet.toast.ownAdded'), detail: t('fleet.toast.ownAddedDetail', { customer: load.customer }) });
        await refresh();
      });
      return ok;
    },
    [client, managerDid, run, fail, pushToast, refresh],
  );

  /**
   * Let a waiting charge go, with a reason.
   *
   * Resolves TRUE only when it actually went through, so the sheet above can stay open on a refusal rather
   * than closing over an error nobody read.
   */
  const waiveWait = useCallback(
    async (departureId: string, bookingId: string, where: 'loading' | 'delivery', reason: string): Promise<boolean> => {
      if (!client || !managerDid || !reason.trim()) return false;
      let ok = false;
      await run(`waive:${bookingId}:${where}`, async () => {
        const r = await client.api.waiveWaiting(managerDid, departureId, bookingId, where, reason.trim());
        if (r.error) return fail(r.error);
        ok = true;
        await refresh();
      });
      return ok;
    },
    [client, managerDid, run, fail, refresh],
  );

  const uncouple = useCallback(
    async (driverDid: string) => {
      if (!client) return;
      await run(`uncouple:${driverDid}`, async () => {
        const r = await client.api.uncouple(driverDid);
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'check', title: t('fleet.toast.sessionEnded'), detail: t('fleet.toast.sessionEndedDetail') });
        await refresh();
      });
    },
    [client, run, fail, pushToast, refresh],
  );

  return {
    state,
    // The raw client, for the shared account menu — the account is the PERSON, so the surface behind it
    // is the same one every other app talks to and this app holds no opinion about it.
    sbg: client?.client.sbg ?? null,
    actions: {
      refresh,
      signIn,
      findCompany,
      clearCompany,
      signOut,
      findMyFleets,
      signInToFleet,
      loadFleetCode,
      rotateFleetCode,
      changeMyPin,
      go,
      setVForm,
      setDForm,
      setCForm,
      uploadPhoto,
      loadMedia,
      deleteMedia,
      submitVehicle,
      submitDriver,
      submitKyc,
      setKyc,
      setVehiclePrice,
      setVehiclePapers,
      sendOwnPaper,
      giveBackBooking,
      callOffRun,
      swapRunVehicle,
      rosterInstead,
      renewLicence,
      couple,
      uncouple,
      assignCorridor,
      /** CV3 — read-only conversations the fleet's drivers shared (null until signed in). */
      chatApi: client?.conversations ?? null,
      /** The office's own inbox and push — the bell in the top bar. Null while signed out, which keeps it inert. */
      notifications: client?.notifications ?? null,
      setLForm,
      proposeLine,
      setRForm,
      declareRun,
      assignRunDriver,
      setRunStatus,
      markDelivered,
      answerClaim,
      addOwnLoad,
      waiveWait,
      queryEarnings,
      exportEarnings,
      openDispatch,
      setDispatchDriver,
      setDispatchRadius,
      assignLoad,
      /** FP2 — the consignment note of a haul one of this fleet's drivers carried. */
      freightNote: (freightId: string) => client!.api.freightNote(freightId),
      pushToast,
      dismissToast,
    },
  };
}

export type FleetActions = ReturnType<typeof useFleetApp>['actions'];
