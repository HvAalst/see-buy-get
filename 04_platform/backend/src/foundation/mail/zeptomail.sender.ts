import { MailFailure, MailSendError, MailSender, OutgoingMail } from './mail.types';
import { ZeptoMailConfig, readZeptoMailAnswer, toZeptoMailRequest } from './zeptomail';

/** How long the provider is waited for. An email is the consequence of an action; nothing should hang on it for long. */
export const ZEPTOMAIL_TIMEOUT_MS = 10_000;
/** How long before the one second try. */
export const ZEPTOMAIL_RETRY_AFTER_MS = 2_000;

const WORDS: Record<MailFailure, string> = {
  unreachable: 'the mail provider could not be reached',
  refused: 'the mail provider refused it for this account',
  limit: 'the mail provider’s sending limit or credit is used up',
  rejected: 'the mail provider turned this email down',
  failed: 'the mail provider answered with a fault',
};

/**
 * THE PRODUCTION `MailSender`: one email, POSTed to the provider.
 *
 * It says an email was sent only when the provider said it took it (`readZeptoMailAnswer`), and otherwise throws a
 * `MailSendError` that says whose it is to put right — which `MailService` logs, counts and shows staff. Nothing it
 * throws or logs carries the token or the address the email was for.
 *
 * ONE SECOND TRY, and only where nothing says the first was taken: the connection failed, or a gateway said the
 * service is not there. Not after a timeout or a plain fault — the email may have gone, and a reset code sent twice
 * is two emails where one was asked for. Not after a refusal: asking again changes nothing.
 *
 * WHETHER IT MAY BE TRIED AGAIN LATER is said on the error (`later`), and is a different question: a refusal of the
 * account or a used-up limit is worth trying again in an hour — somebody may have put it right — where asking again
 * in two seconds is not. `MailService` keeps those, for the emails that are still worth having late.
 *
 * A redirect is not followed. The token is for one address, and a provider's sending address does not redirect.
 */
export class ZeptoMailSender implements MailSender {
  constructor(
    private readonly config: ZeptoMailConfig,
    private readonly timing: { timeoutMs: number; retryAfterMs: number } = { timeoutMs: ZEPTOMAIL_TIMEOUT_MS, retryAfterMs: ZEPTOMAIL_RETRY_AFTER_MS },
  ) {}

  /** There is a token and an address it may be sent to. Without both, this is not the sender to wire in. */
  ready(): boolean {
    return Boolean(this.config.endpoint && this.config.authorization);
  }

  async send(mail: OutgoingMail): Promise<void> {
    if (!this.ready()) throw new MailSendError('refused', 'the mail provider is not set up');
    const body = JSON.stringify(toZeptoMailRequest(mail));
    const first = await this.post(body);
    if (first.ok) return;
    if (!first.again) throw this.error(first);
    await new Promise((r) => setTimeout(r, this.timing.retryAfterMs));
    const second = await this.post(body);
    if (!second.ok) throw this.error(second);
  }

  private error(a: { kind: MailFailure; code?: string; again: boolean }): MailSendError {
    // Not taken, and not this email's fault: the line or a gateway (`again`), or the account as it stands.
    const later = a.again || a.kind === 'refused' || a.kind === 'limit';
    return new MailSendError(a.kind, a.code ? `${WORDS[a.kind]} (${a.code})` : WORDS[a.kind], a.code, later);
  }

  private async post(body: string): Promise<{ ok: true } | { ok: false; kind: MailFailure; code?: string; again: boolean }> {
    let res: Response;
    try {
      res = await fetch(this.config.endpoint!, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json', authorization: this.config.authorization! },
        body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.timing.timeoutMs),
      });
    } catch (err) {
      // It did not answer in time: it may have taken the email all the same, so it is not asked twice.
      const timedOut = (err as Error)?.name === 'TimeoutError' || (err as Error)?.name === 'AbortError';
      return { ok: false, kind: 'unreachable', again: !timedOut };
    }
    // A redirect comes back as itself (it was not followed), and is read like any answer that is not a success.
    return readZeptoMailAnswer(res.status, await res.text().catch(() => ''));
  }
}
