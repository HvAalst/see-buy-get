import { createPrivateKey, createSign, type KeyObject } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { isSandbox } from '../../foundation/runtime/sandbox';

/**
 * FIREBASE CLOUD MESSAGING, AS A SET OF PLAIN FUNCTIONS: what the server was given, what one wake-up looks like on the
 * wire, and what an answer means. `FcmWakeSender` (car-wake.ts) does the sending; this file knows no socket. Built for
 * "Messages in the car" (05_engineering/android-auto-messages.md; the owner, 2026-11-02: "we start with 2").
 *
 * Read from Firebase's HTTP v1 documentation (firebase.google.com/docs/cloud-messaging/send-message, /auth-server,
 * /manage-tokens) on 2026-11-02:
 *   POST https://fcm.googleapis.com/v1/projects/{project_id}/messages:send
 *   Authorization: Bearer <an OAuth 2.0 access token for the scope https://www.googleapis.com/auth/firebase.messaging>
 *   { "message": { "token": "<the phone's registration token>", "data": { … strings … }, "android": { "priority": "HIGH" } } }
 *   200 with { "name": "projects/…/messages/…" } when Firebase took it
 *   an error is { "error": { code, message, status, details: [{ "@type": "…FcmError", "errorCode": "UNREGISTERED" }] } }
 *     UNREGISTERED (404) — the app was removed, or the token is no longer valid: drop it
 *     SENDER_ID_MISMATCH (403) — the token belongs to another Firebase project: it will never work for this one
 *     INVALID_ARGUMENT (400) — about "message.token": not a valid token; about anything else: our request
 *   The access token: a JWT signed RS256 with the service account's private key — iss = its client_email, scope as above,
 *   aud = https://oauth2.googleapis.com/token, an hour at most — posted to that address as
 *   grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<jwt>; it answers { access_token, expires_in }.
 *
 * No firebase-admin: one signed JWT and two HTTPS posts are all a content-free wake-up needs, and Node's own crypto signs
 * the JWT. A dependency that large (it brings Google's whole auth and gRPC stack) would be more code to trust than the
 * thing it does.
 *
 * WHAT A WAKE-UP CARRIES: `{ kind: 'chat', conversationId }` and nothing else — no name, no word of the message, no load.
 * The words never pass through Google's push service (privacy: words go by link, never by attachment); the phone's
 * native part fetches them from us with its car key.
 *
 * NEVER SENT THROUGH THE REAL PROVIDER FROM HERE: it is tested against a server standing where Google stands.
 */
type Env = Record<string, string | undefined>;

export const FCM_API = 'https://fcm.googleapis.com';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const FCM_SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
/** How long an access token is asked for: Google's most. It is kept, and asked for again a minute before it runs out. */
export const ACCESS_TOKEN_SECONDS = 3600;

/**
 * WHY A FIREBASE THAT IS (PARTLY) SET UP IS NOT USED. `no_project` — no project id, in GLOS_FCM_PROJECT_ID or the
 * service account · `no_account` — no service account · `unreadable_account` — it is set, and is not a service account's
 * JSON (inline, base64, or a file that can be read) with a client email and a private key · `not_google` — an address
 * other than Google's was set, and a credential is for one address · `sandbox` — everything is set, and this is a
 * sandbox, which wakes no phone through Firebase.
 */
export const FCM_PROBLEMS = ['no_project', 'no_account', 'unreadable_account', 'not_google', 'sandbox'] as const;
export type FcmProblem = (typeof FCM_PROBLEMS)[number];

export interface FcmConfig {
  /** A project id is set (or is in the service account). */
  projectSet: boolean;
  /** A service account is set, readable or not. */
  accountSet: boolean;
  /** Something of Firebase's is set, and it is not used: why. */
  problem?: FcmProblem;
  /** The address is a stand-in on this machine (a sandbox being driven), not Google's. */
  standIn: boolean;
  // There ONLY when it can be used: a project, a service account that reads, an address a credential may go to.
  sendUrl?: string;
  tokenUrl?: string;
  clientEmail?: string;
  keyId?: string;
  privateKey?: KeyObject;
}

interface ServiceAccount {
  client_email?: unknown;
  private_key?: unknown;
  private_key_id?: unknown;
  project_id?: unknown;
}

const set = (v: string | undefined) => (v ?? '').trim();

/**
 * THE SERVICE ACCOUNT, AS THE ENVIRONMENT GIVES IT: the JSON itself on one line, the same JSON in base64 (an .env line
 * with no quotes to escape), or the path of the file Google handed out. Undefined when it is none of them. Its contents
 * are never repeated anywhere — not in a problem, not in a log.
 */
