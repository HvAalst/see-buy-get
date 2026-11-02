import { createHash, randomBytes } from 'crypto';
import { ownOrigins } from '../../foundation/http/cors';

/**
 * UNLOCK WITH FINGERPRINT OR FACE — the parts that need no server around them (the owner, 2026-11-02: "if face unlock
 * works, integrate it, but then in settings users should be able to undo it and get back to a preferred option").
 *
 * A PASSKEY STANDS IN FOR THE PIN, ON ONE DEVICE, AND NOWHERE ELSE. It is made in Settings, on a phone or browser the
 * person's PIN already works on (one a code to their number confirmed), with the PIN typed once more — an open session
 * is not proof of who is holding the phone. The phone keeps the private key behind its own fingerprint or face; we
 * keep the public key and its id, ON THAT DEVICE'S OWN RECORD (`KnownDevice.passkey`). So a passkey goes whenever its
 * device goes — forgotten from Settings, a PIN replaced by a code, a number moved, an account closed, ninety days
 * unused — with nothing to remember to delete: there is nowhere else it is kept.
 *
 * At a sign-in screen the phone signs a challenge; the server checks it and hands back an UNLOCK TICKET: one use,
 * two minutes, bound to the number, the person and the device key. Every door that takes a PIN takes the ticket in
 * its place through the one place they all check the PIN (`PersonService.loginWithPin`), so each door keeps its own
 * token, roles, limits and lockouts — a second path onto the act, carrying the first's protections.
 */

/** The public half of one device's passkey. Never the fingerprint or the face: those never leave the phone. */
export interface DevicePasskey {
  /** The credential id the phone chose, base64url. */
  id: string;
  /** The public key, COSE-encoded, base64url. */
  publicKey: string;
  /** The phone's own signature counter (many phones always say 0). */
  counter: number;
  transports?: string[];
  addedAt: string;
  /** When it last unlocked, written once a day at most. */
  usedAt?: string;
}

/** The algorithms a passkey may use: ES256 (every phone's default) and RS256 (Windows Hello). Nothing else is offered or taken. */
export const PASSKEY_ALGORITHMS = [-7, -257];
/** How long the phone's own prompt waits for a finger or a face. */
export const PROMPT_MS = 60_000;
/** How long a challenge can be answered — the prompt's minute, and a slow network's. */
export const CHALLENGE_TTL_MS = 2 * 60_000;
/** How long an unlock ticket opens a door for: long enough for a slow network, too short to keep. */
export const UNLOCK_TTL_MS = 2 * 60_000;
/** What a ticket starts with, so that nothing anywhere mistakes one for a PIN. */
export const UNLOCK_PREFIX = 'unl_';
/** At most this many challenges and tickets wait at once; the oldest go first. A flood cannot pin memory. */
const MAX_WAITING = 10_000;

/** The hash a device's key is kept under (person-devices.ts keeps the same). A ticket is bound to it, never to the key. */
export const deviceHashOf = (key: string): string => createHash('sha256').update(key).digest('hex');
const hashOf = (secret: string): string => createHash('sha256').update(secret).digest('hex');

/**
 * WHICH SITE A PASSKEY BELONGS TO, AND WHERE IT MAY BE USED FROM. The relying party is the site's host — the one name
 * every app is served under (SBG_PUBLIC_URL: the apps live at /driver/, /send/, … of one address). The origins a
 * signature is accepted from are our own sites (the same list the browser rule reads, foundation/http/cors.ts), and on
 * a laptop each app's dev and preview port on localhost (frontend/vite.config.ts, APPS: devPort / previewPort).
 */
