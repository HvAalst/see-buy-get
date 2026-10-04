import { createOperatorApi, createSeededClient, makeConfig, publicRequest, type OperatorApi, type Result, type SbgConfig, type SeededAppClient } from '../../lib/sbg';

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
export function enroll(phone: string, pin: string, recovery?: { email: string; code: string }): Promise<Result<PersonAuth>> {
  return publicRequest<PersonAuth>(businessConfig(), '/v1/sbg/identity/enroll', { body: { phone, pin, ...(recovery ? { email: recovery.email, emailCode: recovery.code } : {}) } });
}

export function pinLogin(phone: string, pin: string): Promise<Result<PersonAuth>> {
  return publicRequest<PersonAuth>(businessConfig(), '/v1/sbg/identity/login', { body: { phone, pin } });
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
export interface BusinessClient {
  api: OperatorApi;
  client: SeededAppClient;
  me(): Promise<Result<BusinessView>>;
  update(patch: { name?: string; registrationNo?: string; taxNo?: string | null; activities?: BusinessActivity[] }): Promise<Result<BusinessView>>;
  members(): Promise<Result<{ items: MemberRow[] }>>;
  invite(input: { phone: string; name: string; role: MemberRole }): Promise<Result<MemberRow>>;
  setRole(memberId: string, role: MemberRole): Promise<Result<MemberRow>>;
  remove(memberId: string): Promise<Result<MemberRow>>;
  askForCheck(): Promise<Result<BusinessView>>;
}

export function createBusinessClient(): BusinessClient {
  const client = createSeededClient(businessConfig(), BUSINESS_TOKEN);
  const call = <T>(fn: Parameters<typeof client.sbg.request>[0]) => client.sbg.request(fn) as unknown as Promise<Result<T>>;
  return {
    api: createOperatorApi(client.sbg),
    client,
    me: () => call((c) => c.GET('/v1/sbg/business/me' as never, {} as never) as never),
    update: (patch) => call((c) => c.PATCH('/v1/sbg/business/me' as never, { body: patch } as never) as never),
    members: () => call((c) => c.GET('/v1/sbg/business/me/members' as never, {} as never) as never),
    invite: (input) => call((c) => c.POST('/v1/sbg/business/me/members' as never, { body: input } as never) as never),
    setRole: (memberId, role) => call((c) => c.POST(`/v1/sbg/business/me/members/${encodeURIComponent(memberId)}/role` as never, { body: { role } } as never) as never),
    remove: (memberId) => call((c) => c.DELETE(`/v1/sbg/business/me/members/${encodeURIComponent(memberId)}` as never, {} as never) as never),
    askForCheck: () => call((c) => c.POST('/v1/sbg/business/me/check' as never, {} as never) as never),
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
