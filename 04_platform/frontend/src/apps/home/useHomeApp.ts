import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { t } from '../../shared/i18n';
import type { SbgError } from '../../lib/sbg';
import {
  deviceMarker,
  fetchCountries,
  fetchTruckSubtypes,
  fetchMarket,
  fetchMarketSeries,
  fetchPoints,
  fetchProfile,
  findAgents,
  type AgentCard,
  fetchStoreReputation,
  geocode,
  handOff,
  handOffStore,
  type MarketRow,
  type MarketSeriesView,
  type ProfileView,
  type StoreReputation,
  registerStore,
  requestCode,
  signup,
  verifyCode,
  type NetworkPoint,
  type OperatingCountry,
  type SignupView,
  type VendorRegisteredView,
} from './api';
import { currentPath, townSlugFromPath } from './prerendered';
import { helpPageOf, type HelpPage } from './help';
import { infoPageOf, type InfoPage } from './pages';
import { readLinkKey } from '../../shared/archive/documentLink';
import { readReportKey } from '../../shared/damage/damageReport';
import { EMPTY_JOIN, fleetSignupBody, nextStep, readDeepLink, normalizePhone, onlyJoinable, prevStep, roleById, signupBody, stepBlocker, type JoinForm, type JoinStep, type RoleSpec } from './logic';
import { saveShopDeviceKey } from '../../shared/account/shopDevice';
import { isPinReset } from '../../shared/account/recovery';
import { enrollPerson, mySignups, sendPapersAgain, signUpDriver, signUpFleet, uploadPaper, type FleetSignupView, type PersonSession } from './api';

export type Screen = 'welcome' | 'roles' | 'join' | 'signin' | 'market' | 'store' | 'profile' | 'agents' | 'verify' | 'document' | 'report' | 'town' | 'help' | 'info';

/** FB3b — how far the visitor cares to look. `null` IS a choice: the whole market. */
export type MarketReach = number | null;
export const MARKET_REACHES: MarketReach[] = [25, 100, 300, null];

export interface HomeState {
  screen: Screen;
  /** A fingerprint carried in on ?note=, so a printed address lands straight on the answer. */
  verifyInitial?: string;
  /** The key of a link to a document, carried in on #doc= and taken out of the address the moment it is read. */
  docKey?: string;
  /** The key of a link to a damage claim report, carried in on #report= and taken out of the address the same way. */
  reportKey?: string;
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
  /** The truck body types, read from the network. Empty until a courier picks a truck and we fetch them. */
  truckSubtypes: Array<{ id: string; label: string }>;
  /** What the account became — the "you are in" card. */
  account: SignupView | null;
  store: VendorRegisteredView | null;
  /** A store's public reputation, reached by ?store=<id> from the widget or a link. */
  /** The public profile at /@handle. Null until one is asked for. */
  profile: ProfileView | null;
  /** CL6 — the agent finder. `basis` travels with the rows: this list is alphabetical, never ranked. */
  agents: AgentCard[] | null;
  agentsBasis: string | null;
  agentsState: 'idle' | 'loading' | 'ready' | 'error';
  agentsError: string | null;
  agentQuery: { specialism: string; place: string; country: string };
  profileState: 'idle' | 'loading' | 'ready' | 'error';
  profileError: string | null;
  reputation: StoreReputation | null;
  reputationState: 'idle' | 'loading' | 'ready' | 'error';
  reputationError: SbgError | null;
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
  /** The town page being shown, by its address (`/towns/<slug>`). */
  townSlug: string | null;
  /** The help page being shown, by its address (`/help/`, `/help/<article>/`, `/help/contact/`). */
  helpPage: HelpPage | null;
  /** /about/ or /for/<who>/: the pages written to be quoted. */
  infoPage: InfoPage | null;
  /* --- a fleet signs itself up --- */
  /** The person, signed in after the PIN step: in memory only, for the papers and the sign-up. */
  person: PersonSession | null;
  /** The PIN step asks for a recovery email too: a first PIN (`first`), or a PIN replaced on a new device (`reset`). */
  pinEmail: 'first' | 'reset' | null;
  /** The fleets this person signed up before, read after the PIN. Null until then. */
  fleetSignups: FleetSignupView[] | null;
  /** They have a sign-up already and chose to sign up another fleet. */
  fleetAnother: boolean;
  /** Papers that came back, being sent again for this fleet. */
  resendFor: string | null;
  /** What the sign-up (or the papers sent again) came back as: the done screen. */
  fleetSignup: FleetSignupView | null;
}

