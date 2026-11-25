import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { offerPasskeyAfterCode } from '../../shared/account/PasskeyOffer';
import { rememberWay, type CodeWay } from '../../shared/account/CodeWays';
import { carriedEntry, takeCarryFromAddress, type Carried } from '../../shared/account/carry';
import { isNewDevice } from '../../shared/account/pin';
import { isPinReset } from '../../shared/account/recovery';
import type { Agreement } from '../../shared/documents/documents';
import { LIVE_READ_GAP_MS, openLive, throttleReads, type LiveState } from '../../shared/live';
import type { SbgError } from '../../lib/sbg';
import {
  clearPartnerSession,
  clearSessions,
  createPartnerClient,
  createPersonClient,
  enroll,
  forgetPerson,
  partnerConfig,
  pinLogin,
  readLast,
  readPhone,
  rememberLast,
  rememberPerson,
  requestOtp,
  signedOutHere,
  verifyOtp,
  type Membership,
  type PartnerClient,
  type PartnerMe,
  type PartnerOwed,
  type PartnerMoney,
  type PartnerStatements,
  type PartnerPayouts,
  type PersonAuth,
  type PersonClient,
} from './api';
import { openOnArrival, type Section } from './logic';

/**
 * `login` phone + PIN · `phone` → `code` → `pin` (→ `email` the first time a PIN is chosen): a new device, a new person, or a
 * forgotten PIN — the code to the phone is what proves it is theirs. The Business app's door, step for step.
 */
export type SignInStep = 'login' | 'phone' | 'code' | 'pin' | 'email';

export interface PartnerState {
  phase: 'boot' | 'signin' | 'choose' | 'ready';
  step: SignInStep;
  phone: string;
  /** The number was remembered from last time, so only the PIN is asked for. */
  phoneKnown: boolean;
  pin: string;
  code: string;
  /** A sandbox echoes the phone code; shown so a demo can be run. Never set anywhere else. */
  devCode: string;
  codeSentAt?: number;
  codeVia?: CodeWay;
  email: string;
  emailCode: string;
  agreement: Agreement | null;
  emailReset: boolean;
  busy: boolean;
  error: SbgError | null;
  memberships: Membership[] | null;
  partner: PartnerMe | null;
  /** What the partner owes, as last read; null until the first read. */
  owed: PartnerOwed | null;
  /** 2026-11-20 — its payouts to its hands, as last read (4c). */
  payouts: PartnerPayouts | null;
  /** 2026-11-21 — its money: paid in, paid out, waiting (4e). */
  money: PartnerMoney | null;
  /** 2026-11-24 — what SeeBuyGet's companies owe it, week by week (route plan part 4). */
  statements: PartnerStatements | null;
  /** The last read failed: the figures on screen are the ones before it, and it says so. */
  owedFailed: boolean;
  /** Whether the live view is open: the figures follow each step as it is done. */
  live: LiveState;
  section: Section;
}

const INITIAL: PartnerState = {
  phase: 'boot',
  step: 'login',
  phone: '',
  phoneKnown: false,
  pin: '',
  code: '',
  devCode: '',
  email: '',
  emailCode: '',
  agreement: null,
  emailReset: false,
  busy: false,
  error: null,
  memberships: null,
  partner: null,
  owed: null,
  payouts: null,
  money: null,
  statements: null,
  owedFailed: false,
  live: 'off',
  section: 'home',
};

export interface PartnerActions {
  set: (patch: Partial<Pick<PartnerState, 'phone' | 'pin' | 'code' | 'email' | 'emailCode' | 'agreement'>>) => void;
  setStep: (step: SignInStep) => void;
  forgetPhone: () => void;
  submitLogin: (unlock?: string) => Promise<void>;
  requestCode: (via?: CodeWay) => Promise<void>;
  truecallerConfirmed: () => void;
  submitCode: () => Promise<void>;
  submitPin: () => Promise<void>;
  loadMine: () => Promise<void>;
  open: (entityId: string) => Promise<void>;
  accept: (memberId: string) => Promise<void>;
  decline: (memberId: string) => Promise<void>;
  backToList: () => Promise<void>;
  go: (section: Section) => void;
  /** Read what the partner owes again. */
  refresh: () => Promise<void>;
  signOut: () => void;
  /** The session reading for the partner, for the account's own screens. Null before one is open. */
  partnerClient: () => PartnerClient | null;
}

