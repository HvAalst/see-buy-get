import {
  createMdpApi,
  createSeededClient,
  makeConfig,
  purgeTokens,
  tokenKeyFor,
  type MdpApi,
  type SbgConfig,
  type SeededAppClient,
} from '../../lib/sbg';

const APP_VERSION = '1.0.0';

/** sessionStorage namespace for hub bearer tokens — one key per DID (see lib/sbg/appclient). */
const TOKEN_PREFIX = 'sbg:mdp:';

export function mdpConfig(): SbgConfig {
  return makeConfig('mdp', APP_VERSION);
}

export interface MdpClient {
  api: MdpApi;
  client: SeededAppClient;
}

/**
 * The hub app authenticates with the real S2 login (role `mdp`) — the token binds to the
 * hub's own DID, and the app resolves WHICH hub from the /mdps list by that DID. When the
 * seeded token dies the shell gets `isSignInRequired` and returns to sign-in.
 */
export function createMdpClient(did: string): MdpClient {
  const client = createSeededClient(mdpConfig(), tokenKeyFor(TOKEN_PREFIX, did));
  return { api: createMdpApi(client.sbg), client };
}

export function purgeMdpTokens(keepDid: string | null): void {
  purgeTokens(TOKEN_PREFIX, keepDid);
}

/* ---------------------------------------------------------------- identity -- */

const DID_KEY = 'glos-mdp-did';
const EMAIL_KEY = 'glos-mdp-email';

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

export const readDid = (): string | null => get(DID_KEY);
export const saveDid = (did: string): void => set(DID_KEY, did);
export const clearDid = (): void => drop(DID_KEY);
export const readEmail = (): string | null => get(EMAIL_KEY);
export const saveEmail = (email: string): void => set(EMAIL_KEY, email);
