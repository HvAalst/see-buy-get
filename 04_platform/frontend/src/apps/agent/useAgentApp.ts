import type { InstructionsView } from '../../shared/instructions';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  isMintSourced,
  isSignInRequired,
  narrow,
  sbgConfirmDevice,
  sbgForgot,
  sbgLogin,
  sbgReset,
  type SbgError,
} from '../../lib/sbg';
import type { MediaKind } from '../../lib/sbg/personas/media';
import { downscaleImage } from '../../shared/media';
import { holdPhoto, mayHold } from '../../shared/heldPhotos';
import { onOutboxSent } from '../../shared/outbox';
import type { TamperUnit, UnitHold } from '../../shared/tamper';
import type { BagClosedWith } from '../../shared/bagSeal';
import { t } from '../../shared/i18n'; // plain t(): toasts/notes are built at action time in the shop's active locale
import { errorSentence, refusalSentence } from '../../shared/ui';
import type { RefusalBody } from '../../shared/RefusalCard';
import type { IconName } from '../../shared/ui/Icon';
import { agentConfig, clearDid, createAgentClient, purgeAgentTokens, readDid, readEmail, saveDid, saveEmail } from './api';
import { signal } from '../../shared/feedback';
import { downloadZpl, triggerDownload } from '../../shared/download';
import { topUpTermsOf, type TopUpTerms } from '../../shared/topup-fee';
import type { CustodyCapView } from '../../shared/custodyCap';
import { bodyHintValue, bookFreightMissing, busScan, EMPTY_ACCEPT, type BusList, excludedBodiesValue, handoverRoute, incotermValue, money, otpValid, packagingValue, parseBudget, parseDims, plannedPickupIso, putAwayList, termsBlock, type AcceptForm, type DimsForm } from './logic';
import type { GeoPoint } from '../../shared/geo';
import { peopleApi } from './people';
import { clearStaff, ownerOnlyScreen, readStaff, saveStaff, type StaffAtCounter, type StaffSession } from './staff';
import { setOutboxActor } from '../../shared/outbox';
import { deviceAskOf, saveShopDeviceKey, shopDeviceKey, shopDevicesApi, type DeviceAsk } from '../../shared/account/shopDevice';
import type {
  AgentLedgerRow,
  AgentParcelRow,
  AgentView,
  BagGroup,
  OpenBag,
  BagStaging,
  ClassifyView,
  ConsignmentView,
  CollectView,
  FundingView,
  GateView,
  GeocodeView,
  HandoverView,
  IntakePreview,
  TakeInTerms,
  LedgerSummary,
  NetworkPoint,
  ParcelView,
  RatesView,
  ReceiveBagView,
  ReputationProfileView,
  ShelfGrid,
  OfferQuote,
  MyBookingRow,
  OfferRow,
} from './types';

export type Screen = 'home' | 'accept' | 'handover' | 'bag' | 'release' | 'collect' | 'receivebag' | 'rates' | 'void' | 'records' | 'consignments' | 'shelf' | 'freight' | 'tamper';

/** FB2b — one of the shop's posted loads, plus the prices waiting on it. */
export interface PostedFreight {
  freightId: string;
  code: string;
  description: string;
  destLabel: string;
  weightKg: number;
  status: string;
  commitMode: 'instant' | 'negotiate';
  /** The money the budget, the prices offered and the one agreed are in: the shop’s company’s, stamped when it was posted. */
  currency?: string;
  maxSpend?: number;
  scheduledPickupAt?: string;
  createdAt: string;
  openProposals: number;
  agreedPrice?: number;
  /** FP3 — the journey's stamps and the proof of delivery, so the list can say what became of the load. */
  pickedUpAt?: string;
  deliveredAt?: string;
  receiverName?: string;
  /** D9 — what the receiver found not as the note says, at the handover. */
  exceptions?: import('../../shared/found').FoundLine[];
  cancelledAt?: string;
  /** True while the shop may still withdraw it: before the goods are on a truck. */
  canCancel: boolean;
  /** FP3b — the doors the driver stood at and could not hand over at. */
  attempts?: Array<{ outcome: 'absent' | 'refused' | 'unreachable'; note?: string; at: string }>;
  /** Refused at the door (the user, 2026-10-27): by when the shop says where the goods go, and what it said. */
  refusal?: import('../../shared/refusal').Refusal;
  canDecideRefusal?: boolean;
  /** Where it was picked up — where "back" takes refused goods. */
  pickupLabel?: string;
  /** A return: the load its goods were refused on. */
  returnOf?: { freightId: string; code: string };
  /** FP3b — the shop's claim, as far as it has got. */
  claim?: FreightClaim;
  /** True while a claim may still be made: delivered, none yet, within the window. */
  canClaim: boolean;
  /** FP6 — the link to hand on (the same one the consignment note carries as a QR), who is carrying it, and the verdict. */
  trackingKey?: string;
  trackingUrl?: string;
  carrier?: { driverName?: string; plate?: string; vehicleClass?: string };
  rating?: { stars: number; issues: string[]; at: string };
  canRate: boolean;
  /** FP8 — the times a driver handed this load back before pickup, oldest first. Reason and time only. */
  handBacks?: Array<{ reason: string; at: string }>;
  /** CL1 — the agreed term, the place it names, and who a loss in transit belongs to. */
  incoterm?: string;
  namedPlace?: string;
  claimant?: 'sender' | 'receiver';
  /** FP7 — box 13, and whether it is still the sender's to rewrite (before pickup), only to add to (on the road), or closed. */
  instructions?: InstructionsView;
  instructionsMode: 'edit' | 'amend' | 'none';
}

export interface FreightClaim {
  state: 'open' | 'resolved';
  kind: 'damaged' | 'short' | 'not_received';
  description: string;
  photoRef?: string;
  raisedAt: string;
  decision?: 'upheld' | 'partly_upheld' | 'rejected' | 'report_only';
  award?: number;
  note?: string;
  decidedAt?: string;
  paidTo?: { kind: 'vendor' | 'between_parties'; id?: string };
}

export interface FreightPrice {
  proposalId: string;
  freightId: string;
  driverDid: string;
  price: number;
  note?: string;
  deadheadKm: number;
  loadedKm: number;
  status: 'open' | 'accepted' | 'declined' | 'withdrawn' | 'superseded';
  createdAt: string;
}
export type Phase = 'boot' | 'signin' | 'ready' | 'outdated';

/* --- R4 registers: the shop's parcel history + earnings, server-side searched / filtered / paged --- */

export interface HistQuery {
  q: string;
  status: string;
  role: '' | 'origin' | 'dest';
  from: string;
  to: string;
  sort: 'newest' | 'oldest';
  offset: number;
}
export const HIST_LIMIT = 20;
export const INITIAL_HIST_QUERY: HistQuery = { q: '', status: '', role: '', from: '', to: '', sort: 'newest', offset: 0 };
export function histApiQuery(q: HistQuery) {
  return { q: q.q || undefined, status: q.status || undefined, role: q.role || undefined, from: q.from || undefined, to: q.to || undefined, sort: q.sort, limit: String(HIST_LIMIT), offset: String(q.offset) };
}

export interface EarnQuery {
  q: string;
  type: '' | 'TOP_UP' | 'FEE' | 'LABOR_PAYOUT' | 'REFUND';
  direction: '' | 'in' | 'out';
  from: string;
  to: string;
  sort: 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';
  offset: number;
}
export const EARN_LIMIT = 20;
export const INITIAL_EARN_QUERY: EarnQuery = { q: '', type: '', direction: '', from: '', to: '', sort: 'newest', offset: 0 };
export function earnApiQuery(q: EarnQuery) {
  return { q: q.q || undefined, type: q.type || undefined, direction: q.direction || undefined, from: q.from || undefined, to: q.to || undefined, sort: q.sort, limit: String(EARN_LIMIT), offset: String(q.offset) };
}

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
  /** A top-up asked for and not yet confirmed by the payment provider. Null when nothing is pending —
   *  which is the ordinary state, because a confirmed payment stops being a waiting one. */
  funding: FundingView | null;
  /** What this sister charges to put money in, so the sheet can say it BEFORE the shop commits to an
   *  amount. Null where nobody decided a fee, which is the default and shows no sentence at all. */
  topUpTerms: TopUpTerms | null;
  /** Round 38 — where this shop stands under its company's custody cap. Null until read; `capped` false when none applies. */
  custodyCap: CustodyCapView | null;
  /** Parcels waiting at this shop for the bus (loaded when the handover screen opens). */
  shopParcels: ParcelView[];
  shopParcelsState: 'idle' | 'loading' | 'ready' | 'error';
  /** What to bag, from the server: waiting parcels grouped by NEXT HOP (several bags open at once is the
   *  normal case — direct-to-Addis alongside one for the local hub), plus the bags already open here. */
  bagPlan: { groups: BagGroup[]; bags: OpenBag[]; staging?: BagStaging };
  bagPlanState: 'idle' | 'loading' | 'ready' | 'error';
  /** FB2b — the loads this shop posted, and the prices waiting on the one being looked at. */
  posted: PostedFreight[];
  postedState: 'idle' | 'loading' | 'ready' | 'error';
  /** F3 — runs with space on them, soonest first. Loaded on demand, like the posted loads. */
  offers: OfferRow[];
  offersState: 'idle' | 'loading' | 'ready' | 'error';
  /** F3 — what this shop has booked, which until now it could not read back at all. */
  myBookings: MyBookingRow[];
  myBookingsState: 'idle' | 'loading' | 'ready' | 'error';
  /** The run being taken, and what it would cost — quoted BEFORE anything is committed. */
  offerFor: OfferRow | null;
  offerQuote: OfferQuote | null;
  offerQuoteError: SbgError | null;
  /** Which posted load's prices are open. Null = the list. */
  pricesFor: string | null;
  prices: FreightPrice[];
  pricesState: 'idle' | 'loading' | 'ready' | 'error';
  /** The bag being packed right now. `missed` is the server's verdict at the last seal attempt —
   *  parcels for that destination still on the shelf. `scan` + `lastAdded` are the scanning loop: what is
   *  in the field, and what went in last (spoken back, so the counter never has to hunt the list). */
  bag: { code: string; destKey: string; label: string; parcels: string[]; missed: string[]; sealed: boolean; scan: string; lastAdded: string | null; fillPct: number } | null;
  rates: RatesView | null;
  ratesState: 'idle' | 'loading' | 'ready' | 'error';
  /** F3 — the shop's consolidation lots (loaded when the Consignments screen opens). */
  consignments: ConsignmentView[];
  consignmentsState: 'idle' | 'loading' | 'ready' | 'error';
  /** The pickup-shelf grid + free-slot count (loaded on the Shelf screen AND the Home occupancy strip). */
  shelf: ShelfGrid | null;
  shelfState: 'idle' | 'loading' | 'ready' | 'error';
  /** A shelf-load failure, kept SEPARATE from the screen-level error so a secondary occupancy fetch on Home
   *  never raises the cockpit's error banner. */
  shelfError: SbgError | null;
  /** R4 — the shop's parcel-history register (a filtered/paged page). */
  parcelHist: AgentParcelRow[];
  parcelHistTotal: number;
  parcelHistState: 'idle' | 'loading' | 'ready' | 'error';
  parcelHistQuery: HistQuery;
  /** R4 — the shop's earnings register (a filtered/paged page + the current view's totals). */
  ledger: AgentLedgerRow[];
  ledgerTotal: number;
  ledgerState: 'idle' | 'loading' | 'ready' | 'error';
  ledgerQuery: EarnQuery;
  ledgerSummary: LedgerSummary | null;
  error: SbgError | null;
  toasts: Toast[];
  busy: string | null;
  refreshing: boolean;
  stale: boolean;

  accept: AcceptForm;
  /** The destination-PUDO directory for the walk-up picker (Map/Address). */
  acceptPoints: NetworkPoint[];
  acceptPointsState: 'idle' | 'loading' | 'ready' | 'error';
  /** The derived tier + cargo class for the measured dims (null until all four are entered). */
  acceptDerived: ClassifyView | null;
  /** The geocoded point for the Address mode's nearest-first sort (+ a plain note on the match/quality). */
  acceptNear: GeoPoint | null;
  acceptGeoBusy: boolean;
  acceptGeoNote: string | null;
  /** DT — the label the last accept produced, shown to print + stick on the parcel (null once dismissed).
   *  `releaseCode` is the pickup code, handed to the SENDER at the counter: it is not on the parcel and the
   *  collecting shop never learns it, so this sheet is where it reaches a human. */
  acceptedLabel: (TakenIn & { queued?: boolean }) | null;
  /** Take-ins made without a signal that have since reached SeeBuyGet: their label and code, shown once each, in order. */
  lateTakeIns: Array<TakenIn & { senderMobile?: string; queuedAt: string }>;
  /** A sign-in from a phone the shop has not confirmed: where the code went (and, in a sandbox, the code). */
  deviceAsk: (DeviceAsk & { email: string }) | null;
  /**
   * WHO IS AT THE COUNTER, when it is one of the shop's people and not the shop's own sign-in (staff.ts). The owner's
   * rows — money, prices, hours, people, the shop's papers and account — are left out of the screens for them.
   */
  staff: StaffAtCounter | null;
  /** F2 — the freight the last counter booking produced: the FRT code + tracking key to print for the
   *  customer, plus the site-equipment advisory. Null until a booking succeeds / once dismissed. */
  bookedFreight: {
    code: string;
    trackingKey?: string;
    status: string;
    scheduledPickupAt?: string;
    destLabel: string;
    cargoClass: string;
    equipmentGaps?: Array<'origin' | 'dest'>;
    maxSpend?: number;
    /** The money the cap is in: the shop’s company’s. */
    currency?: string;
    /** FB2c — what the system concluded the load needs, and how strong that claim is. Shown back on the
     *  receipt so the derivation is visible to the person who supplied the facts it ran on. */
    bodyDerived?: { body: string; basis: 'measured' | 'weight-only' };
    /** FB2d — read back from the SERVER's copy of the load, not the form: what the customer's refusal
     *  actually became is the only version that will refuse a driver. */
    excludedBodies?: string[];
  } | null;
  /** PG4 — the scanned sticker resolved to an EXISTING parcel (a pre-minted send, a store order, or an
   *  in-use sticker); null/idle = a fresh sticker → the walk-up form. */
  preMint: IntakePreview | null;
  preMintState: 'idle' | 'loading' | 'ready' | 'error';
  preMintError: SbgError | null;
  /** Bumped to re-fire the preview for an unchanged code (a retry after a transient failure). */
  previewNonce: number;
  intakePhotoRef: string;
  /** The last completed intake — drives the "taken in, cash collected" sheet. */
  intakeDone: { parcelId: string; kind: IntakePreview['kind']; cashDue: number; currency?: string; destShopName?: string } | null;
  /** P3 — whose promise a walk-up taken in here is under. Re-asked every time the take-in screen opens,
   *  because a country can move down the ladder while the shop stands open. */
  takeInTerms: TakeInTerms | null;
  takeInTermsState: 'idle' | 'loading' | 'ready' | 'error';
  /** The shopkeeper ticked that the customer was TOLD the carrier answers (the carrier's promise only). */
  termsTold: boolean;
  /** `missed` is the last server verdict of parcels for this bus still waiting (the S25 gate). */
  /**
   * The bus at the counter: the driver's pass, then the bus's list from the server, and the parcels scanned onto it
   * (`selected`, in the order they were scanned). `missed` is the server's answer when some on the list were not.
   */
  handover: { badge: string; selected: string[]; missed: string[]; list: BusList | null; listState: 'idle' | 'loading' | 'ready'; scan: string; lastScanned: string | null };
  release: { stickerId: string; parcel: ParcelView | null; otp: string; stars: number; photoRef: string };
  collect: { code: string; found: CollectView | null; disputing: boolean; reason: string; photoRef: string };
  /** `putAway`: a bag was just received, and these are the slots its parcels go in — shown until the shop says they are in. */
  receivebag: { code: string; putAway?: Array<{ slot: string; parcelIds: string[] }>; driverDid?: string; bag?: { closedWith?: BagClosedWith; held?: UnitHold } | null; mismatch?: string };
  /** The reverse-logistics window: which recent drop-off is being undone, + its torn-label photo. */
  void: { parcelId: string | null; photoRef: string };
  /** Round 35 — a parcel found cut or opened: which, its photograph, what is seen; the hold as the server answered. */
  tamper: { parcelId: string; photoRef: string; note: string; done: TamperUnit | null };
  /** REP2 — the "rate the driver" prompt, opened after a handover/bag-receipt. `profile` fills in once fetched. */
  driverRating: { driverDid: string; profile: ReputationProfileView | null } | null;
}