export function usePartnerApp(): { state: PartnerState; actions: PartnerActions } {
  const [state, setState] = useState<PartnerState>(INITIAL);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Built once and REPLACED on sign-out: a seeded client keeps its token in memory as well as in storage.
  const person = useRef<PersonClient>(createPersonClient());
  const partner = useRef<PartnerClient>(createPartnerClient());
  const [partnerOpen, setPartnerOpen] = useState(false);

  const patch = (p: Partial<PartnerState>) => setState((s) => ({ ...s, ...p }));

  // Opened from another app of theirs: what it carried (shared/account/carry.ts), once taken.
  const carriedRef = useRef<Carried | null>(null);
  const fromCarried = (c: Carried): Partial<PartnerState> => {
    const entry = carriedEntry(c);
    return { phase: 'signin', step: entry.start === 'signin' ? 'login' : entry.start === 'choose' ? 'pin' : 'phone', phone: entry.phone, phoneKnown: entry.start === 'signin', ...(entry.email ? { email: entry.email } : {}), busy: false };
  };
  const toSignIn = () => {
    if (carriedRef.current) return patch(fromCarried(carriedRef.current));
    const remembered = readPhone();
    patch({ phase: 'signin', step: remembered ? 'login' : 'phone', phone: remembered ?? '', phoneKnown: Boolean(remembered), busy: false });
  };

  /** Read what the partner owes. A failed read keeps the figures already on screen, and says so. */
  const refresh = useCallback(async () => {
    const [r, paid, money, weeks] = await Promise.all([partner.current.owed(), partner.current.payouts(), partner.current.money(), partner.current.statements()]);
    if (r.error?.status === 401 || r.error?.status === 403) return void (await backToListRef.current());
    if (r.error || !r.data) return patch({ owedFailed: true });
    patch({ owed: r.data, owedFailed: false, ...(paid.data ? { payouts: paid.data } : {}), ...(money.data ? { money: money.data } : {}), ...(weeks.data ? { statements: weeks.data } : {}) });
  }, []);

  const enterPartner = useCallback(
    (me: PartnerMe) => {
      rememberLast(me.entityId);
      setPartnerOpen(true);
      setState((s) => ({ ...s, phase: 'ready', partner: me, busy: false, error: null, section: s.partner?.entityId === me.entityId ? s.section : 'home' }));
      void refresh();
    },
    [refresh],
  );

  const open = useCallback(
    async (entityId: string) => {
      patch({ busy: true, error: null });
      const r = await person.current.open(entityId);
      if (r.error || !r.data) return patch({ busy: false, error: r.error });
      await partner.current.client.seed({ access_token: r.data.token.access_token, expires_in: r.data.token.expires_in ?? 3600 });
      enterPartner(r.data.partner);
    },
    [enterPartner],
  );

  const loadMine = useCallback(async () => {
    const r = await person.current.mine();
    if (r.error || !r.data) {
      if (r.error?.status === 401) return toSignIn();
      return patch({ phase: 'choose', memberships: [], error: r.error, busy: false });
    }
    const items = r.data.items;
    const pick = openOnArrival(items, readLast());
    if (pick) return open(pick);
    patch({ phase: 'choose', memberships: items, busy: false });
  }, [open]);

  const backToList = useCallback(async () => {
    clearPartnerSession();
    rememberLast(null);
    partner.current = createPartnerClient();
    setPartnerOpen(false);
    patch({ partner: null, owed: null, payouts: null, money: null, statements: null, owedFailed: false, phase: 'boot', section: 'home' });
    await loadMine();
  }, [loadMine]);
  const backToListRef = useRef(backToList);
  backToListRef.current = backToList;

  /** A person's token came back: keep it, remember who signed in here, then find their partners. */
  const signedIn = useCallback(
    async (auth: PersonAuth) => {
      await person.current.client.seed({ access_token: auth.token.access_token, expires_in: auth.token.expires_in ?? 3600 });
      rememberPerson(auth.personId, stateRef.current.phone.trim());
      patch({ pin: '', code: '', devCode: '', emailCode: '', error: null });
      await loadMine();
    },
    [loadMine],
  );

  // Coming back: an open partner first, then the person's list, then the door.
  useEffect(() => {
    const carried = takeCarryFromAddress(partnerConfig());
    void carried?.then((r) => {
      if (!r.data) return;
      carriedRef.current = r.data;
      const c = r.data;
      setState((s) => (s.phase === 'signin' ? { ...s, ...fromCarried(c) } : s));
    });
    void (async () => {
      const me = await partner.current.me();
      if (!me.error && me.data) return enterPartner(me.data);
      const mine = await person.current.mine();
      if (!mine.error && mine.data) {
        const pick = openOnArrival(mine.data.items, readLast());
        if (pick) return open(pick);
        return patch({ phase: 'choose', memberships: mine.data.items });
      }
      toSignIn();
    })();
  }, []);

  // THE LIVE VIEW (the owner: "partner app with live view"): signed in for a partner, the app listens (shared/live.ts) and
  // reads what the partner owes again when a step is owed or taken back — at most once every LIVE_READ_GAP_MS.
  const reading = state.phase === 'ready' && partnerOpen;
  useEffect(() => {
    if (!reading) return;
    const config = partnerConfig();
    const reads = throttleReads(refresh, LIVE_READ_GAP_MS);
    const live = openLive({
      url: `${config.baseUrl.replace(/\/$/, '')}/v1/sbg/live`,
      clientId: config.clientId,
      token: () => partner.current.client.session.getToken(),
      onTopics: (topics) => {
        if (topics.includes('owed')) reads.tell();
      },
      onState: (live) => patch({ live }),
    });
    return () => {
      live.close();
      reads.stop();
      patch({ live: 'off' });
    };
  }, [reading, refresh]);

  const actions: PartnerActions = {
    set: (p) => patch({ ...p, error: null }),
    setStep: (step) => patch({ step, error: null, pin: '', code: '' }),
    forgetPhone: () => {
      forgetPerson();
      patch({ phone: '', phoneKnown: false, step: 'phone', pin: '', error: null });
    },

    submitLogin: async (unlock) => {
      const s = stateRef.current;
      patch({ busy: true, error: null });
      const r = await pinLogin(s.phone.trim(), unlock ?? s.pin);
      // A device that is new is not a wrong PIN: the PIN stays typed, for when the code has confirmed the device.
      if (r.error || !r.data) return patch({ busy: false, error: r.error, ...(isNewDevice(r.error) ? {} : { pin: '' }) });
      await signedIn(r.data);
    },

    requestCode: async (via?: CodeWay) => {
      const s = stateRef.current;
      patch({ busy: true, error: null });
      const r = await requestOtp(s.phone.trim(), via);
      if (r.error) return patch({ busy: false, error: r.error });
      if (via) rememberWay(via);
      patch({ busy: false, step: 'code', code: '', devCode: r.data?.code ?? '', codeSentAt: Date.now(), codeVia: via ?? 'sms' });
    },

    truecallerConfirmed: () => patch({ busy: false, error: null, step: 'pin', pin: '', code: '' }),

    submitCode: async () => {
      const s = stateRef.current;
      patch({ busy: true, error: null });
      const r = await verifyOtp(s.phone.trim(), s.code);
      if (r.error) return patch({ busy: false, error: r.error, code: '' });
      patch({ busy: false, step: 'pin', pin: '' });
    },

    /** Choose the PIN — the first time with a recovery email behind it, the same rule as every other door. */
    submitPin: async () => {
      const s = stateRef.current;
      patch({ busy: true, error: null });
      const withEmail = s.step === 'email' ? { email: s.email.trim(), code: s.emailCode } : undefined;
      const r = await enroll(s.phone.trim(), s.pin, withEmail, s.agreement);
      if (r.error || !r.data) {
        const field = (r.error?.params as { field?: string } | undefined)?.field;
        if (s.step === 'pin' && field === 'email') return patch({ busy: false, step: 'email', error: null, emailReset: isPinReset(r.error) });
        return patch({ busy: false, error: r.error });
      }
      offerPasskeyAfterCode(s.pin);
      await signedIn(r.data);
    },

    loadMine,
    open,

    accept: async (memberId) => {
      patch({ busy: true, error: null });
      const r = await person.current.accept(memberId);
      if (r.error || !r.data) return patch({ busy: false, error: r.error });
      await open(r.data.entityId);
    },

    decline: async (memberId) => {
      patch({ busy: true, error: null });
      const r = await person.current.decline(memberId);
      if (r.error) return patch({ busy: false, error: r.error });
      await loadMine();
    },

    backToList,
    go: (section) => patch({ section, error: null }),
    refresh,

    signOut: () => {
      clearSessions();
      signedOutHere();
      person.current = createPersonClient();
      partner.current = createPartnerClient();
      setPartnerOpen(false);
      const remembered = readPhone();
      setState({ ...INITIAL, phase: 'signin', step: remembered ? 'login' : 'phone', phone: remembered ?? '', phoneKnown: Boolean(remembered) });
    },

    partnerClient: () => (partnerOpen ? partner.current : null),
  };

  return { state, actions };
}
