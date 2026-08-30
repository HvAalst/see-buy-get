import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../shared/i18n';
import type { SbgError } from '../../lib/sbg';
import {
  deviceMarker,
  fetchCountries,
  fetchMarket,
  fetchMarketSeries,
  fetchPoints,
  geocode,
  handOff,
  type MarketRow,
  type MarketSeriesView,
  registerStore,
  requestCode,
  signup,
  verifyCode,
  type NetworkPoint,
  type OperatingCountry,
  type SignupView,
  type VendorRegisteredView,
} from './api';
import { EMPTY_JOIN, nextStep, normalizePhone, prevStep, roleById, signupBody, stepBlocker, type JoinForm, type JoinStep, type RoleSpec } from './logic';

export type Screen = 'welcome' | 'roles' | 'join' | 'signin' | 'market';

/** FB3b — how far the visitor cares to look. `null` IS a choice: the whole market. */
export type MarketReach = number | null;
export const MARKET_REACHES: MarketReach[] = [25, 100, 300, null];

export interface HomeState {
  screen: Screen;
  role: RoleSpec | null;
  step: JoinStep;
  form: JoinForm;
  /** The sandbox's echoed OTP, shown so a demo can complete without an SMS gateway. */
  issuedCode: string | null;
  points: NetworkPoint[];
  pointsState: 'idle' | 'loading' | 'ready' | 'error';
  /** The countries the network can take somebody on in. Empty until loaded — see countriesState. */
  countries: OperatingCountry[];
  countriesState: 'idle' | 'loading' | 'ready' | 'error';
  /** What the account became — the "you are in" card. */
  account: SignupView | null;
  store: VendorRegisteredView | null;
  error: SbgError | null;
  busy: string | null;
  /* --- FB3b: the public freight market --- */
  /** What the visitor typed. Kept verbatim so the heading can say the name THEY used, not the gazetteer's. */
  marketQuery: string;
  /** Where the market is measured from. Null until a place resolves — nothing is fetched before that,
   *  because there is no sensible default point for a visitor who could be on any continent. */
  marketAt: { lat: number; lng: number } | null;
  /** The place the geocoder actually matched, when it differs from what was typed. */
  marketPlace: string | null;
  marketReach: MarketReach;
  market: MarketRow[];
  marketState: 'idle' | 'locating' | 'loading' | 'ready' | 'error';
  /** The server's own word for what the prices mean. Rendered, never paraphrased. */
  marketBasis: string | null;
  /** FB4 — which half of the market is on screen: today's open loads, or the series over time. */
  marketView: 'loads' | 'series';
  series: MarketSeriesView | null;
  seriesState: 'idle' | 'loading' | 'ready' | 'error';
}

const INITIAL: HomeState = {
  screen: 'welcome',
  role: null,
  step: 'phone',
  form: { ...EMPTY_JOIN },
  issuedCode: null,
  points: [],
  pointsState: 'idle',
  countries: [],
  countriesState: 'idle',
  account: null,
  store: null,
  error: null,
  busy: null,
  marketQuery: '',
  marketAt: null,
  marketPlace: null,
  marketReach: null, // the whole market, until the visitor narrows it
  market: [],
  marketState: 'idle',
  marketBasis: null,
  marketView: 'loads',
  series: null,
  seriesState: 'idle',
};

/**
 * The front door's state. No session, no phases, no toasts — every call is a public POST
 * and every failure renders inline next to the control that caused it.
 */
