import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { SbgError } from '../../lib/sbg';
import {
  deviceMarker,
  fetchPoints,
  handOff,
  registerStore,
  requestCode,
  signup,
  verifyCode,
  type NetworkPoint,
  type SignupView,
  type VendorRegisteredView,
} from './api';
import { EMPTY_JOIN, nextStep, normalizePhone, prevStep, roleById, signupBody, stepBlocker, type JoinForm, type JoinStep, type RoleSpec } from './logic';

export type Screen = 'welcome' | 'roles' | 'join' | 'signin';

export interface HomeState {
  screen: Screen;
  role: RoleSpec | null;
  step: JoinStep;
  form: JoinForm;
  /** The sandbox's echoed OTP, shown so a demo can complete without an SMS gateway. */
  issuedCode: string | null;
  points: NetworkPoint[];
  pointsState: 'idle' | 'loading' | 'ready' | 'error';
  /** What the account became — the "you are in" card. */
  account: SignupView | null;
  store: VendorRegisteredView | null;
  error: SbgError | null;
  busy: string | null;
}

const INITIAL: HomeState = {
  screen: 'welcome',
  role: null,
  step: 'phone',
  form: { ...EMPTY_JOIN },
  issuedCode: null,
  points: [],
  pointsState: 'idle',
  account: null,
  store: null,
  error: null,
  busy: null,
};

/**
 * The front door's state. No session, no phases, no toasts — every call is a public POST
 * and every failure renders inline next to the control that caused it.
 */
export function useHomeApp() {
  const [state, setState] = useState<HomeState>(INITIAL);
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });

  const loadPoints = useCallback(async () => {
    setState((s) => ({ ...s, pointsState: 'loading' }));
    const r = await fetchPoints();
    if (r.error) {
      setState((s) => ({ ...s, pointsState: 'error' }));
      return;
    }
    setState((s) => ({ ...s, points: r.data ?? [], pointsState: 'ready' }));
  }, []);

  const go = useCallback((screen: Screen) => {
    setState((s) => ({ ...s, screen, error: null }));
  }, []);

  const startJoin = useCallback(
    (roleId: string) => {
      const role = roleById(roleId);
      if (!role) return;
      setState((s) => ({
        ...s,
        screen: 'join',
        role,
        step: role.kind === 'vendor' ? 'about' : 'phone',
        form: { ...EMPTY_JOIN },
        issuedCode: null,
        account: null,
        store: null,
        error: null,
      }));
      if (stateRef.current.pointsState !== 'ready') void loadPoints();
    },
    [loadPoints],
  );

  const setForm = useCallback((p: Partial<JoinForm>) => {
    setState((s) => ({ ...s, form: { ...s.form, ...p } }));
  }, []);

  const back = useCallback(() => {
    setState((s) => {
      if (!s.role) return { ...s, screen: 'roles' };
      if (s.step === 'phone' || (s.role.kind === 'vendor' && s.step === 'about')) return { ...s, screen: 'roles', error: null };
      return { ...s, step: prevStep(s.role.kind, s.step), error: null };
    });
  }, []);

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

  /** Step 1 → 2: ask the backend to send (and, in the sandbox, echo) the code. */
  const sendCode = useCallback(async () => {
    const { role, form } = stateRef.current;
    if (!role || stepBlocker(role, 'phone', form)) return;
    await run('code', async () => {
      const r = await requestCode(normalizePhone(form.phone));
      if (r.error) {
        setState((s) => ({ ...s, error: r.error }));
        return;
      }
      const code = r.data?.code ?? r.data?.otp ?? r.data?.verificationCode ?? null;
      setState((s) => ({ ...s, issuedCode: code, step: 'code', form: { ...s.form, code: code ?? '' } }));
    });
  }, [run]);

  /** Step 2 → 3: the backend marks the number verified, which signup then requires. */
  const confirmCode = useCallback(async () => {
    const { role, form } = stateRef.current;
    if (!role || stepBlocker(role, 'code', form)) return;
    await run('verify', async () => {
      const r = await verifyCode(normalizePhone(form.phone), form.code.trim());
      if (r.error) {
        setState((s) => ({ ...s, error: r.error }));
        return;
      }
      setState((s) => ({ ...s, step: 'about' }));
    });
  }, [run]);

  /** Plain steps with nothing to send yet. */
  const advance = useCallback(() => {
    setState((s) => {
      if (!s.role) return s;
      const blocker = stepBlocker(s.role, s.step, s.form);
      if (blocker) return s;
      return { ...s, step: nextStep(s.role.kind, s.step), error: null };
    });
  }, []);

  /** The final step: create the account (or the store) and hand it to its app. */
  const submit = useCallback(async () => {
    const { role, form } = stateRef.current;
    if (!role) return;

    if (role.kind === 'vendor') {
      if (stepBlocker(role, 'about', form)) return;
      await run('submit', async () => {
        const r = await registerStore({ name: form.displayName.trim(), country: form.vendorCountry.trim() || undefined });
        if (r.error) {
          setState((s) => ({ ...s, error: r.error }));
          return;
        }
        setState((s) => ({ ...s, store: r.data, step: 'done' }));
      });
      return;
    }

    if (stepBlocker(role, 'login', form)) return;
    await run('submit', async () => {
      const r = await signup(signupBody(role, form, deviceMarker()));
      if (r.error) {
        setState((s) => ({ ...s, error: r.error }));
        return;
      }
      const account = r.data!;
      // Same-origin handoff: the role's app finds its identity already stored.
      handOff(account.role, account.did, account.email);
      setState((s) => ({ ...s, account, step: 'done' }));
    });
  }, [run]);

  const restart = useCallback(() => {
    setState((s) => ({ ...INITIAL, points: s.points, pointsState: s.pointsState }));
  }, []);

  return {
    state,
    actions: { go, startJoin, setForm, back, sendCode, confirmCode, advance, submit, restart, loadPoints },
  };
}

export type HomeActions = ReturnType<typeof useHomeApp>['actions'];
