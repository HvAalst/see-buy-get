import {
  createCredentialedClient,
  createSeededClient,
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
export type TowerMode = 'operator' | 'company' | 'staff';

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

/**
 * A member of NETWORK STAFF with an account of their own: operator rights, and a name the network established —
 * so a decision that needs two people really takes two. The shared key (`OperatorCreds`) stays for creating the
 * first of these accounts and for scripts.
 *
 * NO PASSWORD IS KEPT. Staff sign in with a password AND a code from an authenticator app, and a code is good for
 * half a minute — so the console could not sign itself back in with what it kept even if it kept it. The session
 * token is what lasts (a working shift, this tab only); when it ends, the person signs in again.
 */
export interface StaffCreds {
  mode: 'staff';
  email: string;
}

export type TowerCreds = OperatorCreds | CompanyCreds | StaffCreds;

/** What a staff login answers with when it signs somebody in. */
export interface StaffLogin {
  operatorId: string;
  email: string;
  name: string;
  /** Whether this account signs in with an authenticator code as well. */
  twoStep: boolean;
  token: { access_token: string; expires_in?: number };
}

/** What an authenticator app needs: the secret to type, and the same as a URI for the QR code. */
export interface TwoStepSetup {
  secret: string;
  uri: string;
}

/** Where two-step sign-in is required and not set up yet: no token — a secret to scan, and the first code signs in. */
export interface StaffSetupNeeded {
  operatorId: string;
  email: string;
  name: string;
  setup: TwoStepSetup;
}

/** A staff account as the console lists it. */
export interface StaffRow {
  operatorId: string;
  email: string;
  name: string;
  createdAt: string;
  lastSeenAt?: string;
  passwordChangedAt?: string;
  /** Signs in with an authenticator code as well as the password. */
  twoStep?: boolean;
  /** A reset of their two-step sign-in, asked for by this member of staff, waiting for a second. */
  twoStepResetAskedBy?: string;
}

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
/** A company administrator changes their own password, proven with the current one. */
export function changeCompanyPassword(email: string, password: string, newPassword: string): Promise<Result<{ ok: true }>> {
  return publicRequest<{ ok: true }>(towerConfig(), '/v1/sbg/entities/admins/password', { body: { email, password, newPassword } });
}

/** A member of network staff signs in: the password, and — once asked for — the authenticator's code. */
export function staffLogin(email: string, password: string, code?: string): Promise<Result<StaffLogin | StaffSetupNeeded>> {
  return publicRequest<StaffLogin | StaffSetupNeeded>(towerConfig(), '/v1/sbg/operators/login', { body: { email, password, ...(code ? { code } : {}) } });
}

/** The signed-in member of staff's own account. */
export function myStaffAccount(client: TowerClient): Promise<Result<StaffRow>> {
  return client.client.sbg.request((raw) => raw.GET('/v1/sbg/operators/me' as never, {} as never) as never) as Promise<Result<StaffRow>>;
}

/** Set up two-step sign-in from Settings: a secret to scan. */
export function startTwoStep(client: TowerClient): Promise<Result<TwoStepSetup>> {
  return client.client.sbg.request((raw) => raw.POST('/v1/sbg/operators/me/two-step' as never, {} as never) as never) as Promise<Result<TwoStepSetup>>;
}

/** The first code from the app turns it on. */
export function confirmTwoStep(client: TowerClient, code: string): Promise<Result<StaffRow>> {
  return client.client.sbg.request((raw) => raw.POST('/v1/sbg/operators/me/two-step/confirm' as never, { body: { code } } as never) as never) as Promise<Result<StaffRow>>;
}

/** Ask for — or, as a second member of staff, complete — the reset of somebody's two-step sign-in. */
export function resetTwoStep(client: TowerClient, operatorId: string): Promise<Result<StaffRow>> {
  return client.client.sbg.request((raw) => raw.POST(`/v1/sbg/operators/${encodeURIComponent(operatorId)}/two-step/reset` as never, {} as never) as never) as Promise<Result<StaffRow>>;
}

/** A member of network staff changes their own password, proven with the current one. */
export function changeStaffPassword(email: string, password: string, newPassword: string): Promise<Result<{ ok: true }>> {
  return publicRequest<{ ok: true }>(towerConfig(), '/v1/sbg/operators/password', { body: { email, password, newPassword } });
}

export function companyLogin(email: string, password: string): Promise<Result<EntityAdminLogin>> {
  return publicRequest<EntityAdminLogin>(towerConfig(), '/v1/sbg/entities/admins/login', { body: { email, password } });
}

/* ------------------------------------------------------------------ client -- */

export interface TowerClient {
  api: OperatorApi;
  client: AppClient;
  /** Staff only: hand the session the token a sign-in returned. */
  seed?: (token: { access_token: string; expires_in?: number }) => Promise<void>;
}

/**
 * The credential is on this device (for as long as the tab is open), so the session re-mints by itself
 * rather than bouncing an operator to sign-in mid-decision. A rejected key surfaces as a mint-sourced
 * failure, which the shell reports as "that key was not accepted" instead of "no signal".
 */
export function createTowerClient(creds: TowerCreds): TowerClient {
  // Staff keep no credential to sign back in with (a code lasts half a minute): the token a sign-in returned is the
  // session, and when it ends every call says "sign in again" and the shell goes back to the sign-in screen.
  if (creds.mode === 'staff') {
    const seeded = createSeededClient(towerConfig(), TOKEN_KEY);
    return { api: createOperatorApi(seeded.sbg), client: seeded, seed: (token) => seeded.seed({ access_token: token.access_token, expires_in: token.expires_in ?? 3600 }) };
  }
  // The other two hold their credential for as long as the tab lives, so they re-mint by themselves rather than
  // bouncing somebody to sign-in mid-decision. What differs is only what the credential IS.
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
    // A staff entry from before two-step sign-in carried a password; only the email is read, never the rest.
    if (parsed?.mode === 'staff') return parsed.email ? { mode: 'staff', email: parsed.email } : null;
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