export function useHomeApp() {
  const [state, setState] = useState<HomeState>(INITIAL);
  /** FB3b — which look owns the screen. A slow answer for "Nairobi" must not overwrite a fast one for
   *  "Kaapstad" typed after it; the market is read by someone trying several places in a row. */
  const marketEpoch = useRef(0);
  const seriesEpoch = useRef(0);
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

  /**
   * Load where the network operates, and preselect when there is only one answer.
   *
   * Preselecting matters: with a single country there is nothing to choose and the wizard shows no
   * control at all, so the form must already hold the country the sign-up will be made in — otherwise the
   * only deployment anybody has ever run would submit a blank one.
   */
  const loadCountries = useCallback(async () => {
    setState((s) => ({ ...s, countriesState: 'loading' }));
    const r = await fetchCountries();
    if (r.error) {
      setState((s) => ({ ...s, countriesState: 'error' }));
      return;
    }
    const countries = r.data ?? [];
    setState((s) => ({
      ...s,
      countries,
      countriesState: 'ready',
      form: s.form.country ? s.form : { ...s.form, country: countries.length === 1 ? countries[0].country : '' },
    }));
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
      if (stateRef.current.countriesState !== 'ready') void loadCountries();
      else if (stateRef.current.countries.length === 1) setState((s) => ({ ...s, form: { ...s.form, country: stateRef.current.countries[0].country } }));
    },
    [loadPoints, loadCountries],
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
    if (!role || stepBlocker(role, 'phone', form, t)) return;
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
    if (!role || stepBlocker(role, 'code', form, t)) return;
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
      const blocker = stepBlocker(s.role, s.step, s.form, t);
      if (blocker) return s;
      return { ...s, step: nextStep(s.role.kind, s.step), error: null };
    });
  }, []);

  /** The final step: create the account (or the store) and hand it to its app. */
  const submit = useCallback(async () => {
    const { role, form } = stateRef.current;
    if (!role) return;

    if (role.kind === 'vendor') {
      if (stepBlocker(role, 'about', form, t)) return;
      await run('submit', async () => {
        const r = await registerStore({ name: form.displayName.trim(), country: form.country.trim() || undefined });
        if (r.error) {
          setState((s) => ({ ...s, error: r.error }));
          return;
        }
        setState((s) => ({ ...s, store: r.data, step: 'done' }));
      });
      return;
    }

    if (stepBlocker(role, 'login', form, t)) return;
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

  /* ------------------------------------------------------- FB3b: the market -- */

  const setMarketQuery = useCallback((marketQuery: string) => setState((s) => ({ ...s, marketQuery })), []);

  /** Read the market around a point. Kept separate from the lookup so changing the reach does not re-geocode
   *  a name that has already resolved — and so a market fetch cannot silently move the pin under the reader. */
  const readMarket = useCallback(async (at: { lat: number; lng: number }, reach: MarketReach) => {
    const epoch = ++marketEpoch.current;
    setState((s) => ({ ...s, marketState: 'loading', marketAt: at, marketReach: reach }));
    const r = await fetchMarket(at, reach ?? undefined);
    if (epoch !== marketEpoch.current) return; // a later look already owns the screen
    if (r.error) {
      setState((s) => ({ ...s, marketState: 'error', error: r.error }));
      return;
    }
    setState((s) => ({ ...s, market: r.data?.items ?? [], marketBasis: r.data?.basis ?? null, marketState: 'ready', error: null }));
  }, []);

  /** Resolve what the visitor typed, then read the market there. A name that cannot be placed leaves the
   *  previous answer alone rather than blanking it: they are mid-search, not looking at nothing. */
  const lookUpMarket = useCallback(async () => {
    const q = stateRef.current.marketQuery.trim();
    if (!q) return;
    const epoch = ++marketEpoch.current;
    setState((s) => ({ ...s, marketState: 'locating', error: null }));
    const r = await geocode(q);
    if (epoch !== marketEpoch.current) return;
    if (r.error || !r.data?.location) {
      setState((s) => ({ ...s, marketState: 'error', error: r.error ?? null }));
      return;
    }
    setState((s) => ({ ...s, marketPlace: r.data!.matched ?? null }));
    await readMarket(r.data.location, stateRef.current.marketReach);
  }, [readMarket]);

  /** Change the reach over a place already found. Does nothing until there is one — there is no default
   *  point for a visitor who could be on any continent, and guessing one would answer the wrong question. */
  const setMarketReach = useCallback(
    (reach: MarketReach) => {
      const at = stateRef.current.marketAt;
      if (!at) {
        setState((s) => ({ ...s, marketReach: reach }));
        return;
      }
      void readMarket(at, reach);
    },
    [readMarket],
  );

  /**
   * FB4 — read the series for wherever the market view is currently pointed.
   *
   * Deliberately fetched over the SAME place and reach the loads list is showing, so switching between the
   * two halves never silently changes the question being answered. With no place chosen the series is still
   * available — it is the whole network then, which is a real answer rather than a missing one.
   */
  const loadSeries = useCallback(async () => {
    const epoch = ++seriesEpoch.current;
    setState((s) => ({ ...s, seriesState: 'loading' }));
    const at = stateRef.current.marketAt;
    const r = await fetchMarketSeries(at, at ? (stateRef.current.marketReach ?? undefined) : undefined);
    if (epoch !== seriesEpoch.current) return;
    if (r.error) {
      setState((s) => ({ ...s, seriesState: 'error', error: r.error }));
      return;
    }
    setState((s) => ({ ...s, series: r.data ?? null, seriesState: 'ready', error: null }));
  }, []);

  /** Switch halves. */
  const setMarketView = useCallback((marketView: 'loads' | 'series') => setState((s) => ({ ...s, marketView })), []);

  /**
   * The series follows whatever the market view is pointed at — on arrival, and whenever the place or the
   * reach moves underneath it.
   *
   * One effect rather than a call chained onto each control, so there is exactly one rule to hold: the table
   * on screen always describes the place named above it. A cached table left behind by an earlier place
   * would be read as this one's, and this is the screen people take numbers away from.
   */
  useEffect(() => {
    if (state.marketView === 'series') void loadSeries();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.marketView, state.marketAt, state.marketReach]);

  return {
    state,
    actions: { go, startJoin, setForm, back, sendCode, confirmCode, advance, submit, restart, loadPoints, setMarketQuery, lookUpMarket, setMarketReach, setMarketView, loadSeries },
  };
}

export type HomeActions = ReturnType<typeof useHomeApp>['actions'];
