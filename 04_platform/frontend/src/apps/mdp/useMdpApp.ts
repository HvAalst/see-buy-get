import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isSignInRequired, narrow, sbgConfirmDevice, sbgDevicePhone, sbgForgot, sbgLogin, sbgReset, type SbgError } from '../../lib/sbg';
import { deviceAskOf, saveShopDeviceKey, shopDeviceKey, shopDevicesApi, type DeviceAsk } from '../../shared/account/shopDevice';
import type { IconName } from '../../shared/ui/Icon';
import { signal } from '../../shared/feedback';
import { t } from '../../shared/i18n';
import { clearDid, createMdpClient, mdpConfig, purgeMdpTokens, readDid, readEmail, saveDid, saveEmail } from './api';
import { addToQueue, dropFromQueue, findMyHub, floorOpen, money, unsortedAt } from './logic';
import { onIt, replaceArrival, unitsLine, type HubArrival, type HubArrivalScan, type HubArrivalsView, type HubBulk } from './arrivals';
import { downscaleImage } from '../../shared/media';
import { holdPhoto } from '../../shared/heldPhotos';
import { errorSentence } from '../../shared/ui';
import type { UnitHold } from '../../shared/tamper';
import type { DropView, LoadView, MdpView, NewToteView, ParcelRow, RatesView, SortView, ToteView } from './types';
import { clearStaff, readStaff, saveStaff, type StaffAtCounter, type StaffSession } from '../agent/staff';
import { peopleApi } from '../agent/people';

/** Where this device keeps who is working the hub's floor: the tab's, like the session. */
export const HUB_STAFF_KEY = 'glos-mdp-staff';

export type Screen = 'home' | 'drop' | 'sort' | 'load' | 'newtote' | 'rates' | 'arrivals' | 'arrival';
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
  /** Round 40 — the password was right on a phone or browser new to the hub: a code went to its number (or it gives one first). */
  deviceAsk: (DeviceAsk & { email: string }) | null;
  refreshing: boolean;
  stale: boolean;
  form: { dropCode: string; sortId: string; loadCode: string; badge: string; arrivalCode: string };
  /** Reading B — whether this hub takes stores' parcels in bulk, and what is coming to it. Null until read. */
  arrivals: HubArrivalsView | null;
  /** The arrival open on the floor. */
  arrivalId: string | null;
  /** The last parcel scanned in off it: which, where it goes, and whether it had been scanned in before. */
  arrivalScan: { arrivalId: string; parcelId: string; destination: string; already: boolean } | null;
  /** Round 35 — a parcel found cut or opened, being reported: which, its photograph, what is seen. `null` when closed. */
  tamper: { parcelId: string; photoRef: string; note: string } | null;
  /** Round 36 — the bag scanned to drop, looked at before it is opened: how it was closed, held; a seal read that did not match. */
  drop: { bag?: { closedWith?: 'seal' | 'photo'; held?: UnitHold } | null; mismatch?: string };
  /** One of the hub's people working its floor on this device, under their own name; null for the hub's own sign-in. */
  staff: StaffAtCounter | null;
}

