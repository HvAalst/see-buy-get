import type { SystemMessage, SystemView } from './system';
import type { NotPaidView, PaidAnswerView, PaidDirectView } from '../../shared/paidDirect';
import type { Agreement, MyAgreement } from '../../shared/documents/documents';
import type { Gs1DisputeView } from './gs1Dispute';
import type { CompanyKey, CompanyKeyIssued } from '../../shared/companyKeys';
import type { CommercialInvoice, CommercialInvoiceView, Gs1View, PackageLabels } from './papers';
import { readDeviceKey, saveDeviceKey } from '../../shared/account/pin';
import { createAgentApi, createNotificationsApi, createOperatorApi, createSeededClient, makeConfig, publicRequest, type AgentApi, type NotificationsApi, type OperatorApi, type Result, type SbgConfig, type SeededAppClient } from '../../lib/sbg';
import { inboundApi, type InboundApi } from './inbound';
import { exportsApi, type ExportsApi } from './exports';
import type { QuoteView } from '../../shared/quote';
import type { ArrivalView, CrossingView, PassageView } from '../../shared/passages';
import type { SealView } from '../../shared/seals';
import type { UnitHold } from '../../shared/tamper';
import type { HeldByAuthorityView } from '../../shared/heldByAuthority';
import { downscaleImage } from '../../shared/media';
import type { SealsView } from './seals';

const APP_VERSION = '1.0.0';

/**
 * THE BUSINESS APP'S TWO SESSIONS — the person, and the business they are acting for.
 *
 * A person signs in with their own phone and PIN; that token says who they are, and opens the list of businesses
 * they are in. Opening ONE business mints a second token that acts as the business (its DID, its entityId as the
 * tenant, the member's name on everything they do). Both live in sessionStorage, for the console's reason: this is a
 * desk shared by an office, and a session that outlived the tab would outlive the person who opened it.
 *
 * What lives in localStorage is only what makes coming back quick: who last signed in here (so the phone is filled
 * in) and which business they last opened. Never a token, never a PIN.
 */
export function businessConfig(): SbgConfig {
  return makeConfig('business', APP_VERSION);
}

const PERSON_TOKEN = 'sbg:business:person';
const BUSINESS_TOKEN = 'sbg:business:session';

/* --------------------------------------------------------------- before a token -- */

export function requestOtp(phone: string): Promise<Result<{ sent: boolean; code?: string }>> {
  return publicRequest(businessConfig(), '/v1/sbg/auth/phone/request', { body: { phone } });
}

export function verifyOtp(phone: string, code: string): Promise<Result<{ verified: boolean }>> {
  return publicRequest(businessConfig(), '/v1/sbg/auth/phone/verify', { body: { phone, code } });
}

export interface PersonAuth {
  personId: string;
  hasPin: boolean;
  displayName?: string;
  token: { access_token: string; expires_in?: number };
}

/** A verified phone, a new PIN, and — the first time — a confirmed recovery email behind it. */
export async function enroll(phone: string, pin: string, recovery?: { email: string; code: string }, agreement?: Agreement | null): Promise<Result<PersonAuth>> {
  const r = await publicRequest<PersonAuth & { device?: string }>(businessConfig(), '/v1/sbg/identity/enroll', { body: { phone, pin, device: readDeviceKey(phone), ...(recovery ? { email: recovery.email, emailCode: recovery.code } : {}), ...(agreement ? { agreement } : {}) } });
  // The code was typed on this device: it is handed the key the PIN is asked with from now on.
  saveDeviceKey(phone, r.data?.device);
  return r;
}

export function pinLogin(phone: string, pin: string): Promise<Result<PersonAuth>> {
  // `device`: the key this phone or browser was handed when the code was typed on it. Without it the PIN is not looked at.
  return publicRequest<PersonAuth>(businessConfig(), '/v1/sbg/identity/login', { body: { phone, pin, device: readDeviceKey(phone) } });
}

/* ---------------------------------------------------------------- the person -- */

export type BusinessActivity = 'shipper' | 'importer' | 'expeditor' | 'clearing_agent' | 'depot' | 'receiver';
export type MemberRole = 'owner' | 'booker' | 'finance' | 'viewer';
export type CheckState = 'unverified' | 'asked' | 'checking' | 'verified' | 'refused';

