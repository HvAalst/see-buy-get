import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isMintSourced, narrow, type SbgError } from '../../lib/sbg';
import type { IconName } from '../../shared/ui/Icon';
import {
  clearCreds,
  createVendorClient,
  fetchPoints,
  purgeVendorTokens,
  readCreds,
  saveCreds,
  vendorLogin,
  vendorRegister,
} from './api';
import { EMPTY_MINT, dimsComplete, fromHandoff, type MintForm } from './logic';
import type {
  CallbackRow,
  CheckoutRow,
  MintView,
  NetworkPoint,
  OrderDetail,
  OrderRow,
  OrderStats,
  OriginOption,
  QuoteView,
  SettlementRow,
  VendorRegisteredView,
  VendorView,
} from './types';

export type Screen = 'orders' | 'mint' | 'store';
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

export interface VendorState {
  phase: Phase;
  screen: Screen;
  vendor: VendorView | null;
  orders: OrderRow[];
  ordersTotal: number;
  ordersState: 'idle' | 'loading' | 'ready' | 'error';
  orderQuery: OrderQuery;
  /** Store-wide counts (whole store, never the current page) — the header nudge + spoken summary read these. */
  orderStats: OrderStats | null;
  checkouts: CheckoutRow[];
  /** Fresh registration — the secret is on screen exactly once. */
  registered: VendorRegisteredView | null;
  detail: OrderDetail | null;
  detailState: 'idle' | 'loading' | 'ready';
  settlement: SettlementRow[];
  callbacks: CallbackRow[];
  storeState: 'idle' | 'loading' | 'ready';
  points: NetworkPoint[];
  pointsState: 'idle' | 'loading' | 'ready' | 'error';
  originOptions: OriginOption[] | null;
  originState: 'idle' | 'loading' | 'ready' | 'error';
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
  refreshing: boolean;
  stale: boolean;
}

const INITIAL: VendorState = {
  phase: 'boot',
  screen: 'orders',
  vendor: null,
  orders: [],
  ordersTotal: 0,
  ordersState: 'idle',
  orderQuery: INITIAL_ORDER_QUERY,
  orderStats: null,
  checkouts: [],
  registered: null,
  detail: null,
  detailState: 'idle',
  settlement: [],
  callbacks: [],
  storeState: 'idle',
  points: [],
  pointsState: 'idle',
  originOptions: null,
  originState: 'idle',
  quote: null,
  quoteState: 'idle',
  minted: null,
  mintedJourney: null,
  mintStep: 'source',
  form: { ...EMPTY_MINT },
  error: null,
  toasts: [],
  busy: null,
  refreshing: false,
  stale: false,
};

const isOffline = (e: SbgError) => e.code === 'NETWORK' || e.code === 'TIMEOUT';

export function phaseAfterFailure(phase: Phase, code: string): Phase {
  if (code === 'CLIENT_OUTDATED') return 'outdated';
  return phase === 'boot' ? 'ready' : phase;
}

