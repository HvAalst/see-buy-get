import type { CommercialInvoice, CommercialInvoiceView, Gs1View, PackageLabels } from './papers';
import { readDeviceKey, saveDeviceKey } from '../../shared/account/pin';
import { createAgentApi, createNotificationsApi, createOperatorApi, createSeededClient, makeConfig, publicRequest, type AgentApi, type NotificationsApi, type OperatorApi, type Result, type SbgConfig, type SeededAppClient } from '../../lib/sbg';
import type { QuoteView } from '../../shared/quote';

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
export async function enroll(phone: string, pin: string, recovery?: { email: string; code: string }): Promise<Result<PersonAuth>> {
  const r = await publicRequest<PersonAuth & { device?: string }>(businessConfig(), '/v1/sbg/identity/enroll', { body: { phone, pin, device: readDeviceKey(phone), ...(recovery ? { email: recovery.email, emailCode: recovery.code } : {}) } });
  // The code was typed on this device: it is handed the key the PIN is asked with from now on.
  saveDeviceKey(phone, r.data?.device);
  return r;
}

export function pinLogin(phone: string, pin: string): Promise<Result<PersonAuth>> {
  // `device`: the key this phone or browser was handed when the code was typed on it. Without it the PIN is not looked at.
  return publicRequest<PersonAuth>(businessConfig(), '/v1/sbg/identity/login', { body: { phone, pin, device: readDeviceKey(phone) } });
}

/* ---------------------------------------------------------------- the person -- */

export type BusinessActivity = 'shipper' | 'importer' | 'expeditor' | 'clearing_agent' | 'depot';
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
}

/** The person's own session: which businesses they are in, setting one up, saying yes or no to an invitation. */
export interface PersonClient {
  client: SeededAppClient;
  mine(): Promise<Result<{ items: Membership[] }>>;
  create(input: NewBusiness): Promise<Result<BusinessSession>>;
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
}

export interface BusinessClient {
  api: OperatorApi;
  /** The shipper's calls the Shop app already speaks — posted loads, proposals, runs, bookings, notes, claims. */
  shipping: AgentApi;
  /** The business's inbox: what a carrier or the network told it. Made once per session, so the bell reads it once. */
  notifications: NotificationsApi;
  client: SeededAppClient;
  postLoad(load: NewLoad): Promise<Result<PostedLoad & { settlement?: string }>>;
  freightQuote(freightId: string): Promise<Result<{ quote: QuoteView | null }>>;
  recordFreightQuote(freightId: string, body: { amount?: number; currency?: string; reference?: string; note?: string }): Promise<Result<QuoteView>>;
  /** The run's consignment note, as the page the shipper prints. */
  bookingNote(departureId: string, bookingId: string): Promise<Result<string>>;
  bookingQuote(departureId: string, bookingId: string): Promise<Result<{ quote: QuoteView | null }>>;
  recordBookingQuote(departureId: string, bookingId: string, body: { amount?: number; currency?: string; reference?: string; note?: string }): Promise<Result<QuoteView>>;
  me(): Promise<Result<BusinessView>>;
  update(patch: { name?: string; registrationNo?: string; taxNo?: string | null; activities?: BusinessActivity[] }): Promise<Result<BusinessView>>;
  members(): Promise<Result<{ items: MemberRow[] }>>;
  invite(input: { phone: string; name: string; role: MemberRole }): Promise<Result<MemberRow>>;
  setRole(memberId: string, role: MemberRole): Promise<Result<MemberRow>>;
  remove(memberId: string): Promise<Result<MemberRow>>;
  askForCheck(): Promise<Result<BusinessView>>;
  clients(archived?: boolean): Promise<Result<{ items: Client[] }>>;
  addClient(input: Omit<Client, 'clientId' | 'createdBy' | 'createdAt' | 'archivedAt'>): Promise<Result<Client>>;
  archiveClient(clientId: string, archived: boolean): Promise<Result<Client>>;
  contracts(): Promise<Result<{ items: CarriageContract[] }>>;
  linkContract(code: string): Promise<Result<CarriageContract>>;
  endContract(contractId: string, reason?: string): Promise<Result<CarriageContract>>;
  /** The business's GS1 company prefix: set (owner only), or stop giving codes. */
  setGs1(companyPrefix: string, extensionDigit: number): Promise<Result<BusinessView>>;
  clearGs1(): Promise<Result<BusinessView>>;
  /** A load's package labels: what they carry, and the page to print. */
  packageLabels(freightId: string): Promise<Result<PackageLabels>>;
  packageLabelsPage(freightId: string): Promise<Result<string>>;
  /** A load's commercial invoice: read, write and sign, and the page of three copies. */
  invoice(freightId: string): Promise<Result<CommercialInvoiceView>>;
  writeInvoice(freightId: string, body: Record<string, unknown>): Promise<Result<CommercialInvoice>>;
  invoicePage(freightId: string): Promise<Result<string>>;
}

export function createBusinessClient(): BusinessClient {
  const client = createSeededClient(businessConfig(), BUSINESS_TOKEN);
  const call = <T>(fn: Parameters<typeof client.sbg.request>[0]) => client.sbg.request(fn) as unknown as Promise<Result<T>>;
  return {
    api: createOperatorApi(client.sbg),
    shipping: createAgentApi(client.sbg),
    notifications: createNotificationsApi(client.sbg),
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
    contracts: () => call((c) => c.GET('/v1/sbg/business/me/contracts' as never, {} as never) as never),
    linkContract: (code) => call((c) => c.POST('/v1/sbg/business/me/contracts/link' as never, { body: { code } } as never) as never),
    endContract: (contractId, reason) => call((c) => c.POST(`/v1/sbg/business/me/contracts/${encodeURIComponent(contractId)}/end` as never, { body: reason ? { reason } : {} } as never) as never),
    setGs1: (companyPrefix, extensionDigit) => call((c) => c.POST('/v1/sbg/business/me/gs1' as never, { body: { companyPrefix, extensionDigit } } as never) as never),
    clearGs1: () => call((c) => c.DELETE('/v1/sbg/business/me/gs1' as never, {} as never) as never),
    packageLabels: (freightId) => call((c) => c.GET(`/v1/sbg/dispatch/freight/${encodeURIComponent(freightId)}/package-labels` as never, {} as never) as never),
    packageLabelsPage: (freightId) => call((c) => c.GET(`/v1/sbg/dispatch/freight/${encodeURIComponent(freightId)}/package-labels.html` as never, { parseAs: 'text' } as never) as never),
    invoice: (freightId) => call((c) => c.GET(`/v1/sbg/dispatch/freight/${encodeURIComponent(freightId)}/commercial-invoice` as never, {} as never) as never),
    writeInvoice: (freightId, body) => call((c) => c.POST(`/v1/sbg/dispatch/freight/${encodeURIComponent(freightId)}/commercial-invoice` as never, { body } as never) as never),
    invoicePage: (freightId) => call((c) => c.GET(`/v1/sbg/dispatch/freight/${encodeURIComponent(freightId)}/commercial-invoice.html` as never, { parseAs: 'text' } as never) as never),
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
