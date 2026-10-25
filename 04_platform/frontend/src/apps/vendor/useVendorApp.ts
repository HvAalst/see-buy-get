import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isMintSourced, isSignInRequired, narrow, sbgConfirmDevice, sbgDevicePhone, type SbgError } from '../../lib/sbg';
import { deviceAskOf, saveShopDeviceKey, shopDeviceKey, shopDevicesApi, type DeviceAsk } from '../../shared/account/shopDevice';
import { t } from '../../shared/i18n'; // plain t(): toasts/notes are built at action time in the store's active locale
import { openPage } from '../../shared/openPage';
import { papersBody } from './papers';
import { downloadZpl, triggerDownload } from '../../shared/download';
import { openSvg } from '../../shared/openPage';
import { topUpTermsOf, type TopUpTerms } from '../../shared/topup-fee';
import { downscaleImage } from '../../shared/media';
import type { Gs1DisputeView } from '../../shared/gs1';
import type { StoreGs1Api } from './gs1';
import type { IconName } from '../../shared/ui/Icon';
import {
  clearCreds,
  createVendorClient,
  fetchPlace,
  fetchPoints,
  purgeVendorTokens,
  readCreds,
  readEmail,
  saveCreds,
  saveEmail,
  vendorForgot,
  vendorLogin,
  vendorReset,
  vendorSession,
  vendorConfig,
} from './api';
import { EMPTY_MINT, dimsComplete, fromHandoff, measureOf, type MintForm } from './logic';
import type {
  ApiKeyRow,
  CallbackRow,
  CheckoutRow,
  DockPlan,
  IssuedKey,
  LedgerSummary,
  MintView,
  NetworkPoint,
  DamageReportRow,
  OrderDetail,
  OrderRow,
  OrderStats,
  OriginOption,
  PlaceFound,
  QuoteView, ReturnOfferView,
  SettlementRow,
  VendorFundingView,
  VendorLoginView,
  VendorView,
} from './types';

export type Screen = 'orders' | 'mint' | 'books' | 'dock' | 'store' | 'notes';
export type MintStep = 'source' | 'parcel' | 'dest' | 'origin' | 'price' | 'label';
export type Phase = 'boot' | 'signin' | 'ready' | 'outdated';

export interface Toast {
  id: number;
  tone: 'ok' | 'info' | 'warn' | 'danger';
  icon?: IconName;
  title: string;
  detail?: string;
}

/** R2 — the vendor shipment register query (server-side). Empty strings mean "no filter". */
export interface OrderQuery {
  q: string;
  status: string;
  pudo: string;
  from: string;
  to: string;
  paid: '' | 'paid' | 'unpaid';
  sort: 'newest' | 'oldest' | 'cost_desc' | 'cost_asc';
  offset: number;
}

export const ORDER_LIMIT = 20;
export const INITIAL_ORDER_QUERY: OrderQuery = { q: '', status: '', pudo: '', from: '', to: '', paid: '', sort: 'newest', offset: 0 };

/** Turn the UI query into the API query — dropping empties, stringifying the page bounds. */
export function orderApiQuery(q: OrderQuery) {
  return {
    q: q.q || undefined,
    status: q.status || undefined,
    pudo: q.pudo || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
    paid: q.paid || undefined,
    sort: q.sort,
    limit: String(ORDER_LIMIT),
    offset: String(q.offset),
  };
}

/** R3 — the vendor bookkeeping (ledger) register query. Empty strings mean "no filter". */
export interface LedgerQuery {
  q: string;
  type: '' | 'TOP_UP' | 'BILLING' | 'REBATE';
  direction: '' | 'in' | 'out';
  from: string;
  to: string;
  sort: 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';
  offset: number;
}

export const LEDGER_LIMIT = 20;
export const INITIAL_LEDGER_QUERY: LedgerQuery = { q: '', type: '', direction: '', from: '', to: '', sort: 'newest', offset: 0 };

export function ledgerApiQuery(q: LedgerQuery) {
  return {
    q: q.q || undefined,
    type: q.type || undefined,
    direction: q.direction || undefined,
    from: q.from || undefined,
    to: q.to || undefined,
    sort: q.sort,
    limit: String(LEDGER_LIMIT),
    offset: String(q.offset),
  };
}

export interface VendorState {
  phase: Phase;
  screen: Screen;
  vendor: VendorView | null;
  /** A prepayment asked for and not yet confirmed by the payment provider. Null when nothing is waiting. */
  funding: VendorFundingView | null;
  /** What this sister charges to prepay, so the sheet can say it before an amount is committed to.
   *  Null where nobody decided a fee — the default, and then no sentence is shown at all. */
  topUpTerms: TopUpTerms | null;
  orders: OrderRow[];
  /** The damage claim reports on this store's orders, newest first. Read with the orders. */
  damageReports: DamageReportRow[];
  ordersTotal: number;
  ordersState: 'idle' | 'loading' | 'ready' | 'error';
  orderQuery: OrderQuery;
  /** Store-wide counts (whole store, never the current page) — the header nudge + spoken summary read these. */
  orderStats: OrderStats | null;
  /** R3 — the bookkeeping register (the money ledger): a filtered/paged page + the current view's totals. */
  ledger: SettlementRow[];
  ledgerTotal: number;
  ledgerState: 'idle' | 'loading' | 'ready' | 'error';
  ledgerQuery: LedgerQuery;
  ledgerSummary: LedgerSummary | null;
  checkouts: CheckoutRow[];
  detail: OrderDetail | null;
  detailState: 'idle' | 'loading' | 'ready';
  settlement: SettlementRow[];
  callbacks: CallbackRow[];
  apiKeys: ApiKeyRow[];
  /** A key the moment it was minted — the ONE time a secret is on screen, and it is gone when dismissed. */
  issuedKey: IssuedKey | null;
  storeState: 'idle' | 'loading' | 'ready';
  /** The dock's work list. Null until fetched, and null again for a store with no dock — the screen reads
   *  `vendor.collection` to tell those two apart, never this. */
  dock: DockPlan | null;
  /** A post-mount loader: 'idle' is treated as 'loading' by the screen, so the empty state never flashes
   *  before the first response (the register epic's lesson). */
  dockState: 'idle' | 'loading' | 'ready' | 'error';
  points: NetworkPoint[];
  pointsState: 'idle' | 'loading' | 'ready' | 'error';
  originOptions: OriginOption[] | null;
  originState: 'idle' | 'loading' | 'ready' | 'error';
  /** Returns this store has been asked to decide on. Loaded with the orders, because that is where a
   *  store operator already looks and a decision nobody sees is a decision nobody makes. */
  returns: ReturnOfferView[];
  quote: QuoteView | null;
  quoteState: 'idle' | 'loading' | 'ready' | 'error';
  minted: MintView | null;
  /** DT — the twin's planned journey (hop labels + when it should be ready), fetched after mint for the label step. */
  mintedJourney: { hops: string[]; pickupReadyAt?: string; mdpRouted: boolean } | null;
  mintStep: MintStep;
  form: MintForm;
  error: SbgError | null;
  toasts: Toast[];
  busy: string | null;
  /** Round 40 — the password was right on a phone or browser new to the store: a code went to its number (or it gives one first). */
  deviceAsk: (DeviceAsk & { email: string }) | null;
  refreshing: boolean;
  stale: boolean;
}

