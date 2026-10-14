/**
 * SeeBuyGet error model — the client half of the RFC 9457 contract the backend emits (S4).
 *
 * The backend never throws for a business rejection; it returns problem+json with a stable machine
 * `code`. This module turns that code into something a NON-READER can act on: an icon + a tone + a
 * read-aloud key. That mapping is the whole reason the error contract exists — a low-literacy collector
 * must be able to see "top up" vs "wrong code" vs "try again" without reading a sentence.
 *
 * SbgErrorCode mirrors backend/src/foundation/http/error-codes.ts. Keep in sync; unknown codes degrade
 * gracefully to the generic presentation rather than throwing.
 */
export type SbgErrorCode =
  | 'BAD_REQUEST' | 'VALIDATION_FAILED' | 'INVALID_INPUT' | 'AMOUNT_INVALID' | 'EMAIL_INVALID' | 'EMAIL_NOT_VERIFIED'
  | 'PASSWORD_TOO_SHORT' | 'PASSWORD_GUESSABLE' | 'PHONE_REQUIRED' | 'PHONE_INVALID' | 'PHONE_NOT_SERVED' | 'PHONE_NOT_VERIFIED' | 'PHOTO_REQUIRED'
  | 'ADDRESS_REQUIRED' | 'FIELD_REQUIRED' | 'INVALID_RATING' | 'ZONES_REQUIRED' | 'LICENCE_REQUIRED'
  | 'LICENCE_EXPIRED' | 'INVALID_VEHICLE_CLASS' | 'INVALID_TRUCK_SUBTYPE' | 'UNKNOWN_ROLE' | 'DISPUTE_INCOMPLETE'
  | 'REQUIREMENTS_NOT_MET' | 'KYC_INCOMPLETE' | 'APPROVAL_BLOCKED' | 'INVALID_STATE' | 'WINDOW_EXPIRED'
  | 'NOT_INBOUND' | 'PARCEL_EXISTS' | 'SHIPMENT_NOT_PAID' | 'CODE_MISMATCH' | 'CODE_LOCKED' | 'WRONG_DESTINATION' | 'NOT_COUPLED' | 'ALREADY_COUPLED'
  | 'CANNOT_COUPLE' | 'HOURS_EXCEEDED' | 'CAPACITY_EXCEEDED' | 'NO_ROOM' | 'CARRIER_NOT_TRADING' | 'REASON_REQUIRED' | 'SAFETY_CHECK_INCOMPLETE' | 'RECEIVER_REQUIRED' | 'DELIVERY_PHOTO_REQUIRED' | 'FRAGILE_NOT_ALLOWED' | 'BAG_FULL' | 'BAG_EMPTY' | 'BAG_RESERVED'
  | 'BAG_MISADDRESSED' | 'ALREADY_IN_BAG' | 'STAGING_FULL' | 'SHELF_FULL' | 'NO_CAPACITY_AVAILABLE' | 'OTP_INVALID' | 'OTP_LOCKED' | 'PIN_INVALID' | 'UNAUTHORIZED'
  | 'AUTH_FAILED' | 'AUTH_CODE_INVALID' | 'AUTH_NOT_ACTIVE' | 'PAYMENT_REQUIRED' | 'WALLET_INSUFFICIENT'
  | 'FORBIDDEN' | 'WRONG_PUDO' | 'AGENT_LOCKED' | 'PIN_LOCKED' | 'PIN_WRONG' | 'DEVICE_NOT_KNOWN' | 'PASSWORD_WRONG' | 'SECRET_WRONG' | 'PASSWORD_LOCKED' | 'PIN_GUESSABLE' | 'ROLE_NOT_HELD' | 'MEDIA_LOCKED' | 'CARGO_REQUIRES_DEDICATED' | 'CARGO_INCOMPATIBLE' | 'VEHICLE_MISSING_CAPABILITY' | 'NOT_FOUND' | 'CONFLICT' | 'DUPLICATE' | 'INCOMPLETE_MANIFEST' | 'INVITE_LIMIT'
  | 'MEDIA_EXPIRED' | 'MEDIA_TOO_LARGE' | 'UNSUPPORTED_MEDIA' | 'RATE_LIMITED' | 'PRICE_CHANGED' | 'SMS_NOT_SENT'
  | 'INTERNAL'
  | 'NETWORK' | 'TIMEOUT' | 'OFFLINE' | 'CLIENT_OUTDATED'; // client-synthesised (no HTTP response)

