import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { MAIL_SENDER, MailAddress, MailSender, OutgoingMail } from './mail.types';
import { MailParams, MailTemplateId, renderMail } from './mail.templates';

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

  constructor(@Inject(MAIL_SENDER) private readonly sender: MailSender) {}

  async send<K extends MailTemplateId>(template: K, to: MailAddress, params: MailParams[K]): Promise<boolean> {
    if (!to?.address || !to.address.includes('@')) return false;
    try {
      const mail: OutgoingMail = {
        ...renderMail(template, params),
        template,
        to,
        reference: `${template}:${randomBytes(6).toString('hex')}`,
        tracking: false,
      };
      await this.sender.send(mail);
      return true;
    } catch (err) {
      this.logger.error(`Could not send "${template}" to ${maskAddress(to.address)}: ${(err as Error).message}`);
      return false;
    }
  }
}

/** "a…@example.com" — enough to find the case in a log, not enough to harvest. */
export function maskAddress(address: string): string {
  const at = address.indexOf('@');
  return at > 0 ? `${address[0]}…${address.slice(at)}` : '…';
}
