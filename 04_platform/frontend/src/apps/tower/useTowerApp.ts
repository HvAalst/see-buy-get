import { FLEET_PAPERS, fleetBody, type FleetForm, type FleetPaperKey, type FleetSetupRow } from './fleets';
import type { CaseBoard, CaseKindCount, CaseListName, FlagCaseRow } from './cases';
import type { LostParcelRow } from './lost';
import type { MoveRow } from './accountMoves';
import type { PaperCase } from './paperReports';
import type { DisputeRow } from './idDisputes';
import type { BusinessRow } from './businesses';
import type { CourierContact, PapersNetworkView } from './papers';
import type { MoversView } from './movers';
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { narrow, type SbgError } from '../../lib/sbg';
import { downscaleImage } from '../../shared/media';
import { t } from '../../shared/i18n'; // plain t(): these strings are built at action time
import { changeCompanyPassword, changeStaffPassword, clearCreds, companyLogin, createTowerClient, myStaffAccount, readCreds, saveCreds, staffLogin, type TowerClient, type TowerCreds, type TwoStepSetup } from './api';
import type { ConstraintView } from './logic';
import type { EntityPricing, EntityRow } from './money';
import type { ApprovalRow, ClaimDecision, ClaimRow, DamageReportRow, DisposalRow, DriverApplication, FreightClaimRow, StalledRow } from './queues';
import { triggerDownloadBlob } from '../../shared/download';
import { EMPTY_CORRIDOR_FORM, corridorName, type CorridorForm, type CorridorRow, type CouplingRow } from './corridors';
import type { DisputeReportRow, ReportRow } from './reports';
import { EMPTY_COUNTRY_FORM, newCountryCode, overridesOf, type CatalogueCountry, type InterestCountry, type NewCountryForm, type PresenceLevel, type PresenceProposalRow, type PresenceRow } from './presence';
import type { ExpiringItem } from './company';
import type { AgentRow, CoverageCounts, FlagRow, HubRow, ToteRow } from './network';
import { runSummary, type FundingAction, type FundingRow, type PayoutAction, type PayoutRow, type RunResult, type UnmatchedRow } from './settlement';
import type { HelpOption } from './pictures';
import { approvedSays } from './connections';
import { staffListOf } from './staff';
import { resolveBaseUrl } from '../../lib/sbg';

export type Phase = 'boot' | 'signin' | 'ready' | 'outdated';
export type Screen = 'network' | 'pilot' | 'stores' | 'cases' | 'hazards' | 'claims' | 'disposal' | 'approvals' | 'businesses' | 'accountmoves' | 'iddisputes' | 'paperreports' | 'papers' | 'imports' | 'market' | 'movers' | 'reports' | 'support' | 'pictures' | 'money' | 'rates' | 'companies' | 'company' | 'corridors' | 'borders' | 'presence' | 'depots' | 'settings' | 'connections';

export interface TowerState {
  phase: Phase;
  screen: Screen;
  creds: TowerCreds | null;
  /** WHO the network says this is, once a token exists. Drives the rail: an operator sees the whole
   *  network, a company administrator sees their own company and whatever sits under it. */
  who: { mode: 'operator' | 'company'; name: string; entityId?: string; /** The name came from an account, not from a field beside the shared key. */ named?: boolean; /** The setup key, on a server where it only sets staff up: the console shows that one screen. */ setupOnly?: boolean } | null;
  /** The disputed queue, longest wait first — the server's order, kept as it arrives. */
  hazards: ConstraintView[] | null;
  /** The automatic flags as cases, the most pressing first; how many nobody has taken. Null while unread. */
  cases: FlagCaseRow[] | null;
  casesWaiting: number | null;
  /** How many there are of what is shown (more than `cases` when the list was cut), and how many of each kind. */
  casesTotal: number | null;
  caseKinds: CaseKindCount[] | null;
  /** What the list shows: the live cases or the closed ones, of every kind or of one. */
  caseWhich: CaseListName;
  caseKind: string | null;
  /** The case an act is being done on, and what the server said when it refused. */
  caseBusy: string | null;
  caseError: string | null;
  /** Parcels declared lost, and found again in the last thirty days (lost.ts). Null while unread. */
  lostParcels: LostParcelRow[] | null;
  /** CV1 — messages a party reported in a conversation. Null while unread. */
  reports: ReportRow[] | null;
  /** CV3 — dispute reports a party shared. Null while unread. */
  disputeReports: DisputeReportRow[] | null;
  loading: boolean;
  /** A failed READ. The screen keeps whatever it last knew and says the read failed. */
  error: SbgError | null;
  signInError: string | null;
  /** Something the sign-in screen should say that is not a refusal: the session ended, the password changed. */
  signInNote: string | null;
  /**
   * The second half of a staff sign-in, when the server asked for it: the code from the authenticator app, or —
   * the first time, where it is required — a secret to scan and then the first code.
   */
  staffStep: { kind: 'code' } | ({ kind: 'setup' } & TwoStepSetup) | null;
  /** Whether the signed-in member of staff has two-step sign-in. Null for anybody else. */
  staffTwoStep: boolean | null;
  /** constraintId of the row whose clear form is open. */
  openId: string | null;
  /** constraintId currently being cleared — single-flight, so a double-click cannot clear twice. */
  busyId: string | null;
  clearError: SbgError | null;
  /** The last thing this session did, kept on screen until the next action replaces it. */
  done: string | null;
  readAt: number | null;

  /* ---- what each sister charges (the rates screen) ---- */
  entities: EntityRow[] | null;
  /** Which sister is being looked at. Null until the list arrives and the first one is chosen. */
  entityId: string | null;
  pricing: EntityPricing | null;
  /** What each rate DID: the spells either side of every change. Null when it has not been read. */
  rateImpact: RateImpactView | null;
  /** A refused SAVE, which is a different thing from a failed read and must not clear the form. */
  saveError: SbgError | null;

  /* ---- the network at a glance (migrated from the vanilla tower) ---- */
  dashboard: DashboardView | null;
  agents: AgentRow[] | null;
  hubs: HubRow[] | null;
  totes: ToteRow[] | null;
  coverage: CoverageCounts | null;

  /* ---- the operator's decision queues (migrated from the vanilla tower) ---- */
  claims: ClaimRow[] | null;
  /** FP3b — claims against delivered freight, read with the parcel ones and counted with them. */
  freightClaims: FreightClaimRow[] | null;
  /** The damage claim reports made, newest first. `null` while unread or when the read failed. */
  damageReports: DamageReportRow[] | null;
  disposal: DisposalRow[] | null;
  approvals: ApprovalRow[] | null;
  /** B1 — customers' businesses, those waiting on a check first. Null while unread, like every queue. */
  businesses: BusinessRow[] | null;
  /** Requests to move an account for somebody who has lost number, PIN and inbox. Two of us decide each. Null while unread. */
  accountMoves: MoveRow[] | null;
  /** Two people say one national ID is theirs. Null while unread. */
  idDisputes: DisputeRow[] | null;
  /** A company's paper somebody reported as not right. One of us dismisses; two strike. Null while unread. */
  paperReports: PaperCase[] | null;
  /** Shops that started signing up and stopped — read beside the applications, counted with none of
   *  them. Null while unread, like every other list here. */
  stalled: StalledRow[] | null;
  /** Heavy-registry drivers waiting to be vetted. A real queue — somebody is waiting on US — and it had
   *  no screen at all until now, though the route has been live the whole time. Null while unread. */
  driverApplications: DriverApplication[] | null;
  /** Every fleet and where it stands in being set up — a fleet is set up by staff, here. Null while unread. */
  fleets: FleetSetupRow[] | null;
  /** What the last act on a fleet came to, said in the fleets panel itself and not at the top of the screen. */
  fleetNote: { tone: 'ok' | 'err'; text: string } | null;
  /** A refusal the SCREEN made before the server had to — a missing reason, an award over the cover. */
  queueError: string | null;
  /** CL4 — who moves loads, with the operator-only half. Null while unread. */
  movers: MoversView | null;
  /** FP4 — the papers only network staff can put right, and when the check last ran. Null while unread. */
  papers: PapersNetworkView | null;

  /* ---- support: one parcel, looked up because somebody is on the phone about it ---- */
  lookup: ParcelView | null;
  /** A freshly rotated release code. Held until dismissed BY HAND — see the support screen. */
  reissued: { kind?: string; otp?: string } | null;

  /* ---- presence: how established the network is, country by country ---- */
  /** Every country with a company, plus every one an operator has decided about. Null while unread. */
  presence: PresenceRow[] | null;
  /** CA — who is waiting for a country we do not reach, by country. The evidence a switch-on is made on. */
  interest: InterestCountry[] | null;
  /** The row being changed. `level` empty means 'whatever that country already stands at'. */
  presenceForm: { level: PresenceLevel | ''; note: string; incoterms?: { origin: string[]; destination: string[] } };
  /** Recording a country that is not on the map yet — the only way the FIRST country we are not in gets one. */
  countryForm: NewCountryForm;
  /** CA1 — every country that exists. Null while unread. */
  catalogue: CatalogueCountry[] | null;
  /** CA2 — changes waiting for a second person, and the ones decided. Null while unread. */
  proposals: PresenceProposalRow[] | null;

  /* ---- the corridors: the routes the network runs buses on ---- */
  /** Every corridor, live and blocked. Null while unread. */
  corridors: CorridorRow[] | null;
  /** Every shift running now — read only to say how many are on a corridor before it is closed. */
  couplings: CouplingRow[] | null;
  corridorForm: CorridorForm;
  /* ---- the illustration library ---- */
  help: HelpOption[] | null;
  helpTopic: string;
  /** The API origin, so a picture served by the backend can be shown by a plain <img>. */
  apiBase: string;

  /* ---- money: the selected company's books and payouts, and the network ledger ---- */
  books: BooksView | null;
  payouts: PayoutRow[] | null;
  /** Money coming IN: what shops and stores have asked to pay, newest first. Null until read. */
  funding: FundingRow[] | null;
  /** …and what arrived with nobody's name on it. Staff only; never posted to any book. */
  unmatched: UnmatchedRow[];
  finance: FinanceView | null;

  /* ---- the companies, side by side (the group's view) ---- */
  companies: CompanyRow[] | null;
  /** Who administers the company being looked at, and the ONE-TIME password a new login just produced. */
  admins: EntityAdminRow[] | null;
  newAdmin: (EntityAdminRow & { password: string }) | null;
  /** CA3 — which company's record is open. Null until one is chosen. */
  companyId: string | null;
  /** CA5 — licences and policies lapsing across every company. Null while unread, or for a company administrator. */
  expiring: ExpiringItem[] | null;
}