export function useVendorApp() {
  const [state, setState] = useState<VendorState>(INITIAL);
  const [creds, setCreds] = useState<{ vendorId: string; secret: string } | null>(null);
  const client = useMemo(() => (creds ? createVendorClient(creds.vendorId, creds.secret) : null), [creds]);
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
   * A mint-sourced AUTH_FAILED means the stored secret no longer opens the store (rotated,
   * or the store is gone): the only way forward is sign-in. Everything else follows the
   * shared shell rules.
   */
  const fail = useCallback((error: SbgError) => {
    if (isMintSourced(error) && (error.code === 'AUTH_FAILED' || error.code === 'UNAUTHORIZED')) {
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
      const [statsR, checkoutsR] = await Promise.all([client.api.orderStats(creds.vendorId), client.api.checkouts(creds.vendorId)]);
      if (superseded()) return;
      setState((s) => ({
        ...s,
        phase: 'ready',
        vendor,
        orderStats: statsR.error ? s.orderStats : (narrow<OrderStats>(statsR.data) ?? s.orderStats),
        checkouts: checkoutsR.error ? s.checkouts : (narrow<CheckoutRow[]>(checkoutsR.data) ?? []),
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

  const signIn = useCallback(async (vendorId: string, secret: string) => {
    const id = vendorId.trim();
    if (!id || !secret.trim()) return;
    setState((s) => ({ ...s, busy: 'signin', error: null }));
    const r = await vendorLogin(id, secret.trim());
    if (r.error) {
      setState((s) => ({ ...s, busy: null, error: r.error }));
      return;
    }
    purgeVendorTokens(null);
    saveCreds(id, secret.trim());
    setState((s) => ({ ...INITIAL, phase: 'boot', toasts: s.toasts }));
    setCreds({ vendorId: id, secret: secret.trim() });
  }, []);

  const register = useCallback(async (name: string, country: string, address: string) => {
    setState((s) => ({ ...s, busy: 'register', error: null }));
    const r = await vendorRegister({ name: name.trim(), country: country.trim() || undefined, address: address.trim() || undefined });
    if (r.error) {
      setState((s) => ({ ...s, busy: null, error: r.error }));
      return;
    }
    // The secret is on screen ONCE; signing in stores it as this device's credential.
    setState((s) => ({ ...s, busy: null, registered: r.data }));
  }, []);

  const adoptRegistration = useCallback(() => {
    const reg = stateRef.current.registered;
    if (!reg) return;
    purgeVendorTokens(null);
    saveCreds(reg.vendorId, reg.secret);
    setState((s) => ({ ...INITIAL, phase: 'boot', toasts: s.toasts }));
    setCreds({ vendorId: reg.vendorId, secret: reg.secret });
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
    const [setR, cbR] = await Promise.all([client.api.settlement(creds.vendorId), client.api.callbacks(creds.vendorId)]);
    setState((s) => ({
      ...s,
      storeState: 'ready',
      settlement: setR.error ? s.settlement : (narrow<SettlementRow[]>(setR.data) ?? []),
      callbacks: cbR.error ? s.callbacks : (narrow<CallbackRow[]>(cbR.data) ?? []),
    }));
    if (setR.error) fail(setR.error);
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
    },
    [loadStore, refresh],
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
      const origins = stateRef.current.points.filter((p) => p.did !== destDid && p.openState === 'open').map((p) => p.did);
      const r = await client.api.quoteOrigins(destDid, origins, size);
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
      const r = await client.api.quote(originDid, f.destDid, f.derivedSize ?? 'M');
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
      });
      if (r.error) return fail(r.error);
      // S32: a heavy/oversized order (cargo class P4+) is DIVERTED into the dedicated-freight lane — the
      // response carries no parcel/label. Confirm it and return to the start instead of walking into the
      // label step (which dereferences the absent parcel). Parity with the old CARGO_REQUIRES_DEDICATED path.
      const diverted = r.data as { diverted?: boolean; cargoClass?: string; freight?: { equipmentGaps?: string[] } } | null;
      if (diverted?.diverted) {
        // S32c: advise if a pickup/dropoff site can't handle the cargo (no lifting gear) — arrange it.
        const gaps = diverted.freight?.equipmentGaps ?? [];
        const gapNote = gaps.length ? ` Arrange lifting equipment at the ${gaps.map((g) => (g === 'origin' ? 'pickup' : 'destination')).join(' and ')}.` : '';
        setState((s) => ({ ...s, minted: null, mintStep: 'source' }));
        pushToast({ tone: 'info', icon: 'truck', title: 'Sent to dedicated freight', detail: `This load is too big for the parcel network (class ${diverted.cargoClass}) — a dedicated-freight job was created.${gapNote}` });
        await refresh();
        return;
      }
      const minted = narrow<MintView>(r.data);
      setState((s) => ({ ...s, minted, mintedJourney: null, mintStep: 'label' }));
      pushToast(
        minted.paid
          ? { tone: 'ok', icon: 'check', title: 'Label minted', detail: 'Print it and stick it on the parcel.' }
          : { tone: 'warn', icon: 'wallet', title: 'Order created — unpaid', detail: 'Top up, then release the label.' },
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
  const settleOrder = useCallback(
    async (parcelId: string) => {
      if (!client || !creds) return;
      await run(`settle:${parcelId}`, async () => {
        const r = await client.api.settle(parcelId);
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'check', title: 'Paid', detail: 'The label is released.' });
        const again = await client.api.order(creds.vendorId, parcelId);
        if (!again.error) {
          setState((s) => ({
            ...s,
            minted: s.minted && s.minted.parcel.parcelId === parcelId ? { ...s.minted, paid: true, parcel: narrow<OrderDetail>(again.data) } : s.minted,
          }));
        }
        await refresh();
      });
    },
    [client, creds, run, fail, pushToast, refresh],
  );

  const topUp = useCallback(
    async (amount: number) => {
      if (!client || !creds || !(amount > 0)) return;
      await run('topup', async () => {
        const r = await client.api.topUp(creds.vendorId, amount);
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'wallet', title: 'Balance topped up', detail: `Added ${amount.toFixed(2)}.` });
        await refresh();
      });
    },
    [client, creds, run, fail, pushToast, refresh],
  );

  /** Move the store's map pin — the origin ranking and "near your store" all key off it. */
  const saveLocation = useCallback(
    async (location: { lat: number; lng: number }) => {
      if (!client || !creds) return;
      await run('location', async () => {
        const r = await client.api.update(creds.vendorId, { location });
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'pin', title: 'Store pin saved' });
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

  /* ----------------------------------------------------------------- store */

  const savePolicy = useCallback(
    async (patch: { mode: 'full' | 'capped'; freeOverSubtotal: number; buyerContributionCap: number; maxTransportSpend?: number }) => {
      if (!client || !creds) return;
      await run('policy', async () => {
        const r = await client.api.update(creds.vendorId, { shippingPolicy: patch });
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'check', title: 'Policy saved' });
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
        pushToast({ tone: 'ok', icon: 'check', title: callbackUrl ? 'Callback URL saved' : 'Callback URL removed' });
        await refresh();
      });
    },
    [client, creds, run, fail, pushToast, refresh],
  );

  return {
    state,
    actions: {
      refresh,
      queryOrders,
      signIn,
      register,
      adoptRegistration,
      signOut,
      go,
      startMint,
      setForm,
      classify,
      toStep,
      pickDest,
      pickOrigin,
      submitMint,
      settleOrder,
      topUp,
      saveLocation,
      openOrder,
      closeOrder,
      savePolicy,
      saveCallback,
      loadPoints,
      pushToast,
      dismissToast,
    },
  };
}

export type VendorActions = ReturnType<typeof useVendorApp>['actions'];
