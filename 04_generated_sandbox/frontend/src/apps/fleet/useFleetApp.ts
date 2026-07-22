import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { isUnknownIdentity, narrow, type SbgError } from '../../lib/sbg';
import type { IconName } from '../../shared/ui/Icon';
import { clearManager, createFleetClient, managerLogin, purgeFleetTokens, readManager, saveManager } from './api';
import { EMPTY_DRIVER, EMPTY_VEHICLE, isHeavySelection, type DriverForm, type VehicleForm } from './logic';
import type {
  AssignmentRow,
  CorridorRow,
  DashboardView,
  DriverRow,
  SubtypeRow,
  VehicleRow,
} from './types';

export type Screen = 'dash' | 'vehicles' | 'drivers' | 'sessions';
export type Phase = 'boot' | 'signin' | 'ready' | 'outdated';

export interface Toast {
  id: number;
  tone: 'ok' | 'info' | 'warn' | 'danger';
  icon?: IconName;
  title: string;
  detail?: string;
}

export interface FleetState {
  phase: Phase;
  screen: Screen;
  manager: { did: string; company: string } | null;
  dashboard: DashboardView | null;
  vehicles: VehicleRow[];
  drivers: DriverRow[];
  assignments: AssignmentRow[];
  corridors: CorridorRow[];
  subtypes: SubtypeRow[];
  error: SbgError | null;
  toasts: Toast[];
  busy: string | null;
  refreshing: boolean;
  stale: boolean;
  vForm: VehicleForm;
  dForm: DriverForm;
  cForm: { driverDid: string; vehicleId: string; corridorId: string };
}

const EMPTY_COUPLE = { driverDid: '', vehicleId: '', corridorId: '' };

const INITIAL: FleetState = {
  phase: 'boot',
  screen: 'dash',
  manager: null,
  dashboard: null,
  vehicles: [],
  drivers: [],
  assignments: [],
  corridors: [],
  subtypes: [],
  error: null,
  toasts: [],
  busy: null,
  refreshing: false,
  stale: false,
  vForm: { ...EMPTY_VEHICLE },
  dForm: { ...EMPTY_DRIVER },
  cForm: { ...EMPTY_COUPLE },
};

const isOffline = (e: SbgError) => e.code === 'NETWORK' || e.code === 'TIMEOUT';

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
      const [dashR, vehR, drvR, asgR, corR, subR] = await Promise.all([
        client.api.dashboard(),
        client.api.vehicles(),
        client.api.drivers(),
        client.api.assignments(),
        client.api.corridors(),
        client.api.truckSubtypes(),
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

  const signIn = useCallback(async (code: string) => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setState((s) => ({ ...s, busy: 'signin', error: null }));
    const r = await managerLogin(trimmed);
    if (r.error) {
      setState((s) => ({ ...s, busy: null, error: r.error }));
      return;
    }
    const m = r.data!;
    purgeFleetTokens(null);
    saveManager(m.did, m.companyName);
    setState((s) => ({ ...INITIAL, phase: 'boot', manager: { did: m.did, company: m.companyName }, toasts: s.toasts }));
    setManagerDid(m.did);
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

  /* ----------------------------------------------------------- navigation */

  const go = useCallback((screen: Screen) => {
    setState((s) => ({ ...s, screen, error: null }));
  }, []);

  const setVForm = useCallback((p: Partial<VehicleForm>) => {
    setState((s) => ({ ...s, vForm: { ...s.vForm, ...p } }));
  }, []);
  const setDForm = useCallback((p: Partial<DriverForm>) => {
    setState((s) => ({ ...s, dForm: { ...s.dForm, ...p } }));
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
        ...(f.pricePerKm ? { pricePerKm: Number(f.pricePerKm) } : {}),
        ...(f.registrationPhotoRef || f.factoryId
          ? { documents: { registrationPhotoRef: f.registrationPhotoRef || undefined, factoryId: f.factoryId || undefined } }
          : {}),
      });
      if (r.error) return fail(r.error);
      const v = narrow<VehicleRow>(r.data);
      setState((s) => ({ ...s, vForm: { ...EMPTY_VEHICLE } }));
      pushToast({
        tone: 'ok',
        icon: 'truck',
        title: `${v?.plate ?? f.plate} registered`,
        detail: v ? `Dashboard QR ${v.qr} · ${v.capacityKg} kg${v.verified ? ' · verified' : ''}.` : undefined,
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
      if (r.error) return fail(r.error);
      const d = narrow<DriverRow>(r.data);
      setState((s) => ({ ...s, dForm: { ...EMPTY_DRIVER } }));
      pushToast({
        tone: 'ok',
        icon: 'person',
        title: `${d?.displayName ?? f.displayName} onboarded`,
        detail: d?.status === 'ACTIVE' ? `Badge ${d.badgeId} — ready to drive.` : 'Heavy registry — submit the KYC papers next.',
      });
      await refresh();
    });
  }, [client, managerDid, run, fail, pushToast, refresh]);

  const submitKyc = useCallback(
    async (did: string) => {
      if (!client) return;
      await run(`kyc:${did}`, async () => {
        // The sandbox transports no bytes; the REFERENCES are the contract fields,
        // exactly as the legacy console recorded them.
        const r = await client.api.submitDriverKyc(did, 'id.jpg', 'licence.jpg');
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'badge', title: 'KYC papers submitted', detail: 'SeeBuyGet checks them and issues the badge.' });
        await refresh();
      });
    },
    [client, run, fail, pushToast, refresh],
  );

  const setVehiclePrice = useCallback(
    async (vehicleId: string, price: number) => {
      if (!client || !(price >= 0)) return;
      await run(`price:${vehicleId}`, async () => {
        const r = await client.api.setVehiclePrice(vehicleId, price);
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'wallet', title: 'Rate updated', detail: `Now ${price.toFixed(3)} per km — public to shippers.` });
        await refresh();
      });
    },
    [client, run, fail, pushToast, refresh],
  );

  const couple = useCallback(async () => {
    if (!client) return;
    const f = stateRef.current.cForm;
    if (!f.driverDid || !f.vehicleId) return;
    await run('couple', async () => {
      const r = await client.api.couple(f.driverDid, f.vehicleId, f.corridorId || undefined);
      if (r.error) return fail(r.error);
      setState((s) => ({ ...s, cForm: { ...EMPTY_COUPLE } }));
      pushToast({ tone: 'ok', icon: 'route', title: 'Coupled', detail: 'The driver is on shift with this vehicle.' });
      await refresh();
    });
  }, [client, run, fail, pushToast, refresh]);

  const uncouple = useCallback(
    async (driverDid: string) => {
      if (!client) return;
      await run(`uncouple:${driverDid}`, async () => {
        const r = await client.api.uncouple(driverDid);
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'check', title: 'Session ended', detail: 'The vehicle is free again.' });
        await refresh();
      });
    },
    [client, run, fail, pushToast, refresh],
  );

  return {
    state,
    actions: {
      refresh,
      signIn,
      signOut,
      go,
      setVForm,
      setDForm,
      setCForm,
      submitVehicle,
      submitDriver,
      submitKyc,
      setVehiclePrice,
      couple,
      uncouple,
      pushToast,
      dismissToast,
    },
  };
}

export type FleetActions = ReturnType<typeof useFleetApp>['actions'];
