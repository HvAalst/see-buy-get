import { MailAddress, OutgoingMail } from './mail.types';

/**
 * The body of ZeptoMail's send-email call (`POST /v1.1/email`), built from one of our emails.
 *
 * Kept as a pure function so the only untested thing left in production is the HTTP request itself. We send our own
 * rendered HTML and text rather than ZeptoMail-hosted templates: the words live in this repository, beside the code
 * that decides when they go, and are reviewed and tested with it.
 */
export interface ZeptoMailRequest {
  from: { address: string; name?: string };
  to: Array<{ email_address: { address: string; name?: string } }>;
  reply_to?: Array<{ address: string; name?: string }>;
  subject: string;
  htmlbody: string;
  textbody: string;
  client_reference: string;
  track_clicks: boolean;
  track_opens: boolean;
}

/** The address this server starts with. It is on a domain nobody owns: no provider will send for it. */
export const PLACEHOLDER_FROM = 'noreply@seebuyget.example';

/** The sender address. Must be verified on the ZeptoMail domain before production can send. */
export function mailFrom(): MailAddress {
  return {
    address: process.env.MAIL_FROM_ADDRESS?.trim() || PLACEHOLDER_FROM,
    name: process.env.MAIL_FROM_NAME?.trim() || 'SeeBuyGet',
  };
}

export function toZeptoMailRequest(mail: OutgoingMail, from: MailAddress = mailFrom(), replyTo?: MailAddress): ZeptoMailRequest {
  return {
    from: { address: from.address, ...(from.name ? { name: from.name } : {}) },
    to: [{ email_address: { address: mail.to.address, ...(mail.to.name ? { name: mail.to.name } : {}) } }],
    ...(replyTo ? { reply_to: [{ address: replyTo.address, ...(replyTo.name ? { name: replyTo.name } : {}) }] } : {}),
    subject: mail.subject,
    htmlbody: mail.html,
    textbody: mail.text,
    client_reference: mail.reference,
    track_clicks: mail.tracking,
    track_opens: mail.tracking,
  };
}
