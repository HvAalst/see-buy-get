import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { SbgError } from '../../lib/sbg';
import {
  clearBusinessSession,
  clearSessions,
  createBusinessClient,
  createPersonClient,
  enroll,
  forgetPerson,
  pinLogin,
  readLast,
  readPhone,
  rememberLast,
  rememberPerson,
  signedOutHere,
  requestOtp,
  verifyOtp,
  type BusinessClient,
  type BusinessView,
  type Membership,
  type NewBusiness,
  type PersonAuth,
  type PersonClient,
} from './api';
import { openOnArrival, sectionsFor, type Section } from './logic';

/**
 * `login` phone + PIN · `phone` → `code` → `pin` (→ `email` the first time a PIN is chosen): a new device, a new
 * person, or a forgotten PIN — the code to the phone is what proves it is theirs.
 */
export type SignInStep = 'login' | 'phone' | 'code' | 'pin' | 'email';

export interface BusinessState {
  phase: 'boot' | 'signin' | 'choose' | 'ready';
  step: SignInStep;
  phone: string;
  /** The number was remembered from last time, so only the PIN is asked for. */
  phoneKnown: boolean;
  pin: string;
  code: string;
  /** A sandbox echoes the phone code; shown so a demo can be run. Never set anywhere else. */
  devCode: string;
  email: string;
  emailCode: string;
  busy: boolean;
  error: SbgError | null;
  memberships: Membership[] | null;
  business: BusinessView | null;
  section: Section;
  /** One line of good news after an act — "Selam is invited". Cleared on the next move. */
  note: string | null;
}

const INITIAL: BusinessState = {
  phase: 'boot',
  step: 'login',
  phone: '',
  phoneKnown: false,
  pin: '',
  code: '',
  devCode: '',
  email: '',
  emailCode: '',
  busy: false,
  error: null,
  memberships: null,
  business: null,
  section: 'home',
  note: null,
};

export interface BusinessActions {
  set: (patch: Partial<Pick<BusinessState, 'phone' | 'pin' | 'code' | 'email' | 'emailCode'>>) => void;
  setStep: (step: SignInStep) => void;
  forgetPhone: () => void;
  submitLogin: () => Promise<void>;
  requestCode: () => Promise<void>;
  submitCode: () => Promise<void>;
  submitPin: () => Promise<void>;
  loadMine: () => Promise<void>;
  open: (entityId: string) => Promise<void>;
  accept: (memberId: string) => Promise<void>;
  decline: (memberId: string) => Promise<void>;
  create: (form: NewBusiness) => Promise<SbgError | null>;
  backToList: () => Promise<void>;
  go: (section: Section) => void;
  /** Read the business again — after anything that changes what it says about itself or where its check stands. */
  reloadBusiness: () => Promise<void>;
  /** Put a changed business in place without another read (the server answered with it). */
  setBusiness: (business: BusinessView) => void;
  say: (note: string | null) => void;
  signOut: () => void;
  /** The session acting as the business, for screens that make their own reads. Null before one is open. */
  businessClient: () => BusinessClient | null;
}

