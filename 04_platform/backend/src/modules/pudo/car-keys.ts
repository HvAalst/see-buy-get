import { createHash, randomBytes } from 'crypto';

/**
 * MESSAGES IN THE CAR — THE CAR KEY (05_engineering/android-auto-messages.md; the owner, 2026-11-02: "we start with 2" —
 * the driver's chats read aloud in the car and answered by voice; "just to keep drivers' safety in mind, we must reduce
 * the tapping").
 *
 * Android Auto reads a message aloud only from a native Android app, so the Play app ("SeeBuyGet Driver") carries a
 * small native part beside the Driver web app. That part needs a credential of its own: it runs when the web app is
 * closed, woken by Firebase, and it must not hold the driver's sign-in — a sign-in opens everything a driver can do.
 *
 * A CAR KEY CAN DO THREE THINGS AND NOTHING ELSE: read that driver's unread chat messages, reply as text into that
 * driver's own chats, mark them read (and tell the server where to wake the phone). It is made under Settings in the
 * Driver app, with the PIN typed again, on a phone the PIN already works on — and kept ON THAT DEVICE'S OWN RECORD
 * (`KnownDevice.car`), as the fingerprint unlock is (passkeys.ts). So it goes by every path a device goes: forgotten from
 * Settings, the others forgotten, a PIN replaced by a code or changed, a number moved, an account closed, ninety days
 * unused — with nothing to remember to delete, because there is nowhere else it is kept.
 *
 * It is shown once, to the page that made it, and kept here only as a hash. It travels only in the `Authorization: Car
 * <key>` header of the car's own doors (car.controller.ts); every other door refuses it, and those doors refuse every
 * other credential.
 */

/** What a car key starts with, so that nothing anywhere mistakes one for a sign-in, a device key or a company key. */
export const CAR_KEY_PREFIX = 'car_';
/** The scheme it is given in: `Authorization: Car car_…`. Never a query parameter — those end up in access logs. */
export const CAR_SCHEME = 'Car';
/** Exactly what a car key looks like: the prefix and 32 random bytes in hex. Anything else is not one, unread. */
const CAR_KEY_SHAPE = /^car_[0-9a-f]{64}$/;

/**
 * THE CAR KEY, AS ITS DEVICE'S RECORD KEEPS IT. Never the key: its hash. The language is the Driver app's, as the driver
 * last had it in Settings — a quick reply is read aloud in it, as the chat renders it.
 */
export interface DeviceCarKey {
  /** sha256 of the key, hex. Not named `hash`: that is a credential name the response mask strips everywhere. */
  keyHash: string;
  /** The driver record whose chats it reads — the one the Driver app was signed in as when it was turned on. */
  driverDid: string;
  addedAt: string;
  /** The Driver app's language when it was turned on, or last read in Settings: `en`, `sw`, … */
  lang: string;
  /** The phone's Firebase token, where its native part has told us one. Absent: "Waiting for the phone". */
  fcmToken?: string;
  /** When the phone last told us its token. */
  tokenAt?: string;
  /** When the key last came to a car door, written once a day at most. It does NOT keep the device known. */
  usedAt?: string;
}

/** A car key found by what was presented: whose it is, the device it lives on, and the record. */
export interface CarKeyFound {
  personDid: string;
  /** The hash its device is kept under. */
  deviceHash: string;
  car: DeviceCarKey;
}

export const carKeyHashOf = (key: string): string => createHash('sha256').update(key).digest('hex');

/** A new car key. Returned ONCE, to the page that turned it on; only its hash is kept. */
export function newCarKey(): string {
  return `${CAR_KEY_PREFIX}${randomBytes(32).toString('hex')}`;
}

/** Is this the shape of a car key — before anything is looked up with it? */
export function isCarKey(value: unknown): value is string {
  return typeof value === 'string' && CAR_KEY_SHAPE.test(value);
}

/**
 * The car key in an `Authorization` header, or undefined. Only the `Car` scheme, and only a value of a car key's shape:
 * a sign-in (`Bearer …`), a device key or a company key there is no car key, and is not looked at.
 */
export function carKeyFromHeader(header: string | string[] | undefined): string | undefined {
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw || raw.length > 200) return undefined;
  const [scheme, value, ...rest] = raw.trim().split(/\s+/);
  if (rest.length || scheme?.toLowerCase() !== CAR_SCHEME.toLowerCase()) return undefined;
  return isCarKey(value) ? value : undefined;
}

/**
 * WHAT A FIREBASE TOKEN LOOKS LIKE, as far as this server needs to know before it keeps one: a few dozen to a few hundred
 * characters of letters, digits and `-_:.` (Firebase does not publish a format, and its tokens have changed length
 * before). Anything else — words, an address, a script — is not kept.
 */
export function isFcmToken(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 20 && value.length <= 4096 && /^[A-Za-z0-9_:.-]+$/.test(value);
}

/**
 * A FIREBASE TOKEN AS IT MAY BE WRITTEN DOWN — a short print of its hash, never the token itself (house rule: never log
 * a key or a token). What the outbox keeps, and what a test compares.
 */
export function tokenPrint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 16);
}