/** The normalized error every SeeBuyGet call resolves to on failure. Never thrown for a business code. */
export interface SbgError {
  code: SbgErrorCode | string;
  status: number; // 0 for client-synthesised (network/timeout)
  title: string;
  detail: string;
  retryable: boolean;
  params?: Record<string, unknown>;
  traceId?: string;
}

/**
 * The monoline icon symbols an error may ask for.
 *
 * These are NAMES, not glyphs. Emoji were used here once and were wrong twice over: they render
 * in a different typeface (and a different palette) on every device, and the newer ones (the
 * ID-card glyph is Unicode 14) are plain tofu on the cheap Androids this app targets. The name is
 * resolved by the shared `<Icon>` set, whose `IconName` union is defined as a superset of this
 * one, so the compiler guarantees every code below has a drawable symbol.
 */
export type ErrorIconName =
  | 'wallet'
  | 'lock'
  | 'keypad'
  | 'camera'
  | 'search'
  | 'pin'
  | 'clock'
  | 'scale'
  | 'block'
  | 'box'
  | 'key'
  | 'edit'
  | 'offline'
  | 'refresh'
  | 'warning';

/** How a code is shown to a non-reader: an icon name, a tone, and a read-aloud clip key. */
export interface ErrorPresentation {
  icon: ErrorIconName;
  tone: 'info' | 'warn' | 'danger';
  /** Key into the app's pre-recorded audio clips (read-aloud for non-readers). */
  say: string;
}

const GENERIC: ErrorPresentation = { icon: 'warning', tone: 'danger', say: 'error.generic' };