/** One company on the side-by-side view: what it charges, and what its books say. */
export interface CompanyRow {
  entity: EntityRow;
  pricing: EntityPricing | null;
  books: BooksView | null;
}

export interface EntityAdminRow {
  adminId: string;
  email: string;
  name: string;
  entityId: string;
  createdAt: string;
  lastSeenAt?: string;
}

/** `GET /entities/:id/books` is untyped in the contract; these are the fields the overview reads. */
export interface BooksView {
  entityId: string;
  integrity: { balanced: boolean; drift: number };
  coverage: { currency: string; held: number; lent: number; owed: number; cover: number };
}

/** `GET /parcels/:id` is untyped in the contract; these are the fields the support screen reads. */
export interface ParcelView {
  parcelId: string;
  status: string;
  size?: string;
  origin?: string;
  destination?: string;
  /** WHO ANSWERS for these goods, decided when they were taken in. Absent on parcels born before the
   *  ladder existed, which is a real state: nobody asked the question then. */
  takeInPromise?: 'ours' | 'theirs';
  releaseLockedAt?: string;
  contentPhotoRef?: string;
  dropoffPhotoRef?: string;
  deliveredPhotoRef?: string;
  scans?: Array<{ at: string; status: string; note?: string }>;
}

/** `GET /finance` is untyped in the contract; these are the fields the screen reads. */
export interface FinanceView {
  /** One float PER CURRENCY. There is deliberately no total: two sisters settle in different money. */
  floats?: Array<{ currency: string; amount: number }>;
  currency?: string;
  todayRevenue?: number;
  recentLedger?: Array<{ id: string; type: string; sign: '+' | '-'; amount: number; currency?: string; reference?: string; at: string }>;
}

/** `GET /dashboard` is untyped in the contract; these are the fields the screen reads. */
export interface DashboardView {
  parcelsInTransit?: number;
  agentsOnline?: number;
  agentsTotal?: number;
  agentRetention?: number;
  systemFloat?: number;
  criticalAlerts?: number;
  statusMix?: Record<string, number>;
  flags?: FlagRow[];
}

/** `GET /entities/:id/rate-impact` is untyped in the contract; these are the fields the screen reads. */
export interface RateImpactView {
  currentPct: number;
  currency?: string;
  spells: { feePct: number; shipments: number; gross: number; margin: number; avgMargin: number; from: string; to: string }[];
  /** Shipments carrying no margin at all — walk-up cash, priced by a different product. */
  unpriced: number;
}

export interface TowerActions {
  signIn(name: string, key: string): Promise<void>;
  /** FP4 — the papers only network staff can put right: a courier's renewed licence, a fleetless vehicle's papers, and the check run now. */
  recordCourierLicence(did: string, body: { number?: string; expiresAt: string }, name: string): Promise<void>;
  /** FP4 — the card a courier sent is not accepted, with the reason they are shown. */
  refuseLicenceRenewal(did: string, reason: string, name: string): Promise<void>;
  /** FP4 — how to reach ONE courier: a receipted look in the vault, asked when their sheet opens. */
  courierContact(did: string): Promise<{ contact: CourierContact | null; error: string | null }>;
  recordVehiclePapers(vehicleId: string, documents: { insuranceRef?: string; insuranceExpiresAt?: string; inspectionRef?: string; inspectionExpiresAt?: string }, plate: string): Promise<void>;
  runPapersSweep(): Promise<void>;
  recordTransitAuthority(carrierDid: string, body: { country: string; reference: string; expiresAt: string }, name: string): Promise<void>;
  withdrawTransitAuthority(carrierDid: string, authorityId: string, reason: string): Promise<void>;
  signInAsCompany(email: string, password: string): Promise<void>;
  /** A member of network staff, with an account of their own: the password, then — when asked — the authenticator's code. */
  signInAsStaff(email: string, password: string, code?: string): Promise<void>;
  /** Back from the code step to the password, e.g. to correct the email. */
  cancelStaffStep(): void;
  /** Two-step sign-in was just turned on from Settings. */
  noteStaffTwoStep(on: boolean): void;
  addAdmin(entityId: string, email: string, name: string): Promise<void>;
  dismissNewAdmin(): void;
  /** A company administrator changes their password; null when done, else the refusal to show. */
  changeCompanyPassword(current: string, next: string): Promise<string | null>;
  revokeAdmin(entityId: string, adminId: string): Promise<void>;
  signOut(): void;
  go(screen: Screen): void;
  /** Take a case, let it go, note it, or close it with a reason. True when the server took it. */
  caseAct(caseId: string, act: 'take' | 'let-go' | 'note' | 'done', body?: Record<string, unknown>): Promise<FlagCaseRow | null>;
  /** Show the live cases or the closed ones, of every kind (null) or of one. */
  caseFilter(which: CaseListName, kind: string | null): void;
  /** Declare a parcel lost after a search, or mark a lost one found. True when the server took it. */
  lostAct(parcelId: string, act: 'lost' | 'found', words: string): Promise<boolean>;
  setPresenceForm(patch: Partial<{ level: PresenceLevel; note: string; incoterms: { origin: string[]; destination: string[] } }>): void;
  setCountryForm(patch: Partial<NewCountryForm>): void;
  recordCountry(): Promise<void>;
  savePresence(jurisdiction: string): Promise<void>;
  /** CA3 — open one company's record. */
  openCompany(entityId: string): void;
  /** A company's record changed, or one of its papers was reported: re-read what the numbers in the menu are counted from. */
  recordChanged(): void;
  /** CA3/CA7 — create a draft company of ours or a partner; true when it was created. */
  createCompany(kind: 'sister' | 'partner', jurisdiction: string, name: string): Promise<boolean>;
  /** The API client, for a screen that owns its own reads (the company record). Null before sign-in. */
  client(): TowerClient | null;
  /** CA2 — the second person approves a change. The server refuses the proposer; so does the screen. */
  approveProposal(proposalId: string): Promise<void>;
  declineProposal(proposalId: string, reason: string): Promise<void>;
  setCorridorForm(patch: Partial<CorridorForm>): void;
  saveCorridor(): Promise<void>;
  setCorridorStatus(corridorId: string, status: 'active' | 'blocked'): Promise<void>;
  /** F2 — make a fleet's proposed line real. */
  publishCorridor(corridorId: string): Promise<void>;
  /** CV4 — the bytes of a voice message a party put in a shared report, or null. */
  disputeVoice(reportId: string, voiceId: string): Promise<Blob | null>;
  refresh(): Promise<void>;
  /** Take the file of one damage claim report. */
  downloadDamageReport(parcelId: string): Promise<void>;
  open(rowId: string | null): void;
  clear(constraintId: string, reason: string, hazard: string): Promise<void>;
  resolveClaim(parcelId: string, decision: ClaimDecision, award: number | undefined, note: string): Promise<void>;
  /** FP3b — decide a freight claim; same three endings, same note. */
  resolveFreightClaim(freightId: string, decision: ClaimDecision, award: number | undefined, note: string): Promise<void>;
  closeDisposal(parcelId: string, reason: string): Promise<void>;
  /** `reason` is required by the server when refusing — the applicant is shown it. */
  decideApproval(did: string, approve: boolean, reason?: string): Promise<void>;
  /** Vet a heavy-registry driver. A refusal carries the reason the driver is shown. */
  /** `criminalRecordClear` is the vetting staff member's own tick — never the applicant's. */
  /** `asked`: the row was a driver in no fleet asking to ride for themselves — said so in what the screen confirms. */
  decideDriver(did: string, approve: boolean, reason?: string, criminalRecordClear?: boolean, asked?: boolean): Promise<void>;
  /** A fleet is set up by staff: register it, put its four papers on record, approve or send back, record its bond. */
  registerFleet(form: FleetForm): Promise<boolean>;
  putFleetPapers(did: string, pictures: Record<FleetPaperKey, string>): Promise<boolean>;
  decideFleet(did: string, approve: boolean, reason?: string): Promise<void>;
  recordFleetBond(did: string): Promise<void>;
  runPayouts(): Promise<void>;
  movePayout(payoutId: string, action: PayoutAction, reason?: string, providerRef?: string): Promise<void>;
  /** Move one funding request along. the provider reference is what a confirmation cannot do without. */
  moveFunding(fundingId: string, action: FundingAction, input?: { providerRef?: string; amount?: number; reason?: string }): Promise<void>;
  /** Say whose an unattributed payment was, and credit it. A judgement — the server records the name. */
  applyFunding(unmatchedId: string, payerKind: 'agent' | 'vendor', payerDid: string): Promise<void>;
  lookupParcel(parcelId: string): Promise<void>;
  reissueRelease(parcelId: string): Promise<void>;
  dismissReissued(): void;
  chooseHelpTopic(topic: string): Promise<void>;
  uploadPicture(topic: string, key: string, file: File): Promise<void>;
  revertPicture(topic: string, key: string): Promise<void>;
  /** Show what the screen itself refused, without pretending the server said it. */
  showQueueError(message: string): void;
  chooseEntity(entityId: string): Promise<void>;
  saveRates(body: { lane?: string; costOfRiskPct: number | null; profitOnRiskPct: number | null; marginPct: number | null }, lane?: string): Promise<void>;
  saveTax(body: { lane?: string; ratePct: number | null; label: string | null; registration: string | null }, lane?: string): Promise<void>;
  saveCover(body: { lane?: string; freeLimit: number | null; premiumPct: number | null }, lane?: string): Promise<void>;
  /** Sister-wide, so no lane: a top-up is not a lane of work. An empty body removes the fee. */
  saveTopUpFee(body: { amount?: number; freeAbove?: number }): Promise<void>;
  /** What a parcel costs and what each step pays at this company. Only the figures changed; null puts one back. */
  saveAmounts(body: Record<string, number | null>): Promise<void>;
  /** Which carrier papers this sister refuses to trade without. The whole list; empty enforces nothing. */
  saveCarrierPapers(enforce: Array<'operator_licence' | 'carrier_insurance'>): Promise<void>;
  /** Record the dates on one fleet operator's own papers — staff only. */
  recordCarrierPapers(did: string, body: { licenceExpiresAt?: string | null; licenceNumber?: string | null; insurancePolicy?: string | null; insuranceExpiresAt?: string | null }): Promise<boolean>;
  /** Turn down a document a fleet sent, with the reason the fleet is shown. */
  refuseCarrierPaper(did: string, kind: 'operator_licence' | 'carrier_insurance', reason: string): Promise<boolean>;
}