export interface Membership {
  memberId: string;
  entityId: string;
  name: string;
  country: string;
  role: MemberRole;
  state: 'invited' | 'joined';
  invitedBy: string;
  checked: CheckState;
}

export interface MemberRow {
  memberId: string;
  name: string;
  role: MemberRole;
  state: 'invited' | 'joined';
  phoneEnds: string;
  invitedBy: string;
  invitedAt: string;
  joinedAt?: string;
  you: boolean;
}

export interface BusinessView {
  entityId: string;
  name: string;
  country: string;
  activities: BusinessActivity[];
  registrationNo: string;
  taxNo?: string;
  /** The sender's address on its consignment notes. */
  address?: string;
  check: { state: CheckState; askedAt?: string; verifiedAt?: string; refusedAt?: string; reason?: string; missing: string[] };
  handle?: string;
  createdAt: string;
  you: MemberRow;
  /** Its GS1 company prefix, when it gave one: its packages then carry SSCCs beside our code. */
  gs1?: Gs1View;
}

export interface BusinessSession {
  token: { access_token: string; expires_in?: number };
  business: BusinessView;
}

export interface NewBusiness {
  name: string;
  country: string;
  registrationNo: string;
  taxNo?: string;
  activities: BusinessActivity[];
  yourName: string;
  /** Asked only where the business's country asks what the person did not agree to yet (its own documents). */
  agreement?: Agreement;
}

/** The person's own session: which businesses they are in, setting one up, saying yes or no to an invitation. */
export interface PersonClient {
  client: SeededAppClient;
  mine(): Promise<Result<{ items: Membership[] }>>;
  create(input: NewBusiness): Promise<Result<BusinessSession>>;
  /** Where the person stands with what a country asks them to agree to — before a business is set up there. */
  myAgreement(country: string): Promise<Result<MyAgreement>>;
  accept(memberId: string): Promise<Result<Membership>>;
  decline(memberId: string): Promise<Result<{ declined: true }>>;
  open(entityId: string): Promise<Result<BusinessSession>>;
}

export function createPersonClient(): PersonClient {
  const client = createSeededClient(businessConfig(), PERSON_TOKEN);
  const call = <T>(fn: Parameters<typeof client.sbg.request>[0]) => client.sbg.request(fn) as unknown as Promise<Result<T>>;
  return {
    client,
    mine: () => call((c) => c.GET('/v1/sbg/business/mine' as never, {} as never) as never),
    create: (input) => call((c) => c.POST('/v1/sbg/business' as never, { body: input } as never) as never),
    myAgreement: (country) => call((c) => c.GET('/v1/sbg/agreement/mine' as never, { params: { query: { country } } } as never) as never),
    accept: (memberId) => call((c) => c.POST(`/v1/sbg/business/invitations/${encodeURIComponent(memberId)}/accept` as never, {} as never) as never),
    decline: (memberId) => call((c) => c.POST(`/v1/sbg/business/invitations/${encodeURIComponent(memberId)}/decline` as never, {} as never) as never),
    open: (entityId) => call((c) => c.POST(`/v1/sbg/business/${encodeURIComponent(entityId)}/session` as never, {} as never) as never),
  };
}

/* ---------------------------------------------------------- acting for a business -- */

/**
 * The session that acts as one business.
 *
 * `api` is the same client the console's import and yard screens already speak, which is what lets the Business app
 * host those screens as they stand: the server decides what a business sign-in may reach, never the screen.
 */
/** B4 — a client in an expeditor's book, and who a load or booking was sent for. */
export interface Client {
  clientId: string;
  name: string;
  country?: string;
  address?: string;
  contactName?: string;
  contactPhone?: string;
  contactEmail?: string;
  createdBy: string;
  createdAt: string;
  archivedAt?: string;
  /** Round 20 — the client's own GS1 prefix, entered by the forwarder. */
  gs1?: Gs1View;
}
export interface ClientRef {
  clientId: string;
  name: string;
  country?: string;
  address?: string;
}