const INITIAL: VendorState = {
  phase: 'boot',
  screen: 'orders',
  vendor: null,
  funding: null,
  topUpTerms: null,
  orders: [],
  damageReports: [],
  ordersTotal: 0,
  ordersState: 'idle',
  orderQuery: INITIAL_ORDER_QUERY,
  orderStats: null,
  ledger: [],
  ledgerTotal: 0,
  ledgerState: 'idle',
  ledgerQuery: INITIAL_LEDGER_QUERY,
  ledgerSummary: null,
  checkouts: [],
  detail: null,
  detailState: 'idle',
  settlement: [],
  callbacks: [],
  apiKeys: [],
  issuedKey: null,
  storeState: 'idle',
  dock: null,
  dockState: 'idle',
  points: [],
  pointsState: 'idle',
  originOptions: null,
  originState: 'idle',
  returns: [],
  quote: null,
  quoteState: 'idle',
  minted: null,
  mintedJourney: null,
  mintStep: 'source',
  form: { ...EMPTY_MINT },
  error: null,
  toasts: [],
  busy: null,
  deviceAsk: null,
  refreshing: false,
  stale: false,
};

const isOffline = (e: SbgError) => e.code === 'NETWORK' || e.code === 'OFFLINE' || e.code === 'TIMEOUT';

export function phaseAfterFailure(phase: Phase, code: string): Phase {
  if (code === 'CLIENT_OUTDATED') return 'outdated';
  return phase === 'boot' ? 'ready' : phase;
}

