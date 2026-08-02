import {
  createAgentApi,
  createNotificationsApi,
  createSeededClient,
  makeConfig,
  purgeTokens,
  tokenKeyFor,
  type AgentApi,
  type NotificationsApi,
  type SbgConfig,
  type SeededAppClient,
} from '../../lib/sbg';

const APP_VERSION = '1.0.0';

/**
 * sessionStorage namespace for agent bearer tokens — one key per DID, purged on every
 * identity transition (the shared machinery in lib/sbg/appclient owns the semantics; the
 * driver app documents why both halves matter).
 */
const TOKEN_PREFIX = 'sbg:agent:';

export function agentConfig(): SbgConfig {
  return makeConfig('agent', APP_VERSION);
}

export interface AgentClient {
  api: AgentApi;
  client: SeededAppClient;
  /** Persona-agnostic Web Push controls, bound to the same token (N1). */
  notifications: NotificationsApi;
}

/**
 * The agent app authenticates with the REAL S2 login (email + password →
 * POST /v1/sbg/auth/login → an actor token) — not the sandbox mint. The token is seeded
 * into a per-DID session; when it dies the shell gets `isSignInRequired` and returns to
 * the sign-in screen, because the password never lives on the device.
 */
export function createAgentClient(did: string): AgentClient {
  const client = createSeededClient(agentConfig(), tokenKeyFor(TOKEN_PREFIX, did));
  return { api: createAgentApi(client.sbg), client, notifications: createNotificationsApi(client.sbg) };
}

export function purgeAgentTokens(keepDid: string | null): void {
  purgeTokens(TOKEN_PREFIX, keepDid);
}

/* ---------------------------------------------------------------- identity -- */

/**
 * The two things that must survive a cold start: who this shop is (DID) and the email that
 * signed in (prefills the next sign-in). localStorage, try/catch-wrapped — private mode and
 * locked-down WebViews throw on access and must not take the app down.
 */
const DID_KEY = 'glos-agent-did';
const EMAIL_KEY = 'glos-agent-email';

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