/** B2 — a load the business posted, as its list reads it. */
export interface PostedLoad {
  freightId: string;
  code: string;
  /** FP3b — the doors the driver stood at and could not hand over at, most recent last. */
  attempts?: Array<{ outcome: 'absent' | 'refused' | 'unreachable'; note?: string; at: string }>;
  /** Refused at the door (the user, 2026-10-27): by when the business says where the goods go, and what it said. */
  refusal?: import('../../shared/refusal').Refusal;
  canDecideRefusal?: boolean;
  /** Where it was picked up — where "back" takes refused goods. */
  pickupLabel?: string;
  /** A return: the load its goods were refused on. */
  returnOf?: { freightId: string; code: string };
  /** FP7 — box 13: what the driver is told, and whether the business may still rewrite it ('edit'), only add to it ('amend'), or neither. */
  instructions?: import('../../shared/instructions').InstructionsView;
  instructionsMode?: 'edit' | 'amend' | 'none';
  /** The money its prices are in: the business’s own, stamped when it was posted. */
  currency?: string;
  /** One load of an order its carrier brings in several: which one, of how many, of which order. */
  partOf?: { rootCode: string; no: number; of: number; orderKg: number };
  /** The carrier's accepted plan has it outside the window asked for: about when, the window as the plan read it, by how much. */
  outsideWindow?: { day: string; arrive: string; window?: string; lateMin?: number; earlyMin?: number };
  /** About when the carrier's accepted plan has it at the door, while it is still on its way. */
  plannedAbout?: { day: string; arrive: string; window?: string };
  /** The carrier's accepted plan for its day leaves it on no vehicle, and why as a shipper is told it. */
  leftOut?: { day: string; why: 'room' | 'fit' | 'heavy' | 'place' | 'closed' };
  /** Not delivered, and wrong on its carrier's own clock: on no vehicle on its day, its planned hour passed, or its whole day. */
  runningLate?: 'unplanned' | 'hour' | 'day';
  /** Delivered: when, on the carrier's clock, and where that fell against the day and the window asked for. */
  deliveryTiming?: { timeZone: string; day: string; at: string; otherDay?: 'early' | 'late'; window?: string; lateMin?: number; earlyMin?: number };
  description: string;
  destLabel: string;
  weightKg: number;
  status: string;
  commitMode: 'instant' | 'negotiate';
  scheduledPickupAt?: string;
  createdAt: string;
  openProposals: number;
  agreedPrice?: number;
  pickedUpAt?: string;
  deliveredAt?: string;
  receiverName?: string;
  /** D9 — what the receiver found not as the note says, at the handover. */
  exceptions?: import('../../shared/found').FoundLine[];
  /** FP3b/CL1 — a claim on the delivered goods: whether one may still be made, the one made, and who carries the risk. */
  canClaim?: boolean;
  claim?: import('./claim').LoadClaim;
  incoterm?: string;
  claimant?: 'sender' | 'receiver';
  cancelledAt?: string;
  /** Its consignment note in the archive, once a copy is kept there (from taking over on): what its links hang on. */
  noteId?: string;
  canCancel: boolean;
  trackingKey?: string;
  trackingUrl?: string;
  carrier?: { driverName?: string; plate?: string; vehicleClass?: string };
  rating?: { stars: number; issues: string[]; at: string };
  canRate: boolean;
  /** B4 — the client it was sent for, as their agent. */
  onBehalfOf?: ClientRef;
  /** P1 — ordered under a standing contract: with which fleet, and the day it must arrive. */
  contract?: ContractRef;
  deliverOn?: string;
  orderRef?: string;
  /** Round 14 — what its driver said on the road: at a border post, cleared it, at a hub. In order; never who, never where. */
  passages?: PassageView[];
  /** Round 14 — on the road across a border: where it has got to, the wait it is allowed and on what, when it is expected. */
  crossing?: CrossingView;
  /** Round 15 — its seals, and what became of each. */
  seals?: SealView[];
  /** Round 35 — held under the tamper protocol: what was found, where, since when. */
  held?: UnitHold;
  /** Held by the police, customs or another authority on the road, as its driver said: who and where, since when. */
  heldByAuthority?: HeldByAuthorityView;
  /** Round 25 — its cold chain broken on the road: the reading that broke it, the band, when — and when it reached us, if later. */
  coldChainBroken?: { celsius: number; at: string; minC: number; maxC: number; receivedAt?: string };
  /** A match: the business pays the driver directly — and, once the carrier says so, that it was paid (2026-10-27). */
  paysDriverDirect?: boolean;
  paidDirect?: PaidDirectView;
  notPaidDirect?: NotPaidView;
  /** …and its answer that it paid, with a reference; or that it may still answer. */
  paidDirectAnswer?: PaidAnswerView;
  canAnswerNotPaid?: boolean;
  /** Round 26 — in one country, on the road: when it is expected, and at what pace. Absent where its carrier's plan has the hour. */
  arrival?: ArrivalView;
}

