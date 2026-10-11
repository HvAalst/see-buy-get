import { Inject, Injectable, Logger } from '@nestjs/common';
import { isSandbox } from '../runtime/sandbox';
import { OutboxSmsSender } from './outbox-sms.sender';
import { SMS_SENDER, SmsConnection, SmsLast, SmsSendError, SmsSender } from './sms.types';
import { twilioConfig } from './twilio';

type Env = Record<string, string | undefined>;

/**
 * THE COUNTRIES A CODE MAY BE TEXTED TO, where the deployment fenced them: `GLOS_SMS_COUNTRIES="+254, +255"`.
 *
 * A door that texts any number in the world is paid for by us. Asking for codes to numbers that earn their owner
 * money per text received is an old fraud, and "send me a code" is exactly the button it presses. The first fence is
 * the provider's own (Twilio's SMS Geo Permissions); this is ours, looked at before a code is made or counted.
 * Unset: any country, and the start-up log says so.
 */
export function smsCountries(env: Env = process.env): string[] {
  return (env.GLOS_SMS_COUNTRIES ?? '')
    .split(',')
    .map((s) => s.trim().replace(/[^\d+]/g, ''))
    .filter((s) => /^\+\d{1,4}$/.test(s));
}

/** `phone` is E.164. With no fence, anywhere. */
export function smsMayGoTo(phone: string, countries: string[] = smsCountries()): boolean {
  return countries.length === 0 || countries.some((dial) => phone.startsWith(dial));
}

/**
 * The one-time code as a text. One segment — under 160 characters, all of them in the plain SMS alphabet — with the
 * code first, so that it shows in the notification. Where the site's address is known it ends with the line a
 * phone's browser needs before it offers the code to OUR page and no other: `@host #code` (`readSmsOtp` in the apps).
 */
export function codeText(code: string, minutes: number, env: Env = process.env): string {
  let host = '';
  try {
    host = env.SBG_PUBLIC_URL ? new URL(env.SBG_PUBLIC_URL).host : '';
  } catch {
    host = '';
  }
  const line = `${code} is your SeeBuyGet code. It works for ${minutes} minutes. Nobody from SeeBuyGet will ask you for it.`;
  return host ? `${line}\n\n@${host} #${code}` : line;
}

/**
 * TEXT MESSAGES, AND WHAT THE SENDER THIS SERVER STARTED WITH DOES WITH THEM.
 *
 * `sendCode` resolves only when the provider took the text. The door that asked (`auth/phone/request`) tells the
 * person it could not be sent rather than leave them waiting for a text that is not coming. A count is kept for the
 * console's Connections screen, and a failure is logged by its kind — never the number, never the code.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  /** Since this server started: kept in memory, and a restart forgets it. */
  private written = 0;
  private failed = 0;
  private fenced = 0;
  private last?: SmsLast;

  constructor(@Inject(SMS_SENDER) private readonly sender: SmsSender) {
    if (isSandbox()) return;
    // Said at start-up, not found out by the first person who cannot sign up.
    if (!this.sends()) {
      const why = twilioConfig().problem;
      this.logger.warn(
        `No text leaves this server${why ? ` (Twilio: ${why})` : ''}, and off a sandbox a code has no other way to a phone: nobody can sign up, confirm a new phone or replace a PIN. ` +
          'Set TWILIO_ACCOUNT_SID, a credential (TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET, or TWILIO_AUTH_TOKEN) and a sender (TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM).',
      );
    } else if (!smsCountries().length) {
      this.logger.warn('GLOS_SMS_COUNTRIES is not set: a code is texted to a number in ANY country. Fence it here ("+254, +255") and in Twilio’s SMS Geo Permissions.');
    }
  }

  /** The outbox keeps; anything in its place sends. Read off the sender, never off a setting. */
  sends(): boolean {
    return !(this.sender instanceof OutboxSmsSender);
  }

  /** May a code be texted to this number at all? Counted when not, for the console. `phone` is E.164. */
  mayGoTo(phone: string): boolean {
    if (smsMayGoTo(phone)) return true;
    this.fenced += 1;
    return false;
  }

  /** The code, texted. Throws an `SmsSendError` when it was not taken. `phone` is E.164. */
  async sendCode(phone: string, code: string, minutes: number): Promise<void> {
    this.written += 1;
    try {
      await this.sender.send({ to: phone, body: codeText(code, minutes) });
      this.last = { at: new Date().toISOString(), ok: true };
    } catch (err) {
      // Whose it is to put right, where the sender said; a fault of nobody's naming otherwise — and none of its words.
      const why = err instanceof SmsSendError ? err : new SmsSendError('failed', 'the SMS provider answered with a fault');
      this.failed += 1;
      this.last = { at: new Date().toISOString(), ok: false, failed: why.kind, ...(why.code ? { code: why.code } : {}) };
      this.logger.error(`A code could not be texted: ${why.message}`);
      throw why;
    }
  }

  /** Where a text goes, for staff: the same reading of the environment that chose the sender when the server started. */
  connection(): SmsConnection {
    const given = twilioConfig();
    return {
      sends: this.sends(),
      accountSet: given.accountSet,
      ...(given.credential ? { credential: given.credential } : {}),
      ...(given.sender ? { sender: given.sender } : {}),
      ...(given.problem ? { problem: given.problem } : {}),
      standIn: given.standIn,
      countries: smsCountries(),
      written: this.written,
      failed: this.failed,
      fenced: this.fenced,
      ...(this.last ? { last: { ...this.last } } : {}),
    };
  }
}
