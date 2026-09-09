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

/**
 * WHO IS SIGNED IN — and they are two genuinely different kinds of caller, not two skins on one.
 *
 * NETWORK STAFF hold one shared operator key. It reaches everything, and it cannot say who is holding
 * it, which is why that mode asks for a name and says plainly that the name is not verified.
 *
 * A COMPANY's administrator has an account of their own. The token carries the company they administer
 * AND their name, established at login — so what they change is recorded against a person the network
 * actually authenticated, and they reach their own company and nothing else. A sister's admin sees its
 * own terms; the group's sees the group and every sister under it.
 */
export type TowerMode = 'operator' | 'company';

export interface OperatorCreds {
  mode: 'operator';
  /** Who is at the keyboard. Recorded beside every decision; NOT verified — see the sign-in screen. */
  name: string;
  /** The shared operator credential (GLOS_CLIENT_SECRET). */
  key: string;
}

export interface CompanyCreds {
  mode: 'company';
  email: string;
  password: string;
}

export type TowerCreds = OperatorCreds | CompanyCreds;

/** What a company login answers with — the person, and the company they administer. */
export interface EntityAdminLogin {
  adminId: string;
  email: string;
  name: string;
  entityId: string;
  token: { access_token: string; expires_in?: number };
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

/** A company administrator signs in. @Public, like every other login: it cannot require what it issues. */
export function companyLogin(email: string, password: string): Promise<Result<EntityAdminLogin>> {
  return publicRequest<EntityAdminLogin>(towerConfig(), '/v1/sbg/entities/admins/login', { body: { email, password } });
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
export function createTowerClient(creds: TowerCreds): TowerClient {
  // Both modes hold their credential for as long as the tab lives, so both re-mint by themselves rather
  // than bouncing somebody to sign-in mid-decision. What differs is only what the credential IS.
  const login = creds.mode === 'operator' ? () => mintOperatorToken(creds.key) : () => companyLogin(creds.email, creds.password);
  const client = createCredentialedClient(towerConfig(), TOKEN_KEY, login);
  return { api: createOperatorApi(client.sbg), client };
}

/* ------------------------------------------------------------------- creds -- */

export function readCreds(): TowerCreds | null {
  try {
    const raw = globalThis.sessionStorage?.getItem(CREDS_KEY);
    if (!raw) return null;
    // Read as a loose shape rather than a union: what came out of storage is whatever was put there,
    // possibly by an older build, and narrowing happens below where the fields are actually checked.
    const parsed = JSON.parse(raw) as { mode?: string; name?: string; key?: string; email?: string; password?: string };
    // A stored shape from before there were two modes reads as the operator one, which is what it was.
    if (parsed?.mode === 'company') return parsed.email && parsed.password ? { mode: 'company', email: parsed.email, password: parsed.password } : null;
    return parsed?.name && parsed?.key ? { mode: 'operator', name: parsed.name, key: parsed.key } : null;
  } catch {
    return null;
  }
}

export function saveCreds(creds: TowerCreds): void {
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
