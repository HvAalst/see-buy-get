import { OutgoingSms, SmsFailure, SmsSendError, SmsSender } from './sms.types';
import { TwilioConfig, readTwilioAnswer, toTwilioForm } from './twilio';

/** How long Twilio is waited for. Somebody is looking at a screen that says "we are sending you a code". */
export const TWILIO_TIMEOUT_MS = 10_000;

const WORDS: Record<SmsFailure, string> = {
  unreachable: 'the SMS provider could not be reached',
  refused: 'the SMS provider refused it for this account',
  limit: 'the SMS provider asked us to slow down',
  rejected: 'the SMS provider cannot text this number',
  failed: 'the SMS provider answered with a fault',
  // Never the provider's: this server's own cap (SmsService), said here only so every kind has its words.
  paused: 'this server reached its own cap on texts',
};

/**
 * THE PRODUCTION `SmsSender`: one text, POSTed to Twilio.
 *
 * It says a text was sent only when Twilio said it took it (`readTwilioAnswer`), and otherwise throws an
 * `SmsSendError` that says whose it is to put right. Nothing it throws carries a credential, the number or the text.
 *
 * NO SECOND TRY. A text that got no answer in time may have gone, and a code texted twice is two codes where the
 * person asked for one — of which only the second works. The person on the screen is told it could not be sent, and
 * asks again.
 *
 * A redirect is not followed: the credential is for one address.
 */
export class TwilioSmsSender implements SmsSender {
  constructor(
    private readonly config: TwilioConfig,
    private readonly timeoutMs: number = TWILIO_TIMEOUT_MS,
  ) {}

  /** There is an account, a credential, a sender and an address it may go to. Without all of them this is not wired in. */
  ready(): boolean {
    return Boolean(this.config.endpoint && this.config.authorization && this.config.from);
  }

  async send(sms: OutgoingSms): Promise<void> {
    const { endpoint, authorization } = this.config;
    if (!endpoint || !authorization || !this.config.from) throw new SmsSendError('refused', 'the SMS provider is not set up');
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    let status: number;
    let body: string;
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization, 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body: toTwilioForm(this.config, sms),
        redirect: 'manual',
        signal: abort.signal,
      });
      status = res.status;
      body = await res.text();
    } catch {
      // No answer, or none in time. What went wrong is not passed on: an error from the socket can name the address.
      throw new SmsSendError('unreachable', WORDS.unreachable);
    } finally {
      clearTimeout(timer);
    }
    const answer = readTwilioAnswer(status, body);
    if (!answer.ok) throw new SmsSendError(answer.kind, answer.code ? `${WORDS[answer.kind]} (${answer.code})` : WORDS[answer.kind], answer.code);
  }
}