export function useBusinessApp(): { state: BusinessState; actions: BusinessActions } {
  const [state, setState] = useState<BusinessState>(INITIAL);
  const stateRef = useRef(state);
  stateRef.current = state;
  // Built once and REPLACED on sign-out: a seeded client keeps its token in memory as well as in storage.
  const person = useRef<PersonClient>(createPersonClient());
  const biz = useRef<BusinessClient>(createBusinessClient());
  const [businessOpen, setBusinessOpen] = useState(false);

  const patch = (p: Partial<BusinessState>) => setState((s) => ({ ...s, ...p }));

  const toSignIn = () => {
    const remembered = readPhone();
    patch({ phase: 'signin', step: remembered ? 'login' : 'phone', phone: remembered ?? '', phoneKnown: Boolean(remembered), busy: false });
  };

  const enterBusiness = useCallback((business: BusinessView) => {
    rememberLast(business.entityId);
    setBusinessOpen(true);
    setState((s) => ({
      ...s,
      phase: 'ready',
      business,
      busy: false,
      error: null,
      // Keep the section across a reload of the same business; a different business starts at the top.
      section: s.business?.entityId === business.entityId && sectionsFor(business.activities).includes(s.section) ? s.section : 'home',
    }));
  }, []);

  const open = useCallback(
    async (entityId: string) => {
      patch({ busy: true, error: null, note: null });
      const r = await person.current.open(entityId);
      if (r.error || !r.data) return patch({ busy: false, error: r.error });
      await biz.current.client.seed({ access_token: r.data.token.access_token, expires_in: r.data.token.expires_in ?? 3600 });
      enterBusiness(r.data.business);
    },
    [enterBusiness],
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

  /** A person's token came back: keep it, remember who signed in here, then find their businesses. */
  const signedIn = useCallback(
    async (auth: PersonAuth) => {
      await person.current.client.seed({ access_token: auth.token.access_token, expires_in: auth.token.expires_in ?? 3600 });
      rememberPerson(auth.personId, stateRef.current.phone.trim());
      patch({ pin: '', code: '', devCode: '', emailCode: '', error: null });
      await loadMine();
    },
    [loadMine],
  );

  // Coming back: an open business first, then the person's list, then the door.
  useEffect(() => {
    void (async () => {
      const me = await biz.current.me();
      if (!me.error && me.data) return enterBusiness(me.data);
      const mine = await person.current.mine();
      if (!mine.error && mine.data) {
        const pick = openOnArrival(mine.data.items, readLast());
        if (pick) return open(pick);
        return patch({ phase: 'choose', memberships: mine.data.items });
      }
      toSignIn();
    })();
  }, []);

  const actions: BusinessActions = {
    set: (p) => patch({ ...p, error: null }),
    setStep: (step) => patch({ step, error: null, pin: '', code: '' }),
    forgetPhone: () => {
      forgetPerson();
      patch({ phone: '', phoneKnown: false, step: 'phone', pin: '', error: null });
    },

    submitLogin: async () => {
      const s = stateRef.current;
      patch({ busy: true, error: null });
      const r = await pinLogin(s.phone.trim(), s.pin);
      if (r.error || !r.data) return patch({ busy: false, error: r.error, pin: '' });
      await signedIn(r.data);
    },

    requestCode: async () => {
      const s = stateRef.current;
      patch({ busy: true, error: null });
      const r = await requestOtp(s.phone.trim());
      if (r.error) return patch({ busy: false, error: r.error });
      patch({ busy: false, step: 'code', code: '', devCode: r.data?.code ?? '' });
    },

    submitCode: async () => {
      const s = stateRef.current;
      patch({ busy: true, error: null });
      const r = await verifyOtp(s.phone.trim(), s.code);
      if (r.error) return patch({ busy: false, error: r.error, code: '' });
      patch({ busy: false, step: 'pin', pin: '' });
    },

    /**
     * Choose the PIN. The first time, the server says a recovery email has to stand behind it — the same rule as every
     * other door — and the email step asks for one, then this sends all three together.
     */
    submitPin: async () => {
      const s = stateRef.current;
      patch({ busy: true, error: null });
      const withEmail = s.step === 'email' ? { email: s.email.trim(), code: s.emailCode } : undefined;
      const r = await enroll(s.phone.trim(), s.pin, withEmail);
      if (r.error || !r.data) {
        const field = (r.error?.params as { field?: string } | undefined)?.field;
        if (s.step === 'pin' && field === 'email') return patch({ busy: false, step: 'email', error: null });
        return patch({ busy: false, error: r.error });
      }
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

    create: async (form) => {
      patch({ busy: true, error: null });
      const r = await person.current.create(form);
      if (r.error || !r.data) {
        patch({ busy: false });
        return r.error;
      }
      await biz.current.client.seed({ access_token: r.data.token.access_token, expires_in: r.data.token.expires_in ?? 3600 });
      enterBusiness(r.data.business);
      return null;
    },

    backToList: async () => {
      clearBusinessSession();
      rememberLast(null);
      biz.current = createBusinessClient();
      setBusinessOpen(false);
      patch({ business: null, phase: 'boot', note: null, section: 'home' });
      await loadMine();
    },

    go: (section) => patch({ section, note: null, error: null }),

    reloadBusiness: async () => {
      const r = await biz.current.me();
      if (r.error?.status === 401 || r.error?.status === 403) {
        // Taken out of the business, or the session ended: back to the list, which says what is left.
        await actions.backToList();
        return;
      }
      if (r.data) enterBusiness(r.data);
    },

    setBusiness: (business) => setState((s) => ({ ...s, business })),
    say: (note) => patch({ note }),

    signOut: () => {
      clearSessions();
      signedOutHere();
      person.current = createPersonClient();
      biz.current = createBusinessClient();
      setBusinessOpen(false);
      const remembered = readPhone();
      setState({ ...INITIAL, phase: 'signin', step: remembered ? 'login' : 'phone', phone: remembered ?? '', phoneKnown: Boolean(remembered) });
    },

    businessClient: () => (businessOpen ? biz.current : null),
  };

  return { state, actions };
}