/** P1 — the copy of a contract an order carries. */
export interface ContractRef {
  contractId: string;
  fleetDid: string;
  fleetName: string;
  shipperName: string;
  reference?: string;
}

/** P1 — a standing contract with a fleet, as either side reads it. The terms are on their own paper. */
export interface CarriageContract {
  contractId: string;
  fleetDid: string;
  fleetName: string;
  shipper: { name: string; entityId?: string; linkedAt?: string; linkedBy?: string };
  reference?: string;
  startsOn?: string;
  endsOn?: string;
  status: 'active' | 'ended';
  createdAt: string;
  createdBy: string;
  ended?: { at: string; side: 'fleet' | 'shipper'; by: string; reason?: string };
  inviteExpiresAt?: string;
}

export interface LoadProposal {
  proposalId: string;
  price: number;
  note?: string;
  status: 'open' | 'accepted' | 'declined' | 'withdrawn' | 'superseded';
  createdAt: string;
}

/** What a business sends to post a load. The two ends are saved places; the server takes their name and point. */
export interface NewLoad {
  description: string;
  pickupLabel: string;
  pickupLocation: { lat: number; lng: number };
  destLabel: string;
  destLocation: { lat: number; lng: number };
  pickupCountry?: string;
  destCountry?: string;
  weightKg: number;
  packaging?: string;
  /** CMR box 2 — who receives the goods. */
  consignee?: { name: string; address?: string };
  /** CMR box 9 — dangerous goods by their UN number, proper shipping name, class and packing group. */
  dangerousGoods?: { unNumber: string; properShippingName: string; hazardClass: string; packingGroup?: string };
  /** CMR box 13 — instructions for customs. */
  customsInstructions?: string;
  /** Only a carrier whose insurance cover SeeBuyGet has checked may take it. */
  coverRequired?: boolean;
  /** How many packages: each gets a label, and an SSCC under the business's GS1 prefix. */
  packages?: number;
  natureCode?: string;
  fragile?: boolean;
  commitMode: 'instant' | 'negotiate';
  instructions?: string;
  contactName?: string;
  contactPhone?: string;
  deliveryWindow?: string;
  scheduledPickupAt?: string;
  dimensionsCm?: { l: number; w: number; h: number };
  /** B4 — sent for one of the business's own clients, as their agent. */
  forClientId?: string;
  /** P1 — ordered under a standing contract, for the day it must arrive. */
  contractId?: string;
  deliverOn?: string;
  /** P1b — the business's own number for the order. Used once per contract. */
  orderRef?: string;
  /** Inbound, reading A: to another business's receiving point, by the code it gave, and its own number for the order. */
  receivingPoint?: string;
  receiverRef?: string;
}