/** Curated presentation for the user-facing codes; anything else falls back to GENERIC. */
const PRESENTATION: Partial<Record<SbgErrorCode, ErrorPresentation>> = {
  WALLET_INSUFFICIENT: { icon: 'wallet', tone: 'warn', say: 'error.top_up' },
  PAYMENT_REQUIRED: { icon: 'wallet', tone: 'warn', say: 'error.top_up' },
  AGENT_LOCKED: { icon: 'lock', tone: 'warn', say: 'error.locked' },
  SHIPMENT_NOT_PAID: { icon: 'wallet', tone: 'warn', say: 'error.unpaid' },
  OTP_INVALID: { icon: 'keypad', tone: 'warn', say: 'error.wrong_code' },
  CODE_MISMATCH: { icon: 'keypad', tone: 'warn', say: 'error.wrong_code' },
  // Bagging: this parcel is going somewhere else. A warning at the counter, not a failure.
  WRONG_DESTINATION: { icon: 'pin', tone: 'warn', say: 'error.wrong_destination' },
  OTP_LOCKED: { icon: 'lock', tone: 'danger', say: 'error.code_locked' },
  // The collection code's own lockout — the inbound half of the same custody check.
  CODE_LOCKED: { icon: 'lock', tone: 'danger', say: 'error.code_locked' },
  // Identity (S20/S21): a phone-first consumer signs in with a 4-digit PIN over their verified phone.
  AUTH_FAILED: { icon: 'lock', tone: 'warn', say: 'error.wrong_sign_in' },
  PIN_INVALID: { icon: 'keypad', tone: 'warn', say: 'error.pin_digits' },
  PIN_LOCKED: { icon: 'lock', tone: 'danger', say: 'error.pin_locked' },
  // A wrong PIN from somebody already signed in (changing it, starting a shift) — a 403, so nothing signs them out.
  PIN_WRONG: { icon: 'keypad', tone: 'warn', say: 'error.pin_wrong' },
  PASSWORD_WRONG: { icon: 'lock', tone: 'warn', say: 'error.password_wrong' },
  PASSWORD_LOCKED: { icon: 'lock', tone: 'warn', say: 'error.password_locked' },
  PASSWORD_TOO_SHORT: { icon: 'lock', tone: 'warn', say: 'error.password_short' },
  PASSWORD_GUESSABLE: { icon: 'lock', tone: 'warn', say: 'error.password_guessable' },
  SECRET_WRONG: { icon: 'lock', tone: 'warn', say: 'error.secret_wrong' },
  PIN_GUESSABLE: { icon: 'keypad', tone: 'warn', say: 'error.pin_guessable' },
  // A PIN typed on a device no code to that phone was ever typed on. Not a wrong PIN — it was not looked at. The apps
  // answer it with a step (NewDeviceSheet), and this is the sentence for where the step was closed.
  DEVICE_NOT_KNOWN: { icon: 'lock', tone: 'info', say: 'error.device_new' },
  ROLE_NOT_HELD: { icon: 'block', tone: 'warn', say: 'error.role_not_held' },
  PHONE_INVALID: { icon: 'keypad', tone: 'warn', say: 'error.phone_invalid' },
  // A good number, in a country this deployment does not text codes to. Not "check what you typed".
  PHONE_NOT_SERVED: { icon: 'keypad', tone: 'warn', say: 'error.phone_not_served' },
  // The code could not be texted — the provider's bad minute, or ours. Nothing was counted: asking again is the answer.
  SMS_NOT_SENT: { icon: 'clock', tone: 'warn', say: 'error.sms_not_sent' },
  PHONE_NOT_VERIFIED: { icon: 'keypad', tone: 'warn', say: 'error.verify_phone' },
  // Choosing a PIN needs a recovery email, proven by the code sent to it.
  EMAIL_NOT_VERIFIED: { icon: 'keypad', tone: 'warn', say: 'error.verify_email' },
  PHOTO_REQUIRED: { icon: 'camera', tone: 'warn', say: 'error.photo_needed' },
  NOT_FOUND: { icon: 'search', tone: 'warn', say: 'error.not_found' },
  WRONG_PUDO: { icon: 'pin', tone: 'warn', say: 'error.wrong_place' },
  INVALID_STATE: { icon: 'clock', tone: 'info', say: 'error.not_now' },
  // FP8 — over the shift limit, or not yet rested after a working day. The detail names the hours.
  HOURS_EXCEEDED: { icon: 'clock', tone: 'warn', say: 'error.hours_exceeded' },
  WINDOW_EXPIRED: { icon: 'clock', tone: 'warn', say: 'error.too_late' },
  CAPACITY_EXCEEDED: { icon: 'scale', tone: 'warn', say: 'error.too_heavy' },
  // F3 — a run that cannot take this load. The server's DETAIL names which axis ran out and by how much
  // ('only 18 m3 of space is left'), which is the part a shipper can act on, so callers pass showDetail.
  NO_ROOM: { icon: 'scale', tone: 'warn', say: 'error.no_room' },
  // The carrier is suspended, or a paper its sister enforces has lapsed. The detail names which — callers pass showDetail.
  CARRIER_NOT_TRADING: { icon: 'block', tone: 'warn', say: 'error.carrier_not_trading' },
  // A decision against somebody that came without its reason. The detail says which reason is missing.
  REASON_REQUIRED: { icon: 'edit', tone: 'warn', say: 'error.reason_required' },
  // Details that already belong to an account. Never 'try again': the same details are refused again. A screen that
  // can say what is expected next reads which detail matched from params.field (shared/duplicate.ts).
  DUPLICATE: { icon: 'lock', tone: 'warn', say: 'error.already_registered' },
  /*
   * The three the delivery gate refuses with, reachable from a run since F5 held it to the board’s line.
   *
   * Worth noting what registering these turned up: VEHICLE_MISSING_CAPABILITY and CARGO_INCOMPATIBLE
   * have been in this file since S31 and their SAY strings were never added to ErrorNote — so on the
   * BOARD too, all this time, "that truck cannot carry these goods" has been rendering as "Something
   * went wrong. Try again." Half-wired in exactly the way NO_ROOM was.
   */
  SAFETY_CHECK_INCOMPLETE: { icon: 'warning', tone: 'warn', say: 'error.checklist' },
  RECEIVER_REQUIRED: { icon: 'edit', tone: 'warn', say: 'error.receiver' },
  DELIVERY_PHOTO_REQUIRED: { icon: 'camera', tone: 'warn', say: 'error.pod_photo' },
  FRAGILE_NOT_ALLOWED: { icon: 'block', tone: 'warn', say: 'error.no_fragile' },
  // S30 cargo taxonomy — a palletised/oversized load cannot use the PUDO network; it needs dedicated freight.
  CARGO_REQUIRES_DEDICATED: { icon: 'scale', tone: 'warn', say: 'error.needs_dedicated' },
  // S31 — two goods that must not travel together (e.g. cement dust + fresh food), or a vehicle that lacks a
  // capability the cargo needs (perishable → cold chain, hazardous → hazmat).
  CARGO_INCOMPATIBLE: { icon: 'block', tone: 'warn', say: 'error.cargo_incompatible' },
  VEHICLE_MISSING_CAPABILITY: { icon: 'block', tone: 'warn', say: 'error.vehicle_capability' },
  BAG_FULL: { icon: 'box', tone: 'warn', say: 'error.bag_full' },
  // Scanning is a loop, so the same sticker gets waved twice — and a parcel already in a SEALED bag on the
  // floor is still on the shelf as far as the shop is concerned. Neither is a failure; both need saying.
  ALREADY_IN_BAG: { icon: 'box', tone: 'info', say: 'error.already_in_bag' },
  // The shop's own floor is full of bags. Not a failure — a queue: one has to leave before another starts.
  STAGING_FULL: { icon: 'box', tone: 'warn', say: 'error.staging_full' },
  SHELF_FULL: { icon: 'box', tone: 'warn', say: 'error.shelf_full' },
  // S25 handover completeness gate — a short load the agent must resolve (load the rest, or short-ship).
  INCOMPLETE_MANIFEST: { icon: 'box', tone: 'warn', say: 'error.manifest_incomplete' },
  // S26 media upload + retention.
  MEDIA_TOO_LARGE: { icon: 'camera', tone: 'warn', say: 'error.photo_too_large' },
  UNSUPPORTED_MEDIA: { icon: 'camera', tone: 'warn', say: 'error.photo_type' },
  MEDIA_EXPIRED: { icon: 'clock', tone: 'info', say: 'error.photo_expired' },
  MEDIA_LOCKED: { icon: 'lock', tone: 'info', say: 'error.photo_locked' },
  RATE_LIMITED: { icon: 'clock', tone: 'info', say: 'error.slow_down' },
  PRICE_CHANGED: { icon: 'wallet', tone: 'warn', say: 'error.price_changed' },
  UNAUTHORIZED: { icon: 'key', tone: 'danger', say: 'error.sign_in' },
  FORBIDDEN: { icon: 'block', tone: 'danger', say: 'error.not_allowed' },
  VALIDATION_FAILED: { icon: 'edit', tone: 'warn', say: 'error.check_fields' },
  NETWORK: { icon: 'offline', tone: 'warn', say: 'error.offline' },
  TIMEOUT: { icon: 'offline', tone: 'warn', say: 'error.slow_network' },
  // The phone knows it has no signal, and this was something only a connection can do.
  OFFLINE: { icon: 'offline', tone: 'warn', say: 'error.offline_needed' },
  CLIENT_OUTDATED: { icon: 'refresh', tone: 'danger', say: 'error.update_app' },
};