const INITIAL: TowerState = {
  phase: 'boot',
  // Network staff open on the overview: the first question an operator has is "is anything wrong",
  // and a console that opens on a queue answers a narrower one. A company administrator is moved to
  // its own screen at sign-in — the overview is not theirs.
  screen: 'network',
  creds: null,
  who: null,
  hazards: null,
  cases: null,
  lostParcels: null,
  casesWaiting: null,
  casesTotal: null,
  caseKinds: null,
  caseWhich: 'live',
  caseKind: null,
  caseBusy: null,
  caseError: null,
  reports: null,
  disputeReports: null,
  loading: false,
  error: null,
  signInError: null,
  signInNote: null,
  staffStep: null,
  staffTwoStep: null,
  openId: null,
  busyId: null,
  clearError: null,
  done: null,
  readAt: null,
  entities: null,
  entityId: null,
  pricing: null,
  rateImpact: null,
  saveError: null,
  companies: null,
  admins: null,
  newAdmin: null,
  companyId: null,
  expiring: null,
  claims: null,
  freightClaims: null,
  damageReports: null,
  disposal: null,
  approvals: null,
  businesses: null,
  accountMoves: null,
  idDisputes: null,
  paperReports: null,
  stalled: null,
  driverApplications: null,
  fleets: null,
  fleetNote: null,
  presence: null,
  interest: null,
  presenceForm: { level: '', note: '' },
  countryForm: { ...EMPTY_COUNTRY_FORM },
  catalogue: null,
  proposals: null,
  corridors: null,
  couplings: null,
  corridorForm: { ...EMPTY_CORRIDOR_FORM },
  queueError: null,
  lookup: null,
  reissued: null,
  help: null,
  helpTopic: 'packaging',
  apiBase: resolveBaseUrl(),
  books: null,
  payouts: null,
  funding: null,
  unmatched: [],
  finance: null,
  dashboard: null,
  agents: null,
  hubs: null,
  totes: null,
  coverage: null,
  movers: null,
  papers: null,
};

/**
 * The operator console's one hook.
 *
 * Deliberately without an offline story. The seven field apps queue writes and show what they last knew,
 * because a shop in a dead spot has no alternative; this console runs at a desk, and everything on it is
 * a queue somebody is about to act on. A cached list here would let an operator clear a dispute that was
 * resolved an hour ago from a screen that looked current. So there is no service worker, no outbox, and
 * a failed read says it failed.
 */