export interface BusinessClient {
  api: OperatorApi;
  /** The shipper's calls the Shop app already speaks — posted loads, proposals, runs, bookings, notes, claims. */
  shipping: AgentApi;
  /** The business's inbox: what a carrier or the network told it. Made once per session, so the bell reads it once. */
  notifications: NotificationsApi;
  /** Inbound, reading A: its receiving points, and what is coming in to them. */
  inbound: InboundApi;
  /** Exports to the port (2026-10-27): the booking's cut-off, the legs to the terminal, the weight, the papers, the file. */
  exports: ExportsApi;
  client: SeededAppClient;
  postLoad(load: NewLoad): Promise<Result<PostedLoad & { settlement?: string }>>;
  freightQuote(freightId: string): Promise<Result<{ quote: QuoteView | null }>>;
  recordFreightQuote(freightId: string, body: { amount?: number; currency?: string; reference?: string; note?: string }): Promise<Result<QuoteView>>;
  /** The run's consignment note, as the page the shipper prints. */
  bookingNote(departureId: string, bookingId: string): Promise<Result<string>>;
  bookingQuote(departureId: string, bookingId: string): Promise<Result<{ quote: QuoteView | null }>>;
  recordBookingQuote(departureId: string, bookingId: string, body: { amount?: number; currency?: string; reference?: string; note?: string }): Promise<Result<QuoteView>>;
  me(): Promise<Result<BusinessView>>;
  update(patch: { name?: string; registrationNo?: string; taxNo?: string | null; address?: string | null; activities?: BusinessActivity[] }): Promise<Result<BusinessView>>;
  members(): Promise<Result<{ items: MemberRow[] }>>;
  invite(input: { phone: string; name: string; role: MemberRole }): Promise<Result<MemberRow>>;
  setRole(memberId: string, role: MemberRole): Promise<Result<MemberRow>>;
  remove(memberId: string): Promise<Result<MemberRow>>;
  askForCheck(): Promise<Result<BusinessView>>;
  clients(archived?: boolean): Promise<Result<{ items: Client[] }>>;
  addClient(input: Omit<Client, 'clientId' | 'createdBy' | 'createdAt' | 'archivedAt'>): Promise<Result<Client>>;
  archiveClient(clientId: string, archived: boolean): Promise<Result<Client>>;
  /** Round 20 — the client's own GS1 prefix (owner only): its loads' packages are coded under it. */
  setClientGs1(clientId: string, companyPrefix: string, extensionDigit: number): Promise<Result<Client>>;
  clearClientGs1(clientId: string): Promise<Result<Client>>;
  contracts(): Promise<Result<{ items: CarriageContract[] }>>;
  linkContract(code: string): Promise<Result<CarriageContract>>;
  endContract(contractId: string, reason?: string): Promise<Result<CarriageContract>>;
  /** The business's GS1 company prefix: set (owner only), or stop giving codes. */
  setGs1(companyPrefix: string, extensionDigit: number): Promise<Result<BusinessView>>;
  clearGs1(): Promise<Result<BusinessView>>;
  /** Round 18 — the disputes over a GS1 prefix this business is in; open one with its licence, send its own, take it back. */
  gs1Disputes(): Promise<Result<{ items: Gs1DisputeView[] }>>;
  openGs1Dispute(body: { companyPrefix: string; extensionDigit: number; licenceRef: string; note?: string; forClientId?: string }): Promise<Result<Gs1DisputeView>>;
  sendGs1Licence(disputeId: string, licenceRef: string, note?: string): Promise<Result<Gs1DisputeView>>;
  withdrawGs1Dispute(disputeId: string): Promise<Result<Gs1DisputeView>>;
  /** A photograph or screenshot of its GS1 licence, uploaded: the media id, or null when it did not go. */
  licencePhoto(file: File): Promise<string | null>;
  /** Round 10 — its own system, told of its loads: what it hears, and what became of each message. */
  system(): Promise<Result<SystemView>>;
  setSystemAddress(url: string): Promise<Result<SystemView>>;
  turnSystemSecret(): Promise<Result<SystemView>>;
  testSystem(): Promise<Result<SystemMessage>>;
  resendSystemMessage(messageId: string): Promise<Result<SystemMessage>>;
  /** Round 12 — its keys, for its own systems: read by everybody, made and taken away by an owner. */
  keys(): Promise<Result<{ items: CompanyKey[] }>>;
  issueKey(mode: 'live' | 'test', label?: string): Promise<Result<CompanyKeyIssued>>;
  revokeKey(keyId: string): Promise<Result<CompanyKey>>;
  /** A load's package labels: what they carry, and the page to print. */
  packageLabels(freightId: string): Promise<Result<PackageLabels>>;
  packageLabelsPage(freightId: string): Promise<Result<string>>;
  /** Round 27 — the same labels for a thermal label printer (ZPL). */
  packageLabelsZpl(freightId: string): Promise<Result<string>>;
  /** A load's commercial invoice: read, write and sign, and the page of three copies. */
  invoice(freightId: string): Promise<Result<CommercialInvoiceView>>;
  writeInvoice(freightId: string, body: Record<string, unknown>): Promise<Result<CommercialInvoice>>;
  invoicePage(freightId: string): Promise<Result<string>>;
  /** Our own paper invoice travels with the goods — or no longer. */
  ownPaper(freightId: string, travels: boolean): Promise<Result<{ ownPaper: { by: string; at: string } | null }>>;
  /** Round 15 — a load's seals: read by everybody in the business; written and taken off by a member who may act, before pickup. */
  seals(freightId: string): Promise<Result<SealsView>>;
  writeSeal(freightId: string, body: Record<string, unknown>): Promise<Result<SealView>>;
  removeSeal(freightId: string, sealId: string): Promise<Result<{ removed: true }>>;
  /** A photograph for a seal, taken here: its id, or null when it could not be sent. */
  sealPhoto(file: File): Promise<string | null>;
  /** A photo of a problem with goods delivered, sent with a claim on them. */
  claimPhoto(file: File): Promise<string | null>;
}

