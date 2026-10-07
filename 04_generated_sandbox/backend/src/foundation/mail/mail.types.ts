import { ApiPropertyOptional } from '@nestjs/swagger';
import type { RenderedMail } from './mail.blocks';
import type { MailTemplateId } from './mail.templates';

/**
 * MAIL — the seam between "an email should go" and the service that delivers it.
 *
 * Production sends through ZeptoMail (Zoho's transactional mail, renamed Zoho CPaaS in September 2026). The words
 * (`mail.templates.ts`), the layout (`mail.blocks.ts`), who is emailed when (the call sites), the request body
 * (`zeptomail.ts`) and the sending itself (`zeptomail.sender.ts`) are built. What switches it on is the environment:
 *
 *   - `ZEPTOMAIL_TOKEN` — the account's Send Mail token, with or without its `Zoho-enczapikey ` prefix;
 *   - `ZEPTOMAIL_URL`   — the sending address AS THE ACCOUNT'S OWN API PAGE SHOWS IT. There is no default: the host
 *     differs by data centre and changed name with the product, and a token sent to another region's host is
 *     refused in words that blame the token;
 *   - `MAIL_FROM_ADDRESS` (a sender on a domain verified with the provider), `MAIL_FROM_NAME`, `SBG_PUBLIC_URL`,
 *     `SBG_HELP_URL` and optionally `MAIL_LOGO_URL` (an https PNG — mail clients will not render SVG).
 *
 * With the token and a usable address set, `mail.module.ts` wires the provider's sender; without, `OutboxMailSender`
 * keeps what would have been sent, readable in a sandbox at GET /v1/mail/outbox. Every email can be looked at with
 * sample data at GET /v1/mail/preview. Staff read which of the two it is on the console's Connections screen.
 */

export interface MailAddress {
  address: string;
  name?: string;
}

export interface OutgoingMail extends RenderedMail {
  template: MailTemplateId;
  to: MailAddress;
  /** Ours, unique per email — ZeptoMail's `client_reference`, so a bounce can be matched to what caused it. */
  reference: string;
  /** Open/click tracking. Off for everything we send: these are account and security emails, not marketing. */
  tracking: boolean;
}

export interface MailSender {
  send(mail: OutgoingMail): Promise<void>;
}

export const MAIL_SENDER = Symbol('MAIL_SENDER');

/**
 * WHY AN EMAIL COULD NOT BE HANDED OVER, by whose it is to put right. `unreachable` — the provider could not be
 * reached, or did not answer in time · `refused` — it will not send for this account as it is set up: the token, the
 * sender's domain, an account not approved or blocked (the operator's) · `limit` — its sending limit or credit is
 * used up (the operator's) · `rejected` — it turned this one email down (the email's, not the connection's) ·
 * `failed` — it answered with a fault, or with something that is not its answer.
 */
export const MAIL_FAILURES = ['unreachable', 'refused', 'limit', 'rejected', 'failed'] as const;
export type MailFailure = (typeof MAIL_FAILURES)[number];

/**
 * WHY A PROVIDER THAT IS HALF SET UP IS NOT USED. `no_address` — a token, and nowhere to send it · `not_an_address`
 * — what is set is not a web address · `not_https` — it is one, and the token would travel in the clear.
 */
export const MAIL_PROBLEMS = ['no_address', 'not_an_address', 'not_https'] as const;
export type MailProblem = (typeof MAIL_PROBLEMS)[number];

/** A sender that could not hand an email over says why in these terms. Carries no address and no token. */
export class MailSendError extends Error {
  constructor(
    readonly kind: MailFailure,
    message: string,
    /** The provider's own code for it, where it gave one. */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'MailSendError';
  }
}

/** What became of the last email this server wrote. */
export class MailLast {
  at: string;
  ok: boolean;
  /** Which email it was, by its name — never who it was for. */
  what: string;
  @ApiPropertyOptional({ enum: MAIL_FAILURES }) failed?: MailFailure;
  /** The provider's own code for the failure, for looking up. A code only: its words may name an address. */
  @ApiPropertyOptional() code?: string;
}

/**
 * WHERE AN EMAIL GOES, as staff are shown it. `sends` is read off the sender this server was started with — it is
 * not a setting anybody types, so it cannot say "sending" while the outbox is what is wired in.
 */
export class MailConnection {
  /** An email leaves this server. `false`: it is kept here instead, and reaches nobody. */
  sends: boolean;
  /** A provider's token is set. Set while `sends` is false, it is a token nothing on this server uses. */
  tokenSet: boolean;
  /** The host of the provider's sending address. Never the address itself, and never the token. */
  @ApiPropertyOptional() host?: string;
  /** A token is set and the provider is not used, and this is why. */
  @ApiPropertyOptional({ enum: MAIL_PROBLEMS }) problem?: MailProblem;
  /** Who an email says it is from. */
  from: string;
  /**
   * That address is on a domain set aside for examples — the one this server starts with is — which nobody owns, so
   * no provider can verify it or will send for it.
   */
  fromIsPlaceholder: boolean;
  /** Emails written since this server started, and how many of those could not be handed over. */
  written: number;
  failed: number;
  /**
   * Emails NOT handed to the provider since this server started because their address cannot exist: it is on a
   * domain reserved for examples and tests. Nought while nothing is sent — the outbox keeps those like any other.
   */
  reserved: number;
  @ApiPropertyOptional({ type: MailLast }) last?: MailLast;
}