export function presentationFor(code: SbgErrorCode | string): ErrorPresentation {
  return PRESENTATION[code as SbgErrorCode] ?? GENERIC;
}

/** Parse an RFC 9457 problem+json body (or any shape) into an SbgError, filling sensible defaults. */
export function toSbgError(body: unknown, status: number): SbgError {
  const p = (body ?? {}) as Partial<SbgError> & { message?: string };
  return {
    code: p.code ?? codeForStatus(status),
    status,
    title: p.title ?? 'Something went wrong',
    detail: p.detail ?? p.message ?? '',
    retryable: p.retryable ?? (status >= 500 || status === 429),
    params: p.params,
    traceId: p.traceId,
  };
}

/** A client-synthesised error for failures with no HTTP response (offline, aborted, version block). */
export function clientError(code: 'NETWORK' | 'TIMEOUT' | 'OFFLINE' | 'CLIENT_OUTDATED', detail: string): SbgError {
  const retryable = code !== 'CLIENT_OUTDATED';
  return { code, status: 0, title: presentationFor(code).say, detail, retryable };
}

function codeForStatus(status: number): SbgErrorCode {
  switch (status) {
    case 400: return 'BAD_REQUEST';
    case 401: return 'UNAUTHORIZED';
    case 402: return 'PAYMENT_REQUIRED';
    case 403: return 'FORBIDDEN';
    case 404: return 'NOT_FOUND';
    case 409: return 'CONFLICT';
    case 429: return 'RATE_LIMITED';
    default: return status >= 500 ? 'INTERNAL' : 'BAD_REQUEST';
  }
}