export function createBusinessClient(): BusinessClient {
  const client = createSeededClient(businessConfig(), BUSINESS_TOKEN);
  const call = <T>(fn: Parameters<typeof client.sbg.request>[0]) => client.sbg.request(fn) as unknown as Promise<Result<T>>;
  return {
    api: createOperatorApi(client.sbg),
    shipping: createAgentApi(client.sbg),
    notifications: createNotificationsApi(client.sbg),
    inbound: inboundApi(client.sbg),
    exports: exportsApi(client.sbg),
    client,
    postLoad: (load) => call((c) => c.POST('/v1/sbg/dispatch/freight' as never, { body: load } as never) as never),
    freightQuote: (freightId) => call((c) => c.GET(`/v1/sbg/dispatch/freight/${encodeURIComponent(freightId)}/quote` as never, {} as never) as never),
    recordFreightQuote: (freightId, body) => call((c) => c.POST(`/v1/sbg/dispatch/freight/${encodeURIComponent(freightId)}/quote` as never, { body } as never) as never),
    bookingNote: (departureId, bookingId) =>
      client.sbg.request(
        (c) => c.GET(`/v1/sbg/departures/${encodeURIComponent(departureId)}/bookings/${encodeURIComponent(bookingId)}/consignment-note.html` as never, { parseAs: 'text' } as never) as never,
      ) as unknown as Promise<Result<string>>,
    bookingQuote: (departureId, bookingId) =>
      call((c) => c.GET(`/v1/sbg/departures/${encodeURIComponent(departureId)}/bookings/${encodeURIComponent(bookingId)}/quote` as never, {} as never) as never),
    recordBookingQuote: (departureId, bookingId, body) =>
      call((c) => c.POST(`/v1/sbg/departures/${encodeURIComponent(departureId)}/bookings/${encodeURIComponent(bookingId)}/quote` as never, { body } as never) as never),
    me: () => call((c) => c.GET('/v1/sbg/business/me' as never, {} as never) as never),
    update: (patch) => call((c) => c.PATCH('/v1/sbg/business/me' as never, { body: patch } as never) as never),
    members: () => call((c) => c.GET('/v1/sbg/business/me/members' as never, {} as never) as never),
    invite: (input) => call((c) => c.POST('/v1/sbg/business/me/members' as never, { body: input } as never) as never),
    setRole: (memberId, role) => call((c) => c.POST(`/v1/sbg/business/me/members/${encodeURIComponent(memberId)}/role` as never, { body: { role } } as never) as never),
    remove: (memberId) => call((c) => c.DELETE(`/v1/sbg/business/me/members/${encodeURIComponent(memberId)}` as never, {} as never) as never),
    askForCheck: () => call((c) => c.POST('/v1/sbg/business/me/check' as never, {} as never) as never),
    clients: (archived) => call((c) => c.GET('/v1/sbg/business/me/clients' as never, { params: { query: archived ? { archived: 'true' } : {} } } as never) as never),
    addClient: (input) => call((c) => c.POST('/v1/sbg/business/me/clients' as never, { body: input } as never) as never),
    archiveClient: (clientId, archived) => call((c) => c.POST(`/v1/sbg/business/me/clients/${encodeURIComponent(clientId)}/archive` as never, { body: { archived } } as never) as never),
    setClientGs1: (clientId, companyPrefix, extensionDigit) => call((c) => c.POST(`/v1/sbg/business/me/clients/${encodeURIComponent(clientId)}/gs1` as never, { body: { companyPrefix, extensionDigit } } as never) as never),
    clearClientGs1: (clientId) => call((c) => c.DELETE(`/v1/sbg/business/me/clients/${encodeURIComponent(clientId)}/gs1` as never, {} as never) as never),
    contracts: () => call((c) => c.GET('/v1/sbg/business/me/contracts' as never, {} as never) as never),
    linkContract: (code) => call((c) => c.POST('/v1/sbg/business/me/contracts/link' as never, { body: { code } } as never) as never),
    endContract: (contractId, reason) => call((c) => c.POST(`/v1/sbg/business/me/contracts/${encodeURIComponent(contractId)}/end` as never, { body: reason ? { reason } : {} } as never) as never),
    setGs1: (companyPrefix, extensionDigit) => call((c) => c.POST('/v1/sbg/business/me/gs1' as never, { body: { companyPrefix, extensionDigit } } as never) as never),
    clearGs1: () => call((c) => c.DELETE('/v1/sbg/business/me/gs1' as never, {} as never) as never),
    gs1Disputes: () => call((c) => c.GET('/v1/sbg/business/me/gs1/disputes' as never, {} as never) as never),
    openGs1Dispute: (body) => call((c) => c.POST('/v1/sbg/business/me/gs1/disputes' as never, { body } as never) as never),
    sendGs1Licence: (disputeId, licenceRef, note) =>
      call((c) => c.POST(`/v1/sbg/business/me/gs1/disputes/${encodeURIComponent(disputeId)}/licence` as never, { body: { licenceRef, ...(note?.trim() ? { note: note.trim() } : {}) } } as never) as never),
    withdrawGs1Dispute: (disputeId) => call((c) => c.POST(`/v1/sbg/business/me/gs1/disputes/${encodeURIComponent(disputeId)}/withdraw` as never, {} as never) as never),
    licencePhoto: async (file) => {
      try {
        const { dataUrl, thumbDataUrl } = await downscaleImage(file);
        const r = await createOperatorApi(client.sbg).uploadMedia('gs1_licence', dataUrl, thumbDataUrl);
        return r.error ? null : ((r.data as { mediaId?: string } | undefined)?.mediaId ?? null);
      } catch {
        return null;
      }
    },
    system: () => call((c) => c.GET('/v1/sbg/business/me/system' as never, {} as never) as never),
    setSystemAddress: (url) => call((c) => c.PUT('/v1/sbg/business/me/system' as never, { body: { url } } as never) as never),
    turnSystemSecret: () => call((c) => c.POST('/v1/sbg/business/me/system/secret' as never, {} as never) as never),
    testSystem: () => call((c) => c.POST('/v1/sbg/business/me/system/test' as never, {} as never) as never),
    resendSystemMessage: (messageId) => call((c) => c.POST(`/v1/sbg/business/me/system/messages/${encodeURIComponent(messageId)}/resend` as never, {} as never) as never),
    keys: () => call((c) => c.GET('/v1/sbg/business/me/keys' as never, {} as never) as never),
    issueKey: (mode, label) => call((c) => c.POST('/v1/sbg/business/me/keys' as never, { body: { mode, ...(label ? { label } : {}) } } as never) as never),
    revokeKey: (keyId) => call((c) => c.POST(`/v1/sbg/business/me/keys/${encodeURIComponent(keyId)}/revoke` as never, {} as never) as never),
    packageLabels: (freightId) => call((c) => c.GET(`/v1/sbg/dispatch/freight/${encodeURIComponent(freightId)}/package-labels` as never, {} as never) as never),
    packageLabelsPage: (freightId) => call((c) => c.GET(`/v1/sbg/dispatch/freight/${encodeURIComponent(freightId)}/package-labels.html` as never, { parseAs: 'text' } as never) as never),
    packageLabelsZpl: (freightId) => call((c) => c.GET(`/v1/sbg/dispatch/freight/${encodeURIComponent(freightId)}/package-labels.zpl` as never, { parseAs: 'text' } as never) as never),
    invoice: (freightId) => call((c) => c.GET(`/v1/sbg/dispatch/freight/${encodeURIComponent(freightId)}/commercial-invoice` as never, {} as never) as never),
    writeInvoice: (freightId, body) => call((c) => c.POST(`/v1/sbg/dispatch/freight/${encodeURIComponent(freightId)}/commercial-invoice` as never, { body } as never) as never),
    invoicePage: (freightId) => call((c) => c.GET(`/v1/sbg/dispatch/freight/${encodeURIComponent(freightId)}/commercial-invoice.html` as never, { parseAs: 'text' } as never) as never),
    ownPaper: (freightId, travels) => call((c) => c.POST(`/v1/sbg/dispatch/freight/${encodeURIComponent(freightId)}/commercial-invoice/own-paper` as never, { body: { travels } } as never) as never),
    seals: (freightId) => call((c) => c.GET(`/v1/sbg/dispatch/freight/${encodeURIComponent(freightId)}/seals` as never, {} as never) as never),
    writeSeal: (freightId, body) => call((c) => c.POST(`/v1/sbg/dispatch/freight/${encodeURIComponent(freightId)}/seals` as never, { body } as never) as never),
    removeSeal: (freightId, sealId) => call((c) => c.DELETE(`/v1/sbg/dispatch/freight/${encodeURIComponent(freightId)}/seals/${encodeURIComponent(sealId)}` as never, {} as never) as never),
    claimPhoto: async (file) => {
      try {
        const { dataUrl, thumbDataUrl } = await downscaleImage(file);
        const r = await createOperatorApi(client.sbg).uploadMedia('dispute', dataUrl, thumbDataUrl);
        return r.error ? null : ((r.data as { mediaId?: string } | undefined)?.mediaId ?? null);
      } catch {
        return null;
      }
    },
    sealPhoto: async (file) => {
      try {
        const { dataUrl, thumbDataUrl } = await downscaleImage(file);
        const r = await createOperatorApi(client.sbg).uploadMedia('seal', dataUrl, thumbDataUrl);
        return r.error ? null : ((r.data as { mediaId?: string } | undefined)?.mediaId ?? null);
      } catch {
        return null;
      }
    },
  };
}

