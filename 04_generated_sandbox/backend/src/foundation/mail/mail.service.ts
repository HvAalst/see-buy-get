import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { MAIL_SENDER, MailAddress, MailConnection, MailLast, MailSendError, MailSender, OutgoingMail } from './mail.types';
import { MAIL_TEMPLATES, MailParams, MailTemplateId, renderMail } from './mail.templates';
import { OutboxMailSender } from './outbox-mail.sender';
import { mailFrom, zeptoMailConfig } from './zeptomail';

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
  private reserved = 0;
  private last?: MailLast;

  constructor(@Inject(MAIL_SENDER) private readonly sender: MailSender) {}

  async send<K extends MailTemplateId>(template: K, to: MailAddress, params: MailParams[K]): Promise<boolean> {
    if (!to?.address || !to.address.includes('@')) return false;
    // SENDING FOR REAL, an address that cannot exist is not handed over. It could only bounce, and bounces are what a
    // provider judges an account by — a sandbox given a real token would otherwise mail every made-up person its
    // seeds are full of, on the reminders' own timetable. The outbox keeps them, as it keeps everything.
    if (this.sends() && isReservedAddress(to.address)) {
      this.reserved += 1;
      return false;
    }
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
      // Whose it is to put right, where the sender said; a fault of nobody's naming otherwise.
      const why = err instanceof MailSendError ? err : undefined;
      this.last = { at: new Date().toISOString(), ok: false, what: MAIL_TEMPLATES[template]?.title ?? template, failed: why?.kind ?? 'failed', ...(why?.code ? { code: why.code } : {}) };
      this.logger.error(`Could not send "${template}" to ${maskAddress(to.address)}: ${(err as Error).message}`);
      return false;
    }
  }

  /**
   * Where an email goes, for staff. `sends` is READ OFF THE SENDER: the outbox keeps, and anything put in its place
   * sends. Nobody states it, so it cannot be stated wrongly — a token set in the environment is not a sender. Where
   * a token is set and the provider is still not used, `problem` says why (`zeptoMailConfig`): the same reading of
   * the environment that chose the sender when the server started.
   */
  connection(): MailConnection {
    const from = mailFrom().address;
    const given = zeptoMailConfig();
    return {
      sends: this.sends(),
      tokenSet: given.tokenSet,
      ...(given.host ? { host: given.host } : {}),
      ...(given.problem ? { problem: given.problem } : {}),
      from,
      // The address the server starts with is one; so is any other on a domain nobody can own.
      fromIsPlaceholder: isReservedAddress(from),
      written: this.written,
      failed: this.failed,
      reserved: this.reserved,
      ...(this.last ? { last: { ...this.last } } : {}),
    };
  }

  /** The outbox keeps; anything in its place sends. Read off the sender, never off a setting. */
  private sends(): boolean {
    return !(this.sender instanceof OutboxMailSender);
  }
}

/**
 * An address nobody can have: on a domain set aside for examples and tests (RFC 2606, RFC 6761) — `example.com`,
 * `.example`, `.test`, `.invalid`, `.localhost`. Nothing else is guessed at: a domain that merely looks made up may
 * be somebody's.
 */
export function isReservedAddress(address: string): boolean {
  const domain = address.slice(address.lastIndexOf('@') + 1).trim().toLowerCase().replace(/\.$/, '');
  if (!domain) return false;
  const labels = domain.split('.');
  if (['example', 'test', 'invalid', 'localhost'].includes(labels[labels.length - 1])) return true;
  return ['example.com', 'example.net', 'example.org'].includes(labels.slice(-2).join('.'));
}

/** "a…@example.com" — enough to find the case in a log, not enough to harvest. */
export function maskAddress(address: string): string {
  const at = address.indexOf('@');
  return at > 0 ? `${address[0]}…${address.slice(at)}` : '…';
}
