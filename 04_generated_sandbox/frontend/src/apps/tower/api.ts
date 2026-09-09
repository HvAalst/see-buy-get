import {
  createCredentialedClient,
  createOperatorApi,
  makeConfig,
  publicRequest,
  type AppClient,
  type OperatorApi,
  type Result,
  type SbgConfig,
} from '../../lib/sbg';

const APP_VERSION = '1.0.0';

/**
 * The console's session lives in sessionStorage, and that is the whole security model of this screen.
 *
 * The operator credential is a PASSWORD typed by a person, not a device identity like the driver's DID
 * or the vendor's store secret — so it never goes near localStorage, where it would outlive the person
 * who typed it, on a machine other people sit at. Close the tab and this console is signed out. The
 * cost is re-typing the key after a browser restart, which is the correct price for a credential that
 * can take a hazard off every driver's map.
 */
const CREDS_KEY = 'sbg:tower:creds';
const TOKEN_KEY = 'sbg:tower:token';

export interface OperatorCreds {
  /** Who is at the keyboard. Recorded beside every decision; NOT verified — see the sign-in screen. */
  name: string;
  /** The shared operator credential (GLOS_CLIENT_SECRET). */
  key: string;
}

export function towerConfig(): SbgConfig {
  return makeConfig('tower', APP_VERSION);
}

/* -------------------------------------------------------------------- auth -- */

/**
 * Mint an operator token — `POST /v1/auth/token` with `role: 'operator'`, the trusted-caller grant.
 *
 * This is the path the backend describes as "ops via script/curl … the client secret is the operator
 * trust boundary until a real ops console exists". This is that console, and it does not improve on the
 * boundary: it is still one shared key, so the token proves that SOMEBODY with the operator credential
 * is acting, and the name typed beside it is what says who. Real per-person operator accounts are a
 * slice of their own, and until they exist this screen says so out loud rather than implying otherwise.
 */
export function mintOperatorToken(key: string): Promise<Result<{ access_token: string; expires_in?: number }>> {
  return publicRequest(towerConfig(), '/v1/auth/token', { body: { role: 'operator', clientSecret: key } });
}

/* ------------------------------------------------------------------ client -- */

export interface TowerClient {
  api: OperatorApi;
  client: AppClient;
}

/**
 * The credential is on this device (for as long as the tab is open), so the session re-mints by itself
 * rather than bouncing an operator to sign-in mid-decision. A rejected key surfaces as a mint-sourced
 * failure, which the shell reports as "that key was not accepted" instead of "no signal".
 */
export function createTowerClient(creds: OperatorCreds): TowerClient {
  const client = createCredentialedClient(towerConfig(), TOKEN_KEY, () => mintOperatorToken(creds.key));
  return { api: createOperatorApi(client.sbg), client };
}

/* ------------------------------------------------------------------- creds -- */

export function readCreds(): OperatorCreds | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(CREDS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OperatorCreds>;
    return parsed?.name && parsed?.key ? { name: parsed.name, key: parsed.key } : null;
  } catch {
    return null;
  }
}

export function saveCreds(creds: OperatorCreds): void {
  try {
    globalThis.sessionStorage?.setItem(CREDS_KEY, JSON.stringify(creds));
  } catch {
    /* storage locked down — the console still works, it just will not survive a reload */
  }
}

/** Sign-out drops BOTH the credential and the bearer it minted. Either one left behind is a way back in. */
export function clearCreds(): void {
  try {
    globalThis.sessionStorage?.removeItem(CREDS_KEY);
    globalThis.sessionStorage?.removeItem(TOKEN_KEY);
  } catch {
    /* nothing was stored in the first place */
  }
}
