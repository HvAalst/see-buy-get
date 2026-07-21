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
  | 'BAD_REQUEST' | 'VALIDATION_FAILED' | 'INVALID_INPUT' | 'AMOUNT_INVALID' | 'EMAIL_INVALID'
  | 'PASSWORD_TOO_SHORT' | 'PHONE_REQUIRED' | 'PHONE_INVALID' | 'PHONE_NOT_VERIFIED' | 'PHOTO_REQUIRED'
  | 'ADDRESS_REQUIRED' | 'FIELD_REQUIRED' | 'INVALID_RATING' | 'ZONES_REQUIRED' | 'LICENCE_REQUIRED'
  | 'LICENCE_EXPIRED' | 'INVALID_VEHICLE_CLASS' | 'INVALID_TRUCK_SUBTYPE' | 'UNKNOWN_ROLE' | 'DISPUTE_INCOMPLETE'
  | 'REQUIREMENTS_NOT_MET' | 'KYC_INCOMPLETE' | 'APPROVAL_BLOCKED' | 'INVALID_STATE' | 'WINDOW_EXPIRED'
  | 'NOT_INBOUND' | 'PARCEL_EXISTS' | 'SHIPMENT_NOT_PAID' | 'CODE_MISMATCH' | 'NOT_COUPLED' | 'ALREADY_COUPLED'
  | 'CANNOT_COUPLE' | 'CAPACITY_EXCEEDED' | 'FRAGILE_NOT_ALLOWED' | 'BAG_FULL' | 'BAG_EMPTY' | 'BAG_RESERVED'
  | 'BAG_MISADDRESSED' | 'SHELF_FULL' | 'NO_CAPACITY_AVAILABLE' | 'OTP_INVALID' | 'OTP_LOCKED' | 'UNAUTHORIZED'
  | 'AUTH_FAILED' | 'AUTH_CODE_INVALID' | 'AUTH_NOT_ACTIVE' | 'PAYMENT_REQUIRED' | 'WALLET_INSUFFICIENT'
  | 'FORBIDDEN' | 'WRONG_PUDO' | 'AGENT_LOCKED' | 'NOT_FOUND' | 'CONFLICT' | 'DUPLICATE' | 'RATE_LIMITED'
  | 'INTERNAL'
  | 'NETWORK' | 'TIMEOUT' | 'CLIENT_OUTDATED'; // client-synthesised (no HTTP response)

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

/** How a code is shown to a non-reader: an icon glyph, a tone, and a read-aloud clip key. */
export interface ErrorPresentation {
  icon: string;
  tone: 'info' | 'warn' | 'danger';
  /** Key into the app's pre-recorded audio clips (read-aloud for non-readers). */
  say: string;
}

const GENERIC: ErrorPresentation = { icon: '⚠️', tone: 'danger', say: 'error.generic' };

/** Curated presentation for the user-facing codes; anything else falls back to GENERIC. */
const PRESENTATION: Partial<Record<SbgErrorCode, ErrorPresentation>> = {
  WALLET_INSUFFICIENT: { icon: '💳', tone: 'warn', say: 'error.top_up' },
  PAYMENT_REQUIRED: { icon: '💳', tone: 'warn', say: 'error.top_up' },
  AGENT_LOCKED: { icon: '🔒', tone: 'warn', say: 'error.locked' },
  SHIPMENT_NOT_PAID: { icon: '💳', tone: 'warn', say: 'error.unpaid' },
  OTP_INVALID: { icon: '🔢', tone: 'warn', say: 'error.wrong_code' },
  CODE_MISMATCH: { icon: '🔢', tone: 'warn', say: 'error.wrong_code' },
  OTP_LOCKED: { icon: '🚫', tone: 'danger', say: 'error.code_locked' },
  PHOTO_REQUIRED: { icon: '📷', tone: 'warn', say: 'error.photo_needed' },
  NOT_FOUND: { icon: '🔍', tone: 'warn', say: 'error.not_found' },
  WRONG_PUDO: { icon: '📍', tone: 'warn', say: 'error.wrong_place' },
  INVALID_STATE: { icon: '⏳', tone: 'info', say: 'error.not_now' },
  WINDOW_EXPIRED: { icon: '⌛', tone: 'warn', say: 'error.too_late' },
  CAPACITY_EXCEEDED: { icon: '⚖️', tone: 'warn', say: 'error.too_heavy' },
  FRAGILE_NOT_ALLOWED: { icon: '🥚', tone: 'warn', say: 'error.no_fragile' },
  BAG_FULL: { icon: '🎒', tone: 'warn', say: 'error.bag_full' },
  SHELF_FULL: { icon: '📦', tone: 'warn', say: 'error.shelf_full' },
  RATE_LIMITED: { icon: '🐢', tone: 'info', say: 'error.slow_down' },
  UNAUTHORIZED: { icon: '🔑', tone: 'danger', say: 'error.sign_in' },
  FORBIDDEN: { icon: '⛔', tone: 'danger', say: 'error.not_allowed' },
  VALIDATION_FAILED: { icon: '✏️', tone: 'warn', say: 'error.check_fields' },
  NETWORK: { icon: '📶', tone: 'warn', say: 'error.offline' },
  TIMEOUT: { icon: '📶', tone: 'warn', say: 'error.slow_network' },
  CLIENT_OUTDATED: { icon: '⬆️', tone: 'danger', say: 'error.update_app' },
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
export function clientError(code: 'NETWORK' | 'TIMEOUT' | 'CLIENT_OUTDATED', detail: string): SbgError {
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