/** Sign-out drops both sessions. Either one left behind is a way back in. */
export function clearSessions(): void {
  try {
    globalThis.sessionStorage?.removeItem(PERSON_TOKEN);
    globalThis.sessionStorage?.removeItem(BUSINESS_TOKEN);
  } catch {
    /* nothing was stored */
  }
}

/** Leaving one business for the list drops only its session. */
export function clearBusinessSession(): void {
  try {
    globalThis.sessionStorage?.removeItem(BUSINESS_TOKEN);
  } catch {
    /* nothing was stored */
  }
}

/* ------------------------------------------------------------- coming back -- */

/**
 * `glos-business-did` is read by the front page too: a device that has signed in here is offered the Business app
 * first next time (presence only — the front page never reads what is in it).
 */
const DID_KEY = 'glos-business-did';
const PHONE_KEY = 'glos-business-phone';
const LAST_KEY = 'glos-business-last';

function get(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function set(key: string, value: string | null): void {
  try {
    if (value === null) globalThis.localStorage?.removeItem(key);
    else globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage blocked — coming back just takes the long way */
  }
}

export const readPhone = (): string | null => get(PHONE_KEY);
export const rememberPerson = (personDid: string, phone: string): void => {
  set(DID_KEY, personDid);
  set(PHONE_KEY, phone);
};
/** Signed out: the front page stops offering this app first. The phone stays, so signing back in is one PIN. */
export const signedOutHere = (): void => {
  set(DID_KEY, null);
  set(LAST_KEY, null);
};
export const forgetPerson = (): void => {
  set(DID_KEY, null);
  set(PHONE_KEY, null);
  set(LAST_KEY, null);
};
export const readLast = (): string | null => get(LAST_KEY);
export const rememberLast = (entityId: string | null): void => set(LAST_KEY, entityId);
