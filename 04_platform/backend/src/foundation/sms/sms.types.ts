import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * SMS — the seam between "this phone must be sent its code" and the service that texts it.
 *
 * Two things are texted, both in fixed words: the code that proves somebody holds a phone, and the notice to an OLD payout
 * number that it was replaced (`payoutNumberChangedText`). Nothing about a parcel, ever. Off a sandbox it goes through
 * Twilio (the user, 2026-10-11); what switches that on is the environment:
 *
 *   - `TWILIO_ACCOUNT_SID` — the account. It is part of the address a text is posted to;
 *   - a credential: `TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET` (what Twilio recommends: a key can be revoked
 *     without touching the account), or `TWILIO_AUTH_TOKEN`;
 *   - who a text is from: `TWILIO_MESSAGING_SERVICE_SID`, or `TWILIO_FROM` (a number, or a sender name);
 *
 * Which countries a code is texted to is NOT set here: it is the countries that are switched on (`SmsService`).
 *
 * With all three set, off a sandbox, `sms.module.ts` wires the provider's sender. Otherwise `OutboxSmsSender` keeps
 * what would have been texted. A SANDBOX NEVER TEXTS THROUGH THE PROVIDER, whatever is set: its people are made up
 * and their numbers may be somebody's. Staff read which it is on the console's Connections screen.
 */

/** One text message, to one phone. The number is E.164 (`+254712345678`): the provider takes nothing else. */
export interface OutgoingSms {
  to: string;
  body: string;
}

/**
 * WHY A TEXT WAS NOT HANDED OVER, by whose it is to put right. `unreachable` — the provider could not be reached, or
 * did not answer in time · `refused` — it will not send for this account as it is set up: the credential, the
 * sender, a country it was not allowed to text (the operator's) · `limit` — it is asking us to slow down (the
 * operator's) · `rejected` — it cannot text THIS number (the person's) · `failed` — it answered with a fault, or
 * with something that is not its answer · `paused` — not asked at all: this server has texted as many as its own cap
 * allows in the last hour or day (SmsService: a bill run up by codes asked for in bulk stops at the cap).
 */
export const SMS_FAILURES = ['unreachable', 'refused', 'limit', 'rejected', 'failed', 'paused'] as const;
export type SmsFailure = (typeof SMS_FAILURES)[number];

/**
 * WHY A PROVIDER THAT IS (PARTLY) SET UP IS NOT USED. `no_account`, `no_credential`, `no_sender` — that part is
 * missing · `not_twilio` — an address other than Twilio's was set, and a credential is for one address · `sandbox`
 * — everything is set, and this is a sandbox, which does not text.
 */
export const SMS_PROBLEMS = ['no_account', 'no_credential', 'no_sender', 'not_twilio', 'sandbox'] as const;
export type SmsProblem = (typeof SMS_PROBLEMS)[number];

export const SMS_CREDENTIALS = ['api_key', 'auth_token'] as const;
export type SmsCredential = (typeof SMS_CREDENTIALS)[number];
export const SMS_SENDERS = ['service', 'from'] as const;
export type SmsSenderKind = (typeof SMS_SENDERS)[number];

/** A sender that could not hand a text over says why in these terms. Carries no number, no text and no credential. */
export class SmsSendError extends Error {
  constructor(
    readonly kind: SmsFailure,
    message: string,
    /** The provider's own number for it, where it gave one. */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'SmsSendError';
  }
}

/** Whatever takes a text off our hands. It resolves ONLY when the text was taken; anything else it throws as an `SmsSendError`. */
export interface SmsSender {
  send(sms: OutgoingSms): Promise<void>;
}

export const SMS_SENDER = Symbol('SMS_SENDER');

/** What became of the last text this server wrote. Never who it was for. */
export class SmsLast {
  at: string;
  ok: boolean;
  @ApiPropertyOptional({ enum: SMS_FAILURES }) failed?: SmsFailure;
  /** The provider's own number for the failure, for looking up. A number only: its words may name a phone. */
  @ApiPropertyOptional() code?: string;
}

/**
 * HOW MANY TEXTS MAY LEAVE IN AN HOUR, AND IN A DAY — every one costs money, and "send me a code" is the button a fraud
 * presses to run up the bill (numbers that earn per text received, asked for in bulk). Per number and per caller the
 * doors already limit; this is the whole server's, set by GLOS_SMS_PER_HOUR and GLOS_SMS_PER_DAY.
 */
export class SmsCap {
  perHour: number;
  perDay: number;
  /** Texts handed to the provider in the last 60 minutes, and the last 24 hours. */
  lastHour: number;
  lastDay: number;
  /** Texting is paused: a cap was reached. Since when, and which. Absent: texts go. */
  @ApiPropertyOptional() pausedSince?: string;
  @ApiPropertyOptional({ enum: ['hour', 'day'] }) pausedBy?: 'hour' | 'day';
  /** Codes not texted since this server started because a cap was reached. */
  held: number;
}

/**
 * WHERE A TEXT GOES, as staff are shown it. `sends` is read off the sender this server was started with — nobody
 * types it, so it cannot say "sending" while the outbox is what is wired in. Nothing here is a number, the text of
 * a message, or a credential: each part is said as set or not set.
 */
export class SmsConnection {
  /** A text leaves this server for the provider. `false`: it is kept here instead, and no phone receives one. */
  sends: boolean;
  /** The provider's account is named. */
  accountSet: boolean;
  /** Which credential would be used. Absent: none is set. */
  @ApiPropertyOptional({ enum: SMS_CREDENTIALS }) credential?: SmsCredential;
  /** Who a text would be from: a Messaging Service, or a number or sender name. Absent: none is set. */
  @ApiPropertyOptional({ enum: SMS_SENDERS }) sender?: SmsSenderKind;
  /** Something of the provider's is set and it is not used, and this is why. */
  @ApiPropertyOptional({ enum: SMS_PROBLEMS }) problem?: SmsProblem;
  /** The texts go to a stand-in on this machine, not to the provider: a sandbox being driven. */
  standIn: boolean;
  /** The countries a code is texted to — the ones that are switched on — each as its code and dial code ("KE +254"). Empty: none. */
  countries: string[];
  /** Texts written since this server started · of those, not handed over. */
  written: number;
  failed: number;
  /** Codes NOT texted since this server started because the number's country is not switched on. */
  fenced: number;
  @ApiPropertyOptional({ type: SmsLast }) last?: SmsLast;
  /** The overall caps, and how near they are: texts handed over in the last hour and day, against each. */
  @ApiProperty({ type: SmsCap }) cap: SmsCap;
}