const EMPTY_HANDOVER = { badge: '', selected: [] as string[], missed: [] as string[], list: null as BusList | null, listState: 'idle' as 'idle' | 'loading' | 'ready', scan: '', lastScanned: null as string | null };
const EMPTY_RELEASE = { stickerId: '', parcel: null, otp: '', stars: 0, photoRef: '' };
const EMPTY_COLLECT = { code: '', found: null, disputing: false, reason: '', photoRef: '' };

const INITIAL: AgentState = {
  phase: 'boot',
  screen: 'home',
  agent: null,
  gate: null,
  funding: null,
  topUpTerms: null,
  custodyCap: null,
  shopParcels: [],
  shopParcelsState: 'idle',
  bagPlan: { groups: [], bags: [] },
  bagPlanState: 'idle',
  posted: [],
  postedState: 'idle',
  offers: [],
  offersState: 'idle',
  myBookings: [],
  myBookingsState: 'idle',
  offerFor: null,
  offerQuote: null,
  offerQuoteError: null,
  pricesFor: null,
  prices: [],
  pricesState: 'idle',
  bag: null,
  rates: null,
  ratesState: 'idle',
  consignments: [],
  consignmentsState: 'idle',
  shelf: null,
  shelfState: 'idle',
  shelfError: null,
  parcelHist: [],
  parcelHistTotal: 0,
  parcelHistState: 'idle',
  parcelHistQuery: INITIAL_HIST_QUERY,
  ledger: [],
  ledgerTotal: 0,
  ledgerState: 'idle',
  ledgerQuery: INITIAL_EARN_QUERY,
  ledgerSummary: null,
  error: null,
  toasts: [],
  busy: null,
  refreshing: false,
  stale: false,
  accept: { ...EMPTY_ACCEPT },
  acceptPoints: [],
  acceptPointsState: 'idle',
  acceptDerived: null,
  acceptNear: null,
  acceptGeoBusy: false,
  acceptGeoNote: null,
  acceptedLabel: null,
  lateTakeIns: [],
  deviceAsk: null,
  staff: null,
  bookedFreight: null,
  preMint: null,
  preMintState: 'idle',
  preMintError: null,
  previewNonce: 0,
  intakePhotoRef: '',
  intakeDone: null,
  takeInTerms: null,
  takeInTermsState: 'idle',
  termsTold: false,
  handover: { ...EMPTY_HANDOVER },
  release: { ...EMPTY_RELEASE },
  collect: { ...EMPTY_COLLECT },
  receivebag: { code: '' },
  void: { parcelId: null, photoRef: '' },
  tamper: { parcelId: '', photoRef: '', note: '', done: null },
  driverRating: null,
};

/** What a take-in hands the counter: the label to stick on, the tracking key, and the release code for the sender. */
export interface TakenIn {
  parcelId: string;
  trackingKey?: string;
  svg?: string;
  releaseCode?: string;
}