export function readServiceAccount(raw: string): ServiceAccount | undefined {
  const parse = (text: string): ServiceAccount | undefined => {
    try {
      const v = JSON.parse(text) as unknown;
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as ServiceAccount) : undefined;
    } catch {
      return undefined;
    }
  };
  if (raw.startsWith('{')) return parse(raw);
  if (/[\\/]/.test(raw) || raw.toLowerCase().endsWith('.json')) {
    try {
      return existsSync(raw) ? parse(readFileSync(raw, 'utf8')) : undefined;
    } catch {
      return undefined;
    }
  }
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8').trim();
    return decoded.startsWith('{') ? parse(decoded) : undefined;
  } catch {
    return undefined;
  }
}

/** The private key of a service account, as a key: PEM, its newlines real or written as `\n`. Undefined when it is not one. */
function privateKeyOf(pem: unknown): KeyObject | undefined {
  if (typeof pem !== 'string' || !pem.includes('PRIVATE KEY')) return undefined;
  try {
    const key = createPrivateKey(pem.includes('\n') ? pem : pem.replace(/\\n/g, '\n'));
    return key.asymmetricKeyType === 'rsa' ? key : undefined;
  } catch {
    return undefined;
  }
}

/**
 * WHAT THE SERVER WAS GIVEN TO WAKE PHONES WITH, and whether it can be used.
 *
 *   GLOS_FCM_PROJECT_ID       the Firebase project (optional: the service account names its own)
 *   GLOS_FCM_SERVICE_ACCOUNT  the service account key Google handed out: the JSON on one line, base64 of it, or a path
 *
 * Nothing set: off, and quiet — a wake-up is kept in the outbox, the message it was for went as it always does.
 *
 * THE ADDRESS IS GOOGLE'S, and is not a setting. `GLOS_FCM_URL` exists for one thing: a stand-in on this machine, on a
 * sandbox — which is how the sender is tested without an account. Anything else in it is refused, and nothing is sent:
 * the signed assertion is a credential, and a credential is for one address.
 *
 * A SANDBOX WAKES NO PHONE THROUGH FIREBASE, with everything set — as it texts nobody through Twilio and pushes to no
 * browser maker: what it holds is made up, and a test run must not light up somebody's phone.
 */
export function fcmConfig(env: Env = process.env, sandbox: boolean = isSandbox()): FcmConfig {
  const rawAccount = set(env.GLOS_FCM_SERVICE_ACCOUNT);
  const address = set(env.GLOS_FCM_URL);
  const account = rawAccount ? readServiceAccount(rawAccount) : undefined;
  const projectId = set(env.GLOS_FCM_PROJECT_ID) || (typeof account?.project_id === 'string' ? account.project_id.trim() : '');
  const anySet = Boolean(rawAccount || address || set(env.GLOS_FCM_PROJECT_ID));
  const standInAt = address ? standIn(address, sandbox) : undefined;
  const said = { projectSet: Boolean(projectId), accountSet: Boolean(rawAccount), standIn: Boolean(standInAt) };
  if (!anySet) return said;

  const clientEmail = typeof account?.client_email === 'string' ? account.client_email.trim() : '';
  const privateKey = account ? privateKeyOf(account.private_key) : undefined;
  const problem: FcmProblem | undefined =
    address && !standInAt ? 'not_google' : !rawAccount ? 'no_account' : !account || !clientEmail || !privateKey ? 'unreadable_account' : !projectId ? 'no_project' : sandbox && !standInAt ? 'sandbox' : undefined;
  if (problem) return { ...said, problem };

  const base = standInAt ?? FCM_API;
  return {
    ...said,
    sendUrl: `${base}/v1/projects/${encodeURIComponent(projectId)}/messages:send`,
    tokenUrl: standInAt ? `${standInAt}/token` : GOOGLE_TOKEN_URL,
    clientEmail,
    ...(typeof account?.private_key_id === 'string' && account.private_key_id ? { keyId: account.private_key_id } : {}),
    privateKey,
  };
}

/** The origin of a stand-in this server may talk to: plain http, on this machine, and only on a sandbox. */
function standIn(address: string, sandbox: boolean): string | undefined {
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return undefined;
  }
  const onThisMachine = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  return sandbox && onThisMachine && url.protocol === 'http:' ? url.origin : undefined;
}

const b64url = (v: string | Buffer) => Buffer.from(v).toString('base64url');

/**
 * THE ASSERTION GOOGLE TRADES FOR AN ACCESS TOKEN: a JWT, RS256, signed with the service account's private key. Its
 * audience is always Google's token address — what Google checks — wherever it is posted.
 */