export function useVendorApp() {
  const [state, setState] = useState<VendorState>(INITIAL);
  // WHICH STORE is open on this device — and nothing that could open it. The session holds the token a sign-in returned.
  const [creds, setCreds] = useState<{ vendorId: string } | null>(null);
  const client = useMemo(() => (creds ? createVendorClient(creds.vendorId) : null), [creds]);
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

  /**
   * The sign-in on this device has ended (the token died, the password was changed elsewhere, the store is gone):
   * the only way forward is the sign-in screen, because nothing that could sign the store back in is kept here.
   * Everything else follows the shared shell rules.
   */
  const fail = useCallback((error: SbgError) => {
    if (isSignInRequired(error) || (isMintSourced(error) && (error.code === 'AUTH_FAILED' || error.code === 'UNAUTHORIZED'))) {
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
  const ordersEpoch = useRef(0);

  /**
   * The register's ONE order-page loader — every path (a store refresh, a search, a filter, a page turn)
   * runs through here so a single epoch decides which response wins: a slow store refresh can no longer
   * clobber a fresher query, nor the reverse. It shows "loading" only when the list isn't already
   * populated, so a background refresh over a ready list never flashes. And it snaps an out-of-range page
   * (offset past the end after the set shrank under us — orders settled/voided, or a refresh at a stale
   * page) back onto the last real page, instead of stranding the merchant on a false "no shipments match".
   */
  const fetchOrdersWith = useCallback(
    async (query: OrderQuery) => {
      if (!client || !creds) return;
      const epoch = ++ordersEpoch.current;
      setState((s) => (s.ordersState === 'ready' ? s : { ...s, ordersState: 'loading' }));
      const r = await client.api.orders(creds.vendorId, orderApiQuery(query));
      if (epoch !== ordersEpoch.current) return; // a newer query/refresh won the race
      if (r.error) {
        setState((s) => ({ ...s, ordersState: 'error' }));
        fail(r.error);
        return;
      }
      const page = narrow<{ items?: OrderRow[]; total?: number }>(r.data);
      const items = page.items ?? [];
      const total = page.total ?? 0;
      if (items.length === 0 && total > 0 && query.offset >= total) {
        const lastOffset = Math.max(0, (Math.ceil(total / ORDER_LIMIT) - 1) * ORDER_LIMIT);
        setState((s) => (s.orderQuery.offset === query.offset ? { ...s, orderQuery: { ...s.orderQuery, offset: lastOffset } } : s));
        void fetchOrdersWith({ ...query, offset: lastOffset });
        return;
      }
      setState((s) => ({ ...s, orders: items, ordersTotal: total, ordersState: 'ready' }));
      // The reports on the store's orders, read beside them. A failed read leaves the list as it was: it is not an error a store can act on.
      void client.api.damageReports(creds.vendorId).then((rr) => {
        if (epoch !== ordersEpoch.current || rr.error) return;
        setState((s) => ({ ...s, damageReports: narrow<{ items?: DamageReportRow[] }>(rr.data)?.items ?? [] }));
      });
    },
    [client, creds, fail],
  );

  const refresh = useCallback(async () => {
    if (!client || !creds) return;
    const epoch = ++refreshEpoch.current;
    const superseded = () => epoch !== refreshEpoch.current;

    refreshesRunning.current += 1;
    setState((s) => ({ ...s, refreshing: true }));
    try {
      const meR = await client.api.me(creds.vendorId);
      if (superseded()) return;
      if (meR.error) {
        if (meR.error.code === 'NOT_FOUND' && !isMintSourced(meR.error)) {
          clearCreds();
          client.client.session.clear();
          purgeVendorTokens(null);
          setState((s) => ({ ...INITIAL, phase: 'signin', error: meR.error, toasts: s.toasts }));
          setCreds(null);
          return;
        }
        fail(meR.error);
        return;
      }
      const vendor = narrow<VendorView>(meR.data);

      // The register page loads on its own (ordersEpoch-guarded) path; the header counts come from the
      // store-wide stats endpoint, NOT the filtered page. Both run alongside the checkouts inbox.
      void fetchOrdersWith(stateRef.current.orderQuery);
      const [statsR, checkoutsR, returnsR, fundingR] = await Promise.all([client.api.orderStats(creds.vendorId), client.api.checkouts(creds.vendorId), client.api.returns(creds.vendorId), client.api.funding(creds.vendorId)]);
      if (superseded()) return;
      setState((s) => ({
        ...s,
        phase: 'ready',
        vendor,
        orderStats: statsR.error ? s.orderStats : (narrow<OrderStats>(statsR.data) ?? s.orderStats),
        checkouts: checkoutsR.error ? s.checkouts : (narrow<CheckoutRow[]>(checkoutsR.data) ?? []),
        returns: returnsR.error ? s.returns : (narrow<{ items: ReturnOfferView[] }>(returnsR.data)?.items ?? []),
        // A prepayment still waiting on the provider — the answer to "why is my balance still low".
        funding: fundingR.error ? s.funding : (narrow<{ open: VendorFundingView | null }>(fundingR.data)?.open ?? null),
        // What a prepayment costs, carried on the same read so the sheet never has to ask separately.
        // Kept from the last good read on a failure: a fee that blinks out when one request fails would
        // leave the sheet quietly promising a free top-up it cannot honour.
        topUpTerms: fundingR.error ? s.topUpTerms : topUpTermsOf(narrow<{ terms?: unknown }>(fundingR.data)?.terms),
        error: null,
        stale: false,
        refreshing: false,
      }));
      // Surface a stats failure like any other — a swallowed count error would let the header silently read
      // "every label is paid" on missing data (the OrdersScreen also refuses to assert all-paid when null).
      if (checkoutsR.error) fail(checkoutsR.error);
      else if (statsR.error) fail(statsR.error);
    } finally {
      refreshesRunning.current -= 1;
    }
  }, [client, creds, fail, fetchOrdersWith]);

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

  /* --------------------------------------------------- shipment register (R2) */

  /** The register's one control point: merge a change into the query and reload. Any change EXCEPT paging
   *  resets to the first page (a new search/filter should not land you on page 5). */
  const queryOrders = useCallback(
    (patch: Partial<OrderQuery>) => {
      const offsetOnly = Object.keys(patch).length === 1 && 'offset' in patch;
      const next: OrderQuery = { ...stateRef.current.orderQuery, ...patch, offset: offsetOnly ? (patch.offset ?? 0) : 0 };
      setState((s) => ({ ...s, orderQuery: next, ordersState: 'loading' }));
      void fetchOrdersWith(next);
    },
    [fetchOrdersWith],
  );

  /* ----------------------------------------------- bookkeeping register (R3) */

  const ledgerEpoch = useRef(0);

  /** The bookkeeping loader — mirrors the shipment loader: one epoch decides which response wins, it shows
   *  "loading" only when the list isn't already populated, and it clamps an out-of-range page. It fetches
   *  the page AND the current-view totals together (the summary is filter-dependent, unlike the store-wide
   *  shipment counts). The always-current balance rides along on the summary. */
  const fetchLedgerWith = useCallback(
    async (query: LedgerQuery) => {
      if (!client || !creds) return;
      const epoch = ++ledgerEpoch.current;
      setState((s) => (s.ledgerState === 'ready' ? s : { ...s, ledgerState: 'loading' }));
      const [pageR, sumR] = await Promise.all([client.api.ledger(creds.vendorId, ledgerApiQuery(query)), client.api.ledgerSummary(creds.vendorId, ledgerApiQuery(query))]);
      if (epoch !== ledgerEpoch.current) return; // a newer query/refresh won the race
      if (pageR.error) {
        // Blank the filter-dependent summary too: a failed load must not leave the PREVIOUS filter's totals
        // in the header beside the new filter's error state (the whole-store balance is unaffected).
        setState((s) => ({ ...s, ledgerState: 'error', ledgerSummary: null }));
        fail(pageR.error);
        return;
      }
      const page = narrow<{ items?: SettlementRow[]; total?: number }>(pageR.data);
      const items = page.items ?? [];
      const total = page.total ?? 0;
      if (items.length === 0 && total > 0 && query.offset >= total) {
        const lastOffset = Math.max(0, (Math.ceil(total / LEDGER_LIMIT) - 1) * LEDGER_LIMIT);
        setState((s) => (s.ledgerQuery.offset === query.offset ? { ...s, ledgerQuery: { ...s.ledgerQuery, offset: lastOffset } } : s));
        void fetchLedgerWith({ ...query, offset: lastOffset });
        return;
      }
      // The summary is filter-dependent, so a failed summary must NOT keep the previous filter's totals next
      // to this filter's rows — blank it (the header then shows neutral wording, never a mismatched total).
      const summary = sumR.error ? null : narrow<LedgerSummary>(sumR.data);
      setState((s) => ({ ...s, ledger: items, ledgerTotal: total, ledgerState: 'ready', ledgerSummary: summary }));
    },
    [client, creds, fail],
  );

  /** The bookkeeping register's control point: merge a change into the query and reload (any change except
   *  paging resets to the first page). */
  const queryLedger = useCallback(
    (patch: Partial<LedgerQuery>) => {
      const offsetOnly = Object.keys(patch).length === 1 && 'offset' in patch;
      const next: LedgerQuery = { ...stateRef.current.ledgerQuery, ...patch, offset: offsetOnly ? (patch.offset ?? 0) : 0 };
      setState((s) => ({ ...s, ledgerQuery: next, ledgerState: 'loading' }));
      void fetchLedgerWith(next);
    },
    [fetchLedgerWith],
  );

  /* ------------------------------------------------------------- identity */

  useEffect(() => {
    const stored = readCreds();
    if (stored) setCreds(stored);
    else setState((s) => ({ ...s, phase: 'signin' }));
  }, []);

  useEffect(() => {
    if (creds) purgeVendorTokens(creds.vendorId);
    if (client && creds) void refresh();
  }, [client, creds, refresh]);

  /**
   * A SIGN-IN, HANDED TO THIS DEVICE. What is kept is which store it is, the email for next time, and the token —
   * never the password, and never the signing secret. A fresh sign-in may be a different store on a shared
   * computer: every other token goes first.
   */
  const enter = useCallback(async (vendorId: string, token: { access_token: string; expires_in?: number }, email?: string) => {
    purgeVendorTokens(null);
    saveCreds(vendorId);
    if (email) saveEmail(email);
    const next = createVendorClient(vendorId);
    await next.client.seed({ access_token: token.access_token, expires_in: token.expires_in ?? 3600 });
    setState((s) => ({ ...INITIAL, phase: 'boot', toasts: s.toasts }));
    setCreds({ vendorId });
  }, []);

  /** HOW A STORE SIGNS IN: its account's email and password. */
  const signIn = useCallback(
    async (email: string, password: string) => {
      const mail = email.trim().toLowerCase();
      if (!mail || !password) return;
      setState((s) => ({ ...s, busy: 'signin', error: null }));
      const r = await vendorSession(mail, password, shopDeviceKey(mail));
      if (r.error || !r.data) {
        // Round 40 — the store's sign-in works only on its own phones and browsers: a new one is confirmed by a code.
        const ask = r.error ? deviceAskOf(r.error) : null;
        if (ask) return setState((s) => ({ ...s, busy: null, error: null, deviceAsk: { ...ask, email: mail } }));
        setState((s) => ({ ...s, busy: null, error: r.error }));
        return;
      }
      await enter(r.data.vendorId, r.data.token, mail);
    },
    [enter],
  );

  /** Round 40 — the code from the store's number, typed on this browser: it is one of the store's from now, and signed in. */
  const confirmDevice = useCallback(
    async (code: string) => {
      const ask = stateRef.current.deviceAsk;
      if (!ask) return;
      setState((s) => ({ ...s, busy: 'signin', error: null }));
      const r = await sbgConfirmDevice(vendorConfig(), ask.challenge, code.trim());
      const data = r.data as unknown as VendorLoginView | undefined;
      if (r.error || !data?.vendorId) return setState((s) => ({ ...s, busy: null, error: r.error ?? null }));
      saveShopDeviceKey(ask.email, data.device);
      await enter(data.vendorId, data.token, ask.email);
    },
    [enter],
  );

  /** Round 40 — a store with no number yet gives one: the code goes to it. */
  const giveDevicePhone = useCallback(async (phone: string) => {
    const ask = stateRef.current.deviceAsk;
    if (!ask) return;
    setState((s) => ({ ...s, busy: 'signin', error: null }));
    const r = await sbgDevicePhone(vendorConfig(), ask.challenge, phone);
    if (r.error || !r.data) return setState((s) => ({ ...s, busy: null, error: r.error ?? null }));
    const sent = r.data;
    setState((s) => ({ ...s, busy: null, deviceAsk: s.deviceAsk ? { ...s.deviceAsk, challenge: sent.challenge, sentTo: sent.sentTo, needsPhone: false, ...(sent.code ? { code: sent.code } : {}) } : null }));
  }, []);

  /** Back to the email and password: another store, or another try. */
  const cancelDeviceAsk = useCallback(() => setState((s) => ({ ...s, deviceAsk: null, error: null })), []);

  /**
   * THE OLD DOOR, for a store that has set no account up yet: its store ID and signing secret, one last time. The
   * secret is used for this one request and kept nowhere; once inside, the store is asked to set its account up.
   * A store that HAS an account is refused here by the server, in words that say so.
   */
  const signInWithSecret = useCallback(
    async (vendorId: string, secret: string) => {
      const id = vendorId.trim();
      if (!id || !secret.trim()) return;
      setState((s) => ({ ...s, busy: 'signin', error: null }));
      const r = await vendorLogin(id, secret.trim());
      if (r.error || !r.data) {
        setState((s) => ({ ...s, busy: null, error: r.error }));
        return;
      }
      await enter(id, r.data.token);
    },
    [enter],
  );

  /**
   * A STORE THAT SIGNED IN WITH ITS SECRET SETS UP ITS ACCOUNT. From this moment it signs in with these, the secret
   * signs nobody in, and this device carries the new sign-in. Answers the refusal, for the sheet it was typed in.
   */
  const setUpAccount = useCallback(
    async (email: string, password: string): Promise<SbgError | null> => {
      if (!client || !creds) return null;
      const mail = email.trim().toLowerCase();
      const r = await client.client.sbg.request((c) => c.POST('/v1/sbg/vendors/{id}/account', { params: { path: { id: creds.vendorId } }, body: { email: mail, password } }));
      if (r.error) return r.error;
      const data = r.data as unknown as { email: string; token: { access_token: string; expires_in?: number } };
      saveEmail(data.email);
      await client.client.seed({ access_token: data.token.access_token, expires_in: data.token.expires_in ?? 3600 });
      setState((s) => ({ ...s, vendor: s.vendor ? { ...s.vendor, hasAccount: true } : s.vendor }));
      pushToast({ tone: 'ok', icon: 'check', title: t('vendor.toast.accountSetUp'), detail: t('vendor.toast.accountSetUpDetail', { email: data.email }) });
      return null;
    },
    [client, creds, pushToast],
  );

  /** After a password change: the server signed every session out and handed this device a fresh sign-in. */
  const adoptToken = useCallback(
    async (token: { access_token: string; expires_in?: number }) => {
      await client?.client.seed({ access_token: token.access_token, expires_in: token.expires_in ?? 3600 });
    },
    [client],
  );

  const forgot = useCallback(async (email: string) => {
    const r = await vendorForgot(email.trim().toLowerCase());
    if (r.error) return { error: r.error, resetToken: null as string | null };
    return { error: null, resetToken: r.data?.resetToken ?? null };
  }, []);

  const reset = useCallback(async (token: string, password: string) => {
    const r = await vendorReset(token.trim(), password);
    return r.error ?? null;
  }, []);

  const signOut = useCallback(() => {
    client?.client.session.clear();
    purgeVendorTokens(null);
    clearCreds();
    setCreds(null);
    setState(() => ({ ...INITIAL, phase: 'signin' }));
  }, [client]);
  useEffect(() => {
    signOutRef.current = signOut;
  }, [signOut]);

  /* ----------------------------------------------------------- navigation */

  const loadStore = useCallback(async () => {
    if (!client || !creds) return;
    setState((s) => ({ ...s, storeState: 'loading' }));
    const [setR, cbR, keyR] = await Promise.all([client.api.settlement(creds.vendorId), client.api.callbacks(creds.vendorId), client.api.apiKeys(creds.vendorId)]);
    setState((s) => ({
      ...s,
      storeState: 'ready',
      // The route answers { balance, entries } — reading the whole answer as the list made My store throw on .slice.
      settlement: setR.error ? s.settlement : settlementRowsOf(setR.data),
      callbacks: cbR.error ? s.callbacks : (narrow<CallbackRow[]>(cbR.data) ?? []),
      apiKeys: keyR.error ? s.apiKeys : (narrow<ApiKeyRow[]>(keyR.data) ?? []),
    }));
    if (setR.error) fail(setR.error);
  }, [client, creds, fail]);

  /* -------------------------------------------------------------- the dock */

  /**
   * The dock's work list.
   *
   * Only fetched for a store that HAS a dock: the endpoint 404s otherwise, and a store that has never
   * asked for one should be offered the idea rather than shown an error about it.
   */
  const loadDock = useCallback(async () => {
    if (!client || !creds) return;
    if (!stateRef.current.vendor?.collection) {
      setState((s) => ({ ...s, dock: null, dockState: 'ready' }));
      return;
    }
    setState((s) => ({ ...s, dockState: 'loading' }));
    const r = await client.api.dockPlan(creds.vendorId);
    if (r.error) {
      setState((s) => ({ ...s, dockState: 'error' }));
      fail(r.error);
      return;
    }
    setState((s) => ({ ...s, dock: narrow<DockPlan>(r.data) ?? null, dockState: 'ready' }));
  }, [client, creds, fail]);

  const go = useCallback(
    (screen: Screen) => {
      setState((s) => ({ ...s, screen, error: null }));
      if (screen === 'store') {
        void loadStore();
        // The pin editor draws the network as context; fetch once.
        if (stateRef.current.pointsState !== 'ready') void loadPointsRef.current();
      }
      if (screen === 'orders') void refresh();
      if (screen === 'books') void fetchLedgerWith(stateRef.current.ledgerQuery);
      if (screen === 'dock') void loadDock();
    },
    [loadStore, refresh, fetchLedgerWith, loadDock],
  );

  /* ----------------------------------------------------------------- mint */

  const loadPoints = useCallback(async () => {
    setState((s) => ({ ...s, pointsState: 'loading' }));
    const r = await fetchPoints();
    if (r.error) {
      setState((s) => ({ ...s, pointsState: 'error' }));
      fail(r.error);
      return;
    }
    setState((s) => ({ ...s, points: r.data ?? [], pointsState: 'ready' }));
  }, [fail]);
  /**
   * The buyer's address — the one on the order — or a place near them, looked for in the countries the shops are in,
   * to put the nearest shops first (2026-10-25: three words were a guess nobody could check). Null where it is not
   * found, or there is no signal. Kept with nobody: the place only orders the list.
   */
  const findPlace = useCallback(async (q: string): Promise<PlaceFound | null> => {
    const countries = [...new Set(stateRef.current.points.map((p) => p.country).filter((c): c is string => Boolean(c)))];
    const r = await fetchPlace(q, countries);
    if (r.error || !r.data || r.data.confidence === 'fallback') return null;
    return r.data;
  }, []);
  const loadPointsRef = useRef(loadPoints);
  useEffect(() => {
    loadPointsRef.current = loadPoints;
  }, [loadPoints]);

  const startMint = useCallback(
    (checkout?: CheckoutRow) => {
      setState((s) => ({
        ...s,
        screen: 'mint',
        minted: null,
        mintedJourney: null,
        quote: null,
        quoteState: 'idle',
        originOptions: null,
        originState: 'idle',
        form: checkout ? fromHandoff({ ...EMPTY_MINT }, checkout) : { ...EMPTY_MINT },
        mintStep: 'parcel',
        error: null,
      }));
      if (stateRef.current.pointsState !== 'ready') void loadPoints();
    },
    [loadPoints],
  );

  const setForm = useCallback((p: Partial<MintForm>) => {
    setState((s) => ({ ...s, form: { ...s.form, ...p } }));
  }, []);

  /** Round 13 — a crossing parcel's papers: three copies, opened to print with the label. */
  const printPapers = useCallback(
    async (parcelId: string) => {
      if (!client || !creds) return;
      await run(`papers:${parcelId}`, async () => {
        const r = await client.api.papersPage(creds.vendorId, parcelId);
        if (r.error || !r.data) return fail(r.error as never);
        openPage(r.data);
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [client, creds],
  );

  /** Derive the size tier live once all four measurements are in. */
  const classify = useCallback(async () => {
    if (!client) return;
    const f = stateRef.current.form;
    if (!dimsComplete(f)) return;
    const r = await client.api.classify(Number(f.l), Number(f.w), Number(f.h), Number(f.kg));
    if (!r.error) {
      const c = narrow<{ size: string; dedicated?: boolean }>(r.data);
      setState((s) => ({ ...s, form: { ...s.form, derivedSize: c?.size ?? null, dedicatedCargo: Boolean(c?.dedicated) } }));
    }
  }, [client]);

  const toStep = useCallback((mintStep: MintStep) => {
    setState((s) => ({ ...s, mintStep, error: null }));
  }, []);

  const pickDest = useCallback(
    async (destDid: string) => {
      if (!client) return;
      setState((s) => ({ ...s, form: { ...s.form, destDid, originDid: '' }, mintStep: 'origin', originState: 'loading', originOptions: null }));
      const f = stateRef.current.form;
      const size = f.derivedSize ?? 'M';
      const origins = stateRef.current.points.filter((p) => p.did !== destDid && p.openState === 'open' && p.takesNew !== false).map((p) => p.did);
      const r = await client.api.quoteOrigins(destDid, origins, size, measureOf(f), f.fragile);
      if (r.error) {
        setState((s) => ({ ...s, originState: 'error' }));
        fail(r.error);
        return;
      }
      setState((s) => ({ ...s, originOptions: narrow<{ options: OriginOption[] }>(r.data)?.options ?? [], originState: 'ready' }));
    },
    [client, fail],
  );

  const pickOrigin = useCallback(
    async (originDid: string) => {
      if (!client) return;
      setState((s) => ({ ...s, form: { ...s.form, originDid }, mintStep: 'price', quoteState: 'loading', quote: null }));
      const f = stateRef.current.form;
      const r = await client.api.quote(originDid, f.destDid, f.derivedSize ?? 'M', measureOf(f), f.fragile);
      if (r.error) {
        setState((s) => ({ ...s, quoteState: 'error' }));
        fail(r.error);
        return;
      }
      setState((s) => ({ ...s, quote: narrow<QuoteView>(r.data), quoteState: 'ready' }));
    },
    [client, fail],
  );

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

  /* ------------------------------------------------- the dock's own actions */
  // Below `run` because every one of them takes the single-flight lock. `loadDock` sits further up, with
  // the other loaders, because `go` has to reach it.

  /** Enable the dock, then immediately load its (empty) plan so the screen lands on the real thing. */
  const enableDock = useCallback(
    async (input: { label: string; zone: string; location: { lat: number; lng: number }; bays?: number }) => {
      if (!client || !creds) return;
      await run('dock-enable', async () => {
        const r = await client.api.setCollectionPoint(creds.vendorId, input);
        if (r.error) return fail(r.error);
        setState((s) => ({ ...s, vendor: narrow<VendorView>(r.data) ?? s.vendor }));
        await loadDock();
        pushToast({ tone: 'ok', icon: 'home', title: t('vendor.dock.enabled'), detail: input.label });
      });
    },
    [client, creds, run, fail, loadDock, pushToast, t],
  );

  /** Stop collecting here. Bags a driver has already accepted stay with that driver — said out loud on the
   *  screen, because it is the one consequence a store cannot undo from here. */
  const disableDock = useCallback(async () => {
    if (!client || !creds) return;
    await run('dock-disable', async () => {
      const r = await client.api.clearCollectionPoint(creds.vendorId);
      if (r.error) return fail(r.error);
      setState((s) => ({ ...s, vendor: narrow<VendorView>(r.data) ?? s.vendor, dock: null, dockState: 'ready' }));
      pushToast({ tone: 'info', icon: 'home', title: t('vendor.dock.disabled') });
    });
  }, [client, creds, run, fail, pushToast, t]);

  const openDockBag = useCallback(
    async (destZone: string) => {
      if (!client || !creds) return;
      await run(`dock-open-${destZone}`, async () => {
        const r = await client.api.openDockBag(creds.vendorId, destZone);
        if (r.error) return fail(r.error); // includes STAGING_FULL, a real limit that should read as one
        await loadDock();
      });
    },
    [client, creds, run, fail, loadDock],
  );

  const fillDockBag = useCallback(
    async (code: string, parcelId: string) => {
      if (!client || !creds) return;
      await run(`dock-fill-${parcelId}`, async () => {
        const r = await client.api.fillDockBag(creds.vendorId, code, parcelId);
        if (r.error) return fail(r.error);
        await loadDock();
      });
    },
    [client, creds, run, fail, loadDock],
  );

  /** Sealing is the store's own act and nothing else does it: closing the bag is what tells drivers near
   *  the dock there is something to collect. */
  const sealDockBag = useCallback(
    async (code: string, opts: { acknowledgeShortShip?: boolean; shortShipReason?: string; closure?: { seal?: string; photoRef: string } } = {}): Promise<boolean> => {
      if (!client || !creds) return false;
      let ok = false;
      await run(`dock-seal-${code}`, async () => {
        const r = await client.api.sealDockBag(creds.vendorId, code, opts);
        if (r.error) return fail(r.error);
        ok = true;
        await loadDock();
        pushToast({ tone: 'ok', icon: 'truck', title: t('vendor.dock.sealed'), detail: code });
      });
      return ok;
    },
    [client, creds, run, fail, loadDock, pushToast, t],
  );

  /** Round 36 — the photograph of a bag closed for the road, its coded seal in view: the store's own. */
  const uploadSealPhoto = useCallback(
    async (file: File): Promise<string | null> => {
      if (!client) return null;
      try {
        const { dataUrl, thumbDataUrl } = await downscaleImage(file);
        const r = await client.api.uploadMedia('seal', dataUrl, thumbDataUrl);
        return r.error ? null : (narrow<{ mediaId?: string }>(r.data)?.mediaId ?? null);
      } catch {
        return null;
      }
    },
    [client],
  );

  const submitMint = useCallback(async () => {
    if (!client || !creds) return;
    const f = stateRef.current.form;
    await run('mint', async () => {
      const r = await client.api.mint({
        vendorId: creds.vendorId,
        originPudoDid: f.originDid,
        destPudoDid: f.destDid,
        ...(f.checkoutId ? { checkoutId: f.checkoutId } : {}),
        ...(f.externalOrderId.trim() ? { externalOrderId: f.externalOrderId.trim() } : {}),
        ...(f.buyerMobile.trim() ? { buyerMobile: f.buyerMobile.trim() } : {}),
        ...(f.buyerEmail.trim() ? { buyerEmail: f.buyerEmail.trim() } : {}),
        dimensionsCm: { l: Number(f.l), w: Number(f.w), h: Number(f.h) },
        weightKg: Number(f.kg),
        contentPhotoRef: f.photoRef,
        routeMode: f.routeMode,
        fragile: f.fragile,
        // FP8 — box 13, for the freight lane. The server ignores them on a parcel-sized order.
        ...(f.instructions.trim() ? { instructions: f.instructions.trim() } : {}),
        ...(f.deliveryWindow.trim() ? { deliveryWindow: f.deliveryWindow.trim() } : {}),
        // Round 13 — crossing a border, its commercial invoice goes with it.
        ...(stateRef.current.quote?.crossesBorder ? { invoice: papersBody(f.papers) } : {}),
      });
      if (r.error) return fail(r.error);
      // S32: a heavy/oversized order (cargo class P4+) is DIVERTED into the dedicated-freight lane — the
      // response carries no parcel/label. Confirm it and return to the start instead of walking into the
      // label step (which dereferences the absent parcel). Parity with the old CARGO_REQUIRES_DEDICATED path.
      const diverted = r.data as { diverted?: boolean; cargoClass?: string; freight?: { equipmentGaps?: string[] } } | null;
      if (diverted?.diverted) {
        // S32c: advise if a pickup/dropoff site can't handle the cargo (no lifting gear) — arrange it.
        const gaps = diverted.freight?.equipmentGaps ?? [];
        const sites = gaps.map((g) => (g === 'origin' ? t('vendor.toast.sitePickup') : t('vendor.toast.siteDestination'))).join(' and ');
        const gapNote = gaps.length ? ' ' + t('vendor.toast.freightGap', { sites }) : '';
        setState((s) => ({ ...s, minted: null, mintStep: 'source' }));
        pushToast({ tone: 'info', icon: 'truck', title: t('vendor.toast.freightTitle'), detail: t('vendor.toast.freightDetail', { cls: diverted.cargoClass ?? '' }) + gapNote });
        await refresh();
        return;
      }
      const minted = narrow<MintView>(r.data);
      setState((s) => ({ ...s, minted, mintedJourney: null, mintStep: 'label' }));
      pushToast(
        minted.paid
          ? { tone: 'ok', icon: 'check', title: t('vendor.toast.mintedTitle'), detail: t('vendor.toast.mintedDetail') }
          : { tone: 'warn', icon: 'wallet', title: t('vendor.toast.unpaidTitle'), detail: t('vendor.toast.unpaidDetail') },
      );
      // DT — the parcel is born with a digital twin + a planned route; fetch it to show on the label step.
      const pid = minted?.parcel?.parcelId;
      if (pid) {
        const jr = await client.api.parcelRoute(pid);
        const j = narrow<{ planned?: boolean; hops?: Array<{ label: string }>; pickupReadyAt?: string; mdpRouted?: boolean }>(jr.data);
        if (j?.planned && j.hops?.length) {
          setState((s) => ({ ...s, mintedJourney: { hops: j.hops!.map((h) => h.label), pickupReadyAt: j.pickupReadyAt, mdpRouted: Boolean(j.mdpRouted) } }));
        }
      }
      await refresh();
    });
  }, [client, creds, run, fail, pushToast, refresh]);

  /** Unpaid mint → top up → settle the parcel → the label releases. */
  /**
   * Answer a return: yes, pay for its journey home — or no.
   *
   * Both go through one action because they are one decision with two endings, and both refresh: an
   * accepted return mints a new shipment that belongs in the list below it, and a declined one has to
   * leave the card so nobody answers it twice.
   */
  const answerReturn = useCallback(
    async (offerId: string, accept: boolean, reason?: string) => {
      if (!client || !creds) return;
      await run(`return:${offerId}`, async () => {
        const r = accept ? await client.api.acceptReturn(creds.vendorId, offerId) : await client.api.declineReturn(creds.vendorId, offerId, reason);
        if (r.error) return fail(r.error);
        pushToast({
          tone: 'ok',
          icon: accept ? 'truck' : 'check',
          title: accept ? t('vendor.returns.acceptedToast') : t('vendor.returns.declinedToast'),
        });
        await refresh();
      });
    },
    [client, creds, run, fail, pushToast, refresh],
  );

  /** Round 27 — an order's label, opened to print again: the store's own, once paid. */
  const printOrderLabel = useCallback(
    async (parcelId: string) => {
      if (!client || !creds) return;
      await run(`label:${parcelId}`, async () => {
        const r = await client.api.orderLabel(creds.vendorId, parcelId);
        if (r.error) return fail(r.error);
        const svg = narrow<{ svg?: string }>(r.data)?.svg;
        if (svg) openSvg(svg);
      });
    },
    [client, creds, run, fail],
  );

  /** Round 27 — the same label as a file for the store's thermal label printer (ZPL). */
  const thermalOrderLabel = useCallback(
    async (parcelId: string) => {
      if (!client || !creds) return;
      await run(`thermal:${parcelId}`, async () => {
        const r = await client.api.orderLabelZpl(creds.vendorId, parcelId);
        if (r.error) return fail(r.error);
        downloadZpl(`label-${parcelId}`, String(r.data ?? ''));
      });
    },
    [client, creds, run, fail],
  );

  const settleOrder = useCallback(
    async (parcelId: string) => {
      if (!client || !creds) return;
      await run(`settle:${parcelId}`, async () => {
        const r = await client.api.settle(parcelId);
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'check', title: t('vendor.toast.paidTitle'), detail: t('vendor.toast.paidDetail') });
        const again = await client.api.order(creds.vendorId, parcelId);
        if (!again.error) {
          setState((s) => ({
            ...s,
            // Paid now, its label issues now — kept, so the label step shows it (it read the order and dropped the label).
            minted: s.minted && s.minted.parcel.parcelId === parcelId ? { ...s.minted, paid: true, parcel: narrow<OrderDetail>(again.data), label: narrow<{ label?: MintView['label'] }>(r.data)?.label ?? s.minted.label } : s.minted,
          }));
        }
        await refresh();
      });
    },
    [client, creds, run, fail, pushToast, refresh],
  );

  /**
   * ASK to prepay — which is not prepaying.
   *
   * The twin of the shop app's, and changed for the same reason: this used to claim "Balance topped up"
   * the instant the request returned, and the balance it claimed rested on the store's own word. The
   * money model's rule 5 says money is created only by a confirmed payment, so what comes back now is a
   * reference to quote, and the balance moves when the provider confirms it.
   */
  const topUp = useCallback(
    async (amount: number, phone?: string) => {
      if (!client || !creds || !(amount > 0)) return;
      await run('topup', async () => {
        const r = await client.api.topUp(creds.vendorId, amount, phone);
        if (r.error) return fail(r.error);
        const funding = narrow<VendorFundingView>(r.data);
        setState((s) => ({ ...s, funding }));
        pushToast({ tone: 'info', icon: 'wallet', title: t('vendor.toast.topUpAsked'), detail: t('vendor.toast.topUpAskedDetail', { reference: funding.reference }) });
      });
    },
    [client, creds, run, fail, pushToast],
  );

  /** Move the store's map pin — the origin ranking and "near your store" all key off it. */
  const saveLocation = useCallback(
    async (location: { lat: number; lng: number }) => {
      if (!client || !creds) return;
      await run('location', async () => {
        const r = await client.api.update(creds.vendorId, { location });
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'pin', title: t('vendor.toast.pinSaved') });
        await refresh();
      });
    },
    [client, creds, run, fail, pushToast, refresh],
  );

  /* ---------------------------------------------------------------- orders */

  const openOrder = useCallback(
    async (parcelId: string) => {
      if (!client || !creds) return;
      setState((s) => ({ ...s, detailState: 'loading' }));
      const r = await client.api.order(creds.vendorId, parcelId);
      if (r.error) {
        setState((s) => ({ ...s, detailState: 'idle' }));
        fail(r.error);
        return;
      }
      setState((s) => ({ ...s, detail: narrow<OrderDetail>(r.data), detailState: 'ready' }));
    },
    [client, creds, fail],
  );

  const closeOrder = useCallback(() => {
    setState((s) => ({ ...s, detail: null, detailState: 'idle' }));
  }, []);

  /** Export the WHOLE current-filter result set (every page) as a CSV download — the server renders it
   *  (owner-scoped, with the same columns + formula-injection guard as the multi-select export). */
  const exportOrders = useCallback(async () => {
    if (!client || !creds) return;
    await run('export', async () => {
      const q = stateRef.current.orderQuery;
      const r = await client.api.exportOrders(creds.vendorId, {
        q: q.q || undefined,
        status: q.status || undefined,
        pudo: q.pudo || undefined,
        from: q.from || undefined,
        to: q.to || undefined,
        paid: q.paid || undefined,
        sort: q.sort,
      });
      if (r.error) return fail(r.error);
      triggerDownload('shipments.csv', narrow<string>(r.data));
      pushToast({ tone: 'ok', icon: 'check', title: t('vendor.toast.shipmentsExported'), detail: t('vendor.toast.shipmentsExportedDetail') });
    });
  }, [client, creds, run, fail, pushToast]);

  /** Export the WHOLE current-filter bookkeeping set (every page) as a CSV download — the server renders it. */
  const exportLedger = useCallback(async () => {
    if (!client || !creds) return;
    await run('export-ledger', async () => {
      const q = stateRef.current.ledgerQuery;
      const r = await client.api.ledgerExport(creds.vendorId, {
        q: q.q || undefined,
        type: q.type || undefined,
        direction: q.direction || undefined,
        from: q.from || undefined,
        to: q.to || undefined,
        sort: q.sort,
      });
      if (r.error) return fail(r.error);
      triggerDownload('bookkeeping.csv', narrow<string>(r.data));
      pushToast({ tone: 'ok', icon: 'check', title: t('vendor.toast.booksExported'), detail: t('vendor.toast.booksExportedDetail') });
    });
  }, [client, creds, run, fail, pushToast]);

  /* ----------------------------------------------------------------- store */

  const savePolicy = useCallback(
    async (patch: { mode: 'full' | 'capped'; freeOverSubtotal: number; buyerContributionCap: number; maxTransportSpend?: number; insurer?: { name: string; email: string } | null }) => {
      if (!client || !creds) return;
      await run('policy', async () => {
        const r = await client.api.update(creds.vendorId, { shippingPolicy: patch });
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'check', title: t('vendor.toast.policySaved') });
        await refresh();
      });
    },
    [client, creds, run, fail, pushToast, refresh],
  );

  /** CV5 — whether our ready_for_pickup callback carries the buyer's collection code. */
  const setCallbackCode = useCallback(
    async (on: boolean) => {
      if (!client || !creds) return;
      await run('callback-code', async () => {
        const r = await client.api.update(creds.vendorId, { callbackCarriesCode: on });
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'check', title: t(on ? 'vendor.toast.callbackCodeOn' : 'vendor.toast.callbackCodeOff') });
        await refresh();
      });
    },
    [client, creds, run, fail, pushToast, refresh],
  );

  const saveCallback = useCallback(
    async (callbackUrl: string) => {
      if (!client || !creds) return;
      await run('callback', async () => {
        const r = await client.api.update(creds.vendorId, { callbackUrl });
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'check', title: callbackUrl ? t('vendor.toast.callbackSaved') : t('vendor.toast.callbackRemoved') });
        await refresh();
      });
    },
    [client, creds, run, fail, pushToast, refresh],
  );

  /**
   * A message to the store's own system SENT AGAIN, or a test sent — and what became of it, said at once (the server answers
   * once the first try is made). Arrived, or not and why: a store that pressed a button deserves to know which.
   */
  const sendCallback = useCallback(
    async (callbackId?: string) => {
      if (!client || !creds) return;
      await run(callbackId ? `callback-resend:${callbackId}` : 'callback-test', async () => {
        const r = callbackId ? await client.api.resendCallback(creds.vendorId, callbackId) : await client.api.testCallback(creds.vendorId);
        if (r.error) return fail(r.error);
        const sent = r.data as unknown as CallbackRow;
        pushToast(
          sent.state === 'delivered'
            ? { tone: 'ok', icon: 'check', title: t('vendor.toast.callbackArrived') }
            : { tone: 'warn', icon: 'warning', title: t('vendor.toast.callbackNotArrived'), ...(sent.lastError ? { detail: sent.lastError } : {}) },
        );
        // The list it was pressed from is the store screen's: read again, so it says what became of it.
        await loadStore();
      });
    },
    [client, creds, run, fail, pushToast, loadStore, t],
  );

  /**
   * Mint a key and put the secret on screen — once.
   *
   * It is held in state rather than pushed through a toast because the merchant has to be able to READ it,
   * select it and copy it before it is gone, and a toast that disappears on a timer is exactly the wrong
   * container for the only copy of a credential.
   */
  const issueApiKey = useCallback(
    async (kind: 'publishable' | 'secret', mode: 'test' | 'live', label: string) => {
      if (!client || !creds) return;
      await run('issue-key', async () => {
        const r = await client.api.issueApiKey(creds.vendorId, { kind, mode, label: label.trim() || undefined });
        if (r.error) return fail(r.error);
        setState((s) => ({ ...s, issuedKey: narrow<IssuedKey>(r.data) ?? null }));
        await loadStore();
      });
    },
    [client, creds, run, fail, loadStore],
  );

  /**
   * Replace the store's signing secret. Being signed in is not enough: the second proof is the account's PASSWORD —
   * so a store that has LOST its secret can still replace it — or, for a store with no account yet, the current
   * secret. The new secret is returned for the screen to show ONCE and is kept nowhere on this device; every sign-in
   * the store had is ended by the server, and the answer carries a fresh one for this device.
   *
   * A REFUSAL IS ANSWERED TO THE SHEET IT WAS TYPED IN — a wrong password said on the screen behind an open sheet is
   * said to nobody. Only a sign-in that has really ended goes the shell's way, to the sign-in screen.
   */
  const rotateSecret = useCallback(
    async (proof: string): Promise<{ secret: string | null; error: SbgError | null }> => {
      if (!client || !creds) return { secret: null, error: null };
      let secret: string | null = null;
      let error: SbgError | null = null;
      await run('rotate-secret', async () => {
        const withAccount = stateRef.current.vendor?.hasAccount === true;
        const r = await client.client.sbg.request((c) => c.POST('/v1/sbg/vendors/{id}/secret/rotate', { params: { path: { id: creds.vendorId } }, body: withAccount ? { password: proof } : { secret: proof } }));
        if (r.error) {
          if (isSignInRequired(r.error)) return fail(r.error);
          error = r.error;
          return;
        }
        const data = r.data as unknown as { secret: string; secretRotatedAt?: string; token: { access_token: string; expires_in?: number } };
        await client.client.seed({ access_token: data.token.access_token, expires_in: data.token.expires_in ?? 3600 });
        // The card says when the secret was last changed: now.
        setState((s) => ({ ...s, vendor: s.vendor ? { ...s.vendor, secretRotatedAt: data.secretRotatedAt ?? s.vendor.secretRotatedAt } : s.vendor }));
        secret = data.secret;
      });
      return { secret, error };
    },
    [client, creds, run, fail],
  );

  /** Forget the one-time secret. Nothing to undo — it was never stored on our side either. */
  const dismissIssuedKey = useCallback(() => setState((s) => ({ ...s, issuedKey: null })), []);

  const revokeApiKey = useCallback(
    async (keyId: string) => {
      if (!client || !creds) return;
      await run('revoke-key', async () => {
        const r = await client.api.revokeApiKey(creds.vendorId, keyId);
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'check', title: t('vendor.toast.keyRevoked') });
        await loadStore();
      });
    },
    [client, creds, run, fail, pushToast, loadStore],
  );

  /**
   * Round 30 — THE PHOTO OF WHAT IS IN THE BOX, kept for real (the user: "A store's content photo, really kept"). It
   * used to be the file's name and nothing more, so a damage claim on a store's parcel had no "before" to show. Now it is
   * downscaled, its location data stripped, and uploaded as the store's own: the order names the id we hold.
   */
  const uploadContentPhoto = useCallback(
    async (file: File): Promise<string | null> => {
      if (!client) return null;
      try {
        const { dataUrl, thumbDataUrl } = await downscaleImage(file);
        const r = await client.api.uploadMedia('content', dataUrl, thumbDataUrl);
        return r.error ? null : (narrow<{ mediaId?: string }>(r.data)?.mediaId ?? null);
      } catch {
        return null;
      }
    },
    [client],
  );

  /** A photo the store holds, for the order that shows it: its bytes, fetched with the store's own sign-in. */
  const loadMedia = useCallback(
    async (mediaId: string) => (client ? client.api.mediaBlob(mediaId, 'thumb') : { data: null, error: 'offline' }) as Promise<{ data: Blob | null; error: unknown }>,
    [client],
  );

  /**
   * Round 29 — the store's GS1 prefix and the disputes it is in, bound to the store signed in. The card keeps its own
   * form; a prefix saved or given up reloads the store, whose record says it.
   */
  const gs1 = useMemo<StoreGs1Api | null>(() => {
    if (!client || !creds) return null;
    const id = creds.vendorId;
    const api = client.api;
    const settled = async (r: Promise<{ error: SbgError | null }>) => {
      const { error } = await r;
      if (!error) await refresh();
      return { error };
    };
    return {
      set: (companyPrefix, extensionDigit) => settled(api.setGs1(id, companyPrefix, extensionDigit)),
      clear: () => settled(api.clearGs1(id)),
      disputes: async () => {
        const r = await api.gs1Disputes(id);
        return r.error ? null : (narrow<{ items?: Gs1DisputeView[] }>(r.data)?.items ?? []);
      },
      open: (body) => api.openGs1Dispute(id, body),
      sendLicence: (disputeId, licenceRef) => api.sendGs1Licence(id, disputeId, licenceRef),
      withdraw: (disputeId) => api.withdrawGs1Dispute(id, disputeId),
      licencePhoto: async (file) => {
        try {
          const { dataUrl, thumbDataUrl } = await downscaleImage(file);
          const r = await api.uploadMedia('gs1_licence', dataUrl, thumbDataUrl);
          return r.error ? null : (narrow<{ mediaId?: string }>(r.data)?.mediaId ?? null);
        } catch {
          return null;
        }
      },
    };
  }, [client, creds, refresh]);

  /** Round 40 — the store's own phones and browsers, in Settings: read and forgotten as a shop's are. */
  const storeDevices = useMemo(
    () => (client ? shopDevicesApi((path, body) => client.client.sbg.request((raw) => raw.POST(path as never, { body } as never) as never), readEmail, 'store') : undefined),
    [client],
  );

  return {
    state,
    // The raw client, for the shared account menu — the account is the PERSON, so the surface behind it
    // is the same one every other app talks to and this app holds no opinion about it.
    sbg: client?.client.sbg ?? null,
    actions: {
      refresh,
      /** CV1 — the conversations API for this store (null until signed in). */
      chatApi: client?.conversations ?? null,
      /** The Web Push controls — a store is run by a person, and they wait on a payment like anybody else. */
      notifications: client?.notifications ?? null,
      gs1,
      uploadContentPhoto,
      loadMedia,
      issueApiKey,
      dismissIssuedKey,
      rotateSecret,
      revokeApiKey,
      queryOrders,
      queryLedger,
      exportLedger,
      signIn,
      confirmDevice,
      giveDevicePhone,
      cancelDeviceAsk,
      storeDevices,
      signInWithSecret,
      setUpAccount,
      adoptToken,
      forgot,
      reset,
      readEmail,
      signOut,
      go,
      startMint,
      setForm,
      printPapers,
      classify,
      toStep,
      pickDest,
      findPlace,
      pickOrigin,
      submitMint,
      settleOrder,
      printOrderLabel,
      thermalOrderLabel,
      topUp,
      saveLocation,
      openOrder,
      closeOrder,
      exportOrders,
      savePolicy,
      answerReturn,
      saveCallback,
      sendCallback,
      setCallbackCode,
      loadPoints,
      loadDock,
      enableDock,
      disableDock,
      openDockBag,
      fillDockBag,
      sealDockBag,
      uploadSealPhoto,
      pushToast,
      dismissToast,
    },
  };
}

/** The settlement book from GET vendors/:id/settlement — { balance, entries }, or a bare list from an older server. */
function settlementRowsOf(data: unknown): SettlementRow[] {
  if (Array.isArray(data)) return data as SettlementRow[];
  const entries = (data as { entries?: unknown } | null)?.entries;
  return Array.isArray(entries) ? (entries as SettlementRow[]) : [];
}

export type VendorActions = ReturnType<typeof useVendorApp>['actions'];
