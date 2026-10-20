import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isSignInRequired, narrow, sbgForgot, sbgLogin, sbgReset, type SbgError } from '../../lib/sbg';
import type { IconName } from '../../shared/ui/Icon';
import { signal } from '../../shared/feedback';
import { t } from '../../shared/i18n';
import { clearDid, createMdpClient, mdpConfig, purgeMdpTokens, readDid, readEmail, saveDid, saveEmail } from './api';
import { addToQueue, dropFromQueue, findMyHub, money, unsortedAt } from './logic';
import { downscaleImage } from '../../shared/media';
import { holdPhoto } from '../../shared/heldPhotos';
import { errorSentence } from '../../shared/ui';
import type { DropView, LoadView, MdpView, NewToteView, ParcelRow, RatesView, SortView, ToteView } from './types';

export type Screen = 'home' | 'drop' | 'sort' | 'load' | 'newtote' | 'rates';
export type Phase = 'boot' | 'signin' | 'ready' | 'outdated';

export interface Toast {
  id: number;
  tone: 'ok' | 'info' | 'warn' | 'danger';
  icon?: IconName;
  title: string;
  detail?: string;
}

export interface MdpState {
  phase: Phase;
  screen: Screen;
  hub: MdpView | null;
  totes: ToteView[];
  inbound: ParcelRow[];
  /** Sticker ids waiting to be sorted, in pile order. */
  queue: string[];
  /** The last sort instruction — the big PLACE IN BAG panel. */
  last: SortView | null;
  /** The last registered tote — shown for print + laminate. */
  lastTote: NewToteView | null;
  rates: RatesView | null;
  ratesState: 'idle' | 'loading' | 'ready' | 'error';
  error: SbgError | null;
  toasts: Toast[];
  busy: string | null;
  refreshing: boolean;
  stale: boolean;
  form: { dropCode: string; sortId: string; loadCode: string; badge: string };
  /** Round 35 — a parcel found cut or opened, being reported: which, its photograph, what is seen. `null` when closed. */
  tamper: { parcelId: string; photoRef: string; note: string } | null;
}

const EMPTY_FORM = { dropCode: '', sortId: '', loadCode: '', badge: '' };

const INITIAL: MdpState = {
  phase: 'boot',
  screen: 'home',
  hub: null,
  totes: [],
  inbound: [],
  queue: [],
  last: null,
  lastTote: null,
  rates: null,
  ratesState: 'idle',
  error: null,
  toasts: [],
  busy: null,
  refreshing: false,
  stale: false,
  form: { ...EMPTY_FORM },
  tamper: null,
};

const isOffline = (e: SbgError) => e.code === 'NETWORK' || e.code === 'OFFLINE' || e.code === 'TIMEOUT';

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