const isOffline = (e: SbgError) => e.code === 'NETWORK' || e.code === 'OFFLINE' || e.code === 'TIMEOUT';

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

      /*
       * A TOP-UP THE SHOP IS STILL WAITING ON.
       *
       * Read on every refresh rather than only when the sheet is opened: a payment that has not been
       * confirmed yet is the answer to "why is my balance still low", and the shopkeeper is most likely
       * to ask that question on the home screen rather than inside the Top up sheet. A failure to read it
       * is not a failure of the screen — the float and the gate above are what the day runs on — so it
       * falls back to nothing rather than taking the cockpit down with it.
       */
      // The shop's money is the owner's: a member of staff at the counter does not read it (and would be refused).
      const fundingR = readStaff(did) ? null : await client.api.funding(did);
      if (superseded()) return;
      const fundingState = !fundingR || fundingR.error ? null : narrow<{ open: FundingView | null; terms?: unknown }>(fundingR.data);
      const funding = fundingState?.open ?? null;
      // The TERMS ride along with it: what a top-up costs has to be on the sheet before an amount is
      // committed to, not in the register afterwards. Kept from the last good read on a failure, because
      // a fee that flickers out of existence when one request fails is the worst of both answers.
      const topUpTerms = !fundingR || fundingR.error ? undefined : topUpTermsOf(fundingState?.terms);
      // Round 38 — the custody cap: a soft read, kept from the last good one on a failure, like the top-up terms.
      const capR = await client.api.custodyCap();
      if (superseded()) return;
      const custodyCap = capR.error ? undefined : narrow<CustodyCapView>(capR.data) ?? null;

      setState((s) => ({
        ...s,
        phase: 'ready',
        agent,
        gate,
        funding,
        topUpTerms: topUpTerms === undefined ? s.topUpTerms : topUpTerms,
        custodyCap: custodyCap === undefined ? s.custodyCap : custodyCap,
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
    if (stored) {
      setDid(stored);
      setState((s) => ({ ...s, staff: readStaff(stored) }));
    } else setState((s) => ({ ...s, phase: 'signin' }));
  }, []);

  // WHO IS SIGNED IN ON THIS PHONE, for the outbox: an act made here without a signal goes under the sign-in that made
  // it — the shop's own, or one of its people's — never under whoever is signed in when the signal comes back.
  const staffKey = state.staff?.memberId;
  const staffName = state.staff?.name;
  useEffect(() => {
    setOutboxActor(did ? (staffKey ? { key: `staff:${did}:${staffKey}`, name: staffName ?? '' } : { key: `shop:${did}`, name: t('agent.outbox.owner') }) : null);
  }, [did, staffKey, staffName]);

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
      // A shop's sign-in works only on its own phones: this one's key goes with it, when it has one.
      const r = await sbgLogin(agentConfig(), mail, password, undefined, shopDeviceKey(mail));
      if (r.error) {
        // The password was right and this phone is new to the shop: a code went to the shop's number.
        const ask = deviceAskOf(r.error);
        if (ask) return setState((s) => ({ ...s, busy: null, error: null, deviceAsk: { ...ask, email: mail } }));
        setState((s) => ({ ...s, busy: null, error: r.error }));
        return;
      }
      await enter(r.data!, mail);
    },
    [],
  );

  /** The code from the shop's number, typed on this phone: it is one of the shop's from now, and signed in. */
  const confirmDevice = useCallback(async (code: string) => {
    const ask = stateRef.current.deviceAsk;
    if (!ask) return;
    setState((s) => ({ ...s, busy: 'signin', error: null }));
    const r = await sbgConfirmDevice(agentConfig(), ask.challenge, code.trim());
    if (r.error || !r.data) {
      setState((s) => ({ ...s, busy: null, error: r.error ?? null }));
      return;
    }
    saveShopDeviceKey(ask.email, r.data.device);
    await enter(r.data, ask.email);
  }, []);

  /** Back to the email and password: another shop, or another try. */
  const cancelDeviceAsk = useCallback(() => setState((s) => ({ ...s, deviceAsk: null, error: null })), []);

  /** Signed in: the shop's role checked, everything of another shop's purged, this one's token seeded. */
  const enter = useCallback(
    async (login: { role: string; did: string; token: { access_token: string; expires_in?: number } }, mail: string) => {
      if (login.role !== 'pudo') {
        setState((s) => ({
          ...s,
          busy: null,
          error: {
            code: 'FORBIDDEN',
            status: 403,
            title: t('agent.toast.notShopTitle'),
            detail: t('agent.toast.notShopDetail', { role: login.role }),
            retryable: false,
          },
        }));
        return;
      }
      // A fresh sign-in may be a different shop on a shared tablet: purge everything,
      // seed the new token under the new DID, then boot.
      purgeAgentTokens(null);
      clearStaff();
      saveDid(login.did);
      saveEmail(mail);
      const next = createAgentClient(login.did);
      await next.client.seed({ access_token: login.token.access_token, expires_in: login.token.expires_in ?? 3600 });
      setState((s) => ({ ...INITIAL, phase: 'boot', toasts: s.toasts }));
      setDid(login.did);
    },
    [],
  );

  /**
   * ONE OF THE SHOP'S PEOPLE, signed in as themselves and now at this counter (staff.ts): their session acts as the shop
   * under their name. Everything of the last sign-in on this phone is dropped first, the shop's own included.
   */
  const enterAsStaff = useCallback(async (session: StaffSession) => {
    purgeAgentTokens(null);
    saveDid(session.shopDid);
    const who = { shopDid: session.shopDid, shopName: session.shopName, name: session.name, memberId: session.memberId };
    saveStaff(who);
    const next = createAgentClient(session.shopDid);
    await next.client.seed({ access_token: session.token.access_token, expires_in: session.token.expires_in ?? 3600 });
    setState((s) => ({ ...INITIAL, phase: 'boot', staff: who, toasts: s.toasts }));
    setDid(session.shopDid);
  }, []);

  /** The shop's own phones, in Settings: read and forgotten by the shop, with its password. */
  const shopDevices = useMemo(
    () => (client ? shopDevicesApi((path, body) => client.client.sbg.request((raw) => raw.POST(path as never, { body } as never) as never), readEmail) : undefined),
    [client],
  );

  /** The people at the counter, for the owner: added by number, taken out at once, and who did what. */
  const people = useMemo(
    () =>
      client
        ? peopleApi(
            (path) => client.client.sbg.request((raw) => raw.GET(path as never, {} as never) as never),
            (path, body) => client.client.sbg.request((raw) => raw.POST(path as never, { body } as never) as never),
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
    purgeAgentTokens(null);
    clearStaff();
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

  /**
   * S26: prepare + upload a captured photo, returning its mediaId (or null on failure, with a toast).
   * The downscale/EXIF-strip happens on-device; the contract field then holds this mediaId, not a filename.
   */
  const uploadPhoto = useCallback(
    async (kind: MediaKind, file: File): Promise<string | null> => {
      if (!client) return null;
      try {
        const { dataUrl, thumbDataUrl } = await downscaleImage(file);
        const r = await client.api.uploadMedia(kind, dataUrl, thumbDataUrl);
        if (r.error) {
          // No signal, and a take-in photo: it waits on this phone and goes with the take-in (shared/heldPhotos.ts).
          const held = isOffline(r.error) && mayHold(kind) ? holdPhoto(kind, dataUrl, thumbDataUrl) : null;
          if (held) {
            pushToast({ tone: 'info', icon: 'camera', title: t('agent.toast.photoHeld'), detail: t('agent.toast.photoHeldDetail') });
            return held;
          }
          pushToast({ tone: 'danger', icon: 'camera', title: t('agent.toast.photoUploadFail'), detail: errorSentence(r.error) });
          return null;
        }
        return narrow<{ mediaId: string }>(r.data)?.mediaId ?? null;
      } catch {
        pushToast({ tone: 'danger', icon: 'camera', title: t('agent.toast.photoReadFail'), detail: t('agent.toast.photoReadFailDetail') });
        return null;
      }
    },
    [client, pushToast],
  );

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

  /** What this shop should be bagging — groups by next hop, plus the bags already open on the floor. */
  const loadBagPlan = useCallback(async () => {
    if (!client || !did) return;
    setState((s) => ({ ...s, bagPlanState: 'loading' }));
    const r = await client.api.bagPlan(did);
    if (r.error) {
      setState((s) => ({ ...s, bagPlanState: 'error' }));
      return fail(r.error);
    }
    const plan = narrow<{ groups: BagGroup[]; bags: OpenBag[]; staging?: BagStaging }>(r.data) ?? { groups: [], bags: [] };
    setState((s) => ({ ...s, bagPlan: plan, bagPlanState: 'ready' }));
  }, [client, did, fail]);

  /** The destination directory for the walk-up picker (Map/Address). Loaded when the accept screen opens. */
  const loadAcceptPoints = useCallback(async () => {
    if (!client) return;
    if (stateRef.current.acceptPointsState === 'loading' || stateRef.current.acceptPointsState === 'ready') return;
    setState((s) => ({ ...s, acceptPointsState: 'loading' }));
    const r = await client.api.networkPoints();
    if (r.error) {
      setState((s) => ({ ...s, acceptPointsState: 'error' }));
      return;
    }
    setState((s) => ({ ...s, acceptPoints: narrow<NetworkPoint[]>(r.data) ?? [], acceptPointsState: 'ready' }));
  }, [client]);

  /**
   * P3 — whose promise, who answers, the cover. Never cached across visits: the answer is a fact about the
   * country RIGHT NOW, and a stale "ours" is exactly the promise nobody stands behind.
   */
  const loadTakeInTerms = useCallback(async () => {
    if (!client || !did) return;
    if (stateRef.current.takeInTermsState === 'loading') return;
    setState((s) => ({ ...s, takeInTermsState: 'loading', termsTold: false }));
    const r = await client.api.takeInTerms(did);
    if (r.error) {
      setState((s) => ({ ...s, takeInTerms: null, takeInTermsState: 'error' }));
      return;
    }
    setState((s) => ({ ...s, takeInTerms: narrow<TakeInTerms>(r.data), takeInTermsState: 'ready' }));
  }, [client, did]);

  const setTermsTold = useCallback((told: boolean) => setState((s) => ({ ...s, termsTold: told })), []);
  const retryTerms = useCallback(() => void loadTakeInTerms(), [loadTakeInTerms]);

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

  /** F3 — the shop's consolidation lots. Loaded when the Consignments screen opens. */
  const loadConsignments = useCallback(async () => {
    if (!client || !did) return;
    setState((s) => ({ ...s, consignmentsState: 'loading' }));
    const r = await client.api.consignments(did);
    if (r.error) {
      setState((s) => ({ ...s, consignmentsState: 'error' }));
      fail(r.error);
      return;
    }
    setState((s) => ({ ...s, consignments: narrow<ConsignmentView[]>(r.data) ?? [], consignmentsState: 'ready' }));
  }, [client, did, fail]);

  /* ----------------------------------------------------- registers (R4) */

  const histEpoch = useRef(0);
  const fetchHistoryWith = useCallback(
    async (query: HistQuery) => {
      if (!client || !did) return;
      const epoch = ++histEpoch.current;
      setState((s) => (s.parcelHistState === 'ready' ? s : { ...s, parcelHistState: 'loading' }));
      const r = await client.api.parcels(did, histApiQuery(query));
      if (epoch !== histEpoch.current) return;
      if (r.error) {
        setState((s) => ({ ...s, parcelHistState: 'error' }));
        fail(r.error);
        return;
      }
      const page = narrow<{ items?: AgentParcelRow[]; total?: number }>(r.data);
      const items = page.items ?? [];
      const total = page.total ?? 0;
      if (items.length === 0 && total > 0 && query.offset >= total) {
        const lastOffset = Math.max(0, (Math.ceil(total / HIST_LIMIT) - 1) * HIST_LIMIT);
        setState((s) => (s.parcelHistQuery.offset === query.offset ? { ...s, parcelHistQuery: { ...s.parcelHistQuery, offset: lastOffset } } : s));
        void fetchHistoryWith({ ...query, offset: lastOffset });
        return;
      }
      setState((s) => ({ ...s, parcelHist: items, parcelHistTotal: total, parcelHistState: 'ready' }));
    },
    [client, did, fail],
  );
  const queryHistory = useCallback(
    (patch: Partial<HistQuery>) => {
      const offsetOnly = Object.keys(patch).length === 1 && 'offset' in patch;
      const next: HistQuery = { ...stateRef.current.parcelHistQuery, ...patch, offset: offsetOnly ? (patch.offset ?? 0) : 0 };
      setState((s) => ({ ...s, parcelHistQuery: next, parcelHistState: 'loading' }));
      void fetchHistoryWith(next);
    },
    [fetchHistoryWith],
  );
  const loadHistory = useCallback(() => {
    void fetchHistoryWith(stateRef.current.parcelHistQuery);
  }, [fetchHistoryWith]);

  const ledgerEpoch = useRef(0);
  const fetchLedgerWith = useCallback(
    async (query: EarnQuery) => {
      if (!client || !did) return;
      const epoch = ++ledgerEpoch.current;
      setState((s) => (s.ledgerState === 'ready' ? s : { ...s, ledgerState: 'loading' }));
      const [pageR, sumR] = await Promise.all([client.api.ledger(did, earnApiQuery(query)), client.api.ledgerSummary(did, earnApiQuery(query))]);
      if (epoch !== ledgerEpoch.current) return;
      if (pageR.error) {
        // Blank the filter-dependent summary too (a failed load must not leave a stale total on the header).
        setState((s) => ({ ...s, ledgerState: 'error', ledgerSummary: null }));
        fail(pageR.error);
        return;
      }
      const page = narrow<{ items?: AgentLedgerRow[]; total?: number }>(pageR.data);
      const items = page.items ?? [];
      const total = page.total ?? 0;
      if (items.length === 0 && total > 0 && query.offset >= total) {
        const lastOffset = Math.max(0, (Math.ceil(total / EARN_LIMIT) - 1) * EARN_LIMIT);
        setState((s) => (s.ledgerQuery.offset === query.offset ? { ...s, ledgerQuery: { ...s.ledgerQuery, offset: lastOffset } } : s));
        void fetchLedgerWith({ ...query, offset: lastOffset });
        return;
      }
      const summary = sumR.error ? null : narrow<LedgerSummary>(sumR.data);
      setState((s) => ({ ...s, ledger: items, ledgerTotal: total, ledgerState: 'ready', ledgerSummary: summary }));
    },
    [client, did, fail],
  );
  const queryLedger = useCallback(
    (patch: Partial<EarnQuery>) => {
      const offsetOnly = Object.keys(patch).length === 1 && 'offset' in patch;
      const next: EarnQuery = { ...stateRef.current.ledgerQuery, ...patch, offset: offsetOnly ? (patch.offset ?? 0) : 0 };
      setState((s) => ({ ...s, ledgerQuery: next, ledgerState: 'loading' }));
      void fetchLedgerWith(next);
    },
    [fetchLedgerWith],
  );
  const loadEarnings = useCallback(() => {
    void fetchLedgerWith(stateRef.current.ledgerQuery);
  }, [fetchLedgerWith]);

  /** Read the pickup-shelf grid (slots + occupancy + the live free count) for the Shelf screen. */
  const loadShelf = useCallback(async () => {
    if (!client || !did) return;
    setState((s) => ({ ...s, shelfState: 'loading' }));
    const r = await client.api.getShelf(did);
    if (r.error) {
      // Keep this OFF the screen-level error: on Home it is only the occupancy widget, and the whole cockpit
      // must not fall over because a secondary metric failed to load.
      setState((s) => ({ ...s, shelf: null, shelfState: 'error', shelfError: r.error }));
      return;
    }
    setState((s) => ({ ...s, shelf: narrow<ShelfGrid>(r.data), shelfState: 'ready', shelfError: null }));
  }, [client, did]);

  /* ------------------------------------------ FB2b: answering prices on our own loads */
  // Declared above go() because go() opens the screen that needs them — a loader referenced before it is
  // defined is a TDZ crash the moment that tab is tapped, not a type-only complaint.

  const loadPosted = useCallback(async () => {
    if (!client) return;
    setState((s) => ({ ...s, postedState: s.postedState === 'ready' ? s.postedState : 'loading' }));
    const r = await client.api.postedFreight();
    if (r.error) {
      setState((s) => ({ ...s, postedState: 'error' }));
      return fail(r.error);
    }
    const page = narrow<{ items?: PostedFreight[] }>(r.data);
    setState((s) => ({ ...s, posted: page.items ?? [], postedState: 'ready' }));
  }, [client, fail]);

  const openPrices = useCallback(
    async (freightId: string | null) => {
      setState((s) => ({ ...s, pricesFor: freightId, prices: freightId ? s.prices : [], pricesState: freightId ? 'loading' : 'idle' }));
      if (!client || !freightId) return;
      const r = await client.api.freightProposals(freightId);
      if (r.error) {
        setState((s) => ({ ...s, pricesState: 'error' }));
        return fail(r.error);
      }
      const page = narrow<{ items?: FreightPrice[] }>(r.data);
      // Guarded on the id still being the one asked for: a shop tapping through two loads quickly must not
      // have the slower answer overwrite the newer one.
      setState((s) => (s.pricesFor === freightId ? { ...s, prices: page.items ?? [], pricesState: 'ready' } : s));
    },
    [client, fail],
  );

  const go = useCallback(
    (asked: Screen) => {
      // A notification or an old link can point one of the shop's people at an owner's screen: the counter instead.
      const screen: Screen = stateRef.current.staff && ownerOnlyScreen(asked) ? 'home' : asked;
      setState((s) => ({
        ...s,
        screen,
        error: null,
        // A fresh visit to the handover screen starts with no stale "still waiting" highlight.
        handover: screen === 'handover' ? { ...s.handover, missed: [] } : s.handover,
        void: screen === 'void' ? { parcelId: null, photoRef: '' } : s.void,
        tamper: screen === 'tamper' ? { parcelId: '', photoRef: '', note: '', done: null } : s.tamper,
      }));
      // The counter lists what is waiting to be collected (CV5), so it needs the shelf too; the tamper job lists what is held here.
      if (screen === 'handover' || screen === 'void' || screen === 'bag' || screen === 'release' || screen === 'tamper') void loadShopParcels();
      if (screen === 'bag') void loadBagPlan();
      if (screen === 'rates') void loadRates();
      if (screen === 'accept') {
        void loadAcceptPoints();
        void loadTakeInTerms();
      }
      if (screen === 'consignments') void loadConsignments();
      if (screen === 'freight') void loadPosted();
      if (screen === 'shelf') void loadShelf();
    },
    [loadShopParcels, loadBagPlan, loadRates, loadAcceptPoints, loadTakeInTerms, loadConsignments, loadShelf, loadPosted],
  );

  /* ---------------------------------------------------------------- forms */

  /**
   * THE TAKE-IN, TIMED for the pilot (the user, 2026-10-18): from the first touch on the take-in form — a scan or a
   * keystroke — to the parcel taken in. Started by the first change, sent with the take-in, and started afresh when the
   * form is empty again.
   */
  const takeInStarted = useRef<number | null>(null);
  const takeInSeconds = (): number | undefined => (takeInStarted.current ? Math.round((Date.now() - takeInStarted.current) / 100) / 10 : undefined);
  const setAccept = useCallback((p: Partial<AcceptForm>) => {
    takeInStarted.current ??= Date.now();
    setState((s) => ({ ...s, accept: { ...s.accept, ...p } }));
  }, []);
  const acceptEmpty = JSON.stringify(state.accept) === JSON.stringify(EMPTY_ACCEPT);
  useEffect(() => {
    if (acceptEmpty) takeInStarted.current = null;
  }, [acceptEmpty]);

  /* --- walk-up intake: measure + destination picker (Map | Address) --- */

  // A dims edit invalidates the derived tier AND supersedes any classify already in flight for the old
  // dims — bump the epoch so a stale result can't repopulate the just-cleared tier (and flip the P4+ warn).
  const deriveEpoch = useRef(0);
  const setDims = useCallback((patch: Partial<DimsForm>) => {
    deriveEpoch.current++;
    takeInStarted.current ??= Date.now();
    setState((s) => ({ ...s, accept: { ...s.accept, dims: { ...s.accept.dims, ...patch } }, acceptDerived: null }));
  }, []);

  // Classify the measured dims → the tier + cargo class (shown as a pill; P4+ warns + blocks). Epoch-guarded.
  const deriveSize = useCallback(async () => {
    const parsed = parseDims(stateRef.current.accept.dims);
    if (!client || !parsed) return;
    const epoch = ++deriveEpoch.current;
    const r = await client.api.classify(parsed.l, parsed.w, parsed.h, parsed.kg);
    if (epoch !== deriveEpoch.current || r.error) return;
    setState((s) => ({ ...s, acceptDerived: narrow<ClassifyView>(r.data) }));
  }, [client]);

  // The typed area drives the nearest-first sort + the confidence note — but ONLY after Find geocodes it.
  // Editing the text (or switching mode) drops the stale near-point/note so the list + distances can never
  // lag behind what the box says.
  const setAddress = useCallback((v: string) => {
    takeInStarted.current ??= Date.now();
    setState((s) => ({ ...s, accept: { ...s.accept, addressText: v }, acceptNear: null, acceptGeoNote: null }));
  }, []);

  const setDestMode = useCallback((mode: 'map' | 'address') => {
    takeInStarted.current ??= Date.now();
    setState((s) => ({ ...s, accept: { ...s.accept, destMode: mode }, acceptNear: null, acceptGeoNote: null }));
  }, []);

  /** "By area", corrected by eye: a tap on the map marks the place the shops are ordered around (2026-10-25). */
  const markDestNear = useCallback((point: GeoPoint) => {
    setState((s) => ({ ...s, acceptNear: point, acceptGeoNote: t('agent.toast.geoMarked') }));
  }, []);

  const pickDest = useCallback((point: { did: string; zone: string; shopName: string }) => {
    takeInStarted.current ??= Date.now();
    setState((s) => ({ ...s, accept: { ...s.accept, destPudoDid: point.did, destZone: point.zone, destShopName: point.shopName } }));
  }, []);

  /**
   * Resolve a typed place to a point + how sure we are of it. Returns the raw answer rather than a sentence:
   * two screens ask the same question for different reasons — the counter sorts a shop list around it, a
   * consolidation lot prices a haul to it — so each says what a match MEANS in its own words. Null = we
   * could not place it at all.
   */
  const geocodePlace = useCallback(
    async (q: string, countries: string[] = []): Promise<GeocodeView | null> => {
      const query = q.trim();
      if (!client || !query) return null;
      const r = await client.api.geocode(query, countries);
      if (r.error || !r.data) return null;
      const found = narrow<GeocodeView>(r.data);
      // A stand-in point for a name nobody found is not a place (the server says NOT_FOUND since 2026-10-25).
      return found.confidence === 'fallback' ? null : found;
    },
    [client],
  );

  // The counter's Address mode: geocode the typed area → the point the destination list sorts around.
  const geocodeEpoch = useRef(0);
  const geocodeAddress = useCallback(async () => {
    const q = stateRef.current.accept.addressText.trim();
    if (!client || !q) return;
    const epoch = ++geocodeEpoch.current;
    setState((s) => ({ ...s, acceptGeoBusy: true, acceptGeoNote: null }));
    // Looked for in the shop's own country: a walk-up at the counter cannot cross a border, and "Westlands" is also a
    // suburb of Johannesburg.
    // A record from before shops had a country leaves it out; the shop list, from the server, says it for every shop.
    const { agent, acceptPoints } = stateRef.current;
    const own = agent?.country ?? acceptPoints.find((p) => p.did === agent?.did)?.country;
    const g = await geocodePlace(q, own ? [own] : []);
    if (epoch !== geocodeEpoch.current) return;
    if (!g) {
      setState((s) => ({ ...s, acceptGeoBusy: false, acceptGeoNote: t('agent.toast.geoNotFound') }));
      return;
    }
    const where = g.matched ?? q;
    const note = g.confidence === 'exact' ? t('agent.toast.geoExact', { where }) : t('agent.toast.geoApprox', { where });
    setState((s) => ({ ...s, acceptGeoBusy: false, acceptNear: g.location, acceptGeoNote: note }));
  }, [client, geocodePlace]);
  const setHandover = useCallback((p: Partial<AgentState['handover']>) => {
    // Another pass is another bus: its list, and what was scanned onto the last one, are not this one's.
    setState((s) => ({ ...s, handover: { ...s.handover, ...p, ...(p.badge !== undefined && p.badge !== s.handover.badge ? { list: null, listState: 'idle' as const, selected: [], missed: [], lastScanned: null } : {}) } }));
  }, []);
  const toggleHandover = useCallback((parcelId: string) => {
    setState((s) => {
      const has = s.handover.selected.includes(parcelId);
      const selected = has ? s.handover.selected.filter((x) => x !== parcelId) : [...s.handover.selected, parcelId];
      // Selecting a parcel the gate flagged as missing resolves it — drop it from the highlight.
      const missed = has ? s.handover.missed : s.handover.missed.filter((x) => x !== parcelId);
      return { ...s, handover: { ...s.handover, selected, missed } };
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
  const openVoid = useCallback((parcelId: string | null) => {
    setState((s) => ({ ...s, void: { parcelId, photoRef: '' }, error: null }));
  }, []);
  const setVoidPhoto = useCallback((photoRef: string) => {
    setState((s) => ({ ...s, void: { ...s.void, photoRef } }));
  }, []);
  const setTamper = useCallback((patch: Partial<AgentState['tamper']>) => {
    setState((s) => ({ ...s, tamper: { ...s.tamper, ...patch }, error: null }));
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

  /**
   * F3 — the runs a shipper can buy space on.
   *
   * Unfiltered on purpose. Filtering to the shop's own zone sounds helpful and is the mistake the country
   * list already taught: a shop sends things from where it stands, but it also sends things that start
   * somewhere else, and a list that quietly hides most of the network reads as "there is nothing".
   */
  const loadOffers = useCallback(async () => {
    if (!client) return;
    setState((s) => ({ ...s, offersState: s.offersState === 'ready' ? s.offersState : 'loading' }));
    const r = await client.api.departureOffers();
    if (r.error) {
      setState((s) => ({ ...s, offersState: 'error' }));
      return fail(r.error);
    }
    const page = narrow<{ items?: OfferRow[] }>(r.data);
    setState((s) => ({ ...s, offers: page.items ?? [], offersState: 'ready' }));
  }, [client, fail]);

  /**
   * WHAT THIS SHOP HAS BOOKED — the read the shipper's side shipped without.
   *
   * Reloaded after every booking and every cancellation, because this list is the only place either of
   * those becomes visible: a toast is gone in five seconds and the thing it announced lived nowhere.
   */
  const loadMyBookings = useCallback(async () => {
    if (!client) return;
    setState((s) => ({ ...s, myBookingsState: s.myBookingsState === 'ready' ? s.myBookingsState : 'loading' }));
    const r = await client.api.myDepartureBookings();
    if (r.error) {
      setState((s) => ({ ...s, myBookingsState: 'error' }));
      return fail(r.error);
    }
    const page = narrow<{ items?: MyBookingRow[] }>(r.data);
    setState((s) => ({ ...s, myBookings: page.items ?? [], myBookingsState: 'ready' }));
  }, [client, fail]);

  /**
   * SOMETHING WENT WRONG with a load that was delivered.
   *
   * Resolves TRUE only when it went through, so the sheet stays open on a refusal with everything
   * typed into it still there — this is somebody describing a bad week, not filling in a form.
   */
  const raiseBookingClaim = useCallback(
    async (departureId: string, bookingId: string, claim: { kind: string; description: string; amount?: number }): Promise<boolean> => {
      if (!client) return false;
      let ok = false;
      await run(`claim:${bookingId}`, async () => {
        const r = await client.api.openBookingClaim(departureId, bookingId, claim);
        if (r.error) return fail(r.error);
        ok = true;
        pushToast({ tone: 'ok', icon: 'info', title: t('agent.mine.claimSent'), detail: t('agent.mine.claimSentDetail') });
        await loadMyBookings();
      });
      return ok;
    },
    [client, run, fail, pushToast, loadMyBookings],
  );

  /** Give the space back. Offered only where the server says it is still possible. */
  const cancelMyBooking = useCallback(
    async (departureId: string, bookingId: string) => {
      if (!client) return;
      await run(`unbook:${bookingId}`, async () => {
        const r = await client.api.cancelDepartureBooking(departureId, bookingId);
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'truck', title: t('agent.mine.gaveBack'), detail: t('agent.mine.gaveBackDetail') });
        // Both lists move: the space is on the market again, and this row is now history.
        await Promise.all([loadMyBookings(), loadOffers()]);
      });
    },
    [client, run, fail, pushToast, loadMyBookings, loadOffers],
  );

  /**
   * Forget the quote, because the load it was for has changed.
   *
   * Not cosmetic. A shop could otherwise quote 40 kg, edit the weight to 4000, and press Take it against a
   * price that was never for this load — the server would price it correctly and the shop would have
   * agreed to a different number than the one on their screen.
   */
  const clearOfferQuote = useCallback(() => {
    setState((s) => (s.offerQuote || s.offerQuoteError ? { ...s, offerQuote: null, offerQuoteError: null } : s));
  }, []);

  /** Open (or close) the take-space sheet for one run. Closing clears the quote — it belongs to a load. */
  const openOffer = useCallback((offer: OfferRow | null) => {
    setState((s) => ({ ...s, offerFor: offer, offerQuote: null, offerQuoteError: null }));
  }, []);

  /**
   * What it would cost, said before anybody commits — the same rule the top-up fee is held to.
   *
   * A refusal is kept as `offerQuoteError` rather than raised as a page error: "only 12 m³ of space is
   * left" is an answer to the question just asked, and it belongs beside the fields that caused it.
   */
  const quoteOffer = useCallback(
    async (load: { description: string; weightKg: number; volumeM3?: number }) => {
      if (!client) return;
      const offer = stateRef.current.offerFor;
      if (!offer) return;
      await run('quote-offer', async () => {
        const r = await client.api.quoteDeparture(offer.departureId, load);
        if (r.error) {
          setState((s) => ({ ...s, offerQuote: null, offerQuoteError: r.error ?? null }));
          return;
        }
        setState((s) => ({ ...s, offerQuote: narrow<OfferQuote>(r.data), offerQuoteError: null }));
      });
    },
    [client, run],
  );

  /** Take the space. Resolves TRUE only when it went through, so the sheet stays open on a refusal. */
  const bookOffer = useCallback(
    async (load: { description: string; weightKg: number; volumeM3?: number }): Promise<boolean> => {
      if (!client) return false;
      const offer = stateRef.current.offerFor;
      if (!offer) return false;
      let ok = false;
      await run('book-offer', async () => {
        const r = await client.api.bookDeparture(offer.departureId, load);
        if (r.error) {
          setState((s) => ({ ...s, offerQuoteError: r.error ?? null }));
          return;
        }
        ok = true;
        setState((s) => ({ ...s, offerFor: null, offerQuote: null, offerQuoteError: null }));
        pushToast({ tone: 'ok', icon: 'truck', title: t('agent.offers.tookTitle'), detail: t('agent.offers.tookDetail', { company: offer.company }) });
        // BOTH lists. The toast is gone in five seconds, and until this reloaded there was nowhere at all
        // the thing it announced could be seen afterwards.
        await Promise.all([loadOffers(), loadMyBookings()]);
      });
      return ok;
    },
    [client, run, pushToast, loadOffers, loadMyBookings],
  );

  /** Export the whole current-filter parcel history (every page) as a CSV download — server-rendered. */
  const exportHistory = useCallback(async () => {
    if (!client || !did) return;
    await run('export-history', async () => {
      const q = stateRef.current.parcelHistQuery;
      const r = await client.api.parcelsExport(did, { q: q.q || undefined, status: q.status || undefined, role: q.role || undefined, from: q.from || undefined, to: q.to || undefined, sort: q.sort });
      if (r.error) return fail(r.error);
      triggerDownload('parcels.csv', narrow<string>(r.data));
      pushToast({ tone: 'ok', icon: 'check', title: t('agent.toast.historyExported'), detail: t('agent.toast.historyExportedDetail') });
    });
  }, [client, did, run, fail, pushToast]);

  /** Export the whole current-filter earnings ledger (every page) as a CSV download — server-rendered. */
  const exportLedger = useCallback(async () => {
    if (!client || !did) return;
    await run('export-ledger', async () => {
      const q = stateRef.current.ledgerQuery;
      const r = await client.api.ledgerExport(did, { q: q.q || undefined, type: q.type || undefined, direction: q.direction || undefined, from: q.from || undefined, to: q.to || undefined, sort: q.sort });
      if (r.error) return fail(r.error);
      triggerDownload('earnings.csv', narrow<string>(r.data));
      pushToast({ tone: 'ok', icon: 'check', title: t('agent.toast.earningsExported'), detail: t('agent.toast.earningsExportedDetail') });
    });
  }, [client, did, run, fail, pushToast]);

  /** Reconfigure the pickup shelf (rows × colour columns + bundle slots) → refresh the agent record + re-read the grid. */
  const saveShelf = useCallback(
    async (rows: number, cols: number, consolidationSlots: string[]) => {
      if (!client || !did) return;
      await run('shelf', async () => {
        const r = await client.api.setShelf(did, rows, cols, consolidationSlots);
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'check', title: t('agent.toast.shelfSaved'), detail: t('agent.toast.shelfSavedDetail', { total: rows * cols }) });
        // Re-fetch the MERGED agent (balance + rating) — the raw setShelf response body carries neither, so
        // trusting it would blank the wallet hero until the next background refresh. Siblings do the same.
        await refresh();
        await loadShelf();
      });
    },
    [client, did, run, fail, pushToast, refresh, loadShelf],
  );

  /** Declare the floor room for outbound BAGS — the shelf's counterpart for the other pile in the room. */
  const saveBagBays = useCallback(
    async (bays: number) => {
      if (!client || !did) return;
      await run('bag-bays', async () => {
        const r = await client.api.setBagBays(did, bays);
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'bag', title: t('agent.toast.baysSaved'), detail: t('agent.toast.baysSavedDetail', { count: bays }) });
        await refresh(); // the merged agent record carries the new number (and the wallet hero it sits beside)
      });
    },
    [client, did, run, fail, pushToast, refresh],
  );

  /* -------------------------------------------------- My-shop editors (location / hours / photo) */

  /** Authenticated byte loader for <AuthImage> (media is owner-gated — no plain <img src>). */
  const loadMedia = useCallback(
    (mediaId: string) => (client ? client.api.mediaBlob(mediaId) : Promise.resolve({ data: null, error: {} as unknown })),
    [client],
  );

  /** Move the shop's map pin → refresh the record so the dashboard shows the new spot + three words. */
  const setLocationPin = useCallback(
    async (lat: number, lng: number) => {
      if (!client || !did) return;
      await run('location', async () => {
        const r = await client.api.setLocation(did, lat, lng);
        if (r.error) return fail(r.error);
        await refresh();
        pushToast({ tone: 'ok', icon: 'check', title: t('agent.toast.locationSaved') });
      });
    },
    [client, did, run, fail, pushToast, refresh],
  );

  /** Save the weekly opening schedule. */
  const saveHours = useCallback(
    async (openingHours: Record<string, { open: string; close: string } | null>) => {
      if (!client || !did) return;
      await run('hours', async () => {
        const r = await client.api.setHours(did, openingHours);
        if (r.error) return fail(r.error);
        await refresh();
        pushToast({ tone: 'ok', icon: 'check', title: t('agent.toast.hoursSaved') });
      });
    },
    [client, did, run, fail, pushToast, refresh],
  );

  /**
   * The shop sends its papers. Each is the id of a picture it has just taken (see PhotoField): the server takes
   * nothing else. True when they went — the sheet closes on that and on nothing else.
   */
  const sendPapers = useCallback(
    async (papers: { idCopyRef: string; tradingLicenceRef: string; shopPhotoRefs: string[] }): Promise<boolean> => {
      if (!client || !did) return false;
      let sent = false;
      await run('papers', async () => {
        const r = await client.api.submitKyc(did, papers);
        if (r.error) return fail(r.error);
        sent = true;
        await refresh();
        pushToast({ tone: 'ok', icon: 'check', title: t('agent.toast.papersSent') });
      });
      return sent;
    },
    [client, did, run, fail, pushToast, refresh],
  );

  /**
   * Round 40 — the shop sends its renewed trading licence: the photo it just took, and the date it runs to. True when it went —
   * the sheet closes on that and on nothing else. Staff read it; the date counts once they have.
   */
  const sendLicenceRenewal = useCallback(
    async (body: { copyRef: string; expiresAt: string }): Promise<boolean> => {
      if (!client || !did) return false;
      let sent = false;
      await run('licence', async () => {
        const r = await client.api.sendLicenceRenewal(did, body);
        if (r.error) return fail(r.error);
        sent = true;
        await refresh();
        pushToast({ tone: 'ok', icon: 'check', title: t('agent.toast.licenceSent') });
      });
      return sent;
    },
    [client, did, run, fail, pushToast, refresh],
  );

  /** Capture + upload a shop-front photo → point the shop at it → refresh. */
  const saveShopfront = useCallback(
    async (file: File) => {
      if (!client || !did) return;
      await run('shopfront', async () => {
        const mediaId = await uploadPhoto('avatar', file);
        if (!mediaId) {
          pushToast({ tone: 'danger', icon: 'warning', title: t('agent.toast.photoUploadFail') });
          return;
        }
        const r = await client.api.setShopfront(did, mediaId);
        if (r.error) return fail(r.error);
        await refresh();
        pushToast({ tone: 'ok', icon: 'check', title: t('agent.toast.shopPhotoSaved') });
      });
    },
    [client, did, run, uploadPhoto, fail, pushToast, refresh],
  );

  /**
   * ASK to top up — and say so, because nothing has been added.
   *
   * The toast used to read "Balance topped up · Added 50.00" the instant this returned. It was never
   * true, and after 2026-09-22 it is not even close: the money arrives when the payment provider says it
   * did. So this hands back the reference to quote and the screen shows it; the float moves later, on a
   * refresh, when the confirmation has landed.
   */
  const topUp = useCallback(
    async (amount: number, phone?: string) => {
      if (!client || !did || !(amount > 0)) return;
      await run('topup', async () => {
        const r = await client.api.topUp(did, amount, phone);
        if (r.error) return fail(r.error);
        buzz();
        const funding = narrow<FundingView>(r.data);
        setState((s) => ({ ...s, funding }));
        pushToast({ tone: 'info', icon: 'wallet', title: t('agent.toast.topUpAsked'), detail: t('agent.toast.topUpAskedDetail', { reference: funding.reference }) });
      });
    },
    [client, did, run, fail, pushToast],
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
            ? { tone: 'ok', icon: 'check', title: t('agent.toast.shopOpen'), detail: t('agent.toast.shopOpenDetail') }
            : { tone: 'info', icon: 'clock', title: t('agent.toast.shopClosed'), detail: t('agent.toast.shopClosedDetail') },
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
        pushToast({ tone: 'ok', icon: 'wallet', title: t('agent.toast.priceUpdated'), detail: t('agent.toast.priceUpdatedDetail', { price: money(price, stateRef.current.agent?.currency) }) });
        await refresh();
        if (stateRef.current.screen === 'rates') await loadRates();
      });
    },
    [client, did, run, fail, pushToast, refresh, loadRates],
  );

  const submitAccept = useCallback(async () => {
    if (!client || !did) return;
    const f = stateRef.current.accept;
    const dims = parseDims(f.dims);
    // A dedicated (P4+) load can't ride the bus — the server refuses it, so don't even send it.
    if (!dims || !f.destPudoDid || stateRef.current.acceptDerived?.dedicated) return;
    // P3 — the same gate the button shows: no take-in on terms nobody has been shown (or told).
    const terms = stateRef.current.takeInTerms;
    if (termsBlock(terms, stateRef.current.takeInTermsState, stateRef.current.termsTold, t)) return;
    await run('accept', async () => {
      const r = await client.api.accept({
        agentDid: did,
        // The created id becomes the canonical Map key; uppercase it so it matches the
        // printed (uppercase) sticker on every later scan/lookup.
        parcelId: f.parcelId.trim().toUpperCase(),
        // The tier is DERIVED server-side from these measurements (no manual size).
        dimensionsCm: { l: dims.l, w: dims.w, h: dims.h },
        weightKg: dims.kg,
        destZone: f.destZone.trim(),
        destPudoDid: f.destPudoDid,
        senderMobile: f.senderMobile.trim() || 'n/a',
        receiverMobile: f.receiverMobile.trim() || 'n/a',
        dropoffPhotoRef: f.photoRef,
        fragile: f.fragile || undefined,
        natureCode: f.natureCode,
        takeInSeconds: takeInSeconds(),
        // Cash at this counter is OUR cash. Where no cash of ours may cross it, the take-in books nothing of
        // ours — the carrier prices and collects its own work — so it is not sent as a cash take-in.
        ...(terms && !terms.cashAccepted ? { paymentMode: 'prepaid' as const } : {}),
      });
      if (r.error) return fail(r.error);
      buzz();
      // Taken in without a signal: it is in the outbox, and says so. Its label and release code are made when it
      // reaches SeeBuyGet, and shown then (lateTakeIns).
      if (narrow<{ queued?: boolean }>(r.data)?.queued) {
        setState((s) => ({ ...s, accept: { ...EMPTY_ACCEPT }, acceptDerived: null, acceptNear: null, acceptGeoNote: null, acceptedLabel: { parcelId: f.parcelId.trim().toUpperCase(), queued: true } }));
        pushToast({ tone: 'info', icon: 'box', title: t('agent.toast.parcelQueued'), detail: t('agent.toast.parcelQueuedDetail') });
        return;
      }
      // DT — capture the label the parcel was born with so the agent can print it and stick it on the parcel
      // (peer-send parcels never had one). Clearing the form but staying on the accept screen; a Sheet shows it.
      const p = narrow<{ parcelId: string; trackingKey?: string; otp?: string; label?: { svg?: string } }>(r.data);
      setState((s) => ({ ...s, accept: { ...EMPTY_ACCEPT }, acceptDerived: null, acceptNear: null, acceptGeoNote: null, acceptedLabel: p ? { parcelId: p.parcelId, trackingKey: p.trackingKey, svg: p.label?.svg, releaseCode: p.otp } : null }));
      pushToast({ tone: 'ok', icon: 'box', title: t('agent.toast.parcelAccepted'), detail: t('agent.toast.parcelAcceptedDetail') });
      await refresh();
    });
  }, [client, did, run, fail, pushToast, refresh]);

  /** DT — dismiss the printed-label sheet and return to the shop home. */
  const dismissAcceptedLabel = useCallback(() => setState((s) => ({ ...s, acceptedLabel: null, screen: 'home' })), []);

  /** The late take-in shown has been dealt with: show the next, if more reached SeeBuyGet. Nothing of it is kept. */
  const dismissLateTakeIn = useCallback(() => setState((s) => ({ ...s, lateTakeIns: s.lateTakeIns.slice(1) })), []);

  // A take-in made without a signal reaches SeeBuyGet: its label and release code exist now, and are shown now.
  useEffect(
    () =>
      onOutboxSent((item, answer) => {
        if (item.path !== '/v1/sbg/parcels/accept') return;
        const p = narrow<{ parcelId?: string; trackingKey?: string; otp?: string; label?: { svg?: string } }>(answer);
        if (!p?.parcelId) return;
        const sender = (item.body as { senderMobile?: string } | undefined)?.senderMobile;
        const late = { parcelId: p.parcelId, trackingKey: p.trackingKey, svg: p.label?.svg, releaseCode: p.otp, ...(sender && sender !== 'n/a' ? { senderMobile: sender } : {}), queuedAt: item.at };
        setState((s) => ({ ...s, lateTakeIns: [...s.lateTakeIns, late] }));
        pushToast({ tone: 'info', icon: 'box', title: t('agent.toast.lateTakeIn', { parcel: p.parcelId }), detail: t('agent.toast.lateTakeInDetail') });
      }),
    [pushToast],
  );

  /**
   * F2 — book a too-big (dedicated/P4+) walk-up as FREIGHT. Only fires for a dedicated load with a valid
   * booking (dims + destination PUDO + a cash cap, and a future date when planned); the same guard the CTA
   * uses, re-checked here so a stale click can't send. The agent is the originator; the customer's cash cap
   * becomes the freight's ceiling and settles off-platform — no wallet is billed.
   */
  const submitBookFreight = useCallback(async () => {
    if (!client || !did) return;
    const f = stateRef.current.accept;
    const dims = parseDims(f.dims);
    const cap = parseBudget(f.budgetCap);
    if (!dims || !cap || !f.destPudoDid || !stateRef.current.acceptDerived?.dedicated) return;
    if (bookFreightMissing(f, Date.now(), t)) return;
    await run('book-freight', async () => {
      const r = await client.api.bookFreight({
        agentDid: did,
        dimensionsCm: { l: dims.l, w: dims.w, h: dims.h },
        weightKg: dims.kg,
        natureCode: f.natureCode,
        fragile: f.fragile || undefined,
        destPudoDid: f.destPudoDid,
        customerMobile: f.customerMobile.trim() || undefined,
        budgetCap: cap,
        scheduledPickupAt: plannedPickupIso(f),
        // Only meaningful for a planned load; omit it for an immediate one so the server keeps its default.
        allowEarlyClaim: f.freightWhen === 'planned' ? f.allowEarlyClaim : undefined,
        // FB2b — sent only when chosen, so an ordinary booking keeps the server's default rather than
        // restating it. Absent reads as 'instant', which is how every counter booking has behaved.
        commitMode: f.negotiate ? 'negotiate' : undefined,
        // FB2c — sent only when the clerk actually said something. `false` and "no opinion" are both the
        // absence of an answer here, and sending them would dress a default up as an observation.
        indivisible: f.indivisible || undefined,
        bodyHint: bodyHintValue(f.bodyHint),
        // FB5 — always present: bookFreightMissing() blocks the button until it is answered, so reaching here
        // means the clerk said it. Sent explicitly rather than left to the server's deployment default,
        // because a default is a guess about the region and this is a fact about the load.
        packaging: packagingValue(f.packaging),
        // FB2d — likewise absent when the customer ruled nothing out, which is the ordinary case. An empty
        // array would post a shipper preference nobody expressed, and this one REFUSES claims.
        excludedBodies: excludedBodiesValue(f.excludedBodies),
        // FP7 — box 13, sent only when the clerk took anything down.
        instructions: f.instructions.trim() || undefined,
        contactName: f.contactName.trim() || undefined,
        contactPhone: f.contactPhone.trim() || undefined,
        deliveryWindow: f.deliveryWindow.trim() || undefined,
        // CL1 — sent only when the clerk was told. No term means the sender claims, as before.
        incoterm: incotermValue(f.incoterm),
        namedPlace: f.namedPlace.trim() || undefined,
      });
      if (r.error) return fail(r.error);
      buzz();
      const fr = narrow<AgentState['bookedFreight']>(r.data);
      setState((s) => ({ ...s, accept: { ...EMPTY_ACCEPT }, acceptDerived: null, acceptNear: null, acceptGeoNote: null, bookedFreight: fr }));
      pushToast({ tone: 'ok', icon: 'truck', title: t('agent.toast.freightBooked'), detail: fr ? t('agent.toast.freightBookedCode', { code: fr.code }) : t('agent.toast.freightBookedFallback') });
      await refresh();
    });
  }, [client, did, run, fail, pushToast, refresh]);

  /**
   * Take a price — which is what CLAIMS the load, not a separate confirmation step.
   *
   * The refusals are the point of this handler. A price above the customer's cash cap is refused by the
   * server with BUDGET_EXCEEDED and the negotiation is left exactly as it was, so the shop can go back to the
   * customer for more money and take the same price afterwards. Nothing is optimistically marked accepted:
   * the driver may have de-coupled or filled up since naming it, and the server re-checks all of that.
   */
  const acceptPrice = useCallback(
    async (p: FreightPrice) => {
      if (!client) return;
      await run(`accept-price:${p.proposalId}`, async () => {
        const r = await client.api.acceptProposal(p.proposalId);
        if (r.error) return fail(r.error);
        buzz();
        pushToast({ tone: 'ok', icon: 'truck', title: t('agent.freight.acceptedToast'), detail: t('agent.freight.acceptedToastDetail', { amount: money(p.price, stateRef.current.posted.find((f) => f.freightId === p.freightId)?.currency) }) });
        await Promise.all([loadPosted(), openPrices(p.freightId)]);
      });
    },
    [client, run, fail, pushToast, t, loadPosted, openPrices],
  );

  /** FP3 — the shop withdraws a load before pickup. A driver who had claimed it is told; a charge comes back. */
  const cancelFreight = useCallback(
    async (freightId: string, reason: string) => {
      if (!client) return;
      await run(`cancel-freight:${freightId}`, async () => {
        const r = await client.api.cancelFreight(freightId, reason);
        if (r.error) return fail(r.error);
        const out = narrow<{ code?: string; refunded?: number }>(r.data);
        pushToast({
          tone: 'ok',
          icon: 'truck',
          title: t('agent.freight.cancelledToast', { code: out.code ?? '' }),
          detail: out.refunded != null ? t('agent.freight.cancelledRefund', { amount: money(out.refunded, stateRef.current.posted.find((f) => f.freightId === freightId)?.currency) }) : t('agent.freight.cancelledDetail'),
        });
        await Promise.all([loadPosted(), openPrices(null)]);
      });
    },
    [client, run, fail, pushToast, t, loadPosted, openPrices],
  );

  /** FP7 — the sender's instructions: rewritten before pickup, added to on the road. The driver holding it is told. */
  const setFreightInstructions = useCallback(
    async (freightId: string, body: { text?: string; contactName?: string; contactPhone?: string; deliveryWindow?: string }) => {
      if (!client) return;
      await run(`instruct-freight:${freightId}`, async () => {
        const r = await client.api.setFreightInstructions(freightId, body);
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'edit', title: t('agent.freight.instructedToast'), detail: t('agent.freight.instructedDetail') });
        await loadPosted();
      });
    },
    [client, run, fail, pushToast, t, loadPosted],
  );

  /** Refused at the door (the user, 2026-10-27): the shop, as the sender, says where the goods go. The refusal in words, or null. */
  const decideRefusal = useCallback(
    async (freightId: string, body: RefusalBody): Promise<string | null> => {
      if (!client) return null;
      const r = await client.api.decideRefusal(freightId, body);
      if (r.error) return refusalSentence(r.error);
      pushToast({ tone: 'ok', icon: 'truck', title: t(body.choice === 'give_up' ? 'refusal.done.giveUp' : body.choice === 'back' ? 'refusal.done.back' : 'refusal.done.elsewhere') });
      await loadPosted();
      return null;
    },
    [client, pushToast, t, loadPosted],
  );

  /** FP6 — the shop's verdict on the carrier, once the load is delivered. Last wins on the same load. */
  const rateFreight = useCallback(
    async (freightId: string, body: { stars: number; issues?: string[] }) => {
      if (!client) return;
      await run(`rate-freight:${freightId}`, async () => {
        const r = await client.api.rateFreight(freightId, body);
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'star', title: t('agent.freight.ratedToast', { stars: body.stars }), detail: t('agent.freight.ratedDetail') });
        await loadPosted();
      });
    },
    [client, run, fail, pushToast, t, loadPosted],
  );

  /** FP3b — the shop says the delivered goods were damaged, short, or never arrived. An operator decides it. */
  const openFreightClaim = useCallback(
    async (freightId: string, body: { kind: 'damaged' | 'short' | 'not_received'; description: string; photoRef?: string }) => {
      if (!client) return;
      await run(`claim-freight:${freightId}`, async () => {
        const r = await client.api.openFreightClaim(freightId, body);
        if (r.error) return fail(r.error);
        pushToast({ tone: 'ok', icon: 'check', title: t('agent.freight.claimToast'), detail: t('agent.freight.claimToastDetail') });
        await loadPosted();
      });
    },
    [client, run, fail, pushToast, t, loadPosted],
  );

  const declinePrice = useCallback(
    async (p: FreightPrice) => {
      if (!client) return;
      await run(`decline-price:${p.proposalId}`, async () => {
        const r = await client.api.declineProposal(p.proposalId);
        if (r.error) return fail(r.error);
        // No toast: saying no to one price is a small, reversible-in-spirit act, and the list redraws to show it.
        await Promise.all([loadPosted(), openPrices(p.freightId)]);
      });
    },
    [client, run, fail, loadPosted, openPrices],
  );

  /** F2 — dismiss the booked-freight receipt and return to the shop home. */
  const dismissBookedFreight = useCallback(() => setState((s) => ({ ...s, bookedFreight: null, screen: 'home' })), []);

  /* -------------------------------------------------------- REP2: rate a driver */

  /** REP2 — open the "rate the driver" prompt (after a handover / bag-receipt) and fetch the driver's public
   *  profile so the sheet can show who they are and their standing rating. */
  const openRateDriver = useCallback(
    async (driverDid: string) => {
      if (!client || !driverDid) return;
      setState((s) => ({ ...s, driverRating: { driverDid, profile: null } }));
      const r = await client.api.reputation(driverDid);
      if (r.error) return; // the sheet still works without the name/current rating
      setState((s) => (s.driverRating?.driverDid === driverDid ? { ...s, driverRating: { driverDid, profile: narrow<ReputationProfileView>(r.data) } } : s));
    },
    [client],
  );

  const dismissRateDriver = useCallback(() => setState((s) => ({ ...s, driverRating: null })), []);

  /** REP2 — submit the shop's rating of the driver (stars + issue tags) for the leg just completed. */
  const submitDriverRating = useCallback(
    async (stars: number, issues: string[]) => {
      const driverDid = stateRef.current.driverRating?.driverDid;
      if (!client || !driverDid || !(stars >= 1 && stars <= 5)) return;
      await run('rate-driver', async () => {
        const r = await client.api.rateDriver(driverDid, { stars, issues: issues.length ? issues : undefined });
        if (r.error) {
          // The rate sheet is a modal that covers the screen's ErrorNote, so surface the failure as a toast
          // (which renders above it) — otherwise a failed submit looks identical to a saved one.
          pushToast({ tone: 'danger', icon: 'warning', title: t('agent.toast.ratingFail'), detail: errorSentence(r.error) });
          return fail(r.error);
        }
        buzz();
        setState((s) => ({ ...s, driverRating: null }));
        pushToast({ tone: 'ok', icon: 'star', title: t('agent.toast.driverRated'), detail: t('agent.toast.driverRatedDetail') });
      });
    },
    [client, run, fail, pushToast],
  );

  /** F3 — open a consolidation lot for a durable dry commodity. `destLocation` is the pin the shop placed (or
   *  the geocoder found and they accepted): without one the eventual haul prices off a name we may not know. */
  const openConsignment = useCallback(
    async (input: { natureCode: string; pickupLabel?: string; pickupLocation?: GeoPoint; destLabel: string; destLocation?: GeoPoint; targetKg: number; maxSpend?: number }) => {
      if (!client || !did || !input.destLabel.trim() || !(input.targetKg > 0)) return;
      await run('open-consignment', async () => {
        const r = await client.api.openConsignment({
          natureCode: input.natureCode as never,
          // Both ends travel together: the truck is paid between them, and the drivers told about it are the
          // ones near the PICKUP — which for a cooperative is a shed, not the counter that owns the lot.
          pickupLabel: input.pickupLabel?.trim() || undefined,
          pickupLocation: input.pickupLocation,
          destLabel: input.destLabel.trim(),
          destLocation: input.destLocation,
          targetKg: input.targetKg,
          maxSpend: input.maxSpend,
        });
        if (r.error) return fail(r.error);
        buzz();
        pushToast({ tone: 'ok', icon: 'bag', title: t('agent.toast.lotOpened'), detail: t('agent.toast.lotOpenedDetail') });
        await loadConsignments();
      });
    },
    [client, did, run, fail, pushToast, loadConsignments],
  );

  /** F3 — record a member deposit into a lot; it auto-posts a freight once full. */
  const depositConsignment = useCallback(
    async (code: string, memberRef: string, weightKg: number) => {
      if (!client || !did || !memberRef.trim() || !(weightKg > 0)) return;
      await run(`deposit-${code}`, async () => {
        const r = await client.api.depositConsignment(code, { memberRef: memberRef.trim(), weightKg });
        if (r.error) return fail(r.error);
        buzz();
        const lot = narrow<ConsignmentView>(r.data);
        pushToast(
          lot?.status === 'posted'
            ? { tone: 'ok', icon: 'truck', title: t('agent.toast.lotFull'), detail: t('agent.toast.lotFullDetail', { code: lot.code }) }
            : { tone: 'ok', icon: 'bag', title: t('agent.toast.depositAdded'), detail: lot ? t('agent.toast.depositAddedDetail', { done: lot.weightKg, target: lot.targetKg }) : undefined },
        );
        await loadConsignments();
      });
    },
    [client, did, run, fail, pushToast, loadConsignments],
  );

  /* -------------------------------------------------- pre-minted intake (PG4) */

  // The scanned sticker might already BE a parcel — a peer send booked in the Send app (cash due at this
  // counter), a store order, or a sticker that is simply in use. Resolve it as the id is typed/scanned;
  // 404 = a fresh sticker → the walk-up form stays. Debounced; a re-scan clears the PREVIOUS parcel's
  // preview + its proof photo SYNCHRONOUSLY (so A's cash card + A's photo can never sit under B's code —
  // charging or evidencing the wrong parcel), and the async result is epoch-guarded against abandonment.
  const previewEpoch = useRef(0);
  useEffect(() => {
    const id = state.accept.parcelId.trim().toUpperCase();
    const epoch = ++previewEpoch.current;
    if (!client || id.length < 6) {
      setState((s) => (s.preMint || s.preMintState !== 'idle' || s.intakePhotoRef ? { ...s, preMint: null, preMintState: 'idle', preMintError: null, intakePhotoRef: '' } : s));
      return;
    }
    // Drop the stale parcel + its photo the instant a new code is scheduled, not when the fetch lands.
    setState((s) => (s.preMint || s.preMintState !== 'loading' || s.intakePhotoRef ? { ...s, preMint: null, preMintState: 'loading', preMintError: null, intakePhotoRef: '' } : s));
    const t = setTimeout(async () => {
      const r = await client.api.intakePreview(id);
      if (epoch !== previewEpoch.current) return;
      if (r.error) {
        if (isSignInRequired(r.error)) return fail(r.error); // an expired shift → the shell's one sign-in route
        const fresh = r.error.status === 404; // an unknown id IS the normal walk-up case, not an error
        setState((s) => ({ ...s, preMint: null, preMintState: fresh ? 'idle' : 'error', preMintError: fresh ? null : r.error }));
        return;
      }
      setState((s) => ({ ...s, preMint: narrow<IntakePreview>(r.data), preMintState: 'ready', preMintError: null }));
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, state.accept.parcelId, state.previewNonce]);

  const setIntakePhoto = useCallback((ref: string) => setState((s) => ({ ...s, intakePhotoRef: ref })), []);

  /** Re-run the preview for the current code (an unchanged id won't re-fire the effect on its own). */
  const retryPreview = useCallback(() => setState((s) => ({ ...s, previewNonce: s.previewNonce + 1 })), []);

  /** Take in a pre-minted parcel: cash (peer send, photo required) or prepaid (store order). */
  /** `papersInPouch` — a crossing parcel's commercial invoice was seen in the pouch (round 13). */
  const submitIntake = useCallback(async (papersInPouch = false) => {
    if (!client || !did) return;
    const pm = stateRef.current.preMint;
    const photo = stateRef.current.intakePhotoRef;
    // Only ever act on a SETTLED preview — never a stale one still on screen during a re-scan's fetch.
    if (!pm || stateRef.current.preMintState !== 'ready' || (pm.kind === 'peer_send' && !photo) || (pm.papers && !papersInPouch)) return;
    await run('intake', async () => {
      const r = await client.api.intake(pm.parcelId, pm.kind === 'peer_send' ? photo : undefined, takeInSeconds(), pm.papers ? papersInPouch : undefined);
      if (r.error) return fail(r.error);
      buzz();
      previewEpoch.current++; // the form reset below must not race a stale preview into the cleared state
      setState((s) => ({
        ...s,
        accept: { ...EMPTY_ACCEPT },
        intakePhotoRef: '',
        preMint: null,
        preMintState: 'idle',
        preMintError: null,
        intakeDone: { parcelId: pm.parcelId, kind: pm.kind, cashDue: pm.cashDue, currency: pm.currency, destShopName: pm.destShopName },
      }));
      pushToast({ tone: 'ok', icon: 'wallet', title: t('agent.toast.parcelTakenIn'), detail: pm.kind === 'peer_send' ? t('agent.toast.takenInCash', { amount: money(pm.cashDue, pm.currency) }) : t('agent.toast.takenInPrepaid') });
      await refresh();
    });
  }, [client, did, run, fail, pushToast, refresh]);

  const dismissIntakeDone = useCallback(() => setState((s) => ({ ...s, intakeDone: null })), []);

  /**
   * Hand the selected parcels to the bus. `shortShipReason` opts into the S25 short-ship: it is passed
   * only when the agent has knowingly chosen to leave the waiting parcels behind. Without it, the server
   * gate refuses a short load (INCOMPLETE_MANIFEST) and we surface exactly which parcels are still waiting
   * — the agent then loads them (and re-submits) or short-ships with a reason.
   */
  /* ------------------------------------------------------------------- bagging for the bus (tote) */

  /** Open a bag for one next hop, or pick up a bag already open for it. Several bags at once is normal:
   *  a shop packs one for Addis and one for the local hub side by side. */
  const openBag = useCallback(
    async (group: BagGroup) => {
      if (!client || !did) return;
      await run('bag-open', async () => {
        const code =
          group.openBagCode ??
          (await (async () => {
            const r = await client.api.openBag(did, group.key);
            if (r.error) {
              fail(r.error);
              return undefined;
            }
            return narrow<{ code: string }>(r.data)?.code;
          })());
        if (!code) return;
        // Re-opening a bag left half-packed restores what is IN it: the tote is durable, so the screen must
        // agree with the physical bag on the floor rather than starting from zero.
        const already = stateRef.current.bagPlan.bags.find((b) => b.code === code);
        setState((s) => ({
          ...s,
          bag: {
            code,
            destKey: group.key,
            label: group.label,
            parcels: already?.parcelIds ?? [],
            missed: [],
            sealed: already?.status === 'available',
            scan: '',
            lastAdded: null,
            fillPct: already?.fillPct ?? 0,
          },
        }));
        await loadBagPlan();
      });
    },
    [client, did, run, fail, loadBagPlan],
  );

  /** Put the open bag down and go back to the plan (it stays on the floor, durably). */
  const closeBagView = useCallback(() => {
    setState((s) => ({ ...s, bag: null }));
    void loadBagPlan();
  }, [loadBagPlan]);

  /**
   * Drop a waiting parcel into the open bag — by tapping its row, or by scanning its sticker.
   *
   * Both paths land here so both get the loud feedback: a bagging shop is a scanning LOOP, and the worker
   * is looking at the parcel in their hands, not at the screen. The green beep is the confirmation; the red
   * one is what stops a wrong-destination parcel from going in unnoticed.
   */
  const addToBag = useCallback(
    async (parcelId: string) => {
      if (!client) return;
      const bag = stateRef.current.bag;
      if (!bag || bag.sealed) return;
      if (!did) return;
      await run('bag-fill', async () => {
        const r = await client.api.fillBag(did, bag.code, parcelId);
        if (r.error) {
          signal('error');
          return fail(r.error);
        }
        signal('ok');
        // The server's own fill figure: the shop learns the bag is full at the moment it fills, rather than
        // by having the NEXT parcel refused.
        const fillPct = narrow<{ fillPct?: number }>(r.data)?.fillPct;
        setState((s) =>
          s.bag
            ? {
                ...s,
                bag: {
                  ...s.bag,
                  parcels: [...s.bag.parcels, parcelId],
                  missed: s.bag.missed.filter((m) => m !== parcelId),
                  scan: '',
                  lastAdded: parcelId,
                  fillPct: typeof fillPct === 'number' ? fillPct : s.bag.fillPct,
                },
              }
            : s,
        );
      });
    },
    [client, did, run, fail],
  );

  /** What is typed/scanned into the bag's parcel field. */
  const setBagScan = useCallback((scan: string) => {
    setState((s) => (s.bag ? { ...s, bag: { ...s.bag, scan } } : s));
  }, []);

  /**
   * Scan (or type) a sticker into the open bag. The same sticker waved twice is the routine accident of a
   * scanning loop, so it is answered HERE — at the counter, with no round-trip — as "already in, carry on"
   * rather than as a failure. The server refuses it too (a bag must never count a parcel twice); this is
   * only the faster, kinder answer for the case we can already see.
   */
  const submitBagScan = useCallback(
    async (override?: string) => {
      const bag = stateRef.current.bag;
      if (!bag || bag.sealed) return;
      const parcelId = (override ?? bag.scan).trim().toUpperCase();
      if (!parcelId) return;
      if (bag.parcels.includes(parcelId)) {
        signal('warn');
        setState((s) => (s.bag ? { ...s, bag: { ...s.bag, scan: '', lastAdded: parcelId } } : s));
        pushToast({ tone: 'info', icon: 'bag', title: t('agent.bag.alreadyIn'), detail: t('agent.bag.alreadyInDetail', { id: parcelId }) });
        return;
      }
      await addToBag(parcelId);
    },
    [addToBag, pushToast],
  );

  /**
   * Seal it. A short bag is REFUSED unless the shop knowingly leaves parcels — the server returns which
   * ones, and they light up on the list exactly as the handover screen's "waiting" rows do.
   */
  const sealBag = useCallback(
    async (opts?: { acknowledgeShortShip?: boolean; shortShipReason?: string; closure?: { seal?: string; photoRef: string } }) => {
      if (!client || !did) return;
      const bag = stateRef.current.bag;
      if (!bag || bag.sealed) return;
      await run('bag-seal', async () => {
        const r = await client.api.sealBag(did, bag.code, opts);
        if (r.error) {
          // Same shape the handover gate uses: the server names the parcels still on the shelf.
          const missed = Array.isArray(r.error.params?.missed) ? (r.error.params!.missed as string[]) : [];
          setState((s) => (s.bag ? { ...s, bag: { ...s.bag, missed } } : s));
          if (r.error.code === 'INCOMPLETE_MANIFEST') return; // the list explains it; no error banner needed
          return fail(r.error);
        }
        setState((s) => (s.bag ? { ...s, bag: { ...s.bag, sealed: true, missed: [] } } : s));
        pushToast({ tone: 'ok', icon: 'bag', title: t('agent.bag.toastSealed'), detail: t('agent.bag.toastSealedDetail', { count: bag.parcels.length }) });
        await loadShopParcels();
        await loadBagPlan();
      });
    },
    [client, did, run, fail, pushToast, loadShopParcels],
  );

  /** Put the bag away and start fresh (after the driver has taken it). */
  const clearBag = closeBagView;

  /**
   * THE BUS'S LIST (the user, 2026-10-18: "scan at the bus handover"): read with the driver's pass, the parcels this shop
   * must scan onto this bus — the same ones the server will hold the handover to.
   */
  const readBusList = useCallback(async (passOverride?: string) => {
    if (!client || !did) return;
    const pass = (passOverride ?? stateRef.current.handover.badge).trim().toUpperCase();
    if (!pass) return;
    setState((s) => ({ ...s, error: null, handover: { ...s.handover, badge: pass, listState: 'loading' } }));
    const r = await client.api.busList(did, pass);
    if (r.error) {
      signal('error');
      setState((s) => ({ ...s, handover: { ...s.handover, listState: 'idle', list: null } }));
      return fail(r.error);
    }
    const list = narrow<BusList>(r.data);
    setState((s) => ({ ...s, handover: { ...s.handover, list, listState: 'ready', selected: [], missed: [], scan: '', lastScanned: null } }));
    void loadShopParcels();
  }, [client, did, fail, loadShopParcels]);

  const setBusScan = useCallback((scan: string) => setState((s) => ({ ...s, handover: { ...s.handover, scan } })), []);

  /**
   * A parcel scanned at the bus — or tapped, where its sticker will not read. The green beep is the confirmation, the red
   * one stops a parcel for another bus from going on, at the moment it is in the shopkeeper's hand (busScan).
   */
  const scanForBus = useCallback(
    (override?: string) => {
      const h = stateRef.current.handover;
      if (!h.list) return;
      const id = (override ?? h.scan).trim().toUpperCase();
      if (!id) return;
      const said = busScan(h.list, h.selected, stateRef.current.shopParcels, id);
      if (said.kind === 'added') {
        signal('ok');
        setState((s) => ({ ...s, handover: { ...s.handover, selected: [...s.handover.selected, id], missed: s.handover.missed.filter((m) => m !== id), scan: '', lastScanned: id } }));
        return;
      }
      signal(said.kind === 'again' ? 'warn' : 'error');
      setState((s) => ({ ...s, handover: { ...s.handover, scan: '' } }));
      if (said.kind === 'again') pushToast({ tone: 'info', icon: 'truck', title: t('agent.handover.alreadyScanned', { id }) });
      else if (said.kind === 'otherBus') pushToast({ tone: 'warn', icon: 'warning', title: t('agent.handover.notThisBus', { id, zone: said.zone }), detail: t('agent.handover.notThisBusDetail') });
      else pushToast({ tone: 'warn', icon: 'warning', title: t('agent.handover.notWaitingHere', { id }) });
    },
    [pushToast],
  );

  const submitHandover = useCallback(async (shortShipReason?: string) => {
    if (!client || !did) return;
    const f = stateRef.current.handover;
    if (!f.badge.trim() || f.selected.length === 0) return;
    const acknowledge = typeof shortShipReason === 'string';
    await run('handover', async () => {
      // Driver badges are DRV-<uppercase hex>, resolved by a case-sensitive Map (byBadge).
      const r = await client.api.handover(
        did,
        f.badge.trim().toUpperCase(),
        f.selected,
        acknowledge ? { acknowledgeShortShip: true, shortShipReason } : undefined,
      );
      if (r.error) {
        // The completeness gate: don't treat it as a dead failure — reconcile the list and show the
        // agent which parcels for this bus are still waiting, so they can load them or short-ship. The
        // on-screen warn Note (+ the read-aloud foot) carries the guidance, so leave the generic
        // ErrorNote banner cleared — one message, not two.
        if (r.error.code === 'INCOMPLETE_MANIFEST') {
          const missed = Array.isArray(r.error.params?.missed) ? (r.error.params!.missed as string[]) : [];
          await loadShopParcels();
          setState((s) => ({ ...s, error: null, handover: { ...s.handover, missed } }));
          return;
        }
        // Reconcile the list (some parcels may have moved), then explain.
        await loadShopParcels();
        fail(r.error);
        return;
      }
      buzz();
      const v = narrow<HandoverView>(r.data);
      const left = v?.missed?.length ?? 0;
      // Round 38 — left at the counter because the rider carries the most a new rider may: said as that, not as missing.
      const capped = v?.rejected?.filter((x) => x.reason === 'custody_cap').length ?? 0;
      setState((s) => ({ ...s, handover: { ...EMPTY_HANDOVER }, screen: 'home' }));
      pushToast({
        tone: left ? 'warn' : 'ok',
        icon: 'truck',
        title: t('agent.toast.onBusTitle', { count: v?.handed?.length ?? f.selected.length }),
        detail: capped
          ? t('agent.toast.onBusCapped', { count: capped })
          : left
          ? t('agent.toast.onBusLeft', { count: left })
          : v?.vehicle
            ? t('agent.toast.onBusLoaded', { vehicle: v.vehicle })
            : undefined,
      });
      await refresh();
      if (v?.driverDid) void openRateDriver(v.driverDid); // REP2 — offer to rate the driver for this pickup
    });
  }, [client, did, run, fail, pushToast, refresh, loadShopParcels, openRateDriver]);

  // `override` carries a freshly scanned value: a camera read sets state AND calls here in
  // the same tick, and stateRef has not caught up yet, so the scan passes its value in.
  const findRelease = useCallback(async (override?: string) => {
    if (!client) return;
    // Parcel ids are uppercase and resolved by a case-sensitive Map — a typed lowercase
    // sticker would otherwise read as "not found".
    const id = (override ?? stateRef.current.release.stickerId).trim().toUpperCase();
    if (!id) return;
    await run('find', async () => {
      const r = await client.api.parcel(id);
      if (r.error) {
        setRelease({ parcel: null });
        return fail(r.error);
      }
      setRelease({ parcel: narrow<ParcelView>(r.data), otp: '', stars: 0 });
    });
  }, [client, run, fail, setRelease]);

  /** Round 27 — the label of a parcel this shop took in, as a file for its thermal label printer (ZPL). */
  const thermalLabel = useCallback(async (parcelId: string) => {
    if (!client || !did) return;
    await run('thermal', async () => {
      const r = await client.api.labelZpl(did, parcelId);
      if (r.error) return fail(r.error);
      downloadZpl(`label-${parcelId}`, String(r.data ?? ''));
    });
  }, [client, did, run, fail]);

  const markArrived = useCallback(async () => {
    if (!client || !did) return;
    const f = stateRef.current.release;
    if (!f.parcel) return;
    await run('arrive', async () => {
      const r = await client.api.arrive(f.parcel!.parcelId, did);
      if (r.error) return fail(r.error);
      buzz();
      // No code comes back: the customer's pickup code was minted with the parcel and is held by the
      // sender + receiver, never by the shop about to hand the goods over.
      const again = await client.api.parcel(f.parcel!.parcelId);
      setRelease({ parcel: again.error ? f.parcel : narrow<ParcelView>(again.data) });
      const slot = narrow<{ binSlot?: string }>(r.data)?.binSlot;
      pushToast({ tone: 'ok', icon: 'box', title: t('agent.toast.arrived'), detail: slot ? t('agent.toast.arrivedAt', { slot }) : t('agent.toast.arrivedDetail') });
    });
  }, [client, did, run, fail, pushToast, setRelease]);

  const submitPickup = useCallback(async () => {
    if (!client || !did) return;
    const f = stateRef.current.release;
    if (!f.parcel || !otpValid(f.otp)) return;
    await run('pickup', async () => {
      const r = await client.api.pickup(f.parcel!.parcelId, did, f.otp.trim(), f.photoRef || undefined);
      if (r.error) return fail(r.error);
      buzz();
      const again = await client.api.parcel(f.parcel!.parcelId);
      setRelease({ parcel: again.error ? f.parcel : narrow<ParcelView>(again.data), otp: '' });
      pushToast({ tone: 'ok', icon: 'check', title: t('agent.toast.delivered'), detail: t('agent.toast.deliveredDetail') });
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
      // BOTH slices. The counter's code field lives on `collect` now even for a peer send, so clearing
      // only `release` would leave the next customer's screen pre-filled with the last one's code — and
      // the first thing that screen does with a code is decide which kind of hand-over this is.
      setState((s) => ({ ...s, release: { ...EMPTY_RELEASE }, collect: { ...EMPTY_COLLECT }, screen: 'home' }));
      pushToast({ tone: 'ok', icon: 'star', title: t('agent.toast.thankYou'), detail: t('agent.toast.thankYouDetail') });
    });
  }, [client, run, fail, pushToast]);

  const findCollect = useCallback(async (override?: string) => {
    if (!client || !did) return;
    // Collection codes are COL-<uppercase hex> and matched case-sensitively server-side.
    const code = (override ?? stateRef.current.collect.code).trim().toUpperCase();
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

  /**
   * THE COUNTER'S ONE ENTRY: whatever the customer just handed over, in code form.
   *
   * Routing on the SHAPE rather than by trying a lookup and falling back. A speculative
   * "search for it as an order, and if that misses treat it as a peer send" would spend a network round
   * trip to learn something the string already says, and would report a mistyped order code as a missing
   * parcel — sending a shopkeeper to search a shelf for something that was never lost.
   *
   * A peer-send code resolves nothing on its own and must not appear to: it stays a second factor, so
   * this only carries it into the release form and lets the shopkeeper find the parcel.
   */
  const handOver = useCallback(
    async (override?: string) => {
      const code = (override ?? stateRef.current.collect.code).trim().toUpperCase();
      if (!code) return;
      const route = handoverRoute(code);
      if (route === 'unknown') return; // the screen already says why; nothing to ask the network
      if (route === 'order') {
        setCollect({ code });
        await findCollect(code);
        return;
      }
      // A peer send: keep the code for the OTP step so the shopkeeper never types it twice, and clear any
      // order lookup left over from a previous customer at the same counter.
      setState((s) => ({
        ...s,
        collect: { ...s.collect, code, found: null },
        release: { ...s.release, otp: code },
      }));
    },
    [findCollect, setCollect],
  );

  const confirmCollect = useCallback(async () => {
    if (!client || !did) return;
    const f = stateRef.current.collect;
    if (!f.found) return;
    await run('collect-confirm', async () => {
      const r = await client.api.collectConfirm(f.found!.parcel.parcelId, did, f.code.trim());
      if (r.error) return fail(r.error);
      buzz();
      setState((s) => ({ ...s, collect: { ...EMPTY_COLLECT }, screen: 'home' }));
      pushToast({ tone: 'ok', icon: 'check', title: t('agent.toast.handedOver'), detail: t('agent.toast.handedOverDetail') });
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
      // What the server did with it: where nobody of ours decides anything the report is made on the spot and the
      // parcel can still be handed over — the customer is standing there, and the shop has to know which it is.
      const recorded = narrow<{ dispute?: { decision?: string } }>(r.data)?.dispute?.decision === 'report_only';
      pushToast({ tone: 'info', icon: 'warning', title: t(recorded ? 'agent.toast.problemRecorded' : 'agent.toast.disputeFiled'), detail: t(recorded ? 'agent.toast.problemRecordedDetail' : 'agent.toast.disputeFiledDetail') });
    });
  }, [client, did, run, fail, pushToast]);

  /** Round 36 — the bag scanned: how it was closed (never its seal's number), and whether it is held. */
  const lookBag = useCallback(async (override?: string) => {
    if (!client) return;
    const code = (override ?? stateRef.current.receivebag.code).trim().toUpperCase();
    if (!code) return;
    setState((s) => ({ ...s, error: null, receivebag: { code, bag: undefined } }));
    const r = await client.api.bag(code);
    if (r.error) {
      signal('error');
      setState((s) => ({ ...s, receivebag: { ...s.receivebag, bag: null } }));
      return fail(r.error);
    }
    const v = narrow<{ closedWith?: BagClosedWith; held?: UnitHold }>(r.data);
    setState((s) => (s.receivebag.code === code ? { ...s, receivebag: { ...s.receivebag, bag: { ...(v?.closedWith ? { closedWith: v.closedWith } : {}), ...(v?.held ? { held: v.held } : {}) } } } : s));
  }, [client, fail]);

  /**
   * Round 36 — RECEIVED ON ITS SEAL, before it is opened. Answers with the refusal's code where the screen acts on it:
   * a seal not the one it was closed with (read again, or report it), not as closed (report it first).
   */
  const submitReceiveBag = useCallback(async (receipt: { sealNumber?: string; photoRef: string; asClosed: boolean }): Promise<string | null> => {
    if (!client || !did) return null;
    const code = stateRef.current.receivebag.code.trim().toUpperCase();
    if (!code) return null;
    let refused: string | null = null;
    await run('receivebag', async () => {
      const r = await client.api.receiveBag(did, code, receipt);
      if (r.error) {
        signal('error');
        refused = r.error.code;
        if (r.error.code === 'SEAL_MISMATCH') return setState((s) => ({ ...s, receivebag: { ...s.receivebag, mismatch: receipt.sealNumber ?? '' } }));
        if (r.error.code === 'TAMPER_REPORT_FIRST') return;
        return fail(r.error);
      }
      signal('ok');
      const v = narrow<ReceiveBagView>(r.data);
      // WHERE EACH ONE GOES, before anything else: the shop is holding the parcels now. It stays on this screen
      // until they say the parcels are in; rating the driver waits for that (donePutAway).
      const putAway = putAwayList(v?.shelved ?? []);
      setState((s) => (putAway.length ? { ...s, receivebag: { code: '', putAway, driverDid: v?.driverDid } } : { ...s, receivebag: { code: '' }, screen: 'home' }));
      pushToast({
        tone: 'ok',
        icon: 'bag',
        title: t('agent.toast.bagReceived'),
        detail: putAway.length ? t('agent.toast.bagPutAway') : t('agent.toast.bagReceivedDetail', { count: v?.delivered?.length ?? 0 }),
      });
      await refresh();
      if (!putAway.length && v?.driverDid) void openRateDriver(v.driverDid); // REP2 — offer to rate the driver for this arrival
    });
    return refused;
  }, [client, did, run, fail, pushToast, refresh, openRateDriver]);

  /** Round 36 — a bag not as it was closed: held, operations told. True when the server took it (or keeps it for a signal). */
  const reportBag = useCallback(async (body: { finding: 'seal_not_as_written' | 'seal_broken' | 'wrap_cut'; numberRead?: string; photoRefs: string[]; note?: string }): Promise<boolean> => {
    if (!client) return false;
    const code = stateRef.current.receivebag.code.trim().toUpperCase();
    if (!code) return false;
    let ok = false;
    await run('bag-report', async () => {
      const r = await client.api.reportBagTamper(code, body);
      if (r.error) {
        signal('error');
        return fail(r.error);
      }
      signal('ok');
      ok = true;
      if (r.status === 202) return pushToast({ tone: 'warn', icon: 'offline', title: t('agent.toast.tamperQueued'), detail: t('agent.toast.tamperQueuedDetail') });
      pushToast({ tone: 'warn', icon: 'warning', title: t('agent.toast.bagHeld', { code }), detail: t('agent.toast.bagHeldDetail') });
      const v = narrow<{ held?: UnitHold }>(r.data);
      setState((s) => ({ ...s, receivebag: { ...s.receivebag, mismatch: undefined, bag: { ...(s.receivebag.bag ?? {}), ...(v?.held ? { held: v.held } : {}) } } }));
    });
    return ok;
  }, [client, run, fail, pushToast]);

  /** The parcels out of the bag are in their slots: back to the shop's home, and only now the question about the driver. */
  const donePutAway = useCallback(() => {
    const driverDid = stateRef.current.receivebag.driverDid;
    setState((s) => ({ ...s, receivebag: { code: '' }, screen: 'home' }));
    if (driverDid) void openRateDriver(driverDid);
  }, [openRateDriver]);

  /**
   * Reverse logistics (compendium Ch 16.1): undo a drop-off inside the 5-minute window with
   * a photo of the torn label, and the wallet is refunded. The server is the real clock —
   * WINDOW_EXPIRED / WRONG_PUDO come back as typed errors and fire the red signal, so a
   * worker who was a second too late hears it.
   */
  const submitVoid = useCallback(async () => {
    if (!client || !did) return;
    const { parcelId, photoRef } = stateRef.current.void;
    if (!parcelId || !photoRef) return;
    await run('void', async () => {
      const r = await client.api.voidParcel(parcelId, did, photoRef);
      if (r.error) {
        signal('error');
        await loadShopParcels();
        return fail(r.error);
      }
      signal('ok');
      setState((s) => ({ ...s, void: { parcelId: null, photoRef: '' }, screen: 'home' }));
      pushToast({ tone: 'ok', icon: 'refresh', title: t('agent.toast.dropoffUndone'), detail: t('agent.toast.dropoffUndoneDetail') });
      await refresh();
    });
  }, [client, did, run, fail, pushToast, refresh, loadShopParcels]);

  /**
   * Round 35 — A PARCEL FOUND CUT OR OPENED (the tamper protocol): held here, SeeBuyGet operations told, the store told.
   * With no signal it waits on this phone with its photograph, dated now (outbox.ts), and is sent when the signal comes.
   */
  const submitTamper = useCallback(async () => {
    if (!client) return;
    const { parcelId, photoRef, note } = stateRef.current.tamper;
    if (!parcelId.trim() || !photoRef) return;
    await run('tamper', async () => {
      const r = await client.api.reportTamper(parcelId.trim(), { photoRefs: [photoRef], ...(note.trim() ? { note: note.trim() } : {}), observedAt: new Date().toISOString() });
      if (r.error) {
        signal('error');
        return fail(r.error);
      }
      signal('ok');
      if (r.status === 202) {
        setState((s) => ({ ...s, tamper: { parcelId: '', photoRef: '', note: '', done: null } }));
        return pushToast({ tone: 'warn', icon: 'offline', title: t('agent.toast.tamperQueued'), detail: t('agent.toast.tamperQueuedDetail') });
      }
      const done = (r.data as unknown as TamperUnit) ?? null;
      setState((s) => ({ ...s, tamper: { ...s.tamper, done } }));
      pushToast({ tone: 'warn', icon: 'warning', title: t('agent.toast.tamperReported'), detail: t('agent.toast.tamperReportedDetail') });
      await loadShopParcels();
    });
  }, [client, run, fail, pushToast, loadShopParcels]);

  return {
    state,
    // The raw client, for the shared account menu — the account is the PERSON, so the surface behind it
    // is the same one every other app talks to and this app holds no opinion about it.
    sbg: client?.client.sbg ?? null,
    did,
    // The Web Push controls (N1b) — surfaced for the TopBar NotificationBell; null while signed out.
    notifications: client?.notifications ?? null,
    actions: {
      /** The same controls, inside actions so a SCREEN can ask for permission where somebody sees the ask. */
      notifications: client?.notifications ?? null,
      refresh,
      signIn,
      confirmDevice,
      cancelDeviceAsk,
      enterAsStaff,
      shopDevices,
      people,
      signOut,
      adoptToken,
      forgot,
      reset,
      go,
      queryHistory,
      loadHistory,
      exportHistory,
      queryLedger,
      loadEarnings,
      exportLedger,
      setAccept,
      setDims,
      deriveSize,
      setAddress,
      setDestMode,
      markDestNear,
      pickDest,
      geocodeAddress,
      geocodePlace,
      setHandover,
      toggleHandover,
      readBusList,
      setBusScan,
      scanForBus,
      setRelease,
      setCollect,
      setReceiveBag,
      lookBag,
      reportBag,
      topUp,
      setOpen,
      setPrice,
      loadShelf,
      saveShelf,
      saveBagBays,
      loadMedia,
      setLocationPin,
      saveHours,
      sendPapers,
      sendLicenceRenewal,
      saveShopfront,
      submitAccept,
      /** CV1 — the conversations API for this shop (null until signed in). */
      chatApi: client?.conversations ?? null,
      setTermsTold,
      retryTerms,
      dismissAcceptedLabel,
      dismissLateTakeIn,
      submitBookFreight,
      dismissBookedFreight,
      loadPosted,
      loadOffers,
      loadMyBookings,
      cancelMyBooking,
      raiseBookingClaim,
      openOffer,
      clearOfferQuote,
      quoteOffer,
      bookOffer,
      openPrices,
      /** FP2 — the consignment note of one of this shop's loads, as a page. */
      freightNote: (freightId: string) => client!.api.freightNote(freightId),
      acceptPrice,
      declinePrice,
      cancelFreight,
      rateFreight,
      setFreightInstructions,
      decideRefusal,
      openFreightClaim,
      loadConsignments,
      openConsignment,
      depositConsignment,
      setIntakePhoto,
      retryPreview,
      submitIntake,
      dismissIntakeDone,
      submitHandover,
      loadBagPlan,
      openBag,
      addToBag,
      setBagScan,
      submitBagScan,
      sealBag,
      clearBag,
      findRelease,
      markArrived,
      thermalLabel,
      submitPickup,
      submitRating,
      findCollect,
      handOver,
      confirmCollect,
      submitDispute,
      submitReceiveBag,
      donePutAway,
      openVoid,
      setVoidPhoto,
      submitVoid,
      setTamper,
      submitTamper,
      openRateDriver,
      submitDriverRating,
      dismissRateDriver,
      uploadPhoto,
      pushToast,
      dismissToast,
      readEmail,
    },
  };
}

export type AgentActions = ReturnType<typeof useAgentApp>['actions'];