export const DEV_PORTS = [5173, 5174, 5175, 5176, 5177, 5178, 5179, 5180, 5181, 5182, 5185, 5186, 5187, 5188, 5189, 5190, 5191, 5192];
export function relyingParty(env: Record<string, string | undefined> = process.env): { rpID: string; rpName: string; origins: string[] } {
  let rpID = 'localhost';
  try {
    if (env.SBG_PUBLIC_URL?.trim()) rpID = new URL(env.SBG_PUBLIC_URL.trim()).hostname;
  } catch {
    rpID = 'localhost';
  }
  const sandbox = (env.GLOS_ENV ?? '').trim().toLowerCase() !== 'production';
  const local = sandbox ? DEV_PORTS.map((port) => `http://localhost:${port}`) : [];
  return { rpID, rpName: 'SeeBuyGet', origins: [...new Set([...ownOrigins(env), ...local])] };
}

/** What a challenge was handed out for, and to whom: the answer must come back for the same. */
export interface Challenge {
  purpose: 'register' | 'unlock';
  /** Turning it on: the signed-in person. */
  personDid?: string;
  /** Unlocking: the number it was asked for (hashed), whoever it belongs to. */
  phoneHash?: string;
  /** The device key it was asked from (hashed). */
  deviceHash: string;
  expiresAt: number;
}

/**
 * THE CHALLENGES WAITING FOR A PHONE TO SIGN THEM. Each answers once: taken as it is used, right or wrong. Kept in
 * memory — a challenge is two minutes old at most, and a restart only asks the person to tap again.
 */
export class Challenges {
  private readonly waiting = new Map<string, Challenge>();

  issue(c: Omit<Challenge, 'expiresAt'>, now: number = Date.now()): string {
    const challenge = randomBytes(32).toString('base64url');
    this.sweep(now);
    this.waiting.set(challenge, { ...c, expiresAt: now + CHALLENGE_TTL_MS });
    return challenge;
  }

  /** The challenge, once: gone whether it is still good or not. Undefined when unknown or run out. */
  take(challenge: string | undefined, now: number = Date.now()): Challenge | undefined {
    if (!challenge) return undefined;
    const c = this.waiting.get(challenge);
    this.waiting.delete(challenge);
    return c && c.expiresAt > now ? c : undefined;
  }

  private sweep(now: number): void {
    for (const [k, c] of this.waiting) if (c.expiresAt <= now) this.waiting.delete(k);
    while (this.waiting.size >= MAX_WAITING) this.waiting.delete(this.waiting.keys().next().value as string);
  }
}

/** What an unlock ticket opens: this person, on this number, on this device, with this passkey, until then. */
export interface UnlockGrant {
  personDid: string;
  phoneHash: string;
  deviceHash: string;
  credentialId: string;
  expiresAt: number;
}

/**
 * THE UNLOCK TICKETS — one use each, two minutes each. Kept as a hash, like every other secret; in memory, because a
 * ticket nobody used in two minutes is worth nothing, and a restart only asks the person to unlock again.
 */
export class UnlockTickets {
  private readonly open = new Map<string, UnlockGrant>();

  issue(grant: UnlockGrant, now: number = Date.now()): string {
    const ticket = `${UNLOCK_PREFIX}${randomBytes(32).toString('hex')}`;
    for (const [k, g] of this.open) if (g.expiresAt <= now) this.open.delete(k);
    while (this.open.size >= MAX_WAITING) this.open.delete(this.open.keys().next().value as string);
    this.open.set(hashOf(ticket), grant);
    return ticket;
  }

  /** The ticket, once: gone whether it is still good or not. Undefined when unknown, used or run out. */
  take(ticket: string | undefined, now: number = Date.now()): UnlockGrant | undefined {
    if (!ticket?.startsWith(UNLOCK_PREFIX)) return undefined;
    const key = hashOf(ticket);
    const grant = this.open.get(key);
    this.open.delete(key);
    return grant && grant.expiresAt > now ? grant : undefined;
  }

  /** Every ticket of one person's, gone: their passkey was turned off, or their device forgotten. */
  dropFor(personDid: string): void {
    for (const [k, g] of this.open) if (g.personDid === personDid) this.open.delete(k);
  }
}
