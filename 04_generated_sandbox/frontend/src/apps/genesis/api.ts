import { readDeviceKey, saveDeviceKey } from '../../shared/account/pin';
import {
  createConsumerApi,
  createConversationsApi,
  createNotificationsApi,
  createSeededClient,
  makeConfig,
  publicRequest,
  purgeTokens,
  tokenKeyFor,
  type ConsumerApi,
  type ConversationsApi,
  type NotificationsApi,
  type Result,
  type SbgConfig,
  type SeededAppClient,
} from '../../lib/sbg';
import type { AuthResult, ClassifyView, NetworkPoint, ParcelSize, PersonRole, QuoteView, AnyTrackView } from './types';

const APP_VERSION = '1.0.0';

/**
 * The Send app is the ANONYMOUS surface of the network for SEE (network + quote) and the public
 * GET (track): those endpoints are @Public (S13), reached with publicRequest — no token. S21 adds
 * the AUTHENTICATED consumer: phone+PIN accounts and the receiver home, a seeded bearer session on
 * top. Send + Track keep working with no account (signed-off O1: never force phone+PIN).
 */
export function sendConfig(): SbgConfig {
  return makeConfig('genesis', APP_VERSION);
}

export function fetchPoints(): Promise<Result<NetworkPoint[]>> {
  return publicRequest<NetworkPoint[]>(sendConfig(), '/v1/sbg/network/points');
}

/**
 * The price of a journey for THIS parcel.
 *
 * ITEM 9 — the measurement goes with it. The mint prices transport on the typed centimetres, and the
 * mint also FAILS CLOSED when what a sender agreed to is not what the fresh quote says: a wizard that
 * priced by size band would therefore not merely mislead, it would make every send bounce on a price it
 * had itself quoted. The tier still rides along for the parts of the answer that are about the tier.
 */
export function fetchQuote(originDid: string, destDid: string, size: ParcelSize, measure?: { l: number; w: number; h: number; kg: number }): Promise<Result<QuoteView>> {
  const q = new URLSearchParams({ origin: originDid, dest: destDid, size });
  if (measure) for (const [k, v] of Object.entries(measure)) q.set(k, String(v));
  return publicRequest<QuoteView>(sendConfig(), `/v1/sbg/quote?${q.toString()}`);
}

export function fetchTrack(key: string): Promise<Result<AnyTrackView>> {
  return publicRequest<AnyTrackView>(sendConfig(), `/v1/sbg/track/${encodeURIComponent(key)}`);
}

/** PG3 — derive the size tier + cargo class from typed dims + weight (@Public: a pure computation over
 *  the open thresholds). The wizard's ONLY size input — no self-declared S/M/L/HEAVY anywhere. */
export function classifyParcel(dims: { l: number; w: number; h: number }, kg: number): Promise<Result<ClassifyView>> {
  return publicRequest<ClassifyView>(sendConfig(), '/v1/sbg/size/classify', { body: { ...dims, kg } });
}

/* -------------------------------------------------- consumer identity (S20/S21) -- */

/**
 * Pre-auth calls — made BEFORE any token exists, so they go through publicRequest against the
 * @Public routes, exactly like sbgLogin. The flow: request a code → verify it → enroll (which
 * consumes the verification and mints a consumer token). A returning user skips straight to pinLogin.
 */
export function requestOtp(phone: string): Promise<Result<{ sent: boolean; code?: string }>> {
  return publicRequest(sendConfig(), '/v1/sbg/auth/phone/request', { body: { phone } });
}

export function verifyOtp(phone: string, code: string): Promise<Result<{ verified: boolean }>> {
  return publicRequest(sendConfig(), '/v1/sbg/auth/phone/verify', { body: { phone, code } });
}

/** Create (or refresh) the consumer for an OTP-verified phone; optionally set the PIN + credit an invite. */
export async function enroll(phone: string, pin?: string, inviteToken?: string, recovery?: { email: string; code: string }): Promise<Result<AuthResult>> {
  // A first PIN needs a confirmed recovery email behind it; somebody replacing a forgotten PIN already has one.
  const r = await publicRequest<AuthResult & { device?: string }>(sendConfig(), '/v1/sbg/identity/enroll', { body: { phone, pin, inviteToken, ...(recovery ? { email: recovery.email, emailCode: recovery.code } : {}) } });
  // The code was typed on this device: the server hands it the key the PIN is asked with from now on.
  saveDeviceKey(phone, r.data?.device);
  return r;
}

/** Validate an invite token at the landing (S24) — public, tells us only whether the link is real. */
export function previewInvite(token: string): Promise<Result<{ valid: boolean }>> {
  return publicRequest<{ valid: boolean }>(sendConfig(), `/v1/sbg/identity/invite/${encodeURIComponent(token)}`);
}

/** Change your PIN, proven with the CURRENT one — a phone left unlocked is not proof of who holds it. */
export function changePinWithCurrent(phone: string, pin: string, newPin: string): Promise<Result<AuthResult>> {
  return publicRequest<AuthResult>(sendConfig(), '/v1/sbg/identity/pin/change', { body: { phone, pin, newPin, device: readDeviceKey(phone) } });
}

/** Reopen with phone + PIN, no code — on a device the code was once typed on. */
export function pinLogin(phone: string, pin: string): Promise<Result<AuthResult>> {
  // `device`: the key this phone or browser was handed when the code was typed on it. Without it the server does not
  // look at the PIN, and answers DEVICE_NOT_KNOWN — the sign-in screen then sends the code (NewDeviceSheet).
  return publicRequest<AuthResult>(sendConfig(), '/v1/sbg/identity/login', { body: { phone, pin, device: readDeviceKey(phone) } });
}

