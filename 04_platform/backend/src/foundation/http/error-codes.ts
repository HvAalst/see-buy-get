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
  // One nation's requirement asked of somebody in another (a KRA PIN outside Kenya): it does not apply there.
  NOT_IN_THIS_COUNTRY: { status: 400, title: 'Not asked in this country' },
  EMAIL_INVALID: { status: 400, title: 'A valid email is required' },
  // Somebody asking to be told when a country opens, about one that is already open. Not a failure on
  // their part: the right answer is a link to the sign-up, which is what the caller turns this into.
  ALREADY_OPEN: { status: 400, title: 'The network already reaches that country' },
  // F3 — a departure that cannot take this load. Weight or space; the message says which.
  NO_ROOM: { status: 409, title: 'There is not enough room on that departure' },
  PASSWORD_TOO_SHORT: { status: 400, title: 'Password is too short' },
  PASSWORD_GUESSABLE: { status: 400, title: 'That password is too easy to guess' },
  PHONE_REQUIRED: { status: 400, title: 'A phone number is required' },
  PHONE_INVALID: { status: 400, title: 'Phone number is not valid' },
  PHONE_NOT_VERIFIED: { status: 400, title: 'Verify your phone number first' },
  // A number in a country that is not switched on, so no code is texted to it. The number may be perfectly
  // good — which is why it is not PHONE_INVALID, whose sentence tells the person to check what they typed.
  PHONE_NOT_SERVED: { status: 400, title: 'We cannot send a code to a number in that country' },
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
  WRONG_DESTINATION: { status: 400, title: 'That is going somewhere else' },
  CODE_LOCKED: { status: 400, title: 'Too many wrong codes' },

  // --- 400 Bad Request: fleet coupling ---------------------------------------------------------
  NOT_COUPLED: { status: 400, title: 'Driver is not coupled to a vehicle' },
  ALREADY_COUPLED: { status: 400, title: 'Already coupled — uncouple first' },
  CANNOT_COUPLE: { status: 400, title: 'These cannot be coupled' },
  /** The CARRIER cannot take new work — suspended, or a paper its sister enforces has lapsed. Never
   *  raised against finishing a run already under way: that would strand the cargo, not the paperwork. */
  CARRIER_NOT_TRADING: { status: 409, title: 'This carrier is not taking new work' },
  HOURS_EXCEEDED: { status: 400, title: 'Over the hours limit' },
  // CL1 — the trade term is not switched on for this country, in this direction.
  TERM_NOT_ACTIVE: { status: 400, title: 'That trade term is not available here' },

  // --- 400 Bad Request: capacity / routing -----------------------------------------------------
  CAPACITY_EXCEEDED: { status: 400, title: 'Exceeds the available capacity' },
  FRAGILE_NOT_ALLOWED: { status: 400, title: 'This vehicle cannot carry fragile parcels' },
  CARGO_REQUIRES_DEDICATED: { status: 400, title: 'This load needs dedicated freight transport' },
  CARGO_INCOMPATIBLE: { status: 400, title: 'These goods cannot travel together' },
  VEHICLE_MISSING_CAPABILITY: { status: 400, title: 'This vehicle cannot carry this cargo' },
  BUDGET_EXCEEDED: { status: 400, title: "The price exceeds the shipper's budget" },
  NEGOTIATION_REQUIRED: { status: 400, title: 'This load is posted for negotiation' },
  BODY_EXCLUDED: { status: 400, title: 'The shipper has ruled out this body type' },
  PRICE_CHANGED: { status: 409, title: 'The price changed — please review the new price' },
  SAFETY_CHECK_INCOMPLETE: { status: 400, title: 'The safety checklist is not complete' },
  SECUREMENT_PHOTO_REQUIRED: { status: 400, title: 'A photo of the secured load is required' },
  COMMERCIAL_INVOICE_REQUIRED: { status: 409, title: 'The commercial invoice is not signed' },
  RECEIVER_REQUIRED: { status: 400, title: 'Record who received the goods' },
  DELIVERY_PHOTO_REQUIRED: { status: 400, title: 'A photo of the goods as delivered is required' },
  REASON_REQUIRED: { status: 400, title: 'A reason is required' },
  NOT_TEMPERATURE_CONTROLLED: { status: 400, title: 'This freight is not temperature-controlled' },
  FX_REQUIRED: { status: 400, title: 'This route would have to be paid in two currencies' },
  CUSTOMS_INCOMPLETE: { status: 400, title: 'A parcel crossing a border needs a declaration' },
  BAG_FULL: { status: 400, title: 'The bag is full' },
  BAG_EMPTY: { status: 400, title: 'The bag is empty' },
  BAG_RESERVED: { status: 400, title: 'The bag is reserved for another driver' },
  BAG_MISADDRESSED: { status: 400, title: 'The bag is addressed to another location' },
  ALREADY_IN_BAG: { status: 400, title: 'That parcel is already in a bag' },
  ALREADY_RATED: { status: 409, title: 'That order has already been rated' },
  STAGING_FULL: { status: 400, title: 'There is no floor room for another bag' },
  SHELF_FULL: { status: 400, title: 'The shelf is full' },
  NO_CAPACITY_AVAILABLE: { status: 400, title: 'No pick-up point with free capacity' },

  // --- 400 Bad Request: OTP + PIN --------------------------------------------------------------
  OTP_INVALID: { status: 400, title: 'Wrong or expired code' },
  OTP_LOCKED: { status: 400, title: 'Too many wrong codes' },
  PIN_INVALID: { status: 400, title: 'PIN must be 5 digits' },
  // The recovery email was given but nobody has proved they read it: a code goes to the address first.
  EMAIL_NOT_VERIFIED: { status: 400, title: 'Confirm your email address first' },
  // One digit four times, a straight run, pairs: the PINs somebody who knows you tries first. Refused when chosen.
  PIN_GUESSABLE: { status: 400, title: 'That PIN is too easy to guess' },

  // --- 400 Bad Request: a payment provider's callback -------------------------------------------
  // The body reached us but does not say what a confirmation has to say. Separate from the signature
  // failures below because they mean different things to whoever is reading the log: this one is a
  // mis-shaped message, those are a message we will not take anybody's word for.
  CALLBACK_INVALID: { status: 400, title: 'This payment confirmation is incomplete' },

  // --- 401 Unauthorized ------------------------------------------------------------------------
  UNAUTHORIZED: { status: 401, title: 'Authentication required' },
  AUTH_FAILED: { status: 401, title: 'Wrong email or password' },
  AUTH_CODE_INVALID: { status: 401, title: 'Unknown sign-in code' },
  AUTH_NOT_ACTIVE: { status: 401, title: 'This account is not active yet' },
  // Money is created by a confirmed payment, so an unsigned or replayed confirmation is refused the way
  // a forged token is — these two are the lock on the door that creates money.
  CALLBACK_UNSIGNED: { status: 401, title: 'This payment confirmation is not signed' },
  CALLBACK_STALE: { status: 401, title: 'This payment confirmation is too old to accept' },
  /**
   * The provider's own records contradict the confirmation we were sent — M-Pesa says that checkout was
   * cancelled, or never paid. A forgery and a stale replay both look like this, and so does a genuine
   * mistake; all three are refused for the same reason and none of them may reach the books.
   */
  CALLBACK_CONTRADICTED: { status: 401, title: 'The payment provider says this payment was not made' },
  /** We could not reach the provider to confirm it, and this deployment has asked not to guess. */
  CALLBACK_UNVERIFIED: { status: 401, title: 'This payment could not be confirmed with the provider' },

  // --- 402 Payment Required --------------------------------------------------------------------
  PAYMENT_REQUIRED: { status: 402, title: 'Payment is required' },
  WALLET_INSUFFICIENT: { status: 402, title: 'Top up to continue' },

  // --- 403 Forbidden ---------------------------------------------------------------------------
  FORBIDDEN: { status: 403, title: 'Not allowed' },
  // CL1 — the agreed term puts the loss on the other party, so this one cannot claim for it.
  NOT_THE_CLAIMANT: { status: 403, title: 'The agreed term puts this loss on the other party' },
  WRONG_PUDO: { status: 403, title: 'This must happen at a different pick-up point' },
  AGENT_LOCKED: { status: 403, title: 'This account is locked' },
  REPUTATION_BELOW_FLOOR: { status: 403, title: 'Rating below the network minimum' },
  PIN_LOCKED: { status: 403, title: 'Too many wrong PINs — verify by code' },
  // A wrong PIN from somebody ALREADY signed in (changing it, starting a shift). Deliberately not a 401: the
  // session is fine, and every app reads a 401 as 'your sign-in ended' and signs the person out.
  PIN_WRONG: { status: 403, title: 'That is not your PIN' },
  // A phone + PIN sign-in from a device no code to that phone was ever typed on. The PIN was not looked at. A 403
  // of its own (never a 401, never "wrong PIN"): the app's answer is to send the code and confirm the device.
  DEVICE_NOT_KNOWN: { status: 403, title: 'This device has not signed in to this account before' },
  // The same, for a store asked for its password (or, with no account yet, its current secret) before its signing
  // secret is replaced: it is signed in, and a mistyped password must not be read as "your sign-in ended".
  PASSWORD_WRONG: { status: 403, title: 'That is not the password' },
  SECRET_WRONG: { status: 403, title: 'That is not the current secret' },
  // Five wrong passwords at one account: the sign-in answers nobody for a while. A 403, because it is asked from
  // inside an app too (changing a password, replacing a store's secret) and a 401 there would sign the person out.
  PASSWORD_LOCKED: { status: 403, title: 'Too many wrong passwords' },
  ROLE_NOT_HELD: { status: 403, title: 'You do not hold that role' },
  // A counter was shown a driver's badge NUMBER: a driver of ours shows the badge from their own phone, with the code
  // of the shift they are on. What only a driver can do needs something only the driver holds.
  DRIVER_PASS_NEEDED: { status: 403, title: 'Scan the badge on the driver’s phone' },
  DRIVER_PASS_WRONG: { status: 403, title: 'That is not the code on the driver’s phone' },
  // The fleet asks for a daily check of a vehicle before a shift, and there is none today: the app opens the check.
  VEHICLE_CHECK_NEEDED: { status: 409, title: 'Check the vehicle first' },

  // --- 403 Forbidden: media ---------------------------------------------------------------------
  MEDIA_LOCKED: { status: 403, title: 'This image is kept as evidence and cannot be removed yet' },

  // --- 404 Not Found ---------------------------------------------------------------------------
  NOT_FOUND: { status: 404, title: 'Not found' },

  // --- 409 Conflict ----------------------------------------------------------------------------
  CONFLICT: { status: 409, title: 'Conflict with existing data' },
  DUPLICATE: { status: 409, title: 'Already registered' },
  INCOMPLETE_MANIFEST: { status: 409, title: 'Some waiting parcels were not loaded' },
  // A parcel staff declared lost, scanned at a counter: it turned up. Kept safe and told to SeeBuyGet, who mark it
  // found; then the ordinary step works.
  PARCEL_LOST: { status: 409, title: 'This parcel was declared lost' },
  INVITE_LIMIT: { status: 409, title: 'Too many open invites' },
  IDEMPOTENCY_REUSED: { status: 409, title: 'That idempotency key was used for a different request' },
  QUOTE_SPENT: { status: 409, title: 'That quote has already been used' },

  // --- 410 / 413 / 415: media upload + retention -----------------------------------------------
  MEDIA_EXPIRED: { status: 410, title: 'This media has passed its retention window' },
  MEDIA_TOO_LARGE: { status: 413, title: 'The image is too large' },
  UNSUPPORTED_MEDIA: { status: 415, title: 'Unsupported image type' },

  // --- 429 / 5xx: transport --------------------------------------------------------------------
  RATE_LIMITED: { status: 429, title: 'Too many requests', retryable: true },
  INTERNAL: { status: 500, title: 'Something went wrong', retryable: true },
  // The code could not be texted: the provider was not there, refused us, or is not set up. Nothing the person did,
  // and nothing was counted against their number — asking again is the answer, so it is retryable.
  SMS_NOT_SENT: { status: 503, title: 'The code could not be sent', retryable: true },
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
