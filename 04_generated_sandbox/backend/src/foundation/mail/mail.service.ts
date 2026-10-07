import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { MAIL_SENDER, MailAddress, MailConnection, MailLast, MailSender, OutgoingMail } from './mail.types';
import { MAIL_TEMPLATES, MailParams, MailTemplateId, renderMail } from './mail.templates';
import { OutboxMailSender } from './outbox-mail.sender';
import { PLACEHOLDER_FROM, mailFrom } from './zeptomail';

/**
 * Send one of the network's emails.
 *
 * NEVER THROWS. An email is the consequence of an action, not a condition of it: a password that was changed is
 * changed whether or not the notice went out, and a mail provider having a bad minute must not turn a reset request
 * into an error page. A failure is logged — without the full address — and reported as `false`.
 */
@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);

  /** Since this server started: kept in memory, and a restart forgets it. */
  private written = 0;
  private failed = 0;
  private last?: MailLast;

  constructor(@Inject(MAIL_SENDER) private readonly sender: MailSender) {}

  async send<K extends MailTemplateId>(template: K, to: MailAddress, params: MailParams[K]): Promise<boolean> {
    if (!to?.address || !to.address.includes('@')) return false;
    this.written += 1;
    try {
      const mail: OutgoingMail = {
        ...renderMail(template, params),
        template,
        to,
        reference: `${template}:${randomBytes(6).toString('hex')}`,
        tracking: false,
      };
      await this.sender.send(mail);
      this.last = { at: new Date().toISOString(), ok: true, what: MAIL_TEMPLATES[template].title };
      return true;
    } catch (err) {
      this.failed += 1;
      this.last = { at: new Date().toISOString(), ok: false, what: MAIL_TEMPLATES[template]?.title ?? template };
      this.logger.error(`Could not send "${template}" to ${maskAddress(to.address)}: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Where an email goes, for staff. `sends` is READ OFF THE SENDER: the outbox keeps, and anything put in its place
   * sends. Nobody states it, so it cannot be stated wrongly — a token set in the environment is not a sender, and
   * until one is wired in (mail.types.ts) this says that emails are written and reach nobody.
   */
  connection(): MailConnection {
    const from = mailFrom().address;
    return {
      sends: !(this.sender instanceof OutboxMailSender),
      tokenSet: Boolean(process.env.ZEPTOMAIL_TOKEN?.trim()),
      from,
      fromIsPlaceholder: from === PLACEHOLDER_FROM,
      written: this.written,
      failed: this.failed,
      ...(this.last ? { last: { ...this.last } } : {}),
    };
  }
}

/** "a…@example.com" — enough to find the case in a log, not enough to harvest. */
export function maskAddress(address: string): string {
  const at = address.indexOf('@');
  return at > 0 ? `${address[0]}…${address.slice(at)}` : '…';
}
