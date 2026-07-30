// Error-code registry — the machine-readable half of every failure (S4).
//
// A low-literacy UI cannot read an English sentence, but it CAN map a stable `code` to an icon and a
// pre-recorded audio clip. So every GlosError carries a code from this closed union; the English
// message survives only as `detail` (a fallback for readers and logs). The registry is the single
// source of truth for a code's HTTP status and human title, so throw sites pass a code — never a raw
// status — and the ProblemFilter renders a consistent RFC 9457 body from it.
//
// Codes are grouped by HTTP status. When adding one, keep it broad enough to be reused (several throw
// sites share INVALID_STATE / NOT_FOUND / DUPLICATE) — the UI needs a manageable set of icons, not one
// per throw site. Disambiguation is what `detail` and `params` are for.

export interface ErrorSpec {
  /** Default HTTP status for this code. A throw site keeps the status of the exception it replaced. */
  status: number;
  /** Short human title (RFC 9457 `title`) — stable per code, unlike the per-site `detail`. */
  title: string;
  /** Whether a client may safely retry the same request unchanged. Defaults to (status >= 500). */
  retryable?: boolean;
}

/* eslint-disable @typescript-eslint/no-unused-vars */
export const ERROR_CODES = {
  // --- 400 Bad Request: input validation -------------------------------------------------------
  BAD_REQUEST: { status: 400, title: 'Bad request' },
  VALIDATION_FAILED: { status: 400, title: 'Some fields are invalid' },
  INVALID_INPUT: { status: 400, title: 'Invalid input' },
  AMOUNT_INVALID: { status: 400, title: 'Amount is not valid' },
  EMAIL_INVALID: { status: 400, title: 'A valid email is required' },
  PASSWORD_TOO_SHORT: { status: 400, title: 'Password is too short' },
  PHONE_REQUIRED: { status: 400, title: 'A phone number is required' },
  PHONE_INVALID: { status: 400, title: 'Phone number is not valid' },
  PHONE_NOT_VERIFIED: { status: 400, title: 'Verify your phone number first' },
  PHOTO_REQUIRED: { status: 400, title: 'A photo is required' },
  ADDRESS_REQUIRED: { status: 400, title: 'A location or address is required' },
  FIELD_REQUIRED: { status: 400, title: 'A required field is missing' },
  INVALID_RATING: { status: 400, title: 'Rating is out of range' },
  ZONES_REQUIRED: { status: 400, title: 'At least one zone is required' },
  LICENCE_REQUIRED: { status: 400, title: 'A driving licence is required' },
  LICENCE_EXPIRED: { status: 400, title: 'The driving licence has expired' },
  INVALID_VEHICLE_CLASS: { status: 400, title: 'Unknown vehicle class' },
  INVALID_TRUCK_SUBTYPE: { status: 400, title: 'Unknown truck sub-type' },
  UNKNOWN_ROLE: { status: 400, title: 'Unknown account role' },
  DISPUTE_INCOMPLETE: { status: 400, title: 'A reason and a photo are required' },

  // --- 400 Bad Request: onboarding / KYC -------------------------------------------------------
  REQUIREMENTS_NOT_MET: { status: 400, title: 'Eligibility requirements not met' },
  KYC_INCOMPLETE: { status: 400, title: 'KYC documents are incomplete' },
  APPROVAL_BLOCKED: { status: 400, title: 'Cannot approve yet' },

  // --- 400 Bad Request: lifecycle / state ------------------------------------------------------
  INVALID_STATE: { status: 400, title: 'Not allowed in the current state' },
  WINDOW_EXPIRED: { status: 400, title: 'The time window has expired' },
  NOT_INBOUND: { status: 400, title: 'Not an inbound shipment' },
  PARCEL_EXISTS: { status: 400, title: 'A parcel with this ID already exists' },
  SHIPMENT_NOT_PAID: { status: 400, title: 'The shipment has not been paid' },
  CODE_MISMATCH: { status: 400, title: 'The code does not match' },

  // --- 400 Bad Request: fleet coupling ---------------------------------------------------------
  NOT_COUPLED: { status: 400, title: 'Driver is not coupled to a vehicle' },
  ALREADY_COUPLED: { status: 400, title: 'Already coupled — uncouple first' },
  CANNOT_COUPLE: { status: 400, title: 'These cannot be coupled' },

  // --- 400 Bad Request: capacity / routing -----------------------------------------------------
  CAPACITY_EXCEEDED: { status: 400, title: 'Exceeds the available capacity' },
  FRAGILE_NOT_ALLOWED: { status: 400, title: 'This vehicle cannot carry fragile parcels' },
  CARGO_REQUIRES_DEDICATED: { status: 400, title: 'This load needs dedicated freight transport' },
  CARGO_INCOMPATIBLE: { status: 400, title: 'These goods cannot travel together' },
  VEHICLE_MISSING_CAPABILITY: { status: 400, title: 'This vehicle cannot carry this cargo' },
  BUDGET_EXCEEDED: { status: 400, title: "The price exceeds the shipper's budget" },
  SAFETY_CHECK_INCOMPLETE: { status: 400, title: 'The safety checklist is not complete' },
  SECUREMENT_PHOTO_REQUIRED: { status: 400, title: 'A photo of the secured load is required' },
  NOT_TEMPERATURE_CONTROLLED: { status: 400, title: 'This freight is not temperature-controlled' },
  BAG_FULL: { status: 400, title: 'The bag is full' },
  BAG_EMPTY: { status: 400, title: 'The bag is empty' },
  BAG_RESERVED: { status: 400, title: 'The bag is reserved for another driver' },
  BAG_MISADDRESSED: { status: 400, title: 'The bag is addressed to another location' },
  SHELF_FULL: { status: 400, title: 'The shelf is full' },
  NO_CAPACITY_AVAILABLE: { status: 400, title: 'No pick-up point with free capacity' },

  // --- 400 Bad Request: OTP + PIN --------------------------------------------------------------
  OTP_INVALID: { status: 400, title: 'Wrong or expired code' },
  OTP_LOCKED: { status: 400, title: 'Too many wrong codes' },
  PIN_INVALID: { status: 400, title: 'PIN must be 4 digits' },

  // --- 401 Unauthorized ------------------------------------------------------------------------
  UNAUTHORIZED: { status: 401, title: 'Authentication required' },
  AUTH_FAILED: { status: 401, title: 'Wrong email or password' },
  AUTH_CODE_INVALID: { status: 401, title: 'Unknown sign-in code' },
  AUTH_NOT_ACTIVE: { status: 401, title: 'This account is not active yet' },

  // --- 402 Payment Required --------------------------------------------------------------------
  PAYMENT_REQUIRED: { status: 402, title: 'Payment is required' },
  WALLET_INSUFFICIENT: { status: 402, title: 'Top up to continue' },

  // --- 403 Forbidden ---------------------------------------------------------------------------
  FORBIDDEN: { status: 403, title: 'Not allowed' },
  WRONG_PUDO: { status: 403, title: 'This must happen at a different pick-up point' },
  AGENT_LOCKED: { status: 403, title: 'This account is locked' },
  PIN_LOCKED: { status: 403, title: 'Too many wrong PINs — verify by code' },
  ROLE_NOT_HELD: { status: 403, title: 'You do not hold that role' },

  // --- 403 Forbidden: media ---------------------------------------------------------------------
  MEDIA_LOCKED: { status: 403, title: 'This image is kept as evidence and cannot be removed yet' },

  // --- 404 Not Found ---------------------------------------------------------------------------
  NOT_FOUND: { status: 404, title: 'Not found' },

  // --- 409 Conflict ----------------------------------------------------------------------------
  CONFLICT: { status: 409, title: 'Conflict with existing data' },
  DUPLICATE: { status: 409, title: 'Already registered' },
  INCOMPLETE_MANIFEST: { status: 409, title: 'Some waiting parcels were not loaded' },
  INVITE_LIMIT: { status: 409, title: 'Too many open invites' },

  // --- 410 / 413 / 415: media upload + retention -----------------------------------------------
  MEDIA_EXPIRED: { status: 410, title: 'This media has passed its retention window' },
  MEDIA_TOO_LARGE: { status: 413, title: 'The image is too large' },
  UNSUPPORTED_MEDIA: { status: 415, title: 'Unsupported image type' },

  // --- 429 / 5xx: transport --------------------------------------------------------------------
  RATE_LIMITED: { status: 429, title: 'Too many requests', retryable: true },
  INTERNAL: { status: 500, title: 'Something went wrong', retryable: true },
} as const;
/* eslint-enable @typescript-eslint/no-unused-vars */

export type GlosErrorCode = keyof typeof ERROR_CODES;

/** The generic code for a bare HTTP status — used by the filter for exceptions that predate the codemod. */
export function codeForStatus(status: number): GlosErrorCode {
  switch (status) {
    case 400:
      return 'BAD_REQUEST';
    case 401:
      return 'UNAUTHORIZED';
    case 402:
      return 'PAYMENT_REQUIRED';
    case 403:
      return 'FORBIDDEN';
    case 404:
      return 'NOT_FOUND';
    case 409:
      return 'CONFLICT';
    case 429:
      return 'RATE_LIMITED';
    default:
      return status >= 500 ? 'INTERNAL' : 'BAD_REQUEST';
  }
}

/** True when a client may retry the request unchanged (network-class failures, not business rejections). */
export function isRetryable(code: GlosErrorCode): boolean {
  const spec = ERROR_CODES[code] as ErrorSpec;
  return spec.retryable ?? spec.status >= 500;
}
