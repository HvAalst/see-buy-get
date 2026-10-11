import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { COUNTRY_CATALOGUE, catalogueEntry } from '../countries/catalogue';
import { PresenceService } from '../presence/presence.service';
import { isSandbox } from '../runtime/sandbox';
import { OutboxSmsSender } from './outbox-sms.sender';
import { SMS_SENDER, SmsConnection, SmsLast, SmsSendError, SmsSender } from './sms.types';
import { twilioConfig } from './twilio';

type Env = Record<string, string | undefined>;

/** Every dial code there is, the longest first: `+1242` is asked before `+1`. */
const DIAL_CODES = [...new Set(COUNTRY_CATALOGUE.map((c) => c.dialCode))].sort((a, b) => b.length - a.length);

/**
 * IS THIS NUMBER IN ONE OF THESE COUNTRIES — judged by the LONGEST dial code in the catalogue it starts with, so a
 * number in the Bahamas (+1242) is not let through because the United States (+1) is on. Countries that share one
 * dial code and nothing longer (the US and Canada, Russia and Kazakhstan) cannot be told apart by it: one of them
 * being on lets the other's numbers through. `phone` is E.164; `on` is dial codes.
 */
export function smsMayGoTo(phone: string, on: string[], all: string[] = DIAL_CODES): boolean {
  const dial = all.find((d) => phone.startsWith(d));
  return Boolean(dial) && on.includes(dial as string);
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
 *
 * WHICH COUNTRIES A CODE IS TEXTED TO IS NOT A SETTING OF ITS OWN (the user, 2026-10-11: "switching on a country
 * would also mean to switch on the sms geo permission"). It is the countries that are switched on — every one whose
 * standing is above "observed" — read from the same register every other screen asks, at the moment a code is
 * asked for. Switching a country on is what lets its numbers be texted; lowering it to observed stops them. There
 * is no list to keep beside it and forget.
 *
 * It matters because a door that texts any number in the world is paid for by us: codes asked for to numbers that
 * earn their owner money per text received is an old fraud, and "send me a code" is the button it presses.
 *
 * THE PROVIDER KEEPS A LIST OF ITS OWN, and that one cannot follow ours: Twilio's SMS Geo Permissions are changed
 * in its console and "can not be changed programmatically via the API for security reasons" (its documentation,
 * read 2026-10-11). So a country switched on here and not there is refused by Twilio with 21408, which the
 * Connections screen says in those words; and the console says so at the moment a country is switched on.
 */
@Injectable()
export class SmsService {
  private readonly logger = new Logger(SmsService.name);
  /** Since this server started: kept in memory, and a restart forgets it. */
  private written = 0;
  private failed = 0;
  private fenced = 0;
  private last?: SmsLast;

  constructor(
    @Inject(SMS_SENDER) private readonly sender: SmsSender,
    // Optional so that what builds this by hand keeps compiling: with no register of countries to ask, nothing is fenced.
    @Optional() private readonly presence?: PresenceService,
  ) {
    if (isSandbox() || this.sends()) return;
    // Said at start-up, not found out by the first person who cannot sign up.
    const why = twilioConfig().problem;
    this.logger.warn(
      `No text leaves this server${why ? ` (Twilio: ${why})` : ''}, and off a sandbox a code has no other way to a phone: nobody can sign up, confirm a new phone or replace a PIN. ` +
        'Set TWILIO_ACCOUNT_SID, a credential (TWILIO_API_KEY_SID + TWILIO_API_KEY_SECRET, or TWILIO_AUTH_TOKEN) and a sender (TWILIO_MESSAGING_SERVICE_SID or TWILIO_FROM).',
    );
  }

  /** The outbox keeps; anything in its place sends. Read off the sender, never off a setting. */
  sends(): boolean {
    return !(this.sender instanceof OutboxSmsSender);
  }

  /** The countries that are switched on, as the catalogue has them. Read each time: a country may have changed a minute ago. */
  private switchedOn(): Array<{ code: string; dialCode: string }> {
    return (this.presence?.list() ?? [])
      .filter((p) => p.level !== 'observed')
      .map((p) => catalogueEntry(p.jurisdiction))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
      .map((c) => ({ code: c.code, dialCode: c.dialCode }));
  }

  /** May a code be texted to this number: is its country switched on? Counted when not, for the console. `phone` is E.164. */
  mayGoTo(phone: string): boolean {
    if (!this.presence) return true;
    const on = this.switchedOn().map((c) => c.dialCode);
    if (smsMayGoTo(phone, on)) return true;
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
      countries: this.switchedOn()
        .map((c) => `${c.code} ${c.dialCode}`)
        .sort(),
      written: this.written,
      failed: this.failed,
      fenced: this.fenced,
      ...(this.last ? { last: { ...this.last } } : {}),
    };
  }
}
