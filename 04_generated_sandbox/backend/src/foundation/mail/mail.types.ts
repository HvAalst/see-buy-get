import { ApiPropertyOptional } from '@nestjs/swagger';
import type { RenderedMail } from './mail.blocks';
import type { MailTemplateId } from './mail.templates';

/**
 * MAIL — the seam between "an email should go" and the service that delivers it.
 *
 * Production sends through ZeptoMail (Zoho's transactional mail). Everything above the transport is built and
 * tested: the words (`mail.templates.ts`), the layout (`mail.blocks.ts`), who is emailed when (the call sites), and
 * the exact request body ZeptoMail takes (`zeptomail.ts`). What is left is plumbing:
 *
 *   1. a `ZeptoMailSender implements MailSender` that POSTs `toZeptoMailRequest(mail)` to the account's region host
 *      (api.zeptomail.com / .eu / .in …) at `/v1.1/email`, with `Authorization: Zoho-enczapikey <ZEPTOMAIL_TOKEN>`;
 *   2. provide it under `MAIL_SENDER` in `mail.module.ts` when `ZEPTOMAIL_TOKEN` is set;
 *   3. set `MAIL_FROM_ADDRESS` (a verified sender on the ZeptoMail domain), `MAIL_FROM_NAME`, `SBG_PUBLIC_URL`,
 *      `SBG_HELP_URL` and optionally `MAIL_LOGO_URL` (an https PNG — mail clients will not render SVG).
 *
 * Until then `OutboxMailSender` keeps what would have been sent, readable in a sandbox at GET /v1/mail/outbox, and
 * every email can be looked at with sample data at GET /v1/mail/preview.
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

/** What became of the last email this server wrote. */
export class MailLast {
  at: string;
  ok: boolean;
  /** Which email it was, by its name — never who it was for. */
  what: string;
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
  /** Who an email says it is from. */
  from: string;
  /** That address is the one this server starts with, which no provider will send for. */
  fromIsPlaceholder: boolean;
  /** Emails written since this server started, and how many of those could not be handed over. */
  written: number;
  failed: number;
  @ApiPropertyOptional({ type: MailLast }) last?: MailLast;
}