export function useMdpApp() {
  const [state, setState] = useState<MdpState>(INITIAL);
  const [did, setDid] = useState<string | null>(null);
  const client = useMemo(() => (did ? createMdpClient(did) : null), [did]);
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

  /**
   * Boot/refresh: mdps → my hub by DID → (totes, inbound parcels). The queue is SEEDED
   * from unsorted parcels but never shrunk here — a drop's emptied list may be ahead of
   * the parcel index, and losing queued stickers mid-shift wastes floor time.
   */
  const refresh = useCallback(async () => {
    if (!client || !did) return;
    const epoch = ++refreshEpoch.current;
    const superseded = () => epoch !== refreshEpoch.current;

    refreshesRunning.current += 1;
    setState((s) => ({ ...s, refreshing: true }));
    try {
      const hubsR = await client.api.mdps();
      if (superseded()) return;
      if (hubsR.error) {
        fail(hubsR.error);
        return;
      }
      const hub = findMyHub(narrow<MdpView[]>(hubsR.data), did);
      if (!hub) {
        // The account exists (the token minted) but no hub carries this DID — a data
        // problem, not an identity one. Say so and keep the retry; never erase the sign-in.
        fail({
          code: 'NOT_FOUND',
          status: 404,
          title: t('mdp.toast.hubNotFoundTitle'),
          detail: t('mdp.toast.hubNotFoundDetail'),
          retryable: true,
        });
        return;
      }

      const [totesR, parcelsR] = await Promise.all([client.api.totesAt(hub.mdpId), client.api.parcelsAtMdp()]);
      if (superseded()) return;
      if (totesR.error) {
        setState((s) => ({ ...s, hub, phase: 'ready' }));
        fail(totesR.error);
        return;
      }
      const totes = narrow<ToteView[]>(totesR.data) ?? [];
      const inbound = parcelsR.error
        ? null
        : (narrow<ParcelRow[]>(parcelsR.data) ?? []).filter((p) => p.atMdpId === hub.mdpId);

      setState((s) => ({
        ...s,
        phase: 'ready',
        hub,
        totes,
        inbound: inbound ?? s.inbound,
        queue: inbound ? addToQueue(s.queue, unsortedAt(inbound, hub.mdpId).map((p) => p.parcelId)) : s.queue,
        error: null,
        stale: false,
        refreshing: false,
      }));

      // Parcels soft-fail (totes alone still run the floor) — but say what is missing.
      if (parcelsR.error) fail(parcelsR.error);
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
    if (did) purgeMdpTokens(did);
    if (client && did) void refresh();
  }, [client, did, refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const mail = email.trim().toLowerCase();
    if (!mail || !password) return;
    setState((s) => ({ ...s, busy: 'signin', error: null }));
    const r = await sbgLogin(mdpConfig(), mail, password);
    if (r.error) {
      setState((s) => ({ ...s, busy: null, error: r.error }));
      return;
    }
    const login = r.data!;
    if (login.role !== 'mdp') {
      setState((s) => ({
        ...s,
        busy: null,
        error: {
          code: 'FORBIDDEN',
          status: 403,
          title: t('mdp.toast.notHubTitle'),
          detail: t('mdp.toast.notHubDetail', { role: login.role }),
          retryable: false,
        },
      }));
      return;
    }
    purgeMdpTokens(null);
    saveDid(login.did);
    saveEmail(mail);
    const next = createMdpClient(login.did);
    await next.client.seed({ access_token: login.token.access_token, expires_in: login.token.expires_in ?? 3600 });
    setState((s) => ({ ...INITIAL, phase: 'boot', toasts: s.toasts }));
    setDid(login.did);
  }, []);

  /** After a password change: the server signed every session out and handed this device a fresh sign-in. */
  const adoptToken = useCallback(
    async (token: { access_token: string; expires_in?: number }) => {
      await client?.client.seed({ access_token: token.access_token, expires_in: token.expires_in ?? 3600 });
    },
    [client],
  );

  const signOut = useCallback(() => {
    client?.client.session.clear();
    purgeMdpTokens(null);
    clearDid();
    setDid(null);
    setState(() => ({ ...INITIAL, phase: 'signin' }));
  }, [client]);
  useEffect(() => {
    signOutRef.current = signOut;
  }, [signOut]);

  const forgot = useCallback(async (email: string) => {
    const r = await sbgForgot(mdpConfig(), email.trim().toLowerCase());
    if (r.error) return { error: r.error, resetToken: null as string | null, sent: false };
    return { error: null, resetToken: r.data?.resetToken ?? null, sent: Boolean(r.data?.sent) };
  }, []);

  const reset = useCallback(async (token: string, password: string) => {
    const r = await sbgReset(mdpConfig(), token.trim(), password);
    return r.error ?? null;
  }, []);

  /* ----------------------------------------------------------- navigation */

  const loadRates = useCallback(async () => {
    if (!client) return;
    setState((s) => ({ ...s, ratesState: 'loading' }));
    const at = stateRef.current.hub?.location;
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
      setState((s) => ({ ...s, screen, error: null, lastTote: screen === 'newtote' ? null : s.lastTote }));
      if (screen === 'rates') void loadRates();
      // Fresh bag/parcel truth for the floor screens costs one round trip.
      if (screen === 'home' || screen === 'load' || screen === 'sort') void refresh();
    },
    [loadRates, refresh],
  );

  const setForm = useCallback((p: Partial<MdpState['form']>) => {
    setState((s) => ({ ...s, form: { ...s.form, ...p } }));
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

  // `override` carries a freshly scanned value: a camera read sets state AND calls here in
  // the same tick, before stateRef catches up, so the scan passes its value straight in.
  const submitDrop = useCallback(async (override?: string) => {
    if (!client) return;
    const hub = stateRef.current.hub;
    const code = (override ?? stateRef.current.form.dropCode).trim().toUpperCase();
    if (!hub || !code) return;
    await run('drop', async () => {
      const r = await client.api.dropBag(hub.mdpId, code);
      if (r.error) {
        signal('error');
        return fail(r.error);
      }
      signal('ok');
      const emptied = narrow<DropView>(r.data)?.emptied ?? [];
      setState((s) => ({
        ...s,
        queue: addToQueue(s.queue, emptied),
        form: { ...s.form, dropCode: '' },
      }));
      pushToast({
        tone: 'ok',
        icon: 'bag',
        title: t('mdp.toast.emptied', { code }),
        detail: emptied.length === 1 ? t('mdp.toast.dropDetailOne', { count: emptied.length }) : t('mdp.toast.dropDetailMany', { count: emptied.length }),
      });
      await refresh();
    });
  }, [client, run, fail, pushToast, refresh]);

  const submitSort = useCallback(async (override?: string) => {
    if (!client) return;
    const hub = stateRef.current.hub;
    const id = (override ?? stateRef.current.form.sortId).trim().toUpperCase();
    if (!hub || !id) return;
    await run('sort', async () => {
      const r = await client.api.sort(hub.mdpId, id);
      if (r.error) {
        signal('error');
        // An unknown or mis-scanned sticker must not stay queued forever — but only a
        // definitive verdict (not found / wrong state) removes it.
        if (r.error.code === 'NOT_FOUND' || r.error.code === 'INVALID_STATE') {
          setState((s) => ({ ...s, queue: dropFromQueue(s.queue, id) }));
        }
        return fail(r.error);
      }
      signal('ok');
      const sorted = narrow<SortView>(r.data);
      setState((s) => ({
        ...s,
        last: sorted,
        queue: dropFromQueue(s.queue, id),
        form: { ...s.form, sortId: '' },
      }));
      await refresh();
    });
  }, [client, run, fail, refresh]);

  const openTamper = useCallback((parcelId: string | null) => {
    setState((s) => ({ ...s, tamper: parcelId === null ? null : { parcelId, photoRef: '', note: '' }, error: null }));
  }, []);
  const setTamper = useCallback((patch: Partial<NonNullable<MdpState['tamper']>>) => {
    setState((s) => (s.tamper ? { ...s, tamper: { ...s.tamper, ...patch } } : s));
  }, []);

  /** Round 35 — a photograph for the tamper report: prepared on the phone; with no signal it waits here and goes with the report. */
  const uploadPhoto = useCallback(
    async (file: File): Promise<string | null> => {
      if (!client) return null;
      try {
        const { dataUrl, thumbDataUrl } = await downscaleImage(file);
        const r = await client.api.uploadMedia('tamper', dataUrl, thumbDataUrl);
        if (r.error) {
          const held = isOffline(r.error) ? holdPhoto('tamper', dataUrl, thumbDataUrl) : null;
          if (held) return held;
          pushToast({ tone: 'danger', icon: 'camera', title: t('mdp.tamper.photoFail'), detail: errorSentence(r.error) });
          return null;
        }
        return narrow<{ mediaId: string }>(r.data)?.mediaId ?? null;
      } catch {
        pushToast({ tone: 'danger', icon: 'camera', title: t('mdp.tamper.photoFail') });
        return null;
      }
    },
    [client, pushToast],
  );

  /**
   * Round 35 — A PARCEL FOUND CUT OR OPENED at this hub (the tamper protocol): held here — sorted into no bag, loaded
   * onto no bus — and SeeBuyGet operations told at once. With no signal it waits on this phone and goes when it can.
   */
  const submitTamper = useCallback(async () => {
    if (!client) return;
    const hub = stateRef.current.hub;
    const f = stateRef.current.tamper;
    const id = f?.parcelId.trim().toUpperCase() ?? '';
    if (!hub || !f || !id || !f.photoRef) return;
    await run('tamper', async () => {
      const r = await client.api.reportTamper(hub.mdpId, id, { photoRefs: [f.photoRef], ...(f.note.trim() ? { note: f.note.trim() } : {}), observedAt: new Date().toISOString() });
      if (r.error) {
        signal('error');
        return fail(r.error);
      }
      signal('ok');
      setState((s) => ({ ...s, tamper: null, form: s.form.sortId.trim().toUpperCase() === id ? { ...s.form, sortId: '' } : s.form }));
      if (r.status === 202) {
        return pushToast({ tone: 'warn', icon: 'offline', title: t('mdp.tamper.queued'), detail: t('mdp.tamper.queuedDetail') });
      }
      pushToast({ tone: 'warn', icon: 'warning', title: t('mdp.tamper.reported', { id }), detail: t('mdp.tamper.reportedDetail') });
      await refresh();
    });
  }, [client, run, fail, pushToast, refresh]);

  const pickSortId = useCallback((id: string) => {
    setState((s) => ({ ...s, form: { ...s.form, sortId: id } }));
  }, []);

  const pickLoadCode = useCallback((code: string) => {
    setState((s) => ({ ...s, form: { ...s.form, loadCode: code } }));
  }, []);

  const submitLoad = useCallback(async () => {
    if (!client) return;
    const { loadCode, badge } = stateRef.current.form;
    if (!loadCode || !badge.trim()) return;
    await run('load', async () => {
      const r = await client.api.loadBag(loadCode, badge.trim().toUpperCase());
      if (r.error) return fail(r.error);
      buzz();
      const v = narrow<LoadView>(r.data);
      const moved = v?.moved?.length ?? 0;
      const dest = v?.tote?.destinationLabel;
      setState((s) => ({ ...s, form: { ...s.form, loadCode: '', badge: '' }, screen: 'home' }));
      pushToast({
        tone: 'ok',
        icon: 'truck',
        title: t('mdp.toast.onBus', { code: loadCode }),
        detail: dest
          ? t(moved === 1 ? 'mdp.toast.loadMovingToOne' : 'mdp.toast.loadMovingToMany', { count: moved, dest })
          : t(moved === 1 ? 'mdp.toast.loadMovingOne' : 'mdp.toast.loadMovingMany', { count: moved }),
      });
      await refresh();
    });
  }, [client, run, fail, pushToast, refresh]);

  const submitNewTote = useCallback(async () => {
    if (!client) return;
    const hub = stateRef.current.hub;
    if (!hub) return;
    await run('newtote', async () => {
      const r = await client.api.newTote(hub.mdpId);
      if (r.error) return fail(r.error);
      buzz();
      setState((s) => ({ ...s, lastTote: narrow<NewToteView>(r.data) }));
      await refresh();
    });
  }, [client, run, fail, refresh]);

  const setPrice = useCallback(
    async (price: number) => {
      if (!client) return;
      const hub = stateRef.current.hub;
      if (!hub || !(price >= 0)) return;
      await run('price', async () => {
        const r = await client.api.setPrice(hub.mdpId, price);
        if (r.error) return fail(r.error);
        buzz();
        pushToast({ tone: 'ok', icon: 'wallet', title: t('mdp.toast.feeUpdatedTitle'), detail: t('mdp.toast.feeUpdatedDetail', { price: money(price, hub.currency) }) });
        await refresh();
        if (stateRef.current.screen === 'rates') await loadRates();
      });
    },
    [client, run, fail, pushToast, refresh, loadRates],
  );

  return {
    state,
    // The raw client, for the shared account menu — the account is the PERSON, so the surface behind it
    // is the same one every other app talks to and this app holds no opinion about it.
    sbg: client?.client.sbg ?? null,
    actions: {
      refresh,
      signIn,
      signOut,
      adoptToken,
      forgot,
      reset,
      go,
      setForm,
      pickSortId,
      openTamper,
      setTamper,
      uploadPhoto,
      submitTamper,
      pickLoadCode,
      submitDrop,
      submitSort,
      submitLoad,
      submitNewTote,
      setPrice,
      pushToast,
      dismissToast,
      readEmail,
    },
  };
}

export type MdpActions = ReturnType<typeof useMdpApp>['actions'];