export function useTowerApp(): { state: TowerState; actions: TowerActions } {
  const [state, setState] = useState<TowerState>(INITIAL);
  const clientRef = useRef<TowerClient | null>(null);
  // The latest state, for callbacks that must not be re-created every time anything changes.
  const stateRef = useRef(state);
  stateRef.current = state;

  const loadHazards = useCallback(async (client: TowerClient) => {
    setState((s) => ({ ...s, loading: true }));
    const { data, error } = await client.api.disputedConstraints();
    if (error) {
      // 426 is the version handshake: the server is newer than this build. With no service worker in
      // the way, a plain reload is the whole fix — which is the honest upside of not installing.
      if (error.code === 'CLIENT_OUTDATED') {
        setState((s) => ({ ...s, phase: 'outdated', loading: false }));
        return;
      }
      setState((s) => ({ ...s, loading: false, error }));
      return;
    }
    const items = narrow<{ items: ConstraintView[]; total: number }>(data)?.items ?? [];
    setState((s) => ({ ...s, loading: false, error: null, hazards: items, readAt: Date.now() }));
  }, []);

  /** The flags as cases: read fresh, because a case escalates whether or not anybody is looking. */
  const loadCases = useCallback(async (client: TowerClient, which?: CaseListName, kind?: string | null) => {
    const w = which ?? stateRef.current.caseWhich;
    const k = kind === undefined ? stateRef.current.caseKind : kind;
    const { data, error } = await client.api.flagCases(w, k ?? undefined);
    if (error) {
      setState((s) => ({ ...s, caseError: error.detail || error.title }));
      return;
    }
    const list = narrow<CaseBoard>(data);
    // Read with the cases: a parcel declared lost from one leaves the list, and lands here.
    const lost = await client.api.lostParcels();
    setState((s) => ({
      ...s,
      cases: list?.items ?? [],
      casesWaiting: list?.waiting ?? 0,
      casesTotal: list?.total ?? 0,
      caseKinds: list?.kinds ?? [],
      caseError: null,
      lostParcels: lost.error ? s.lostParcels : (narrow<LostParcelRow[]>(lost.data) ?? []),
    }));
  }, []);

  /** FP4 — read fresh every time: a licence that lapsed since sign-in is exactly the row this screen is for. */
  /** CL4 — who moves loads, with the reasons and driver names the public page does not carry. */
  const loadMovers = useCallback(async (client: TowerClient) => {
    const { data, error } = await client.api.movers();
    if (error) {
      if (error.code === 'CLIENT_OUTDATED') setState((s) => ({ ...s, phase: 'outdated' }));
      else setState((s) => ({ ...s, error }));
      return;
    }
    setState((s) => ({ ...s, error: null, movers: narrow<MoversView>(data), readAt: Date.now() }));
  }, []);

  const loadPapers = useCallback(async (client: TowerClient) => {
    const { data, error } = await client.api.papersReport();
    if (error) {
      if (error.code === 'CLIENT_OUTDATED') setState((s) => ({ ...s, phase: 'outdated' }));
      else setState((s) => ({ ...s, error }));
      return;
    }
    setState((s) => ({ ...s, error: null, papers: narrow<PapersNetworkView>(data), readAt: Date.now() }));
  }, []);

  /**
   * Read one sister's whole pricing picture, and what its rates have done.
   *
   * Two calls rather than one because they answer different questions and fail independently: the knobs
   * are configuration and always exist, while the impact is history and a young sister has none. A screen
   * that lost its knobs because there were no shipments yet would be unusable on the day it was needed.
   */
  const loadPricing = useCallback(async (client: TowerClient, entityId: string) => {
    setState((s) => ({ ...s, loading: true, entityId }));
    void loadMoney(client, entityId);
    const [pricing, impact, admins] = await Promise.all([client.api.pricing(entityId), client.api.rateImpact(entityId), client.api.admins(entityId)]);
    if (pricing.error) {
      setState((s) => ({ ...s, loading: false, error: pricing.error }));
      return;
    }
    setState((s) => ({
      ...s,
      loading: false,
      error: null,
      pricing: narrow<EntityPricing>(pricing.data),
      // The impact is allowed to be missing without taking the screen down with it.
      rateImpact: impact.error ? null : narrow<RateImpactView>(impact.data),
      admins: admins.error ? null : (narrow<{ items: EntityAdminRow[] }>(admins.data)?.items ?? []),
      readAt: Date.now(),
    }));
  }, []);

  /**
   * Every company this caller reaches, with what it charges and what its books say.
   *
   * Read in PARALLEL per company and tolerant per company: a books read that fails takes that column's
   * money away, not the whole table. What it must never do is silently drop a company — a comparison
   * with a row missing is worse than one with a hole in it, because nothing on screen says it is short.
   */
  const loadCompanies = useCallback(async (client: TowerClient, rows: EntityRow[]) => {
    const results = await Promise.all(
      rows.map(async (entity) => {
        const [pricing, books] = await Promise.all([client.api.pricing(entity.entityId), client.api.books(entity.entityId)]);
        return {
          entity,
          pricing: pricing.error ? null : narrow<EntityPricing>(pricing.data),
          books: books.error ? null : narrow<BooksView>(books.data),
        };
      }),
    );
    // CA3 — the catalogue for creating a company. Network staff's alone: a company administrator would be refused
    // it, and a refusal is noise.
    const staff = stateRef.current.who?.mode === 'operator';
    const catalogue = staff ? await client.api.countryCatalogue() : null;
    setState((s) => ({
      ...s,
      companies: results,
      catalogue: !catalogue || catalogue.error ? s.catalogue : (narrow<{ items: CatalogueCountry[] }>(catalogue.data)?.items ?? []),
    }));
  }, []);

  /**
   * CA5 — the licences and policies that are running out, for whoever is signed in: every company's for network
   * staff, a company administrator's own (the server cuts the list to what they reach). Read for EVERYBODY, not only
   * for somebody who has the side-by-side view: an administrator of one company never sees that view, and is shown
   * how many of their papers need them beside their Company record.
   */
  const loadExpiring = useCallback(async (client: TowerClient) => {
    const expiring = await client.api.expiringCompanyPapers();
    setState((s) => ({ ...s, expiring: expiring.error ? null : (narrow<{ items: ExpiringItem[] }>(expiring.data)?.items ?? []) }));
  }, []);

  /** The papers somebody has reported — read by itself after a report, so the number beside the queue is true at once. A failed read keeps what was known. */
  const loadPaperReports = useCallback(async (client: TowerClient) => {
    const reports = await client.api.paperReports();
    setState((s) => ({ ...s, paperReports: reports.error ? s.paperReports : (narrow<{ items: PaperCase[] }>(reports.data)?.items ?? []) }));
  }, []);

  /**
   * What the selected company holds and owes, and what it has raised for the people it owes.
   *
   * Read beside the pricing rather than on the money screen alone: choosing a company is one act, and a
   * console that re-reads on every tab change makes the same question twice. The network ledger comes
   * with it and is network-wide — it belongs to no single company, which is why it is read once here
   * rather than per selection.
   */
  const loadMoney = useCallback(async (client: TowerClient, entityId: string) => {
    const staff = stateRef.current.who?.mode === 'operator';
    /*
     * THE NETWORK LEDGER IS ASKED FOR ONLY BY NETWORK STAFF.
     *
     * This used to be read on every load by everybody, so a company administrator's first act on opening
     * the console was a 403 the screen then swallowed. It was tracked as a known gap for weeks, which is
     * its own lesson: a refusal a screen handles quietly is still a screen asking for something it knows
     * it may not have.
     */
    const [books, payouts, finance, funding, shops] = await Promise.all([
      client.api.books(entityId),
      client.api.payouts(entityId),
      staff ? client.api.finance() : Promise.resolve({ error: null, data: null } as never),
      client.api.funding(entityId),
      // The shop list, so that attributing a stray payment can offer NAMES to pick from rather than
      // asking somebody to paste a DID. Staff only — it is the same list the overview reads, and a
      // company administrator never sees the unattributed pile that needs it.
      staff ? client.api.agents() : Promise.resolve({ error: null, data: null } as never),
    ]);
    setState((s) => ({
      ...s,
      books: books.error ? null : narrow<BooksView>(books.data),
      payouts: payouts.error ? null : (narrow<{ items: PayoutRow[] }>(payouts.data)?.items ?? []),
      // Operator-only, so a company administrator simply never gets one — and the screen renders no
      // ledger rather than an empty one, which would say the network's books were empty.
      finance: finance.error ? null : narrow<FinanceView>(finance.data),
      // Money coming in. A company administrator is served only its own company's requests by the server,
      // so nothing is filtered here — "which company am I" is a question the token already answered.
      funding: funding.error ? null : (narrow<{ items: FundingRow[] }>(funding.data)?.items ?? []),
      unmatched: funding.error ? [] : (narrow<{ unmatched: UnmatchedRow[] }>(funding.data)?.unmatched ?? []),
      // Kept as-is on a failure rather than emptied: "we could not ask" must never wear "there are no
      // shops" clothes, and here it would mean a stray payment looked unattributable to anybody.
      agents: shops.error ? s.agents : (narrow<AgentRow[]>(shops.data) ?? s.agents),
    }));
  }, []);

  /** The sister list, then the first sister that can actually transact — the group has no rates to show. */
  const loadEntities = useCallback(
    async (client: TowerClient) => {
      const { data, error } = await client.api.entities();
      if (error) {
        setState((s) => ({ ...s, error }));
        return;
      }
      const rows = narrow<EntityRow[]>(data) ?? [];
      setState((s) => ({ ...s, entities: rows }));
      const first = rows.find((e) => e.kind === 'sister') ?? rows[0];
      if (first) await loadPricing(client, first.entityId);
      // The side-by-side view only means anything with more than one company in it, and only somebody
      // who reaches more than one ever sees it. Reading it for a lone sister would be a table of one row.
      if (rows.length > 1) await loadCompanies(client, rows);
      await loadExpiring(client);
    },
    [loadPricing, loadCompanies, loadExpiring],
  );

  /**
   * The monitoring reads: the dashboard, the shops, the hubs and their bags, and where the shops are.
   *
   * Five calls in parallel and each one allowed to fail on its own. A panel whose read failed stays
   * `null` and renders as "reading…" rather than as an empty network — "there are no shops" and "we
   * could not ask" are opposite answers, and on a monitoring screen the second must never wear the
   * first's clothes.
   */
  const loadNetwork = useCallback(async (client: TowerClient) => {
    setState((s) => ({ ...s, loading: true }));
    const [dashboard, agents, hubs, totes, heatmap] = await Promise.all([
      client.api.dashboard(),
      client.api.agents(),
      client.api.hubs(),
      client.api.totes(),
      client.api.heatmap(),
    ]);
    setState((s) => ({
      ...s,
      loading: false,
      dashboard: dashboard.error ? null : narrow<DashboardView>(dashboard.data),
      agents: agents.error ? null : (narrow<AgentRow[]>(agents.data) ?? []),
      hubs: hubs.error ? null : (narrow<HubRow[]>(hubs.data) ?? []),
      totes: totes.error ? null : (narrow<ToteRow[]>(totes.data) ?? []),
      coverage: heatmap.error ? null : (narrow<{ counts?: CoverageCounts }>(heatmap.data)?.counts ?? null),
      readAt: Date.now(),
    }));
  }, []);

  /** One vocabulary's options, with whatever picture each one has. */
  const loadHelp = useCallback(async (client: TowerClient, topic: string) => {
    setState((s) => ({ ...s, loading: true, helpTopic: topic }));
    const { data, error } = await client.api.help(topic);
    setState((s) => ({
      ...s,
      loading: false,
      // A failed read leaves it null, which the screen renders as "reading…" — not as a vocabulary with
      // no options, which would say this deployment has nothing to illustrate.
      help: error ? null : (narrow<{ options: HelpOption[] }>(data)?.options ?? []),
      queueError: error ? error.detail || error.title : null,
    }));
  }, []);

  /**
   * Every queue that waits on network staff, read together.
   *
   * Tolerant per queue and never silently short: a failed read leaves that queue as `null` — which the
   * screens render as "reading…" rather than as an empty queue, because "nothing is waiting" and "we
   * could not look" are opposite answers and must not share a rendering.
   */
  const loadQueues = useCallback(async (client: TowerClient) => {
    setState((s) => ({ ...s, loading: true }));
    const [claims, freightClaims, disposal, approvals, stalled, driverApplications, businesses, accountMoves, idDisputes, paperReports, fleets, damageReports] = await Promise.all([
      client.api.disputes(),
      client.api.freightClaims(),
      client.api.disposalQueue(),
      client.api.kycQueue(),
      // Read with the queues and kept apart from them everywhere after: it shares a screen with the
      // applications and shares neither their count nor their badge.
      client.api.unfinishedSignups(),
      // The queue that had no screen: read here because it IS a decision we owe, unlike the chase list.
      client.api.driverKycQueue(),
      // B1 — a business asking to be checked is a decision we owe, and it takes two of us.
      client.api.businesses(),
      // Somebody locked out of their account is waiting on two of us — and so, perhaps, is somebody after another's.
      client.api.accountMoves(),
      client.api.idDisputes(),
      // The one time staff step into the record of a company that keeps its own: somebody said a paper is not right.
      client.api.paperReports(),
      // A fleet is set up by staff, and two of its four steps are somebody waiting on us.
      client.api.fleetsSettingUp(),
      // Not a queue — nobody waits on us for these — but read beside the claims, because it is where a reported problem now goes.
      client.api.damageReports(),
    ]);
    setState((s) => ({
      ...s,
      loading: false,
      claims: claims.error ? null : (narrow<{ disputes: ClaimRow[] }>(claims.data)?.disputes ?? []),
      freightClaims: freightClaims.error ? null : (narrow<{ claims: FreightClaimRow[] }>(freightClaims.data)?.claims ?? []),
      damageReports: damageReports.error ? null : (narrow<{ items: DamageReportRow[] }>(damageReports.data)?.items ?? []),
      disposal: disposal.error ? null : (narrow<{ rows: DisposalRow[] }>(disposal.data)?.rows ?? []),
      approvals: approvals.error ? null : (narrow<ApprovalRow[]>(approvals.data) ?? []),
      stalled: stalled.error ? null : (narrow<{ items: StalledRow[] }>(stalled.data)?.items ?? []),
      driverApplications: driverApplications.error ? null : (narrow<DriverApplication[]>(driverApplications.data) ?? []),
      businesses: businesses.error ? null : (narrow<{ items: BusinessRow[] }>(businesses.data)?.items ?? []),
      accountMoves: accountMoves.error ? null : (narrow<{ items: MoveRow[] }>(accountMoves.data)?.items ?? []),
      idDisputes: idDisputes.error ? null : (narrow<{ items: DisputeRow[] }>(idDisputes.data)?.items ?? []),
      paperReports: paperReports.error ? null : (narrow<{ items: PaperCase[] }>(paperReports.data)?.items ?? []),
      fleets: fleets.error ? null : (narrow<{ items: FleetSetupRow[] }>(fleets.data)?.items ?? []),
      readAt: Date.now(),
    }));
  }, []);

  /**
   * The corridors, the shifts on them, and the shops that tell us which zones exist.
   *
   * Three questions, so three reads: what routes exist, who is running on each one (blocking a corridor
   * with four buses on it is a different decision from blocking an idle one), and which zones this
   * deployment knows about — offered as suggestions, never as a closed list.
   */
  /** CV1 — reported messages. A failed read keeps what was known and says so, like every queue here. */
  const loadReports = useCallback(async (client: TowerClient) => {
    setState((s) => ({ ...s, loading: true }));
    const [reported, disputes] = await Promise.all([client.api.conversationReports(), client.api.disputeReports()]);
    const error = reported.error ?? disputes.error;
    setState((s) => ({
      ...s,
      loading: false,
      reports: reported.error ? s.reports : (narrow<{ items: ReportRow[] }>(reported.data)?.items ?? []),
      disputeReports: disputes.error ? s.disputeReports : (narrow<{ items: DisputeReportRow[] }>(disputes.data)?.items ?? []),
      queueError: error ? error.detail || error.title : null,
      readAt: Date.now(),
    }));
  }, []);

  const loadCorridors = useCallback(async (client: TowerClient) => {
    setState((s) => ({ ...s, loading: true }));
    const [corridors, couplings, agents, hubs] = await Promise.all([
      client.api.corridors(),
      client.api.couplings(),
      client.api.agents(),
      client.api.hubs(),
    ]);
    setState((s) => ({
      ...s,
      loading: false,
      corridors: corridors.error ? null : (narrow<CorridorRow[]>(corridors.data) ?? []),
      couplings: couplings.error ? s.couplings : (narrow<CouplingRow[]>(couplings.data) ?? []),
      // The zone suggestions are a convenience: a failed read leaves what was known rather than
      // emptying a list somebody is typing beside.
      agents: agents.error ? s.agents : (narrow<AgentRow[]>(agents.data) ?? []),
      hubs: hubs.error ? s.hubs : (narrow<HubRow[]>(hubs.data) ?? []),
      queueError: corridors.error ? corridors.error.detail || corridors.error.title : null,
      readAt: Date.now(),
    }));
  }, []);
  /** The presence map. One read: it is a list of decisions, not a queue. */
  const loadPresence = useCallback(async (client: TowerClient) => {
    setState((s) => ({ ...s, loading: true }));
    // CA1 + CA2 — the map, the countries it may grow into, and the changes waiting for a second person, read together.
    // …and who is waiting in the countries it has not reached, which is the evidence the decision needs.
    const [map, catalogue, proposals, interest] = await Promise.all([
      client.api.presence(),
      client.api.countryCatalogue(),
      client.api.presenceProposals(),
      client.api.interest(),
    ]);
    const error = map.error ?? catalogue.error ?? proposals.error;
    setState((s) => ({
      ...s,
      loading: false,
      presence: map.error ? null : (narrow<{ items: PresenceRow[] }>(map.data)?.items ?? []),
      catalogue: catalogue.error ? s.catalogue : (narrow<{ items: CatalogueCountry[] }>(catalogue.data)?.items ?? []),
      proposals: proposals.error ? s.proposals : (narrow<{ items: PresenceProposalRow[] }>(proposals.data)?.items ?? []),
      // Soft-failed on purpose: the map and the proposals are what this screen is FOR, and losing the
      // waiting list must not take them down with it.
      interest: interest.error ? s.interest : (narrow<{ items: InterestCountry[] }>(interest.data)?.items ?? []),
      queueError: error ? error.detail || error.title : null,
      readAt: Date.now(),
    }));
  }, []);

  // Boot: a credential in this tab means the console picks up where it left off; nothing means sign-in.
  useEffect(() => {
    const creds = readCreds();
    if (!creds) {
      setState((s) => ({ ...s, phase: 'signin' }));
      return;
    }
    const client = createTowerClient(creds);
    clientRef.current = client;
    if (creds.mode === 'operator') {
      // The staff list is the one read the setup key is allowed everywhere, and it says when that list is ALL the key
      // reaches (outside a sandbox). Asked first, so the console does not open on a screen of refusals.
      void client.api.staff().then(({ data }) => {
        const setupOnly = staffListOf(data).setupOnly;
        setState((s) => ({ ...s, phase: 'ready', creds, who: { mode: 'operator', name: creds.name, setupOnly } }));
        if (setupOnly) return;
        void loadHazards(client);
        void loadCases(client);
        void loadQueues(client);
        void loadPapers(client);
        void loadNetwork(client);
        void loadEntities(client);
      });
      return;
    }
    if (creds.mode === 'staff') {
      // The token this tab already holds is the session. Asked who it belongs to: a dead token means sign in again.
      void myStaffAccount(client).then(({ data, error }) => {
        if (error || !data) {
          clearCreds();
          setState((s) => ({ ...s, phase: 'signin', signInNote: t('tower.signIn.ended') }));
          return;
        }
        setState((s) => ({ ...s, phase: 'ready', creds, who: { mode: 'operator', name: data.name, named: true }, staffTwoStep: Boolean(data.twoStep) }));
        void loadHazards(client);
        void loadCases(client);
        void loadQueues(client);
        void loadPapers(client);
        void loadNetwork(client);
        void loadEntities(client);
      });
      return;
    }
    // A company login has to ask the server who it is again — the stored credential says how to sign in,
    // never what it may reach, and a console that assumed the second would be guessing at somebody's
    // authority from a value in their own browser.
    void companyLogin(creds.email, creds.password).then(({ data, error }) => {
      if (error || !data) {
        clearCreds();
        setState((s) => ({ ...s, phase: 'signin', signInError: error?.detail ?? null }));
        return;
      }
      setState((s) => ({ ...s, phase: 'ready', creds, who: { mode: 'company', name: data.name, entityId: data.entityId }, companyId: data.entityId ?? null, screen: 'imports' }));
      void loadEntities(client);
    });
  }, [loadHazards, loadQueues, loadNetwork, loadEntities, loadPapers]);

  const signIn = useCallback(
    async (name: string, key: string) => {
      const creds: TowerCreds = { mode: 'operator', name: name.trim(), key };
      const client = createTowerClient(creds);
      setState((s) => ({ ...s, loading: true, signInError: null }));
      // The staff list is the sign-in test: it needs a token AND the operator role, so a key the server rejects fails
      // here rather than after the shell has already claimed the person is signed in. It is also the one read the
      // setup key is allowed everywhere, and its answer says when that is all the key reaches (outside a sandbox).
      const { data, error } = await client.api.staff();
      if (error) {
        setState((s) => ({ ...s, loading: false, signInError: error.detail || t('tower.signIn.rejected') }));
        return;
      }
      const setupOnly = staffListOf(data).setupOnly;
      clientRef.current = client;
      saveCreds(creds);
      setState((s) => ({ ...s, phase: 'ready', creds, who: { mode: 'operator', name: creds.name, setupOnly }, signInError: null }));
      if (setupOnly) {
        // Nothing else is this key's to read: the one screen is shown, and none of the rest is asked for.
        setState((s) => ({ ...s, loading: false }));
        return;
      }
      await loadHazards(client);
      await loadQueues(client);
      await loadPapers(client);
      await loadNetwork(client);
      await loadEntities(client);
    },
    [loadHazards, loadQueues, loadNetwork, loadEntities, loadPapers],
  );

  /**
   * A company's administrator signs in.
   *
   * The login is called DIRECTLY here rather than through the client's own re-mint, because this is where
   * the answer is needed: it says which company this person administers and what their name is, and the
   * shell renders a different console depending on the first of those.
   */
  const signInAsCompany = useCallback(
    async (email: string, password: string) => {
      setState((s) => ({ ...s, loading: true, signInError: null }));
      const { data, error } = await companyLogin(email.trim(), password);
      if (error || !data) {
        setState((s) => ({ ...s, loading: false, signInError: error?.detail || t('tower.signIn.rejected') }));
        return;
      }
      const creds: TowerCreds = { mode: 'company', email: email.trim(), password };
      const client = createTowerClient(creds);
      clientRef.current = client;
      saveCreds(creds);
      setState((s) => ({
        ...s,
        phase: 'ready',
        creds,
        who: { mode: 'company', name: data.name, entityId: data.entityId },
        // Their own record is the one they may edit, so the company screen opens on it rather than on
        // nothing — an operator picks a company from a list; an administrator IS one.
        companyId: data.entityId ?? null,
        /*
         * A company administrator is not network staff: the hazard queue is not theirs to work, and the
         * rail must not offer a section whose every row would answer 403. It used to open on RATES, which
         * is what a sister charges and is an operator's knob — they land on their own containers now.
         */
        screen: 'imports',
        signInError: null,
        loading: false,
      }));
      await loadEntities(client);
    },
    [loadEntities],
  );

  /**
   * A member of network staff signs in. Operator rights, like the setup key — but the name comes from their account,
   * so nothing is typed beside it and a two-person rule can tell two people apart.
   */
  const signInAsStaff = useCallback(
    async (email: string, password: string, code?: string) => {
      setState((s) => ({ ...s, loading: true, signInError: null, signInNote: null }));
      const { data, error } = await staffLogin(email.trim(), password, code?.trim() || undefined);
      if (error || !data) {
        // The password was right and the server wants the second step: that is the next field, not a refusal.
        const asksCode = error?.code === 'FIELD_REQUIRED' && (error.params as { field?: string } | undefined)?.field === 'code';
        setState((s) => ({
          ...s,
          loading: false,
          staffStep: asksCode ? (s.staffStep ?? { kind: 'code' }) : s.staffStep,
          signInError: asksCode ? null : error?.detail || t('tower.signIn.rejected'),
        }));
        return;
      }
      if ('setup' in data) {
        setState((s) => ({ ...s, loading: false, signInError: null, staffStep: { kind: 'setup', ...data.setup } }));
        return;
      }
      const creds: TowerCreds = { mode: 'staff', email: email.trim() };
      const client = createTowerClient(creds);
      await client.seed?.(data.token);
      clientRef.current = client;
      saveCreds(creds);
      setState((s) => ({ ...s, phase: 'ready', creds, who: { mode: 'operator', name: data.name, named: true }, screen: 'network', signInError: null, signInNote: null, staffStep: null, staffTwoStep: data.twoStep, loading: false }));
      await loadHazards(client);
      await loadQueues(client);
      await loadPapers(client);
      await loadNetwork(client);
      await loadEntities(client);
    },
    [loadHazards, loadQueues, loadNetwork, loadEntities, loadPapers],
  );

  const signOut = useCallback(() => {
    clearCreds();
    clientRef.current = null;
    setState({ ...INITIAL, phase: 'signin' });
  }, []);

  const cancelStaffStep = useCallback(() => setState((s) => ({ ...s, staffStep: null, signInError: null })), []);
  const noteStaffTwoStep = useCallback((on: boolean) => setState((s) => ({ ...s, staffTwoStep: on })), []);

  /**
   * Look one parcel up. A failed lookup CLEARS what was on screen rather than leaving the last parcel
   * under a new error — an operator reading a timeline that belongs to a different parcel is worse than
   * an empty screen.
   */
  const lookupParcel = useCallback(async (parcelId: string) => {
    const client = clientRef.current;
    if (!client) return;
    setState((s) => ({
      ...s,
      busyId: 'lookup',
      queueError: null,
      done: null,
      // A code shown once survives a re-read of the SAME parcel and dies with a new one. Clearing it
      // unconditionally is what this did first, and it wiped the OTP a tenth of a second after showing
      // it — the reissue re-reads the parcel to pick up the new lock state, and took the only copy of
      // the code down with it. A new subject on screen is the one thing that should end it.
      reissued: s.lookup?.parcelId === parcelId ? s.reissued : null,
    }));
    const { data, error } = await client.api.parcel(parcelId);
    if (error) {
      setState((s) => ({ ...s, busyId: null, lookup: null, queueError: error.detail || error.title }));
      return;
    }
    setState((s) => ({ ...s, busyId: null, lookup: narrow<ParcelView>(data), queueError: null }));
  }, []);

  /** The file of one damage claim report: the report to read or print, the same facts for a machine, and its photographs. */
  const downloadDamageReport = useCallback(async (parcelId: string) => {
    const client = clientRef.current;
    if (!client) return;
    const r = await client.api.damageReportFile(parcelId);
    if (r.error || !r.data) return setState((s) => ({ ...s, error: r.error ?? null }));
    triggerDownloadBlob(`damage-claim-report-${parcelId.replace(/[^A-Za-z0-9._-]+/g, '-')}.zip`, r.data);
  }, []);

  const refresh = useCallback(async () => {
    const client = clientRef.current;
    if (!client) return;
    // Refresh what is on screen, not everything: an operator pressing this on the rates table is asking
    // about rates, and re-reading the hazard queue underneath them would move a list they are not looking at.
    if (state.screen === 'rates' && state.entityId) await loadPricing(client, state.entityId);
    else if (state.screen === 'claims' || state.screen === 'disposal' || state.screen === 'approvals') await loadQueues(client);
    else if (state.screen === 'network') await loadNetwork(client);
    else if (state.screen === 'money' && state.entityId) await loadMoney(client, state.entityId);
    else if (state.screen === 'pictures') await loadHelp(client, state.helpTopic);
    else if (state.screen === 'corridors') await loadCorridors(client);
    else if (state.screen === 'reports') await loadReports(client);
    else if (state.screen === 'presence') await loadPresence(client);
    else if (state.screen === 'companies') await loadEntities(client);
    else if (state.screen === 'papers') await loadPapers(client);
    else if (state.screen === 'businesses' || state.screen === 'accountmoves' || state.screen === 'iddisputes' || state.screen === 'paperreports') await loadQueues(client);
    else if (state.screen === 'movers') await loadMovers(client);
    else if (state.screen === 'cases') await loadCases(client);
    else if (state.screen === 'support') {
      // Refreshing the support screen means re-reading the parcel somebody is on the phone about, not
      // reloading a list — there is no list here.
      if (state.lookup) await lookupParcel(state.lookup.parcelId);
    }
    else await loadHazards(client);
  }, [loadHazards, loadCases, loadQueues, loadNetwork, loadMoney, loadHelp, loadCorridors, loadReports, loadPresence, lookupParcel, loadPricing, loadPapers, state.screen, state.entityId, state.lookup, state.helpTopic]);

  const open = useCallback((constraintId: string | null) => {
    setState((s) => ({ ...s, openId: constraintId, clearError: null }));
  }, []);

  const clear = useCallback(
    async (constraintId: string, reason: string, hazard: string) => {
      const client = clientRef.current;
      if (!client) return;
      setState((s) => ({ ...s, busyId: constraintId, clearError: null }));
      const { error } = await client.api.clearConstraint(constraintId, reason.trim(), state.who?.name);
      if (error) {
        setState((s) => ({ ...s, busyId: null, clearError: error }));
        return;
      }
      // Drop the row here rather than re-reading the whole queue: the answer is authoritative (the write
      // succeeded), and a refetch would make the row a moving target under the operator's cursor.
      setState((s) => ({
        ...s,
        busyId: null,
        openId: null,
        clearError: null,
        hazards: (s.hazards ?? []).filter((h) => h.constraintId !== constraintId),
        done: t('tower.hazards.cleared', { hazard }),
      }));
    },
    [state.who?.name],
  );

  /**
   * Save one knob group, then RE-READ rather than patching the row from the response.
   *
   * The response is the stored Entity, not the resolved picture: what a lane now charges depends on
   * fallbacks this screen would have to re-derive to update itself, and re-deriving resolution in a client
   * is exactly what the pricing read model exists to avoid.
   */
  const saveKnob = useCallback(
    async (lane: string | undefined, run: (client: TowerClient, entityId: string) => Promise<{ error: SbgError | null }>, done?: string) => {
      const client = clientRef.current;
      const entityId = state.entityId;
      if (!client || !entityId) return;
      const rowId = lane ?? 'default';
      setState((s) => ({ ...s, busyId: rowId, saveError: null }));
      const { error } = await run(client, entityId);
      if (error) {
        // The form stays open and holding what was typed: a refused rate is a number somebody still means.
        setState((s) => ({ ...s, busyId: null, saveError: error }));
        return;
      }
      setState((s) => ({ ...s, busyId: null, saveError: null, done: done ?? t('tower.rates.saved', { lane: rowId }) }));
      await loadPricing(client, entityId);
      // The overview holds the same numbers from a different angle; leaving it stale would put two
      // different answers to one question on two tabs of the same console.
      const rows = stateRef.current.entities;
      if (rows && rows.length > 1) await loadCompanies(client, rows);
    },
    [loadPricing, loadCompanies, state.entityId],
  );

  return {
    state,
    actions: {
      signIn,
      signOut,
      /**
       * Move to a section — and read what that section needs if nothing has read it yet.
       *
       * The illustration library is the only one nothing else loads: the queues, the overview and the
       * money reads all happen at sign-in, because they are what somebody is likely to open. This one
       * would otherwise sit empty until a refresh, and the screen would have to guess whether "no
       * pictures" meant none or meant nobody had asked.
       */
      go: (screen) => {
        setState((s) => ({ ...s, screen, openId: null, done: null, saveError: null, queueError: null }));
        const client = clientRef.current;
        if (screen === 'pictures' && client && stateRef.current.help === null) void loadHelp(client, stateRef.current.helpTopic);
        if (screen === 'corridors' && client && stateRef.current.corridors === null) void loadCorridors(client);
        if (screen === 'reports' && client) void loadReports(client);
        if (screen === 'presence' && client && stateRef.current.presence === null) void loadPresence(client);
        // CA5 — the lapsing list is only worth reading fresh: a policy that lapsed since sign-in must show.
        if (screen === 'companies' && client) void loadEntities(client);
        if (screen === 'papers' && client) void loadPapers(client);
        // B1 — fresh: a colleague may have just given the first approval, and the second is yours to give.
        if ((screen === 'businesses' || screen === 'accountmoves' || screen === 'iddisputes' || screen === 'paperreports') && client) void loadQueues(client);
        // Read fresh every time: a hand-back that happened this morning is the reason somebody opened it.
        if (screen === 'movers' && client) void loadMovers(client);
        if (screen === 'cases' && client) void loadCases(client);
      },
      refresh,
      caseAct: async (caseId, act, body) => {
        const client = clientRef.current;
        if (!client) return null;
        setState((s) => ({ ...s, caseBusy: caseId, caseError: null }));
        // Named, like every act here: the setup key cannot say who is at the keyboard, the name typed at sign-in does.
        const by = stateRef.current.who?.name;
        const { data, error } = await client.api.caseAct(caseId, act, { ...(body ?? {}), ...(by ? { by } : {}) });
        setState((s) => ({ ...s, caseBusy: null, ...(error ? { caseError: error.detail || error.title } : {}) }));
        await loadCases(client);
        // The case as it now is: a case somebody took may have left the page it was opened from.
        return error ? null : (narrow<FlagCaseRow>(data) ?? null);
      },
      lostAct: async (parcelId, act, words) => {
        const client = clientRef.current;
        if (!client) return false;
        setState((s) => ({ ...s, caseBusy: parcelId, caseError: null }));
        const by = stateRef.current.who?.name;
        const { error } = act === 'lost' ? await client.api.declareLost(parcelId, { reason: words, ...(by ? { by } : {}) }) : await client.api.foundAgain(parcelId, { note: words, ...(by ? { by } : {}) });
        setState((s) => ({ ...s, caseBusy: null, ...(error ? { caseError: error.detail || error.title } : {}) }));
        await loadCases(client);
        return !error;
      },
      caseFilter: (which, kind) => {
        const client = clientRef.current;
        setState((s) => ({ ...s, caseWhich: which, caseKind: kind, cases: null, casesTotal: null }));
        if (client) void loadCases(client, which, kind);
      },
      downloadDamageReport,
      open,
      clear,
      chooseEntity: async (entityId: string) => {
        const client = clientRef.current;
        // Closing the open editor is not tidiness: its boxes hold another sister's numbers.
        setState((s) => ({ ...s, openId: null, saveError: null, done: null, pricing: null, rateImpact: null, books: null, payouts: null }));
        if (client) await loadPricing(client, entityId);
      },
      setCountryForm: (patch: Partial<NewCountryForm>) => setState((s) => ({ ...s, countryForm: { ...s.countryForm, ...patch }, queueError: null })),
      /**
       * Record a country the map does not list yet.
       *
       * Without this the map could only ever show countries that already had a company or a standing,
       * which makes the first country we are NOT in unrecordable — the same gap the corridors had,
       * where the only routes in existence were the ones a seed script happened to write.
       */
      recordCountry: async () => {
        const client = clientRef.current;
        if (!client) return;
        const form = stateRef.current.countryForm;
        const code = newCountryCode(form);
        if (!code) return;
        setState((s) => ({ ...s, busyId: 'country', queueError: null, done: null }));
        const { data, error } = await client.api.setPresence(code, {
          level: form.level,
          ...(stateRef.current.who?.name ? { by: stateRef.current.who.name } : {}),
          ...(form.note.trim() ? { note: form.note.trim() } : {}),
        });
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        const proposed = Boolean(narrow<{ proposal?: unknown }>(data)?.proposal);
        setState((s) => ({
          ...s,
          busyId: null,
          countryForm: { ...EMPTY_COUNTRY_FORM },
          done: proposed ? t('tower.presence.proposed', { country: code }) : t('tower.presence.recorded', { country: code }),
        }));
        await loadPresence(client);
      },
      setPresenceForm: (patch: Partial<{ level: PresenceLevel; note: string }>) =>
        setState((s) => ({ ...s, presenceForm: { ...s.presenceForm, ...patch }, queueError: null })),
      /**
       * Move a country up or down the ladder.
       *
       * The capabilities somebody deliberately switched off are sent BACK with the new level, so a
       * level change moves everything that was never argued about and leaves the arguments standing.
       * Dropping them silently would quietly re-grant a permission a person had taken away.
       */
      savePresence: async (jurisdiction: string) => {
        const client = clientRef.current;
        if (!client) return;
        const current = stateRef.current;
        const row = current.presence?.find((p) => p.jurisdiction === jurisdiction);
        const level = current.presenceForm.level || row?.level;
        if (!row || !level) return;
        setState((s) => ({ ...s, busyId: jurisdiction, queueError: null, done: null }));
        const { data, error } = await client.api.setPresence(jurisdiction, {
          level,
          overrides: overridesOf(row) as Record<string, boolean>,
          // CL1 — the trade terms, sent only when this editor actually touched them. Sending the row back
          // unchanged would be harmless, but sending nothing is what makes "I did not open that" true.
          ...(current.presenceForm.incoterms ? { incoterms: current.presenceForm.incoterms } : {}),
          ...(current.who?.name ? { by: current.who.name } : {}),
          ...(current.presenceForm.note.trim() ? { note: current.presenceForm.note.trim() } : {}),
        });
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        const proposed = Boolean(narrow<{ proposal?: unknown }>(data)?.proposal);
        setState((s) => ({
          ...s,
          busyId: null,
          openId: null,
          presenceForm: { level: '', note: '' },
          done: proposed ? t('tower.presence.proposed', { country: jurisdiction }) : t('tower.presence.moved', { country: jurisdiction }),
        }));
        await loadPresence(client);
      },
      openCompany: (entityId: string) => setState((s) => ({ ...s, screen: 'company', companyId: entityId || null, done: null, queueError: null })),
      recordChanged: () => {
        const client = clientRef.current;
        if (!client) return;
        void loadExpiring(client);
        // A report made from a record is one more waiting on staff. Only staff have that queue.
        if (stateRef.current.who?.mode === 'operator') void loadPaperReports(client);
      },
      client: () => clientRef.current,
      createCompany: async (kind: 'sister' | 'partner', jurisdiction: string, name: string) => {
        const client = clientRef.current;
        if (!client) return false;
        setState((s) => ({ ...s, busyId: 'company', queueError: null, done: null }));
        const { data, error } = await client.api.createCompany({ kind, jurisdiction, name, ...(stateRef.current.who?.name ? { by: stateRef.current.who.name } : {}) });
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return false;
        }
        const created = narrow<{ entityId: string; name: string }>(data);
        setState((s) => ({ ...s, busyId: null, done: t('tower.companies.created', { name: created?.name ?? name }) }));
        await loadEntities(client);
        return true;
      },
      approveProposal: async (proposalId: string) => {
        const client = clientRef.current;
        if (!client) return;
        const proposal = stateRef.current.proposals?.find((p) => p.proposalId === proposalId);
        setState((s) => ({ ...s, busyId: proposalId, queueError: null, done: null }));
        const { error } = await client.api.approvePresence(proposalId, stateRef.current.who?.name);
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, done: approvedSays(proposal, t) }));
        await loadPresence(client);
      },
      declineProposal: async (proposalId: string, reason: string) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: proposalId, queueError: null, done: null }));
        const { error } = await client.api.declinePresence(proposalId, reason, stateRef.current.who?.name);
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, done: t('tower.presence.declined') }));
        await loadPresence(client);
      },
      setCorridorForm: (patch: Partial<CorridorForm>) =>
        setState((s) => ({ ...s, corridorForm: { ...s.corridorForm, ...patch }, queueError: null })),
      /**
       * Draw a corridor. Re-reads afterwards rather than pushing the new row in locally: the id and the
       * defaults the server fills in are the server’s, and a table an operator BLOCKS things from must
       * show what the network holds rather than what this tab hoped it would.
       */
      saveCorridor: async () => {
        const client = clientRef.current;
        if (!client) return;
        const form = stateRef.current.corridorForm;
        setState((s) => ({ ...s, busyId: 'corridor', queueError: null, done: null }));
        const { error } = await client.api.addCorridor({
          name: corridorName(form),
          originZone: form.originZone.trim(),
          destZone: form.destZone.trim(),
          vehicleType: form.vehicleType,
          ...(form.schedule.trim() ? { schedule: form.schedule.trim() } : {}),
        });
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, corridorForm: { ...EMPTY_CORRIDOR_FORM }, done: t('tower.corridors.drawn') }));
        await loadCorridors(client);
      },
      /** Close a corridor or reopen it. Closing stops every cross-zone take-in it was serving. */
      setCorridorStatus: async (corridorId: string, status: 'active' | 'blocked') => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: corridorId, queueError: null, done: null }));
        const { error } = await client.api.setCorridorStatus(corridorId, status);
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, done: t(status === 'blocked' ? 'tower.corridors.closed' : 'tower.corridors.reopened') }));
        await loadCorridors(client);
      },
      /** Publish a fleet's proposed line. From then on shops in its origin zone may take parcels in for it. */
      publishCorridor: async (corridorId: string) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: corridorId, queueError: null, done: null }));
        const { error } = await client.api.publishCorridor(corridorId);
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, done: t('tower.corridors.published') }));
        await loadCorridors(client);
      },
      /** CV4 — fetched on press, never ahead: a list of reports must not download every recording in them. */
      disputeVoice: async (reportId: string, voiceId: string) => {
        const client = clientRef.current;
        if (!client) return null;
        const r = await client.api.disputeVoice(reportId, voiceId);
        return r.error ? null : ((r.data ?? null) as unknown as Blob | null);
      },
      signInAsCompany,
      signInAsStaff,
      cancelStaffStep,
      noteStaffTwoStep,
      showQueueError: (message: string) => setState((s) => ({ ...s, queueError: message })),
      /**
       * Decide a claim. The note travels on every ending, including a rejection.
       *
       * Re-reads the queue afterwards rather than dropping the row locally: resolving a claim moves money
       * and can change what else is open, and this is the one screen where guessing at the new state
       * would put a stale case in front of the next decision.
       */
      resolveClaim: async (parcelId: string, decision: ClaimDecision, award: number | undefined, note: string) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: parcelId, queueError: null }));
        const { error } = await client.api.resolveDispute(parcelId, { decision, ...(award != null ? { award } : {}), note, by: stateRef.current.who?.name });
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, openId: null, queueError: null, done: t('tower.claims.decided', { parcel: parcelId }) }));
        await loadQueues(client);
      },
      resolveFreightClaim: async (freightId: string, decision: ClaimDecision, award: number | undefined, note: string) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: freightId, queueError: null }));
        const { error } = await client.api.resolveFreightClaim(freightId, { decision, ...(award != null && award > 0 ? { award } : {}), note, by: stateRef.current.who?.name });
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, openId: null, queueError: null, done: t('tower.claims.decided', { parcel: freightId }) }));
        await loadQueues(client);
      },
      /** Close a disposal row. The screen said what it pays the shop; the toast says what it paid. */
      closeDisposal: async (parcelId: string, reason: string) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: parcelId, queueError: null }));
        const { data, error } = await client.api.writeOff(parcelId, { by: stateRef.current.who?.name, reason: reason.trim() });
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        const paid = narrow<{ paidToShop?: number }>(data)?.paidToShop ?? 0;
        setState((s) => ({ ...s, busyId: null, openId: null, queueError: null, done: t('tower.disposal.closed', { parcel: parcelId, amount: paid.toFixed(2) }) }));
        await loadQueues(client);
      },
      /** Let a shop in, or refuse it — and a refusal carries the reason the applicant is shown. */
      decideApproval: async (did: string, approve: boolean, reason?: string) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: did, queueError: null }));
        const { error } = await client.api.decideKyc(did, { approve, by: stateRef.current.who?.name, ...(reason ? { reason } : {}) });
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, queueError: null, done: approve ? t('tower.approvals.approved') : t('tower.approvals.refused') }));
        await loadQueues(client);
      },
      /**
       * Vet a heavy-registry driver — the decision that had no screen.
       *
       * A refusal carries the reason: the driver is shown it and is the only person who can put it right.
       */
      decideDriver: async (did: string, approve: boolean, reason?: string, criminalRecordClear?: boolean, asked?: boolean) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: did, queueError: null }));
        const { error } = await client.api.decideDriverKyc(did, { approve, by: stateRef.current.who?.name, ...(reason ? { reason } : {}), ...(criminalRecordClear ? { criminalRecordClear } : {}) });
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        const said = asked ? (approve ? 'tower.drivers.askApproved' : 'tower.drivers.askRefused') : approve ? 'tower.drivers.approved' : 'tower.drivers.refused';
        setState((s) => ({ ...s, busyId: null, queueError: null, done: t(said) }));
        await loadQueues(client);
      },
      /**
       * A FLEET IS SET UP BY STAFF — the four acts that had no screen. Each says what it came to in the fleets panel
       * and reads the list again: the next step on a row is derived from the fleet, never remembered here.
       */
      registerFleet: async (form: FleetForm): Promise<boolean> => {
        const client = clientRef.current;
        if (!client) return false;
        setState((s) => ({ ...s, busyId: 'fleet-new', fleetNote: null }));
        const { error } = await client.api.registerFleet(fleetBody(form));
        if (error) {
          setState((s) => ({ ...s, busyId: null, fleetNote: { tone: 'err', text: error.detail || error.title } }));
          return false;
        }
        setState((s) => ({ ...s, busyId: null, fleetNote: { tone: 'ok', text: t('tower.fleets.registered', { name: form.companyName.trim() }) } }));
        await loadQueues(client);
        return true;
      },
      /** Its four papers: each picture is uploaded as this member of staff's own, and only then are they put on record. */
      putFleetPapers: async (did: string, pictures: Record<FleetPaperKey, string>): Promise<boolean> => {
        const client = clientRef.current;
        if (!client) return false;
        setState((s) => ({ ...s, busyId: did, fleetNote: null }));
        const refs: Partial<Record<FleetPaperKey, string>> = {};
        for (const [key, kind] of FLEET_PAPERS) {
          const up = await client.api.uploadMedia(kind, pictures[key]);
          const mediaId = narrow<{ mediaId: string }>(up.data)?.mediaId;
          if (up.error || !mediaId) {
            setState((s) => ({ ...s, busyId: null, fleetNote: { tone: 'err', text: up.error ? up.error.detail || up.error.title : t('tower.fleets.uploadFailed') } }));
            return false;
          }
          refs[key] = mediaId;
        }
        const { error } = await client.api.submitFleetPapers(did, refs as Record<FleetPaperKey, string>);
        if (error) {
          setState((s) => ({ ...s, busyId: null, fleetNote: { tone: 'err', text: error.detail || error.title } }));
          return false;
        }
        setState((s) => ({ ...s, busyId: null, fleetNote: { tone: 'ok', text: t('tower.fleets.papersOnRecord') } }));
        await loadQueues(client);
        return true;
      },
      /** Approve, or send back with the reason whoever puts them on record again will read. */
      decideFleet: async (did: string, approve: boolean, reason?: string) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: did, fleetNote: null }));
        const { error } = await client.api.decideFleetKyc(did, { approve, by: stateRef.current.who?.name, ...(reason ? { reason } : {}) });
        if (error) {
          setState((s) => ({ ...s, busyId: null, fleetNote: { tone: 'err', text: error.detail || error.title } }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, fleetNote: { tone: 'ok', text: approve ? t('tower.fleets.approved') : t('tower.fleets.sentBackDone') } }));
        await loadQueues(client);
      },
      recordFleetBond: async (did: string) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: did, fleetNote: null }));
        const { error } = await client.api.recordFleetBond(did);
        if (error) {
          setState((s) => ({ ...s, busyId: null, fleetNote: { tone: 'err', text: error.detail || error.title } }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, fleetNote: { tone: 'ok', text: t('tower.fleets.bondRecorded') } }));
        await loadQueues(client);
      },
      addAdmin: async (entityId: string, email: string, name: string) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: 'admin', saveError: null, newAdmin: null }));
        const { data, error } = await client.api.createAdmin(entityId, { email, name });
        if (error) {
          setState((s) => ({ ...s, busyId: null, saveError: error }));
          return;
        }
        // The password is held in state and shown until somebody closes it BY HAND. A toast would take
        // the only copy of a credential away on a timer.
        setState((s) => ({ ...s, busyId: null, newAdmin: narrow<EntityAdminRow & { password: string }>(data) }));
        const listed = await client.api.admins(entityId);
        if (!listed.error) setState((s) => ({ ...s, admins: narrow<{ items: EntityAdminRow[] }>(listed.data)?.items ?? [] }));
      },
      dismissNewAdmin: () => setState((s) => ({ ...s, newAdmin: null })),
      changeCompanyPassword: async (current: string, next: string) => {
        const creds = stateRef.current.creds;
        if (!creds || creds.mode === 'operator') return t('tower.password.onlyCompany');
        const { error } = await (creds.mode === 'staff' ? changeStaffPassword : changeCompanyPassword)(creds.email, current, next);
        if (error) return error.detail || error.title;
        // A staff password change ends every staff session, this one included — and there is no password kept to sign
        // back in with. So it says so, on the sign-in screen, rather than failing at the next click.
        if (creds.mode === 'staff') {
          clearCreds();
          clientRef.current = null;
          setState({ ...INITIAL, phase: 'signin', signInNote: t('tower.password.signInAgain') });
          return null;
        }
        // The console re-signs itself in with what it keeps, so it must keep the NEW password, not the old one.
        const fresh: TowerCreds = { mode: 'company', email: creds.email, password: next };
        saveCreds(fresh);
        clientRef.current = createTowerClient(fresh);
        setState((s) => ({ ...s, creds: fresh }));
        return null;
      },
      revokeAdmin: async (entityId: string, adminId: string) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: adminId, saveError: null }));
        const { error } = await client.api.revokeAdmin(entityId, adminId);
        if (error) {
          setState((s) => ({ ...s, busyId: null, saveError: error }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, admins: (s.admins ?? []).filter((a) => a.adminId !== adminId) }));
      },
      /**
       * Raise today's payouts. Says what it RAISED and, more importantly, who it SKIPPED and why.
       */
      runPayouts: async () => {
        const client = clientRef.current;
        const entityId = stateRef.current.entityId;
        if (!client || !entityId) return;
        setState((s) => ({ ...s, busyId: 'run', queueError: null, done: null }));
        // Named, like every act here: the run is raised by one member of staff and approved by another.
        const { data, error } = await client.api.runPayouts(entityId, stateRef.current.who?.name);
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, done: runSummary(narrow<RunResult>(data) ?? {}, t) }));
        await loadMoney(client, entityId);
      },
      /** Move one payout along the rail. Nothing here moves money; it records what the rail said. */
      movePayout: async (payoutId: string, action: PayoutAction, reason?: string, providerRef?: string) => {
        const client = clientRef.current;
        const entityId = stateRef.current.entityId;
        if (!client || !entityId) return;
        setState((s) => ({ ...s, busyId: payoutId, queueError: null }));
        const { error } = await client.api.movePayout(payoutId, action, { reason, providerRef, by: stateRef.current.who?.name });
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, done: t('tower.money.moved', { action }) }));
        await loadMoney(client, entityId);
      },
      /**
       * Move one funding request along — and never by declaring money arrived.
       *
       * `confirm` is a member of staff naming a bank statement line; `simulate` is the sandbox standing
       * in for the payment provider, signed and verified exactly as a real callback is. Both demand a
       * provider reference, because a confirmation nobody can look up afterwards is the shop's own word
       * with extra steps.
       */
      moveFunding: async (fundingId: string, action: FundingAction, input?: { providerRef?: string; amount?: number; reason?: string }) => {
        const client = clientRef.current;
        const entityId = stateRef.current.entityId;
        if (!client || !entityId) return;
        setState((s) => ({ ...s, busyId: fundingId, queueError: null }));
        const { error } =
          action === 'confirm'
            ? await client.api.confirmFunding(fundingId, input?.providerRef ?? '', input?.amount ?? 0)
            : action === 'simulate'
              ? await client.api.simulateFunding(fundingId, input?.providerRef ?? '', input?.amount ?? 0)
              : await client.api.moveFunding(fundingId, action, input?.reason ?? '');
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, done: t('tower.money.in.moved', { action }) }));
        await loadMoney(client, entityId);
      },
      /**
       * SAY WHOSE AN UNATTRIBUTED PAYMENT WAS.
       *
       * The only way out of that list. It credits real money on one person's judgement, so the name that
       * goes into the record comes from the signed token, not from anything typed here.
       */
      applyFunding: async (unmatchedId: string, payerKind: 'agent' | 'vendor', payerDid: string) => {
        const client = clientRef.current;
        const entityId = stateRef.current.entityId;
        if (!client || !entityId) return;
        setState((s) => ({ ...s, busyId: unmatchedId, queueError: null }));
        const { error } = await client.api.applyFunding(unmatchedId, payerKind, payerDid, stateRef.current.who?.name);
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, done: t('tower.money.in.applied') }));
        await loadMoney(client, entityId);
      },
      lookupParcel,
      /**
       * Rotate a burnt release code. What comes back is never the new code — except a peer send's OTP,
       * which has no app to go to and is returned once to be read down the phone.
       */
      reissueRelease: async (parcelId: string) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: 'reissue', queueError: null, done: null }));
        const { data, error } = await client.api.reissueRelease(parcelId, stateRef.current.who?.name);
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, reissued: narrow<{ kind?: string; otp?: string }>(data) ?? {} }));
        await lookupParcel(parcelId); // the lock state changed; re-read rather than assume
      },
      dismissReissued: () => setState((s) => ({ ...s, reissued: null })),
      chooseHelpTopic: async (topic: string) => {
        const client = clientRef.current;
        setState((s) => ({ ...s, help: null, done: null, queueError: null }));
        if (client) await loadHelp(client, topic);
      },
      /**
       * Put this deployment's own drawing on an option.
       *
       * Downscaled in the browser first, with the same helper the field apps use for evidence photos:
       * this picture is fetched by every clerk on every booking, over connections paid for by the
       * megabyte, so it is worth being strict at the one moment somebody is at a desk on wifi.
       */
      uploadPicture: async (topic: string, key: string, file: File) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: `${topic}:${key}`, queueError: null, done: null }));
        try {
          const { dataUrl } = await downscaleImage(file, { maxEdge: 512, quality: 0.8 });
          const { error } = await client.api.setHelpImage(topic, key, dataUrl);
          if (error) {
            setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
            return;
          }
        } catch (e) {
          // A file that is not an image at all, or one the browser cannot decode.
          setState((s) => ({ ...s, busyId: null, queueError: t('tower.pictures.notAnImage') }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, done: t('tower.pictures.saved', { key }) }));
        await loadHelp(client, topic);
      },
      /** Take our own drawing back — which reveals the network's again rather than blanking the option. */
      revertPicture: async (topic: string, key: string) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: `${topic}:${key}`, queueError: null, done: null }));
        const { error } = await client.api.clearHelpImage(topic, key);
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, done: t('tower.pictures.reverted', { key }) }));
        await loadHelp(client, topic);
      },
      /** FP4 — a courier's renewed licence, recorded by network staff because no fleet office exists to. */
      recordCourierLicence: async (did: string, body: { number?: string; expiresAt: string }, name: string) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: did, queueError: null, done: null }));
        const { error } = await client.api.renewLicence(did, body);
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, openId: null, done: t('tower.papers.licenceDone', { name }) }));
        await loadPapers(client);
      },
      /** FP4 — the card is not accepted. The reason is the courier's to read, so the server insists on one. */
      refuseLicenceRenewal: async (did: string, reason: string, name: string) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: did, queueError: null, done: null }));
        const { error } = await client.api.refuseLicenceRenewal(did, { reason });
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, openId: null, done: t('tower.papers.cardRefusedDone', { name }) }));
        await loadPapers(client);
      },
      /**
       * FP4 — one courier's name and phone. Asked by the sheet when it opens and held there, never in the
       * console's state: a phone number kept in a store outlives the look that was receipted for it.
       */
      courierContact: async (did: string) => {
        const client = clientRef.current;
        if (!client) return { contact: null, error: null };
        const { data, error } = await client.api.courierContact(did);
        if (error) return { contact: null, error: error.detail || error.title };
        return { contact: narrow<CourierContact>(data), error: null };
      },
      /** A fleet operator's own papers. Answers whether it stored, so the form closes only on success. */
      recordCarrierPapers: async (did, body) => {
        const client = clientRef.current;
        if (!client) return false;
        setState((s) => ({ ...s, busyId: did, queueError: null, done: null }));
        const { error } = await client.api.recordCarrierPapers(did, body);
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return false;
        }
        setState((s) => ({ ...s, busyId: null, openId: null, done: t('tower.carrierPapers.recorded') }));
        await loadPapers(client);
        return true;
      },
      /** A document a fleet sent is not accepted. The reason is the fleet's to read, so it is required. */
      refuseCarrierPaper: async (did, kind, reason) => {
        const client = clientRef.current;
        if (!client) return false;
        setState((s) => ({ ...s, busyId: did, queueError: null, done: null }));
        const { error } = await client.api.refuseCarrierPaper(did, kind, reason);
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return false;
        }
        setState((s) => ({ ...s, busyId: null, openId: null, done: t('tower.carrierPapers.refusedDone') }));
        await loadPapers(client);
        return true;
      },
      /** FP4 — a fleetless vehicle's papers. The date is the switch in both directions. */
      recordVehiclePapers: async (vehicleId: string, documents: { insuranceRef?: string; insuranceExpiresAt?: string; inspectionRef?: string; inspectionExpiresAt?: string }, plate: string) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: vehicleId, queueError: null, done: null }));
        const { error } = await client.api.setVehicleDocuments(vehicleId, documents);
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, openId: null, done: t('tower.papers.vehicleDone', { plate }) }));
        await loadPapers(client);
      },
      /**
       * BL1 — record a carrier's permission to move uncleared goods.
       *
       * Ours to record because nobody else can: a fleet keeps its own driving licences in the fleet app,
       * and a customs transit licence has no office but this one. A lapsed one stops a carrier being
       * offered bonded work silently, which is the quietest way for a container to sit on a quay.
       */
      recordTransitAuthority: async (carrierDid: string, body: { country: string; reference: string; expiresAt: string }, name: string) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: carrierDid, queueError: null, done: null }));
        const { error } = await client.api.declareTransitAuthority(carrierDid, body);
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, openId: null, done: t('tower.papers.transitDone', { name }) }));
        await loadPapers(client);
      },
      /** BL1 — take one away, always with a reason. The row stays; a carried leg is still a fact. */
      withdrawTransitAuthority: async (carrierDid: string, authorityId: string, reason: string) => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: authorityId, queueError: null, done: null }));
        const { error } = await client.api.withdrawTransitAuthority(carrierDid, authorityId, { reason });
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        setState((s) => ({ ...s, busyId: null, openId: null, done: t('tower.papers.transitWithdrawn') }));
        await loadPapers(client);
      },
      /** FP4 — run the six-hourly check now. What it did is said, even when that is nothing. */
      runPapersSweep: async () => {
        const client = clientRef.current;
        if (!client) return;
        setState((s) => ({ ...s, busyId: 'sweep', queueError: null, done: null }));
        const { data, error } = await client.api.papersSweep();
        if (error) {
          setState((s) => ({ ...s, busyId: null, queueError: error.detail || error.title }));
          return;
        }
        const r = narrow<{ shiftsEnded: number; notified: number; mails: number }>(data);
        setState((s) => ({ ...s, busyId: null, done: t('tower.papers.sweepDone', { shifts: r?.shiftsEnded ?? 0, told: r?.notified ?? 0, mails: r?.mails ?? 0 }) }));
        await loadPapers(client);
      },
      saveRates: (body, lane) => saveKnob(lane, (client, entityId) => client.api.setRates(entityId, body)),
      saveTax: (body, lane) => saveKnob(lane, (client, entityId) => client.api.setTax(entityId, body)),
      saveCover: (body, lane) => saveKnob(lane, (client, entityId) => client.api.setInsurance(entityId, body)),
      // Its own busy id and its own confirmation: this knob is not a lane, and "Saved — default" would
      // tell an operator they had just changed the default LANE, which is a different panel entirely.
      saveTopUpFee: (body) =>
        saveKnob(
          'topUpFee',
          (client, entityId) => client.api.setTopUpFee(entityId, body),
          body.amount === undefined ? t('tower.topupfee.removed') : t('tower.topupfee.saved'),
        ),
      // The company's own list of amounts: not a lane, its own busy id, its own words.
      saveAmounts: (body) => saveKnob('amounts', (client, entityId) => client.api.setAmounts(entityId, body), t('tower.amounts.saved')),
      // Not a lane either, so its own busy id and its own words — same reasoning as the top-up fee.
      saveCarrierPapers: (enforce) =>
        saveKnob(
          'carrierPapers',
          (client, entityId) => client.api.setCarrierPapers(entityId, enforce),
          enforce.length ? t('tower.carrierPapers.saved') : t('tower.carrierPapers.savedNone'),
        ),
    },
  };
}
