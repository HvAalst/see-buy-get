import {
  createConversationsApi,
  createFleetApi,
  type ConversationsApi,
  createSeededClient,
  makeConfig,
  publicRequest,
  purgeTokens,
  tokenKeyFor,
  type MintedToken,
  type FleetApi,
  type Result,
  type SbgConfig,
} from '../../lib/sbg';
import { t } from '../../shared/i18n';
import type { ManagerView } from './types';

const APP_VERSION = '1.0.0';

/** sessionStorage namespace for fleet-manager bearer tokens — one key per DID. */
const TOKEN_PREFIX = 'sbg:fleet:';

export function fleetConfig(): SbgConfig {
  return makeConfig('fleet', APP_VERSION);
}

/**
 * Step one — WHICH FLEET. The code names a company and hands back nothing else.
 *
 * It used to be the whole sign-in, and the app then minted its own fleet_manager token for that DID.
 * One shared secret per company is a poor fit for a company running twenty managers across as many
 * depots: no record of who did what, no way to cut off one leaver without re-issuing to everybody, and
 * a code that is permanent access to anyone who ever saw it.
 */
export function managerLookup(code: string): Promise<Result<{ did: string; companyName: string; status: string }>> {
  return publicRequest(fleetConfig(), '/v1/sbg/fleet/managers/login', { body: { code } });
}

/**
 * Step two — WHICH PERSON, and the only step that returns a token.
 *
 * The server mints it, against a PIN checked by the identity spine that already counts wrong attempts
 * and locks out. The app no longer mints its own: a client that can mint its own access is a client
 * whose sign-in screen is decoration.
 */
export function managerSession(code: string, phone: string, pin: string): Promise<Result<ManagerView & { token: MintedToken }>> {
  return publicRequest(fleetConfig(), '/v1/sbg/fleet/managers/session', { body: { code, phone, pin } });
}

/** Forgot the fleet code: phone + PIN name the fleets this person manages. Mints nothing. */
export function managerChoices(phone: string, pin: string): Promise<Result<{ fleets: Array<{ did: string; companyName: string; status: string }> }>> {
  return publicRequest(fleetConfig(), '/v1/sbg/fleet/managers/mine', { body: { phone, pin } });
}

/** Sign in to a fleet CHOSEN after phone + PIN — the PIN and the manager role are checked again. */
export function managerSessionByFleet(did: string, phone: string, pin: string): Promise<Result<ManagerView & { token: MintedToken }>> {
  return publicRequest(fleetConfig(), '/v1/sbg/fleet/managers/session', { body: { did, phone, pin } });
}

/** Change your own PIN, proven with the current one. Other sessions end. */
export function changeManagerPin(phone: string, pin: string, newPin: string): Promise<Result<{ token: MintedToken }>> {
  return publicRequest(fleetConfig(), '/v1/sbg/identity/pin/change', { body: { phone, pin, newPin } });
}

export interface FleetClient {
  api: FleetApi;
  /** Seeded rather than self-minting — the server hands the token over on a real sign-in. */
  client: ReturnType<typeof createSeededClient>;
  /** CV3 — the conversations this fleet's drivers chose to share. Read-only. */
  conversations: ConversationsApi;
}

export function createFleetClient(managerDid: string): FleetClient {
  const client = createSeededClient(fleetConfig(), tokenKeyFor(TOKEN_PREFIX, managerDid));
  return { api: createFleetApi(client.sbg), client, conversations: createConversationsApi(client.sbg) };
}

export function purgeFleetTokens(keepDid: string | null): void {
  purgeTokens(TOKEN_PREFIX, keepDid);
}

/* ---------------------------------------------------------------- identity -- */

const DID_KEY = 'glos-fleet-did';
const COMPANY_KEY = 'glos-fleet-company';

function get(key: string): string | null {
  try {
    return globalThis.localStorage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}
function set(key: string, value: string): void {
  try {
    globalThis.localStorage?.setItem(key, value);
  } catch {
    /* storage unavailable — the session will not survive a cold start */
  }
}
function drop(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* no-op */
  }
}

export const readManager = (): { did: string; company: string } | null => {
  const did = get(DID_KEY);
  if (!did) return null;
  return { did, company: get(COMPANY_KEY) ?? t('fleet.myFleetFallback') };
};
export const saveManager = (did: string, company: string): void => {
  set(DID_KEY, did);
  set(COMPANY_KEY, company);
};
export const clearManager = (): void => {
  drop(DID_KEY);
  drop(COMPANY_KEY);
};
