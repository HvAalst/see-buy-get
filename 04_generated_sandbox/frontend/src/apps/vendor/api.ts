import {
  createConversationsApi,
  createSeededClient,
  createNotificationsApi,
  createVendorApi,
  type ConversationsApi,
  type NotificationsApi,
  makeConfig,
  publicRequest,
  purgeTokens,
  sbgForgot,
  sbgReset,
  tokenKeyFor,
  type SeededAppClient,
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

/** @Public vendors/session — the store's ACCOUNT: an email and a password. How a store signs in. */
export function vendorSession(email: string, password: string): Promise<Result<VendorLoginView>> {
  return publicRequest<VendorLoginView>(vendorConfig(), '/v1/sbg/vendors/session', { body: { email, password } });
}

/**
 * @Public vendors/login — the store ID + the signing secret. Only for a store that has set no account up yet: it gets
 * in this way one last time, and is asked to set one up. A store WITH an account is refused here by the server.
 */
export function vendorLogin(vendorId: string, secret: string): Promise<Result<VendorLoginView>> {
  return publicRequest<VendorLoginView>(vendorConfig(), '/v1/sbg/vendors/login', { body: { vendorId, secret } });
}

/** A code to the store's address, and the new password it opens. */
export const vendorForgot = (email: string) => sbgForgot(vendorConfig(), email);
export const vendorReset = (token: string, password: string) => sbgReset(vendorConfig(), token, password);

/**
 * @Public vendors registration — the store AND its account in one act. The response carries the signing secret
 * EXACTLY ONCE (for the store's own systems), and a sign-in for this device.
 */
export function vendorRegister(body: {
  name: string;
  country?: string;
  address?: string;
  location?: { lat: number; lng: number };
  callbackUrl?: string;
  email: string;
  password: string;
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
  client: SeededAppClient;
  /** CV1 — questions drivers ask about this store's own freight. */
  conversations: ConversationsApi;
  /** The store's own notifications — a store is run by a person at a desk or on a phone, not only by
   *  an integration reading callbacks. See the money-in work: they wait on a payment to be confirmed. */
  notifications: NotificationsApi;
}

/**
 * NO CREDENTIAL LIVES ON THIS DEVICE. The console used to keep the store ID and the signing secret in localStorage
 * and sign itself back in with them — so the secret that signs a store's callbacks sat readable in every browser
 * the store had ever been opened in. Now the store signs in with its email and password, the token that sign-in
 * returned is seeded into the session, and when it dies the shell returns to the sign-in screen: the password never
 * lives here, as in the Shop and Hub apps.
 */
export function createVendorClient(vendorId: string): VendorClient {
  const client = createSeededClient(vendorConfig(), tokenKeyFor(TOKEN_PREFIX, vendorId));
  return { api: createVendorApi(client.sbg), client, conversations: createConversationsApi(client.sbg), notifications: createNotificationsApi(client.sbg) };
}

export function purgeVendorTokens(keepVendorId: string | null): void {
  purgeTokens(TOKEN_PREFIX, keepVendorId);
}

/* --------------------------------------------------------------- identity -- */

const ID_KEY = 'glos-vendor-id';
const EMAIL_KEY = 'glos-vendor-email';
/** Where an older version kept the signing secret as this device's way in. Nothing is kept there now; what was is removed. */
const LEGACY_SECRET_KEY = 'glos-vendor-secret';

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

/** Which store this device last opened — and never how. */
export const readCreds = (): { vendorId: string } | null => {
  // A secret an older version left on this device is taken off it the first time the app opens.
  drop(LEGACY_SECRET_KEY);
  const vendorId = get(ID_KEY);
  return vendorId ? { vendorId } : null;
};
export const saveCreds = (vendorId: string): void => set(ID_KEY, vendorId);
export const clearCreds = (): void => drop(ID_KEY);
/** The email that signed in last, to fill the next sign-in. Kept across a sign-out, like the Shop app's. */
export const readEmail = (): string | null => get(EMAIL_KEY);
export const saveEmail = (email: string): void => set(EMAIL_KEY, email);
