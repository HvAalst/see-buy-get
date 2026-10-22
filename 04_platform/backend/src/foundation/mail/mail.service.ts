import { Inject, Injectable, Logger, OnModuleDestroy, Optional } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { MailBounces } from './mail-bounces.service';
import { MAIL_SENDER, MailAddress, MailConnection, MailLast, MailSendError, MailSender, OutgoingMail } from './mail.types';
import { MAIL_TEMPLATES, MailParams, MailTemplateId, renderMail } from './mail.templates';
import { OutboxMailSender } from './outbox-mail.sender';
import { mailFrom, zeptoMailConfig } from './zeptomail';

/** How long after a failed try the next one comes, in minutes. The last step repeats until the email is no longer worth sending. */
export const MAIL_AGAIN_AFTER_MIN = [1, 5, 15, 60] as const;
/** How many emails may wait at once. Past it a new one is not kept, and is counted as given up on. */
export const MAIL_MAX_WAITING = 500;
/** How often the waiting ones are looked at. */
const LOOK_EVERY_MS = 30_000;

/** An email waiting to be tried again. In memory only: it holds an address, and may hold a link's key. */
interface WaitingMail {
  template: MailTemplateId;
  to: MailAddress;
  params: unknown;
  /** The same on every try, so the provider (and a bounce) can tell it is one email. */
  reference: string;
  firstAt: number;
  tries: number;
  nextAt: number;
  /** Past this it is no longer worth sending (the template's `sendLater`). */
  until: number;
}

/**
 * Send one of the network's emails.
 *
 * NEVER THROWS. An email is the consequence of an action, not a condition of it: a password that was changed is
 * changed whether or not the notice went out, and a mail provider having a bad minute must not turn a reset request
 * into an error page. A failure is logged — without the full address — and reported as `false`.
 *
 * SENT AGAIN LATER, where that is right. An email that could not be handed over is kept and tried again when three
 * things hold: nothing says the provider took it (`MailSendError.later`), the email is one still worth having late
 * (its template's `sendLater` — a notice is, a code is not), and it has not waited past that. Many notices are sent
 * ONCE by the event that causes them — a delivery, a paper lapsing — so without this a provider's bad hour was a
 * notice nobody ever got.
 *
 * WHAT WAITS, WAITS IN MEMORY. A waiting email holds an address — which this system keeps in a vault and nowhere
 * beside the person — and may hold a link's key, which it keeps nowhere at all. Neither is written to disk to wait.
 * So a restart forgets what was waiting, and the console's Connections screen says how many that would be.
 */
@Injectable()
export class MailService implements OnModuleDestroy {
  private readonly logger = new Logger(MailService.name);

  /** Since this server started: kept in memory, and a restart forgets it. */
  private written = 0;
  private failed = 0;
  private reserved = 0;
  private bounced = 0;
  private sentLater = 0;
  private gaveUp = 0;
  private last?: MailLast;

  private waiting: WaitingMail[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private looking = false;

  constructor(
    @Inject(MAIL_SENDER) private readonly sender: MailSender,
    // Optional so everything that builds this by hand keeps compiling: without it no address is ever held back.
    @Optional() private readonly bounces?: MailBounces,
  ) {}

  onModuleDestroy(): void {
    this.stopLooking();
  }

  async send<K extends MailTemplateId>(template: K, to: MailAddress, params: MailParams[K], now: number = Date.now()): Promise<boolean> {
    if (!to?.address || !to.address.includes('@')) return false;
    // SENDING FOR REAL, an address that cannot exist is not handed over. It could only bounce, and bounces are what a
    // provider judges an account by — a sandbox given a real token would otherwise mail every made-up person its
    // seeds are full of, on the reminders' own timetable. The outbox keeps them, as it keeps everything.
    if (this.sends() && isReservedAddress(to.address)) {
      this.reserved += 1;
      return false;
    }
    // An address email CAME BACK from is not written to again: it would bounce again, and bounces are what a
    // provider judges an account by. A code goes all the same — somebody is at a screen asking for it, and reading
    // it is the only way that address proves it works (`addressWorks`).
    if (this.sends() && !MAIL_TEMPLATES[template]?.asked && this.bounces?.stopped(to.address, now)) {
      this.bounced += 1;
      return false;
    }
    this.written += 1;
    const reference = `${template}:${randomBytes(6).toString('hex')}`;
    const failure = await this.handOver(template, to, params, reference, now);
    if (!failure) return true;
    this.failed += 1;
    if (this.keepToTryAgain({ template, to, params, reference }, failure, now) && this.last) this.last.again = true;
    return false;
  }

  /**
   * TRY THE ONES WHOSE TIME HAS COME. Called on a timer while anything waits; public so that it can be asked for a
   * given moment.
   *
   * One that is past being worth sending is given up on without being tried. One that is turned down, or that may
   * have gone, is given up on: it is not asked a third way. And once the provider has said no to the account, or was
   * not there, THE REST OF THIS LOOK IS NOT TRIED — they would hear the same, and five hundred emails must not turn
   * a provider's bad minute into a flood. They stay due; the next look tries one more. When one goes through, the
   * rest of that look follows it.
   */
  async tryWaiting(now: number = Date.now()): Promise<void> {
    if (this.looking) return;
    this.looking = true;
    try {
      let notThere = false;
      for (const w of this.waiting.filter((x) => x.nextAt <= now)) {
        if (now >= w.until) {
          this.giveUp(w, 'it waited too long to be worth sending');
          continue;
        }
        // It came back from this address while this one waited: it is not sent to bounce too.
        if (this.bounces?.stopped(w.to.address, now)) {
          this.giveUp(w, 'email to its address came back in the meantime');
          continue;
        }
        if (notThere) continue;
        const failure = await this.handOver(w.template, w.to, w.params, w.reference, now);
        if (!failure) {
          this.forget(w);
          this.sentLater += 1;
          continue;
        }
        if (!(failure instanceof MailSendError) || !failure.later) {
          this.giveUp(w, 'it was turned down, or may already have gone');
          continue;
        }
        w.tries += 1;
        w.nextAt = now + againAfterMs(w.tries);
        if (this.last) this.last.again = true;
        notThere = true;
      }
    } finally {
      this.looking = false;
      if (this.waiting.length === 0) this.stopLooking();
    }
  }

  /** Somebody read a code we sent to this address and typed it in: the address works, whatever came back before. */
  addressWorks(address: string): void {
    this.bounces?.works(address);
  }

  /**
   * Where an email goes, for staff. `sends` is READ OFF THE SENDER: the outbox keeps, and anything put in its place
   * sends. Nobody states it, so it cannot be stated wrongly — a token set in the environment is not a sender. Where
   * a token is set and the provider is still not used, `problem` says why (`zeptoMailConfig`): the same reading of
   * the environment that chose the sender when the server started.
   */
  connection(now: number = Date.now()): MailConnection {
    const from = mailFrom().address;
    const given = zeptoMailConfig();
    const oldest = this.waiting.length ? Math.min(...this.waiting.map((w) => w.firstAt)) : undefined;
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
      bounced: this.bounced,
      bounces: this.bounces?.connection(now) ?? { listening: false, stopped: 0, received: 0, refused: 0, unsigned: 0 },
      waiting: this.waiting.length,
      ...(oldest !== undefined ? { waitingSince: new Date(oldest).toISOString() } : {}),
      sentLater: this.sentLater,
      gaveUp: this.gaveUp,
      ...(this.last ? { last: { ...this.last } } : {}),
    };
  }