export function signedAssertion(config: Pick<FcmConfig, 'clientEmail' | 'keyId' | 'privateKey'>, now: number = Date.now()): string {
  if (!config.clientEmail || !config.privateKey) throw new Error('no service account to sign with');
  const iat = Math.floor(now / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', ...(config.keyId ? { kid: config.keyId } : {}) }));
  const claims = b64url(JSON.stringify({ iss: config.clientEmail, scope: FCM_SCOPE, aud: GOOGLE_TOKEN_URL, iat, exp: iat + ACCESS_TOKEN_SECONDS }));
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(config.privateKey);
  return `${header}.${claims}.${b64url(signature)}`;
}

/** The form the assertion is posted as. */
export function tokenForm(assertion: string): string {
  const form = new URLSearchParams();
  form.set('grant_type', 'urn:ietf:params:oauth:grant-type:jwt-bearer');
  form.set('assertion', assertion);
  return form.toString();
}

/** What a wake-up says, exactly: that a chat has news, and which. Nothing else — never a name, a word, a load. */
export interface WakeData {
  kind: 'chat';
  conversationId: string;
}
export const wakeData = (conversationId: string): WakeData => ({ kind: 'chat', conversationId });

/**
 * ONE WAKE-UP, as Firebase is sent it. A data message only (no `notification`): the phone's native part decides what to
 * show, after fetching the words from us. HIGH priority, which Android lets a data message have when it leads to a
 * notification the person sees — it does: the message, read aloud in the car, or shown on the phone.
 */
export function wakeMessage(token: string, conversationId: string): { message: { token: string; data: WakeData; android: { priority: 'HIGH' } } } {
  return { message: { token, data: wakeData(conversationId), android: { priority: 'HIGH' } } };
}

/**
 * WHY A WAKE-UP WAS NOT TAKEN, by what to do about it. `gone` — Firebase no longer knows the phone: drop its token ·
 * `auth` — the access token was refused: ask for another · `limit` — Firebase is asking us to slow down · `refused` — it
 * will not take it as we are set up · `failed` — it answered with a fault, or with something that is not its answer ·
 * `unreachable` — no answer, or none in time.
 */
export const FCM_FAILURES = ['gone', 'auth', 'limit', 'refused', 'failed', 'unreachable'] as const;
export type FcmFailure = (typeof FCM_FAILURES)[number];
export type FcmAnswer = { ok: true } | { ok: false; kind: FcmFailure };

/**
 * WHAT AN ANSWER MEANS. Taken only on a success that is Firebase's own answer: JSON naming the message it made. A token
 * is said to be gone only where Firebase says so of the token — UNREGISTERED, SENDER_ID_MISMATCH, or a bad argument about
 * `message.token` — never on a fault of ours, which would drop every phone's token at once.
 */
export function readFcmAnswer(status: number, body: string): FcmAnswer {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    json = undefined;
  }
  const answer = json && typeof json === 'object' && !Array.isArray(json) ? (json as Record<string, unknown>) : undefined;
  if (status >= 200 && status < 300) return typeof answer?.name === 'string' && answer.name.length > 0 ? { ok: true } : { ok: false, kind: 'failed' };

  const error = answer?.error && typeof answer.error === 'object' ? (answer.error as Record<string, unknown>) : undefined;
  const details = Array.isArray(error?.details) ? (error.details as Array<Record<string, unknown>>) : [];
  const codes = details.map((d) => d?.errorCode).filter((c): c is string => typeof c === 'string');
  const aboutToken = details.some((d) => Array.isArray(d?.fieldViolations) && (d.fieldViolations as Array<Record<string, unknown>>).some((v) => v?.field === 'message.token'));
  const message = typeof error?.message === 'string' ? error.message : '';

  if (codes.includes('UNREGISTERED') || codes.includes('SENDER_ID_MISMATCH')) return { ok: false, kind: 'gone' };
  if (status === 400 && (aboutToken || /registration token/i.test(message))) return { ok: false, kind: 'gone' };
  if (status === 401) return { ok: false, kind: 'auth' };
  if (status === 429 || codes.includes('QUOTA_EXCEEDED')) return { ok: false, kind: 'limit' };
  if (status === 400 || status === 403 || status === 404) return { ok: false, kind: 'refused' };
  return { ok: false, kind: 'failed' };
}

/** Google's answer to the assertion: the access token and how long it lasts, or undefined when it is not one. */
export function readTokenAnswer(status: number, body: string): { token: string; seconds: number } | undefined {
  if (status < 200 || status >= 300) return undefined;
  try {
    const v = JSON.parse(body) as { access_token?: unknown; expires_in?: unknown };
    if (typeof v.access_token !== 'string' || !v.access_token) return undefined;
    const seconds = Number(v.expires_in);
    return { token: v.access_token, seconds: Number.isFinite(seconds) && seconds > 0 ? Math.min(seconds, ACCESS_TOKEN_SECONDS) : 300 };
  } catch {
    return undefined;
  }
}
