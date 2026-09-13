import {
  createConversationsApi,
  createCredentialedClient,
  createVendorApi,
  type ConversationsApi,
  makeConfig,
  publicRequest,
  purgeTokens,
  tokenKeyFor,
  type AppClient,
  type Result,
  type SbgConfig,
  type VendorApi,
} from '../../lib/sbg';
import type { NetworkPoint, VendorLoginView, VendorRegisteredView } from './types';

const APP_VERSION = '1.0.0';

/** sessionStorage namespace for vendor bearer tokens — one key per vendorId. */
const TOKEN_PREFIX = 'sbg:vendor:';

export function vendorConfig(): SbgConfig {
  return makeConfig('vendor', APP_VERSION);
}

/* ------------------------------------------------------------- public auth -- */

/** @Public vendors/login — the store ID + the signing secret issued once at registration. */
export function vendorLogin(vendorId: string, secret: string): Promise<Result<VendorLoginView>> {
  return publicRequest<VendorLoginView>(vendorConfig(), '/v1/sbg/vendors/login', { body: { vendorId, secret } });
}

/** @Public vendors registration — a signup; the response carries the secret EXACTLY ONCE. */
export function vendorRegister(body: {
  name: string;
  country?: string;
  address?: string;
  location?: { lat: number; lng: number };
  callbackUrl?: string;
}): Promise<Result<VendorRegisteredView>> {
  return publicRequest<VendorRegisteredView>(vendorConfig(), '/v1/sbg/vendors', { body });
}

/** The public network directory — powers both pickers without a token. */
export function fetchPoints(): Promise<Result<NetworkPoint[]>> {
  return publicRequest<NetworkPoint[]>(vendorConfig(), '/v1/sbg/network/points');
}

/** One country the network operates in — a real company there, and the money it settles in. */
export interface OperatingCountry {
  country: string;
  name: string;
  currency?: string;
  /** False where the network operates but no company of ours handles money: you settle with the carrier. */
  settles?: boolean;
}

/**
 * Where a store can register. @Public, and needed BEFORE the store exists: registering in a country with
 * no daughter company is refused, and a merchant should be told that by the form rather than by a 404.
 */
export function fetchCountries(): Promise<Result<OperatingCountry[]>> {
  return publicRequest<OperatingCountry[]>(vendorConfig(), '/v1/sbg/countries');
}

/* ----------------------------------------------------------------- client -- */

export interface VendorClient {
  api: VendorApi;
  client: AppClient;
  /** CV1 — questions drivers ask about this store's own freight. */
  conversations: ConversationsApi;
}

/**
 * The console's CREDENTIAL lives on this device (store ID + secret — the secret is issued
 * once and localStorage is its only home, like the driver's DID), so the session re-mints
 * by itself through vendors/login: an expired token never bounces the merchant to sign-in.
 */
export function createVendorClient(vendorId: string, secret: string): VendorClient {
  const client = createCredentialedClient(vendorConfig(), tokenKeyFor(TOKEN_PREFIX, vendorId), () => vendorLogin(vendorId, secret));
  return { api: createVendorApi(client.sbg), client, conversations: createConversationsApi(client.sbg) };
}

export function purgeVendorTokens(keepVendorId: string | null): void {
  purgeTokens(TOKEN_PREFIX, keepVendorId);
}

/* --------------------------------------------------------------- identity -- */

const ID_KEY = 'glos-vendor-id';
const SECRET_KEY = 'glos-vendor-secret';

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
    /* storage unavailable — the sign-in will not survive a cold start */
  }
}
function drop(key: string): void {
  try {
    globalThis.localStorage?.removeItem(key);
  } catch {
    /* no-op */
  }
}

export const readCreds = (): { vendorId: string; secret: string } | null => {
  const vendorId = get(ID_KEY);
  const secret = get(SECRET_KEY);
  return vendorId && secret ? { vendorId, secret } : null;
};
export const saveCreds = (vendorId: string, secret: string): void => {
  set(ID_KEY, vendorId);
  set(SECRET_KEY, secret);
};
export const clearCreds = (): void => {
  drop(ID_KEY);
  drop(SECRET_KEY);
};