const EMPTY_FORM = { dropCode: '', sortId: '', loadCode: '', badge: '', arrivalCode: '' };

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
  deviceAsk: null,
  refreshing: false,
  stale: false,
  form: { ...EMPTY_FORM },
  arrivals: null,
  arrivalId: null,
  arrivalScan: null,
  tamper: null,
  staff: null,
  drop: {},
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

      const [totesR, parcelsR, arrivalsR] = await Promise.all([
        client.api.totesAt(hub.mdpId),
        client.api.parcelsAtMdp(),
        // Reading B — what stores bring in bulk. Read where the floor is open: a hub not yet approved takes nothing in.
        floorOpen(hub) ? client.api.arrivals(hub.mdpId) : Promise.resolve(null),
      ]);
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
        arrivals: arrivalsR && !arrivalsR.error ? (narrow<HubArrivalsView>(arrivalsR.data) ?? s.arrivals) : s.arrivals,
        queue: inbound ? addToQueue(s.queue, unsortedAt(inbound, hub.mdpId).map((p) => p.parcelId)) : s.queue,
        error: null,
        stale: false,
        refreshing: false,
      }));

      // Parcels soft-fail (totes alone still run the floor) — but say what is missing.
      if (parcelsR.error) fail(parcelsR.error);
      // What is coming in, likewise — said where it is being looked at.
      else if (arrivalsR?.error && (stateRef.current.screen === 'arrivals' || stateRef.current.screen === 'arrival')) fail(arrivalsR.error);
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
    // Who is on the floor on this device: the session here is theirs, under their name — or the hub's own.
    setState((s) => ({ ...s, staff: readStaff(did, HUB_STAFF_KEY) }));
    if (client && did) void refresh();
  }, [client, did, refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const mail = email.trim().toLowerCase();
    if (!mail || !password) return;
    setState((s) => ({ ...s, busy: 'signin', error: null }));
    // Round 40 — a hub's sign-in works only on its own phones: this one's key goes with it, when it has one.
    const r = await sbgLogin(mdpConfig(), mail, password, undefined, shopDeviceKey(mail));
    if (r.error) {
      const ask = deviceAskOf(r.error);
      if (ask) return setState((s) => ({ ...s, busy: null, error: null, deviceAsk: { ...ask, email: mail } }));
      setState((s) => ({ ...s, busy: null, error: r.error }));
      return;
    }
    await enter(r.data!, mail);
  }, []);

  /** Round 40 — the code from the hub's number, typed on this phone: it is one of the hub's from now, and signed in. */
  const confirmDevice = useCallback(async (code: string) => {
    const ask = stateRef.current.deviceAsk;
    if (!ask) return;
    setState((s) => ({ ...s, busy: 'signin', error: null }));
    const r = await sbgConfirmDevice(mdpConfig(), ask.challenge, code.trim());
    if (r.error || !r.data) return setState((s) => ({ ...s, busy: null, error: r.error ?? null }));
    saveShopDeviceKey(ask.email, r.data.device);
    await enter(r.data, ask.email);
  }, []);

  /** Round 40 — a hub with no number yet gives one: the code goes to it. */
  const giveDevicePhone = useCallback(async (phone: string) => {
    const ask = stateRef.current.deviceAsk;
    if (!ask) return;
    setState((s) => ({ ...s, busy: 'signin', error: null }));
    const r = await sbgDevicePhone(mdpConfig(), ask.challenge, phone);
    if (r.error || !r.data) return setState((s) => ({ ...s, busy: null, error: r.error ?? null }));
    const sent = r.data;
    setState((s) => ({ ...s, busy: null, deviceAsk: s.deviceAsk ? { ...s.deviceAsk, challenge: sent.challenge, sentTo: sent.sentTo, needsPhone: false, ...(sent.code ? { code: sent.code } : {}) } : null }));
  }, []);

  /** Back to the email and password: another hub, or another try. */
  const cancelDeviceAsk = useCallback(() => setState((s) => ({ ...s, deviceAsk: null, error: null })), []);

  /** Signed in: the hub's role checked, everything of another hub's purged, this one's token seeded. */
  const enter = useCallback(async (login: { role: string; did: string; token: { access_token: string; expires_in?: number } }, mail: string) => {
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
    clearStaff(HUB_STAFF_KEY);
    saveDid(login.did);
    saveEmail(mail);
    const next = createMdpClient(login.did);
    await next.client.seed({ access_token: login.token.access_token, expires_in: login.token.expires_in ?? 3600 });
    setState((s) => ({ ...INITIAL, phase: 'boot', toasts: s.toasts }));
    setDid(login.did);
  }, []);

  /**
   * ONE OF THE HUB'S PEOPLE, signed in as themselves and now on its floor (the ISO 28000 check: "a hub's own people by
   * name"): their session acts as the hub under their name. Everything of the last sign-in on this device is dropped first.
   */
  const enterAsStaff = useCallback(async (session: StaffSession) => {
    purgeMdpTokens(null);
    saveDid(session.shopDid);
    const who = { shopDid: session.shopDid, shopName: session.shopName, name: session.name, memberId: session.memberId };
    saveStaff(who, HUB_STAFF_KEY);
    const next = createMdpClient(session.shopDid);
    await next.client.seed({ access_token: session.token.access_token, expires_in: session.token.expires_in ?? 3600 });
    setState((s) => ({ ...INITIAL, phase: 'boot', staff: who, toasts: s.toasts }));
    setDid(session.shopDid);
  }, []);

  /** The hub's people, for its owner: added by number, taken out at once, and who did what on the floor. */
  const people = useMemo(
    () =>
      client
        ? peopleApi(
            (path) => client.client.sbg.request((raw) => raw.GET(path as never, {} as never) as never),
            (path, body) => client.client.sbg.request((raw) => raw.POST(path as never, { body } as never) as never),
            'hub',
          )
        : undefined,
    [client],
  );

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
    clearStaff(HUB_STAFF_KEY);
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
      if (screen === 'home' || screen === 'load' || screen === 'sort' || screen === 'arrivals') void refresh();
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
  /** Round 36 — the bag scanned to drop: how it was closed (never its seal's number), and whether it is held. */
  const lookDropBag = useCallback(async (override?: string) => {
    if (!client) return;
    const code = (override ?? stateRef.current.form.dropCode).trim().toUpperCase();
    if (!code) return;
    setState((s) => ({ ...s, error: null, form: { ...s.form, dropCode: code }, drop: {} }));
    const r = await client.api.bag(code);
    if (r.error) {
      signal('error');
      setState((s) => ({ ...s, drop: { bag: null } }));
      return fail(r.error);
    }
    const v = narrow<{ closedWith?: 'seal' | 'photo'; held?: UnitHold }>(r.data);
    setState((s) => (s.form.dropCode === code ? { ...s, drop: { bag: { ...(v?.closedWith ? { closedWith: v.closedWith } : {}), ...(v?.held ? { held: v.held } : {}) } } } : s));
  }, [client, fail]);

  /** Round 36 — received on its seal, before it is opened. Answers with the refusal the screen acts on. */
  const submitDrop = useCallback(async (receipt: { sealNumber?: string; photoRef: string; asClosed: boolean }): Promise<string | null> => {
    if (!client) return null;
    const hub = stateRef.current.hub;
    const code = stateRef.current.form.dropCode.trim().toUpperCase();
    if (!hub || !code) return null;
    let refused: string | null = null;
    await run('drop', async () => {
      const r = await client.api.dropBag(hub.mdpId, code, receipt);
      if (r.error) {
        signal('error');
        refused = r.error.code;
        if (r.error.code === 'SEAL_MISMATCH') return setState((s) => ({ ...s, drop: { ...s.drop, mismatch: receipt.sealNumber ?? '' } }));
        if (r.error.code === 'TAMPER_REPORT_FIRST') return;
        return fail(r.error);
      }
      signal('ok');
      const emptied = narrow<DropView>(r.data)?.emptied ?? [];
      setState((s) => ({
        ...s,
        queue: addToQueue(s.queue, emptied),
        form: { ...s.form, dropCode: '' },
        drop: {},
      }));
      pushToast({
        tone: 'ok',
        icon: 'bag',
        title: t('mdp.toast.emptied', { code }),
        detail: emptied.length === 1 ? t('mdp.toast.dropDetailOne', { count: emptied.length }) : t('mdp.toast.dropDetailMany', { count: emptied.length }),
      });
      await refresh();
    });
    return refused;
  }, [client, run, fail, pushToast, refresh]);

  /** Round 36 — a bag not as it was closed: held, operations told. True when the server took it (or keeps it for a signal). */
  const reportBag = useCallback(async (code: string, body: { finding: 'seal_not_as_written' | 'seal_broken' | 'wrap_cut'; numberRead?: string; photoRefs: string[]; note?: string }): Promise<boolean> => {
    if (!client || !code) return false;
    let ok = false;
    await run('bag-report', async () => {
      const r = await client.api.reportBagTamper(code, body);
      if (r.error) {
        signal('error');
        return fail(r.error);
      }
      signal('ok');
      ok = true;
      if (r.status === 202) return pushToast({ tone: 'warn', icon: 'offline', title: t('mdp.tamper.queued'), detail: t('mdp.tamper.queuedDetail') });
      pushToast({ tone: 'warn', icon: 'warning', title: t('mdp.bag.held', { code }), detail: t('mdp.bag.heldDetail') });
      const v = narrow<{ held?: UnitHold }>(r.data);
      setState((s) => (s.form.dropCode === code ? { ...s, drop: { bag: { ...(s.drop.bag ?? {}), ...(v?.held ? { held: v.held } : {}) } } } : s));
      await refresh();
    });
    return ok;
  }, [client, run, fail, pushToast, refresh]);

  /** Round 36 — a bag closed for the road at this hub: its coded seal and a photograph, or a photograph alone. */
  const closeBag = useCallback(async (code: string, closure: { seal?: string; photoRef: string }): Promise<boolean> => {
    if (!client || !code) return false;
    let ok = false;
    await run('close', async () => {
      const r = await client.api.closeBag(code, closure);
      if (r.error) {
        signal('error');
        return fail(r.error);
      }
      signal('ok');
      ok = true;
      pushToast({ tone: 'ok', icon: 'bag', title: t('mdp.bag.closed', { code }), detail: t(closure.seal ? 'mdp.bag.closedSeal' : 'mdp.bag.closedPhoto', { seal: closure.seal ?? '' }) });
      await refresh();
    });
    return ok;
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
    async (file: File, kind: 'tamper' | 'seal' | 'kyc_id' | 'kyc_licence' | 'shop' = 'tamper'): Promise<string | null> => {
      if (!client) return null;
      try {
        const { dataUrl, thumbDataUrl } = await downscaleImage(file);
        const r = await client.api.uploadMedia(kind, dataUrl, thumbDataUrl);
        if (r.error) {
          // A report waits on the phone with its photograph; papers do not — staff cannot approve a photograph we never had.
          const held = isOffline(r.error) && (kind === 'tamper' || kind === 'seal') ? holdPhoto(kind, dataUrl, thumbDataUrl) : null;
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

  /**
   * The hub's papers (the ISO 28000 check: "hubs are vetted"): each the id of a photograph it has just taken — the server
   * takes nothing else. True when they went: the sheet closes on that and on nothing else.
   */
  const sendPapers = useCallback(
    async (papers: { idCopyRef: string; licenceRef: string; photoRefs: string[] }): Promise<boolean> => {
      if (!client) return false;
      const hub = stateRef.current.hub;
      if (!hub) return false;
      let sent = false;
      await run('papers', async () => {
        const r = await client.api.sendPapers(hub.mdpId, papers);
        if (r.error) return fail(r.error);
        sent = true;
        pushToast({ tone: 'ok', icon: 'check', title: t('mdp.papers.sentToast') });
        await refresh();
      });
      return sent;
    },
    [client, run, fail, refresh, pushToast],
  );

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

  /* ------------------------------------------------------------ coming in -- */

  /** Reading B — an arrival opened on the floor, or closed back to the list. */
  const openArrival = useCallback((arrivalId: string | null) => {
    setState((s) => ({ ...s, screen: arrivalId ? 'arrival' : 'arrivals', arrivalId, arrivalScan: null, error: null, form: { ...s.form, arrivalCode: '' } }));
  }, []);

  /** The open arrival's id and the hub, or nothing to act on. */
  const arrivalAt = () => {
    const hub = stateRef.current.hub;
    const id = stateRef.current.arrivalId;
    return hub && id ? { mdpId: hub.mdpId, id } : null;
  };

  /** At the door: the units that came, counted, and a line of the hub's words. Each parcel is scanned in after. */
  const receiveArrival = useCallback(
    async (units: number, note: string) => {
      const at = arrivalAt();
      if (!client || !at) return;
      await run('arrival-receive', async () => {
        const r = await client.api.receiveArrival(at.mdpId, at.id, { units, ...(note.trim() ? { note: note.trim() } : {}) });
        if (r.error) {
          signal('error');
          return fail(r.error);
        }
        signal('ok');
        const a = narrow<HubArrival>(r.data);
        if (a) setState((s) => ({ ...s, arrivals: replaceArrival(s.arrivals, a) }));
        pushToast({ tone: 'ok', icon: 'truck', title: t('mdp.toast.arrivalIn', { units: a ? unitsLine(a.unitKind, units, t) : String(units) }), detail: t('mdp.toast.arrivalInDetail') });
      });
    },
    [client, run, fail, pushToast],
  );

  /**
   * One parcel scanned in off the units, by its label — our QR, its tracking key, or its own barcode (the box finds the
   * parcel by it). From that scan it is the hub's: it joins the parcels waiting for their sort. The last one ends it.
   */
  const scanArrival = useCallback(
    async (override?: string) => {
      const at = arrivalAt();
      const code = (override ?? stateRef.current.form.arrivalCode).trim().toUpperCase();
      if (!client || !at || !code) return;
      await run('arrival-scan', async () => {
        const r = await client.api.scanArrival(at.mdpId, at.id, code);
        if (r.error) {
          signal('error');
          // A code not on this arrival leaves the box empty for the next one — a hand scanner types into what is there;
          // the refusal names the code.
          setState((s) => ({ ...s, arrivalScan: null, form: r.error!.code === 'NOT_FOUND' ? { ...s.form, arrivalCode: '' } : s.form }));
          return fail(r.error);
        }
        const v = narrow<HubArrivalScan>(r.data);
        if (!v) return;
        signal(v.already ? 'warn' : 'ok');
        setState((s) => ({
          ...s,
          arrivals: replaceArrival(s.arrivals, v.arrival),
          arrivalScan: { arrivalId: at.id, parcelId: v.parcelId, destination: v.destination, already: v.already },
          form: { ...s.form, arrivalCode: '' },
          queue: v.already ? s.queue : addToQueue(s.queue, [v.parcelId]),
        }));
        if (v.arrival.state === 'received') {
          pushToast({ tone: 'ok', icon: 'check', title: t('mdp.toast.arrivalAllIn', { n: v.arrival.scannedCount }), detail: t('mdp.toast.arrivalAllInDetail') });
          await refresh();
        }
      });
    },
    [client, run, fail, pushToast, refresh],
  );

  /** Scanning finished by hand: what was booked and not scanned did not come — still the store's, which is told. */
  const finishArrival = useCallback(async () => {
    const at = arrivalAt();
    if (!client || !at) return;
    await run('arrival-finish', async () => {
      const r = await client.api.finishArrival(at.mdpId, at.id);
      if (r.error) {
        signal('error');
        return fail(r.error);
      }
      signal('ok');
      const a = narrow<HubArrival>(r.data);
      if (a) setState((s) => ({ ...s, arrivals: replaceArrival(s.arrivals, a) }));
      const missing = a?.finished?.missing.length ?? 0;
      pushToast({
        tone: missing ? 'warn' : 'ok',
        icon: 'truck',
        title: t('mdp.toast.arrivalFinished', { done: a?.scannedCount ?? 0, all: a ? onIt(a).length : 0 }),
        detail: t(missing ? 'mdp.toast.arrivalFinishedMissing' : 'mdp.toast.arrivalAllInDetail'),
      });
      await refresh();
    });
  }, [client, run, fail, pushToast, refresh]);

  /** Its day is over on the hub's clock and nothing came: said, the store is told and books its parcels again. */
  const missedArrival = useCallback(async () => {
    const at = arrivalAt();
    if (!client || !at) return;
    await run('arrival-missed', async () => {
      const r = await client.api.missedArrival(at.mdpId, at.id);
      if (r.error) {
        signal('error');
        return fail(r.error);
      }
      signal('ok');
      const a = narrow<HubArrival>(r.data);
      if (a) setState((s) => ({ ...s, arrivals: replaceArrival(s.arrivals, a) }));
      pushToast({ tone: 'ok', icon: 'check', title: t('mdp.toast.arrivalMissed'), detail: t('mdp.toast.arrivalMissedDetail') });
    });
  }, [client, run, fail, pushToast]);

  /**
   * The hub's word that it takes stores' parcels in bulk — its days and hours, its doors — or that it no longer does. Its
   * owner's (the server refuses its people). Answers with the refusal, for the sheet to show where it was asked.
   */
  const setBulk = useCallback(
    async (body: { open: boolean; hours?: Record<string, { open: string; close: string } | null> | null; doors?: number | null }): Promise<{ error: SbgError | null }> => {
      const hub = stateRef.current.hub;
      if (!client || !hub) return { error: null };
      let error: SbgError | null = null;
      await run('bulk', async () => {
        const r = await client.api.setBulk(hub.mdpId, body);
        if (r.error) {
          error = r.error;
          return;
        }
        const bulk = narrow<{ bulk?: HubBulk }>(r.data)?.bulk;
        setState((s) => ({ ...s, arrivals: { arrivals: s.arrivals?.arrivals ?? [], ...(bulk ? { bulk } : {}) } }));
        pushToast({ tone: 'ok', icon: 'check', title: t(bulk ? 'mdp.bulk.saved' : 'mdp.bulk.stopped') });
      });
      return { error };
    },
    [client, run, pushToast],
  );

  /** Round 40 — the hub's own phones and browsers, in Settings: read and forgotten as the shop's are. */
  const hubDevices = useMemo(
    () => (client ? shopDevicesApi((path, body) => client.client.sbg.request((raw) => raw.POST(path as never, { body } as never) as never), readEmail, 'hub') : undefined),
    [client],
  );

  return {
    state,
    // The raw client, for the shared account menu — the account is the PERSON, so the surface behind it
    // is the same one every other app talks to and this app holds no opinion about it.
    sbg: client?.client.sbg ?? null,
    actions: {
      refresh,
      signIn,
      confirmDevice,
      giveDevicePhone,
      cancelDeviceAsk,
      hubDevices,
      signOut,
      enterAsStaff,
      people,
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
      lookDropBag,
      reportBag,
      closeBag,
      submitSort,
      submitLoad,
      submitNewTote,
      sendPapers,
      setPrice,
      openArrival,
      receiveArrival,
      scanArrival,
      finishArrival,
      missedArrival,
      setBulk,
      pushToast,
      dismissToast,
      readEmail,
    },
  };
}

export type MdpActions = ReturnType<typeof useMdpApp>['actions'];