const INITIAL: HomeState = {
  screen: 'welcome',
  townSlug: null,
  helpPage: null,
  infoPage: null,
  agents: null,
  agentsBasis: null,
  agentsState: 'idle',
  agentsError: null,
  agentQuery: { specialism: '', place: '', country: '' },
  role: null,
  step: 'phone',
  form: { ...EMPTY_JOIN },
  issuedCode: null,
  points: [],
  pointsState: 'idle',
  countries: [],
  countriesState: 'idle',
  truckSubtypes: [],
  account: null,
  store: null,
  profile: null,
  profileState: 'idle',
  profileError: null,
  reputation: null,
  reputationState: 'idle',
  reputationError: null,
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
  person: null,
  pinEmail: null,
  fleetSignups: null,
  fleetAnother: false,
  resendFor: null,
  fleetSignup: null,
};

/** Everything a fleet's sign-up holds, cleared whenever a join starts again. */
const NO_FLEET = { person: null, pinEmail: null, fleetSignups: null, fleetAnother: false, resendFor: null, fleetSignup: null } as const;

/**
 * The front door's state. No session, no phases, no toasts — every call is a public POST
 * and every failure renders inline next to the control that caused it.
 */
export function useHomeApp() {
  // A town page is an ADDRESS (`/towns/<slug>`), known before the first render — in the build and in the browser
  // alike — so the first frame is the town page and a prerendered one hydrates without a flash of the front door.
  const [state, setState] = useState<HomeState>(() => {
    const path = currentPath();
    const slug = townSlugFromPath(path);
    if (slug) return { ...INITIAL, screen: 'town', townSlug: slug };
    // The help is an address too: its pages are built into HTML, and the first frame must be that page.
    const helpPage = helpPageOf(path);
    if (helpPage) return { ...INITIAL, screen: 'help', helpPage };
    const infoPage = infoPageOf(path);
    return infoPage ? { ...INITIAL, screen: 'info', infoPage } : INITIAL;
  });
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
      // Preselect only when there is genuinely one answer — counted over the countries somebody may
      // actually join in, not over the atlas, which is always long.
      form: s.form.country ? s.form : { ...s.form, country: onlyJoinable(countries) },
    }));
  }, []);

  /**
   * The body types, fetched the first time somebody says they drive a truck.
   *
   * Not restated in the client: the catalogue has more than twenty entries and the hand-typed seven this
   * form shipped with included two that were not real keys, so it offered body types the server refuses.
   */
  const loadTruckSubtypes = useCallback(async () => {
    if (stateRef.current.truckSubtypes.length) return;
    const r = await fetchTruckSubtypes();
    if (r.error) return; // the field simply stays a plain list of nothing; the blocker still says one is needed
    setState((s) => ({ ...s, truckSubtypes: r.data ?? [] }));
  }, []);

  const go = useCallback((screen: Screen) => {
    setState((s) => ({ ...s, screen, error: null }));
  }, []);

  /**
   * A store's public page, by id.
   *
   * Reached from ?store=<id> — the widget chip's link, and anything else anybody wants to paste. No key
   * and no account: the page has to be readable by the shopper deciding whether to buy, which is the
   * whole point of measuring any of this.
   */
  const openStore = useCallback(async (vendorId: string) => {
    if (!vendorId) return;
    setState((s) => ({ ...s, screen: 'store', reputationState: 'loading', reputationError: null }));
    const r = await fetchStoreReputation(vendorId);
    if (r.error) {
      setState((s) => ({ ...s, reputationState: 'error', reputationError: r.error }));
      return;
    }
    setState((s) => ({ ...s, reputation: r.data, reputationState: 'ready', reputationError: null }));
  }, []);

  /**
   * FINDING AN AGENT — the market dynamic §6a's page-per-participant could not supply on its own.
   *
   * A page closes the findability gap only for somebody who already has the handle. An importer looking
   * for an agent who clears vehicles at Mombasa has nowhere to start, and "ask around" is precisely the
   * out-of-band chasing this whole slice exists to end.
   *
   * It is still not a ranked directory: the answer is a list of PAGES, alphabetical, with every row
   * carrying what the agent SAYS beside what we have actually seen — so a claim with nothing behind it
   * and a claim with forty consignments behind it are visibly different things.
   */
  const findAgentsBy = useCallback(async (q: { specialism?: string; place?: string; country?: string }) => {
    setState((s) => ({
      ...s,
      screen: 'agents',
      agentsState: 'loading',
      agentsError: null,
      agentQuery: { specialism: q.specialism ?? '', place: q.place ?? '', country: q.country ?? '' },
    }));
    const r = await findAgents(q);
    if (r.error) {
      setState((s) => ({ ...s, agentsState: 'error', agentsError: r.error.detail || r.error.title }));
      return;
    }
    setState((s) => ({ ...s, agents: r.data.items, agentsBasis: r.data.basis, agentsState: 'ready', agentsError: null }));
  }, []);

  /**
   * A participant's public page, by handle.
   *
   * The directory, and deliberately not a list: a ranked list of clearing agents would impose an ordering
   * on people whether or not anything went wrong, and while the network is the party appointing them,
   * publishing that ordering is self-dealing. A page per participant carries the same facts and
   * manufactures no loser out of relative position.
   */
  const openProfile = useCallback(async (handle: string) => {
    if (!handle) return;
    setState((s) => ({ ...s, screen: 'profile', profileState: 'loading', profileError: null }));
    const r = await fetchProfile(handle);
    if (r.error) {
      setState((s) => ({ ...s, profileState: 'error', profileError: r.error.detail || r.error.title }));
      return;
    }
    setState((s) => ({ ...s, profile: r.data, profileState: 'ready', profileError: null }));
  }, []);

  /**
   * `/@handle` — read from the PATH, and deliberately NOT stripped afterwards.
   *
   * The store deep link below is a query param that gets cleaned away, because a refresh should not
   * re-jump somebody onto a page they navigated off. A handle is the opposite: `/@fedex` is the canonical
   * address of that participant, so it belongs in the bar where it can be copied, shared and bookmarked.
   * Taking it out would break the one thing the address shape exists for.
   *
   * A static host needs a rewrite so `/@*` serves this app's index.html. NOT WIRED here, documented the
   * way the carrier webhook seam is: the sandbox's dev server already falls through to index.html.
   */
  useEffect(() => {
    const path = globalThis.location?.pathname ?? '';
    const handle = /^\/@([A-Za-z0-9][A-Za-z0-9-]*)\/?$/.exec(path)?.[1];
    if (handle) void openProfile(handle);
  }, [openProfile]);

  /**
   * ?note=<fingerprint> — the address printed on the consignment note and in every export bundle.
   *
   * Somebody holding a paper copy types the address and lands on the answer, rather than on a front door
   * that asks them to join a logistics network to find out whether a document is genuine. Kept in the
   * URL deliberately, unlike the store deep link: this one is worth sharing and worth refreshing.
   */
  useEffect(() => {
    const note = new URLSearchParams(globalThis.location?.search ?? '').get('note');
    if (note) setState((s) => ({ ...s, screen: 'verify', verifyInitial: note }));
  }, []);

  /**
   * #doc=<key> — the button in an email: a consignment note, for whoever holds the link, with nobody signed in.
   *
   * After the `#`, so that no server ever saw it. Read once and TAKEN OUT OF THE ADDRESS, unlike the fingerprint
   * above: this one opens a document, and an address bar is photographed, bookmarked and synced to other devices.
   * The key lives in this page's memory from here; a refresh sends somebody back to the email, which still has it.
   */
  useEffect(() => {
    const key = readLinkKey(globalThis.location?.hash);
    if (key === undefined) return;
    try {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    } catch {
      /* a browser that refuses the rewrite still shows the document */
    }
    setState((s) => ({ ...s, screen: 'document', docKey: key }));
  }, []);

  /**
   * #report=<key> — a damage claim report, for whoever the claimant handed the link to, with nobody signed in. Read
   * once and taken out of the address, exactly as a note's key is, and for the same reason.
   */
  useEffect(() => {
    const key = readReportKey(globalThis.location?.hash);
    if (key === undefined) return;
    try {
      history.replaceState(null, '', `${location.pathname}${location.search}`);
    } catch {
      /* a browser that refuses the rewrite still shows the report */
    }
    setState((s) => ({ ...s, screen: 'report', reportKey: key }));
  }, []);

  /*
   * `/?join=driver`, `/?go=market` — every card on the front page is a real address (shareable, opens in a new tab,
   * followable by a search engine). Read once and stripped, like the store link: a refresh must not re-run a join.
   */
  useEffect(() => {
    const link = readDeepLink(globalThis.location?.search ?? '');
    if (!link) return;
    try {
      const url = new URL(location.href);
      url.searchParams.delete('join');
      url.searchParams.delete('go');
      history.replaceState(null, '', url.toString());
    } catch {
      /* a browser that refuses the rewrite still lands on the right screen */
    }
    if ('join' in link) startJoin(link.join);
    else go(link.go);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The deep link, read once and stripped as it is used — a refresh should not re-jump somebody onto a
  // store page they have already read and navigated away from.
  useEffect(() => {
    const id = new URLSearchParams(globalThis.location?.search ?? '').get('store');
    if (!id) return;
    try {
      const url = new URL(location.href);
      url.searchParams.delete('store');
      history.replaceState(null, '', url.toString());
    } catch {
      /* a browser that refuses the rewrite still lands on the right screen */
    }
    void openStore(id);
  }, [openStore]);

  const startJoin = useCallback(
    (roleId: string) => {
      const role = roleById(roleId);
      if (!role) return;
      setState((s) => ({
        ...s,
        screen: 'join',
        role,
        step: 'phone',
        form: { ...EMPTY_JOIN },
        ...NO_FLEET,
        issuedCode: null,
        account: null,
        store: null,
        error: null,
      }));
      if (stateRef.current.pointsState !== 'ready') void loadPoints();
      if (stateRef.current.countriesState !== 'ready') void loadCountries();
      else setState((s) => (s.form.country ? s : { ...s, form: { ...s.form, country: onlyJoinable(stateRef.current.countries) } }));
    },
    [loadPoints, loadCountries],
  );

  const setForm = useCallback(
    (p: Partial<JoinForm>) => {
      setState((s) => ({ ...s, form: { ...s.form, ...p } }));
      // The moment a truck is in play, the body types are needed — and a truck is not registrable without
      // one, so fetching them late would leave somebody looking at an empty required field.
      if (p.vehicleClass === 'truck' || p.licenceClasses?.includes('truck')) void loadTruckSubtypes();
    },
    [loadTruckSubtypes],
  );

  const back = useCallback(() => {
    setState((s) => {
      if (!s.role) return { ...s, screen: 'roles' };
      if (s.step === 'phone') return { ...s, screen: 'roles', error: null };
      // A fleet's person is signed in by now: back from the papers sent again is back to their list, and back from
      // the first form is out of the join — never into a PIN step whose code has been spent.
      if (s.role.kind === 'fleet' && s.person) {
        if (s.resendFor) return { ...s, resendFor: null, step: 'about', error: null };
        if (s.step === 'about') return s.fleetAnother && s.fleetSignups?.length ? { ...s, fleetAnother: false, error: null } : { ...s, screen: 'roles', error: null };
      }
      return { ...s, step: prevStep(s.role.kind, s.step), error: null };
    });
  }, []);

  /** Back to one step to put a detail right — the duplicate note's 'check what you typed'. Everything typed is kept. */
  const revisit = useCallback((step: JoinStep) => {
    setState((s) => ({ ...s, step, error: null }));
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
      // A fleet's person chooses their PIN next; everybody else goes on to say who they are.
      setState((s) => ({ ...s, step: nextStep(role.kind, 'code') }));
    });
  }, [run]);

  /** The driver, made under the person's sign-in. The Driver app on this browser then opens with the phone and PIN. */
  const makeDriver = useCallback(async (person: PersonSession) => {
    const { role, form } = stateRef.current;
    if (!role) return;
    const r = await signUpDriver(person, { phone: normalizePhone(form.phone), profile: (signupBody(role, form, deviceMarker()) as { profile: unknown }).profile, ...(form.agreement ? { agreement: form.agreement } : {}) });
    if (r.error || !r.data) {
      setState((s) => ({ ...s, error: r.error }));
      return;
    }
    const made = r.data;
    handOff('driver', made.did, '');
    setState((s) => ({ ...s, account: { role: 'driver', did: made.did, entityStatus: made.entityStatus }, step: 'done', error: null }));
  }, []);

  /**
   * THE PERSON SIGNS IN: the PIN their app opens with — and, the first time, a recovery email behind it. A fleet's
   * person does it before the papers (they are uploaded under this sign-in), and then the fleets they signed up before
   * are read, so somebody coming back is shown those. A driver does it last, and the driver is made under it.
   */
  const choosePin = useCallback(async () => {
    const { role, form, pinEmail, person: signedIn } = stateRef.current;
    if (!role || stepBlocker(role, 'pin', form, t)) return;
    if (pinEmail && (!form.recoveryEmail.includes('@') || !/^\d{6}$/.test(form.recoveryCode))) return;
    await run('pin', async () => {
      // A driver whose details were refused (already registered) puts them right and comes back here signed in: the
      // code is spent, so the driver is made again under the sign-in they already have.
      if (role.kind === 'driver' && signedIn) {
        await makeDriver(signedIn);
        return;
      }
      const phone = normalizePhone(form.phone);
      const r = await enrollPerson(phone, form.pin, pinEmail ? { email: form.recoveryEmail.trim(), code: form.recoveryCode } : undefined, form.agreement);
      if (r.error || !r.data) {
        const field = (r.error?.params as { field?: string } | undefined)?.field;
        // Not an error: the server wants a recovery email behind a first PIN, or the account's own on a new device.
        if (!pinEmail && field === 'email') {
          setState((s) => ({ ...s, pinEmail: isPinReset(r.error) ? 'reset' : 'first', error: null }));
          return;
        }
        // The check of the number is spent or gone: back to it.
        const reverify = r.error?.code === 'PHONE_NOT_VERIFIED';
        setState((s) => ({ ...s, error: r.error, ...(reverify ? { step: 'phone' as JoinStep } : {}) }));
        return;
      }
      const person = r.data;
      if (role.kind === 'driver') {
        setState((s) => ({ ...s, person, pinEmail: null, error: null }));
        await makeDriver(person);
        return;
      }
      const mine = await mySignups(person);
      setState((s) => ({ ...s, person, pinEmail: null, fleetSignups: mine.data?.items ?? [], step: 'about', error: null }));
    });
  }, [run, makeDriver]);

  /** One of the four papers, photographed and uploaded as the person. */
  const uploadFleetPaper = useCallback(async (kind: string, file: File): Promise<string | null> => {
    const person = stateRef.current.person;
    return person ? uploadPaper(person, kind, file) : null;
  }, []);

  /** Sign up another fleet, from the list of the ones already signed up. */
  const signUpAnother = useCallback(() => setState((s) => ({ ...s, fleetAnother: true, resendFor: null, error: null })), []);

  /** Papers came back: take the ones that were wrong again, and send them. The rest of the sign-up stands. */
  const resendPapers = useCallback((did: string) => {
    setState((s) => ({ ...s, resendFor: did, step: 'papers', form: { ...s.form, papers: { ...EMPTY_JOIN.papers } }, error: null }));
  }, []);

  /** The fleet's last step: the sign-up with its papers — or, for papers that came back, the papers alone. */
  const submitFleet = useCallback(async () => {
    const { role, form, person, resendFor } = stateRef.current;
    if (!role || !person || stepBlocker(role, 'papers', form, t)) return;
    // A new fleet waits for what its country asks to be settled: covered by what they agreed to, or agreed to here.
    if (!resendFor && !form.agreementHere) return;
    await run('submit', async () => {
      const r = resendFor ? await sendPapersAgain(person, resendFor, form.papers) : await signUpFleet(person, fleetSignupBody(form));
      if (r.error || !r.data) {
        setState((s) => ({ ...s, error: r.error }));
        return;
      }
      setState((s) => ({ ...s, fleetSignup: r.data, step: 'done', error: null }));
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
      if (stepBlocker(role, 'about', form, t) || stepBlocker(role, 'login', form, t)) return;
      await run('submit', async () => {
        const email = form.email.trim().toLowerCase();
        // Round 40 — with the number checked in the first steps: new phones and browsers are confirmed by a code to it.
        const r = await registerStore({ name: form.displayName.trim(), country: form.country.trim() || undefined, address: form.storeAddress.trim() || undefined, email, password: form.password, ownerPhone: normalizePhone(form.phone), ...(form.agreement ? { agreement: form.agreement } : {}) });
        if (r.error) {
          // The check of the number is spent or gone: back to it, rather than a button that can only say no.
          const reverify = r.error.code === 'PHONE_NOT_VERIFIED';
          setState((s) => ({ ...s, error: r.error, ...(reverify ? { step: 'phone' as JoinStep } : {}) }));
          return;
        }
        // The Store app finds the address already filled in: the store signs in with it and the password just chosen —
        // and this browser, the one it was made on, is already the store's.
        handOffStore(email);
        saveShopDeviceKey(email, r.data?.device);
        setState((s) => ({ ...s, store: r.data, step: 'done' }));
      });
      return;
    }

    if (stepBlocker(role, 'login', form, t)) return;
    await run('submit', async () => {
      const r = await signup(signupBody(role, form, deviceMarker()));
      if (r.error) {
        // Refused too often on one verification (details already registered): the phone has to be verified again,
        // so the person is taken to that step rather than left pressing a button that can only say no.
        const reverify = r.error.code === 'PHONE_NOT_VERIFIED';
        setState((s) => ({ ...s, error: r.error, ...(reverify ? { step: 'phone' as JoinStep } : {}) }));
        return;
      }
      const account = r.data!;
      // Same-origin handoff: the role's app finds its identity already stored — and a shop, the phone it signed up on,
      // which is its first (its sign-in works only on its own phones).
      handOff(account.role, account.did, account.email ?? '');
      if (account.email) saveShopDeviceKey(account.email, account.device);
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
    actions: { go, openStore, openProfile, findAgentsBy, startJoin, setForm, back, revisit, sendCode, confirmCode, advance, submit, restart, loadPoints, loadTruckSubtypes, setMarketQuery, lookUpMarket, setMarketReach, setMarketView, loadSeries, choosePin, uploadFleetPaper, signUpAnother, resendPapers, submitFleet },
  };
}

export type HomeActions = ReturnType<typeof useHomeApp>['actions'];