/** sessionStorage namespace for the consumer's bearer — one key per personDid, purged on every
 *  identity transition (shared-phone hygiene; a phone changes hands). */
const TOKEN_PREFIX = 'sbg:send:';

export interface ConsumerClient {
  api: ConsumerApi;
  client: SeededAppClient;
  /** Persona-agnostic Web Push controls, bound to the same token (N1). */
  notifications: NotificationsApi;
  /** CV5 — a word with the shop holding a parcel of theirs. */
  conversations: ConversationsApi;
}

/**
 * The authenticated consumer session. Seeded flavour: the token comes from a real phone+PIN login and
 * the session can never self-mint — when it dies (tab closed, expiry) the shell gets isSignInRequired
 * and returns to the PIN screen, because the PIN never lives on the device.
 */
export function createConsumerClient(personDid: string): ConsumerClient {
  const client = createSeededClient(sendConfig(), tokenKeyFor(TOKEN_PREFIX, personDid));
  return { api: createConsumerApi(client.sbg), client, notifications: createNotificationsApi(client.sbg), conversations: createConversationsApi(client.sbg) };
}

export function purgeConsumerTokens(keepDid: string | null): void {
  purgeTokens(TOKEN_PREFIX, keepDid);
}

/* -------------------------------------------------- role-switch handoff -- */

/**
 * Where each role's own PWA lives + how it names its cold-start identity. The role switcher hands the
 * switched actor token to the target app by seeding it into that app's per-DID session slot and setting
 * its identity key, then navigating — so "act as driver" lands you signed-in in the driver app with no
 * second login (the whole point of one person, many roles). This couples the Send app to the other
 * apps' storage conventions; keep it in step if those change. Vendor is keyed by store-id (not the
 * person DID) and carries a store secret, so it is opened fresh rather than handed a token.
 */
export const ROLE_APPS: Partial<Record<PersonRole, { app: string; path: string; didKey: string; handoff: boolean }>> = {
  driver: { app: 'driver', path: '/driver/', didKey: 'glos-driver-did', handoff: true },
  agent: { app: 'agent', path: '/agent/', didKey: 'glos-agent-did', handoff: true },
  mdp: { app: 'mdp', path: '/mdp/', didKey: 'glos-mdp-did', handoff: true },
  fleet_manager: { app: 'fleet', path: '/fleet/', didKey: 'glos-fleet-did', handoff: true },
  vendor: { app: 'vendor', path: '/vendor/', didKey: 'glos-vendor-id', handoff: false },
};

/**
 * Seed the switched token into the target app and navigate to it. Returns false when the role has no
 * seamless handoff (vendor) — the caller then just opens the app for a normal sign-in.
 */
export async function handoffToRole(role: PersonRole, entityDid: string, token: { access_token: string; expires_in?: number }): Promise<boolean> {
  const target = ROLE_APPS[role];
  if (!target) return false;
  if (target.handoff) {
    // Seed the actor token into the target app's own per-DID session slot (same origin → same tab reads it).
    const seeded = createSeededClient(makeConfig(target.app, APP_VERSION), tokenKeyFor(`sbg:${target.app}:`, entityDid));
    await seeded.seed({ access_token: token.access_token, expires_in: token.expires_in ?? 3600 });
    try {
      globalThis.localStorage?.setItem(target.didKey, entityDid);
    } catch {
      /* storage blocked — the target app will fall back to its own sign-in */
    }
  }
  globalThis.location?.assign(target.path);
  return target.handoff;
}

/* -------------------------------------------------- cold-start identity -- */

/** The two things that survive a cold start: who this person is (personDid) and their phone (prefill). */
const DID_KEY = 'glos-send-did';
const PHONE_KEY = 'glos-send-phone';

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
export const readPhone = (): string | null => get(PHONE_KEY);
export const savePhone = (phone: string): void => set(PHONE_KEY, phone);

/* -------------------------------------------------- invite map (S28) -- */

/**
 * The invite token → contact map that renders "Jane joined" lives ONLY here, on the device. The server
 * holds nothing but the opaque token, so this is what keeps the invitee's name/number off the wire while
 * still letting the sender see per-name status. Keyed by personDid so two accounts on one phone never mix.
 */
const INVITE_KEY = 'glos-send-invites';

export interface InviteEntry {
  token: string;
  name: string;
  tel: string;
  at: string;
  /** Did the share channel actually open? A failed open keeps the token (reusable) but shows Send (retry). */
  delivered?: boolean;
}

export function readInviteMap(personDid: string): InviteEntry[] {
  try {
    const raw = get(`${INVITE_KEY}:${personDid}`);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? (list as InviteEntry[]).filter((e) => e && typeof e.token === 'string') : [];
  } catch {
    return [];
  }
}

export function writeInviteMap(personDid: string, entries: InviteEntry[]): void {
  set(`${INVITE_KEY}:${personDid}`, JSON.stringify(entries));
}

/* ------------------------------------------------------------ recent keys -- */

/**
 * The GET half of See-Buy-Get on a phone that loses its SMS thread: the last few tracking
 * keys this device looked up, newest first, so "where is my parcel" is one tap. Keys only —
 * no PII lives here, and the key is already the bearer credential for the public track view.
 */
const RECENT_KEY = 'glos-send-recent';
const RECENT_MAX = 5;

export function recentKeys(): string[] {
  try {
    const raw = globalThis.localStorage?.getItem(RECENT_KEY);
    const list = raw ? (JSON.parse(raw) as unknown) : [];
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export function rememberKey(key: string): string[] {
  const next = [key, ...recentKeys().filter((k) => k !== key)].slice(0, RECENT_MAX);
  try {
    globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    /* storage unavailable — recall just won't survive a cold start */
  }
  return next;
}
