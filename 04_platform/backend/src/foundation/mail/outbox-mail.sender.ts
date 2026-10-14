import { Injectable } from '@nestjs/common';
import { MailSender, OutgoingMail } from './mail.types';

/**
 * The sandbox `MailSender`: keeps what WOULD have been sent, newest last, instead of sending it. Replaced by a
 * ZeptoMail sender in production (see mail.types.ts) — nothing above this seam changes.
 */
@Injectable()
export class OutboxMailSender implements MailSender {
  private readonly outbox: Array<OutgoingMail & { at: string }> = [];

  async send(mail: OutgoingMail): Promise<void> {
    this.outbox.push({ ...mail, at: new Date().toISOString() });
    if (this.outbox.length > 200) this.outbox.shift();
  }

  /** Newest first, optionally for one address. */
  recent(address?: string): Array<OutgoingMail & { at: string }> {
    const wanted = address?.trim().toLowerCase();
    return this.outbox.filter((m) => !wanted || m.to.address.toLowerCase() === wanted).reverse();
  }
}
