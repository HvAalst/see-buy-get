import type { CodeWay } from '../../shared/account/CodeWays';
import { readDeviceKey, saveDeviceKey } from '../../shared/account/pin';
import { secretBody } from '../../shared/account/unlock';
import type { Agreement } from '../../shared/documents/documents';
import { dropInvite, inviteBody } from '../../shared/invite';
import type { PartnerOwedRow } from '../../shared/partnerOwed';
import { createSeededClient, makeConfig, publicRequest, type Result, type SbgConfig, type SeededAppClient } from '../../lib/sbg';

const APP_VERSION = '1.0.0';

/**
 * 2026-11-20 — THE PARTNER APP'S TWO SESSIONS (the payments plan, 3c; the owner: a separate Partner app, with a live view) —
 * the person, and the partner they read for, as the Business app has them.
 *
 * A person signs in with their own phone and PIN; that token says who they are, and opens the list of partners they are in
 * or invited to. Opening ONE partner mints a second token that reads for it (its DID, its entityId as the tenant, the
 * member's name). Both live in sessionStorage: a partner's office is often a shared desk, and a session that outlived the tab
 * would outlive the person who opened it. In localStorage only what makes coming back quick: who last signed in here and
 * which partner they last opened. Never a token, never a PIN.
 */
export function partnerConfig(): SbgConfig {
  return makeConfig('partner', APP_VERSION);
}

const PERSON_TOKEN = 'sbg:partner:person';
const PARTNER_TOKEN = 'sbg:partner:session';

/* --------------------------------------------------------------- before a token -- */

export function requestOtp(phone: string, via?: CodeWay): Promise<Result<{ sent: boolean; code?: string }>> {
  return publicRequest(partnerConfig(), '/v1/sbg/auth/phone/request', { body: { phone, ...(via ? { via } : {}) } });
}

export function verifyOtp(phone: string, code: string): Promise<Result<{ verified: boolean }>> {
  return publicRequest(partnerConfig(), '/v1/sbg/auth/phone/verify', { body: { phone, code } });
}

export interface PersonAuth {
  personId: string;
  hasPin: boolean;
  displayName?: string;
  token: { access_token: string; expires_in?: number };
}

/** A verified phone, a new PIN, and — the first time — a confirmed recovery email behind it. */
export async function enroll(phone: string, pin: string, recovery?: { email: string; code: string }, agreement?: Agreement | null): Promise<Result<PersonAuth>> {
  const r = await publicRequest<PersonAuth & { device?: string }>(partnerConfig(), '/v1/sbg/identity/enroll', { body: { phone, pin, device: readDeviceKey(phone), ...inviteBody(), ...(recovery ? { email: recovery.email, emailCode: recovery.code } : {}), ...(agreement ? { agreement } : {}) } });
  if (r.data) dropInvite();
  // The code was typed on this device: it is handed the key the PIN is asked with from now on.
  saveDeviceKey(phone, r.data?.device);
  return r;
}

export function pinLogin(phone: string, pin: string): Promise<Result<PersonAuth>> {
  return publicRequest<PersonAuth>(partnerConfig(), '/v1/sbg/identity/login', { body: { phone, ...secretBody(pin), device: readDeviceKey(phone) } });
}

/* ---------------------------------------------------------------- the person -- */

export interface Membership {
  memberId: string;
  entityId: string;
  name: string;
  country: string;
  state: 'invited' | 'joined';
  invitedBy: string;
}

export interface PartnerMe {
  entityId: string;
  name: string;
  country: string;
  currency: string;
  memberName: string;
}

export interface PartnerSession {
  token: { access_token: string; expires_in?: number };
  partner: PartnerMe;
}

/** What the partner owes, as its own people read it: in all, per hand, every step — and each hand's name. */
export interface PartnerOwed {
  partnerEntityId: string;
  partnerName: string;
  currency: string;
  owed: number;
  byPayee: Array<{ payeeId: string; payeeKind: PartnerOwedRow['payeeKind']; amount: number; steps: number }>;
  lines: PartnerOwedRow[];
  names: Record<string, string>;
}

/** The person's own session: which partners they are in, and saying yes or no to an invitation. */
export interface PersonClient {
  client: SeededAppClient;
  mine(): Promise<Result<{ items: Membership[] }>>;
  accept(memberId: string): Promise<Result<Membership>>;
  decline(memberId: string): Promise<Result<{ declined: true }>>;
  open(entityId: string): Promise<Result<PartnerSession>>;
}

export function createPersonClient(): PersonClient {
  const client = createSeededClient(partnerConfig(), PERSON_TOKEN);
  const call = <T>(fn: Parameters<typeof client.sbg.request>[0]) => client.sbg.request(fn) as unknown as Promise<Result<T>>;
  return {
    client,
    mine: () => call((c) => c.GET('/v1/sbg/partner/mine', {}) as never),
    accept: (memberId) => call((c) => c.POST('/v1/sbg/partner/invitations/{memberId}/accept', { params: { path: { memberId } } }) as never),
    decline: (memberId) => call((c) => c.POST('/v1/sbg/partner/invitations/{memberId}/decline', { params: { path: { memberId } } }) as never),
    open: (entityId) => call((c) => c.POST('/v1/sbg/partner/{entityId}/session', { params: { path: { entityId } } }) as never),
  };
}

/* ------------------------------------------------------------ reading for a partner -- */

export interface PartnerClient {
  client: SeededAppClient;
  me(): Promise<Result<PartnerMe>>;
  owed(): Promise<Result<PartnerOwed>>;
}

export function createPartnerClient(): PartnerClient {
  const client = createSeededClient(partnerConfig(), PARTNER_TOKEN);
  const call = <T>(fn: Parameters<typeof client.sbg.request>[0]) => client.sbg.request(fn) as unknown as Promise<Result<T>>;
  return {
    client,
    me: () => call((c) => c.GET('/v1/sbg/partner/me', {}) as never),
    owed: () => call((c) => c.GET('/v1/sbg/partner/me/owed', {}) as never),
  };
}

/** Sign-out drops both sessions. Either one left behind is a way back in. */
export function clearSessions(): void {
  try {
    globalThis.sessionStorage?.removeItem(PERSON_TOKEN);
    globalThis.sessionStorage?.removeItem(PARTNER_TOKEN);
  } catch {
    /* nothing was stored */
  }
}

/** Leaving one partner for the list drops only its session. */
export function clearPartnerSession(): void {
  try {
    globalThis.sessionStorage?.removeItem(PARTNER_TOKEN);
  } catch {
    /* nothing was stored */
  }
}

/* ------------------------------------------------------------- coming back -- */

/** `glos-partner-did` is read by the front page too: a device that has signed in here is offered the Partner app first. */
const DID_KEY = 'glos-partner-did';
const PHONE_KEY = 'glos-partner-phone';
const LAST_KEY = 'glos-partner-last';

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