  /** Render it and give it to the sender. Nothing on success; what went wrong otherwise — said, logged, never thrown. */
  private async handOver(template: MailTemplateId, to: MailAddress, params: unknown, reference: string, now: number): Promise<Error | undefined> {
    try {
      const mail: OutgoingMail = { ...renderMail(template, params as never), template, to, reference, tracking: false };
      await this.sender.send(mail);
      this.last = { at: new Date(now).toISOString(), ok: true, what: MAIL_TEMPLATES[template].title };
      return undefined;
    } catch (err) {
      // Whose it is to put right, where the sender said; a fault of nobody's naming otherwise.
      const why = err instanceof MailSendError ? err : undefined;
      this.last = { at: new Date(now).toISOString(), ok: false, what: MAIL_TEMPLATES[template]?.title ?? template, failed: why?.kind ?? 'failed', ...(why?.code ? { code: why.code } : {}) };
      this.logger.error(`Could not send "${template}" to ${maskAddress(to.address)}: ${(err as Error).message}`);
      return err instanceof Error ? err : new Error(String(err));
    }
  }

  /** Keep it to be tried again, where that is right. Whether it was kept. */
  private keepToTryAgain(mail: Pick<WaitingMail, 'template' | 'to' | 'params' | 'reference'>, failure: Error, now: number): boolean {
    const hours = MAIL_TEMPLATES[mail.template]?.sendLater;
    // A code is never sent late. And where the provider may have taken it, or turned this one email down, asking
    // again later is a second email or the same refusal.
    if (!hours || !(failure instanceof MailSendError) || !failure.later) return false;
    if (this.waiting.length >= MAIL_MAX_WAITING) {
      this.gaveUp += 1;
      this.logger.error(`"${mail.template}" is not kept to be tried again: ${MAIL_MAX_WAITING} emails are already waiting`);
      return false;
    }
    this.waiting.push({ ...mail, firstAt: now, tries: 1, nextAt: now + againAfterMs(1), until: now + hours * 3_600_000 });
    if (!this.timer) {
      this.timer = setInterval(() => void this.tryWaiting(), LOOK_EVERY_MS);
      // Mail waiting to be tried again is not a reason to keep a stopping server alive.
      this.timer.unref?.();
    }
    return true;
  }

  private giveUp(w: WaitingMail, why: string): void {
    this.forget(w);
    this.gaveUp += 1;
    this.logger.error(`Gave up on "${w.template}" to ${maskAddress(w.to.address)} after ${w.tries} ${w.tries === 1 ? "try" : "tries"}: ${why}`);
  }

  private forget(w: WaitingMail): void {
    this.waiting = this.waiting.filter((x) => x !== w);
  }

  private stopLooking(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  /** The outbox keeps; anything in its place sends. Read off the sender, never off a setting. */
  /** Round 40 — whether email leaves the building here, or waits in the outbox (no provider is wired). Said on screens that send it. */
  delivers(): boolean {
    return this.sends();
  }

  private sends(): boolean {
    return !(this.sender instanceof OutboxMailSender);
  }
}

/** How long after the n-th failed try the next one comes. */
function againAfterMs(tries: number): number {
  return MAIL_AGAIN_AFTER_MIN[Math.min(tries, MAIL_AGAIN_AFTER_MIN.length) - 1] * 60_000;
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
