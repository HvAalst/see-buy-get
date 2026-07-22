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
import type { IconName } from '../../shared/ui/Icon';
import { agentConfig, clearDid, createAgentClient, purgeAgentTokens, readDid, readEmail, saveDid, saveEmail } from './api';
import { EMPTY_ACCEPT, destinationZones, otpValid, type AcceptForm } from './logic';
import type {
  AgentView,
  ArriveView,
  CollectView,
  CorridorRow,
  GateView,
  HandoverView,
  ParcelView,
  RatesView,
  ReceiveBagView,
} from './types';

export type Screen = 'home' | 'accept' | 'handover' | 'release' | 'collect' | 'receivebag' | 'rates';
export type Phase = 'boot' | 'signin' | 'ready' | 'outdated';

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
  zones: string[];
  /** Parcels waiting at this shop for the bus (loaded when the handover screen opens). */
  shopParcels: ParcelView[];
  shopParcelsState: 'idle' | 'loading' | 'ready' | 'error';
  rates: RatesView | null;
  ratesState: 'idle' | 'loading' | 'ready' | 'error';
  error: SbgError | null;
  toasts: Toast[];
  busy: string | null;
  refreshing: boolean;
  stale: boolean;

  accept: AcceptForm;
  handover: { badge: string; selected: string[] };
  release: { stickerId: string; parcel: ParcelView | null; otp: string; issuedOtp: string | null; stars: number };
  collect: { code: string; found: CollectView | null; disputing: boolean; reason: string; photoRef: string };
  receivebag: { code: string };
}

const EMPTY_HANDOVER = { badge: '', selected: [] as string[] };
const EMPTY_RELEASE = { stickerId: '', parcel: null, otp: '', issuedOtp: null, stars: 0 };
const EMPTY_COLLECT = { code: '', found: null, disputing: false, reason: '', photoRef: '' };

const INITIAL: AgentState = {
  phase: 'boot',
  screen: 'home',
  agent: null,
  gate: null,
  zones: [],
  shopParcels: [],
  shopParcelsState: 'idle',
  rates: null,
  ratesState: 'idle',
  error: null,
  toasts: [],
  busy: null,
  refreshing: false,
  stale: false,
  accept: { ...EMPTY_ACCEPT },
  handover: { ...EMPTY_HANDOVER },
  release: { ...EMPTY_RELEASE },
  collect: { ...EMPTY_COLLECT },
  receivebag: { code: '' },
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

      // Corridors soft-fail: accepting can still use a typed destination.
      const corR = await client.api.corridors();
      if (superseded()) return;
      const zones = corR.error ? [] : destinationZones(narrow<CorridorRow[]>(corR.data), agent.zone);

      setState((s) => ({
        ...s,
        phase: 'ready',
        agent,
        gate,
        zones,
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

  const go = useCallback(
    (screen: Screen) => {
      setState((s) => ({ ...s, screen, error: null }));
      if (screen === 'handover') void loadShopParcels();
      if (screen === 'rates') void loadRates();
    },
    [loadShopParcels, loadRates],
  );

  /* ---------------------------------------------------------------- forms */

  const setAccept = useCallback((p: Partial<AcceptForm>) => {
    setState((s) => ({ ...s, accept: { ...s.accept, ...p } }));
  }, []);
  const setHandover = useCallback((p: Partial<AgentState['handover']>) => {
    setState((s) => ({ ...s, handover: { ...s.handover, ...p } }));
  }, []);
  const toggleHandover = useCallback((parcelId: string) => {
    setState((s) => {
      const has = s.handover.selected.includes(parcelId);
      const selected = has ? s.handover.selected.filter((x) => x !== parcelId) : [...s.handover.selected, parcelId];
      return { ...s, handover: { ...s.handover, selected } };
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
    if (!f.size) return;
    await run('accept', async () => {
      const r = await client.api.accept({
        agentDid: did,
        parcelId: f.parcelId.trim(),
        size: f.size as 'S' | 'M' | 'L' | 'HEAVY',
        destZone: f.destZone.trim(),
        senderMobile: f.senderMobile.trim() || 'n/a',
        receiverMobile: f.receiverMobile.trim() || 'n/a',
        dropoffPhotoRef: f.photoRef,
      });
      if (r.error) return fail(r.error);
      buzz();
      setState((s) => ({ ...s, accept: { ...EMPTY_ACCEPT }, screen: 'home' }));
      pushToast({ tone: 'ok', icon: 'box', title: 'Parcel accepted', detail: 'A tracking message has been sent.' });
      await refresh();
    });
  }, [client, did, run, fail, pushToast, refresh]);

  const submitHandover = useCallback(async () => {
    if (!client || !did) return;
    const f = stateRef.current.handover;
    if (!f.badge.trim() || f.selected.length === 0) return;
    await run('handover', async () => {
      const r = await client.api.handover(did, f.badge.trim(), f.selected);
      if (r.error) {
        // Reconcile the list (some parcels may have moved), then explain.
        await loadShopParcels();
        fail(r.error);
        return;
      }
      buzz();
      const v = narrow<HandoverView>(r.data);
      setState((s) => ({ ...s, handover: { ...EMPTY_HANDOVER }, screen: 'home' }));
      pushToast({
        tone: 'ok',
        icon: 'truck',
        title: `${v?.handed?.length ?? f.selected.length} parcel(s) on the bus`,
        detail: v?.vehicle ? `Loaded onto ${v.vehicle}.` : undefined,
      });
      await refresh();
    });
  }, [client, did, run, fail, pushToast, refresh, loadShopParcels]);

  const findRelease = useCallback(async () => {
    if (!client) return;
    const id = stateRef.current.release.stickerId.trim();
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
      const r = await client.api.pickup(f.parcel!.parcelId, did, f.otp.trim());
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

  const findCollect = useCallback(async () => {
    if (!client || !did) return;
    const code = stateRef.current.collect.code.trim();
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

  const submitReceiveBag = useCallback(async () => {
    if (!client || !did) return;
    const code = stateRef.current.receivebag.code.trim().toUpperCase();
    if (!code) return;
    await run('receivebag', async () => {
      const r = await client.api.receiveBag(did, code);
      if (r.error) return fail(r.error);
      buzz();
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

  return {
    state,
    did,
    actions: {
      refresh,
      signIn,
      signOut,
      forgot,
      reset,
      go,
      setAccept,
      setHandover,
      toggleHandover,
      setRelease,
      setCollect,
      setReceiveBag,
      topUp,
      setOpen,
      setPrice,
      submitAccept,
      submitHandover,
      findRelease,
      markArrived,
      submitPickup,
      submitRating,
      findCollect,
      confirmCollect,
      submitDispute,
      submitReceiveBag,
      pushToast,
      dismissToast,
      readEmail,
    },
  };
}

export type AgentActions = ReturnType<typeof useAgentApp>['actions'];
