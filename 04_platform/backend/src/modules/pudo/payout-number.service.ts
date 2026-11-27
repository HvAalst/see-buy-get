import type { CodeWay } from '../../foundation/sms/code-routes.types';
import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { standInCode } from '../../foundation/runtime/standin-code';
import { randomBytes, randomInt, timingSafeEqual } from 'crypto';
import { actingTenant, auditActor } from '../../foundation/auth/acting';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { maskMsisdn, normaliseMsisdn } from '../../foundation/funding/mpesa-funding-rail.adapter';
import { GlosError } from '../../foundation/http/glos-error';
import { PayoutService } from '../../foundation/payouts/payout.service';
import { payoutWayOf, type PayoutDestination, type PayoutDestinationRefusal, type PayoutWay } from '../../foundation/payouts/payout-ways';
import { isSandbox } from '../../foundation/runtime/sandbox';
import { SmsService, notSentWords } from '../../foundation/sms/sms.service';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { MdpService } from './mdp.service';
import { PAYOUT_NUMBER_HOLD_MS, PayoutBankRecord, PayoutCodeSent, PayoutNumberRecord, PayoutNumberSaved, PayoutNumberView } from './payout-number.types';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { ibanProblem, isBic, maskIban, normaliseIban } from '../../foundation/payouts/iban';
import { payeeKindIn, type PayeeAccount } from '../../foundation/payment-hub/hub.types';
import { NETWORK_JURISDICTION } from './pudo.config';
import { normalizePhone } from '../../foundation/identity/phone';
import { AgentService } from './agent.service';
import { PartnerLedgerService } from './partner-ledger.service';
import type { NumberWay } from './payout-number.types';
import { MailService } from '../../foundation/mail/mail.service';
import { PersonService } from './person.service';
import { AccountService } from './account.service';
import { NotificationService } from './notification.service';
import { at, noticeOf, said } from './notice-words/say';
import { ReaderLanguageService, safetyMailOf } from './reader-language.service';

const CODE_TTL_MS = 10 * 60 * 1000;
const MAX_ATTEMPTS = 5;
const RESEND_COOLDOWN_MS = 60 * 1000;
const MAX_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Said to staff, who pass every role check: a payee's payout number is its own. */
export const STAFF_SET_NO_PAYOUT_NUMBER = 'A payee sets its own payout number, signed in as itself. Staff see it masked on each payout, and change none.';

interface Payee {
  payeeId: string;
  country: string;
}

/**
 * THE PAYOUT NUMBER (payout-number.types.ts): set by the payee, confirmed by a code texted to it, paused for a day after
 * a change with the old number told — and asked by the payout run, through the seam it registers at boot, for where
 * each payee is paid.
 */
@Injectable()
export class PayoutNumberService implements OnModuleInit {
  private readonly logger = new Logger(PayoutNumberService.name);
  private readonly numbers = new PersistentMap<string, PayoutNumberRecord>('payout-numbers');
  /** Route plan part 4 — each payee's own bank account, where its partner pays to bank accounts: sealed. */
  private readonly banks = new PersistentMap<string, PayoutBankRecord>('payout-banks');
  // A code lives ten minutes: kept in memory, like every other code here. A restart only means asking again.
  private readonly pending = new Map<string, { msisdn: string; code: string; expires: number; attempts: number }>();
  private readonly rates = new Map<string, { lastAt: number; windowStart: number; count: number }>();

  constructor(
    private readonly payouts: PayoutService,
    private readonly drivers: DriverService,
    private readonly managers: FleetManagerService,
    private readonly mdps: MdpService,
    @Optional() private readonly sms?: SmsService,
    // 2026-11-20 — a shop is a payee where a partner pays it (4c); and where a partner contracts, it pays every hand by phone.
    @Optional() private readonly agents?: AgentService,
    @Optional() private readonly partners?: PartnerLedgerService,
    @Optional() private readonly crypt?: FieldEncryption,
    // 2026-11-26 — the sign-in asked again before a bank account is kept, and a change told (the PIN, or a shop's or hub's password).
    @Optional() private readonly persons?: PersonService,
    @Optional() private readonly accounts?: AccountService,
    @Optional() private readonly notices?: NotificationService,
    @Optional() private readonly mail?: MailService,
    // 2026-11-27 — the email beside the notice in the language the person reads their app in.
    @Optional() private readonly readers?: ReaderLanguageService,
  ) {}

  /** Where a partner pays a hand in this country: its bank account in the European Union, its phone elsewhere — by the country alone. */
  paysTo(country: string): 'phone' | 'bank' | undefined {
    if (this.wayOf(country) !== 'partner') return undefined;
    return payeeKindIn(country);
  }

  /** How a payee in this country is paid: M-Pesa where we pay by it, by the partner where one contracts, by hand elsewhere. */
  wayOf(country: string): NumberWay {
    if (payoutWayOf(country) === 'mpesa') return 'mpesa';
    return this.partners?.partnerAt(country) ? 'partner' : 'by_hand';
  }

  /** A mobile number of this country, as digits with its country code — or nothing for a number that is not one. */
  private numberIn(country: string, phone: string): string | undefined {
    const dial = catalogueEntry(country)?.dialCode;
    if (!dial) return undefined;
    const e164 = normalizePhone(phone, dial);
    const digits = e164.replace(/\D/g, '');
    return e164.startsWith(dial) && digits.length >= 9 && digits.length <= 15 ? digits : undefined;
  }

  onModuleInit(): void {
    this.payouts.registerDestinations({
      of: (payeeId, way, now) => this.destinationOf(payeeId, way, now),
      full: (payeeId, numberId) => this.fullNumber(payeeId, numberId),
    });
  }

  /** What this payee's Settings shows: how its country pays, and the number, masked — or why it has none of its own. */
  /** ITS OWNER CLOSED THEIR ACCOUNT (2026-10-22): the number payouts went to was theirs, and goes, with its history. */
  forget(payeeId: string): void {
    this.numbers.delete(payeeId);
    this.banks.delete(payeeId);
  }

  view(actor: IntrospectionResult | undefined, now: number = Date.now()): PayoutNumberView {
    const who = this.payeeOf(actor);
    if ('notPayee' in who) return { way: this.wayOf(who.country), country: who.country, notPayee: who.notPayee };
    return this.viewOf(who, now);
  }

  /**
   * Text a code to the number the payee wants to be paid to. Refused, before anything is sent, where the country pays by
   * hand, for a number M-Pesa cannot pay, and for the number it already is.
   */
  /** `via` (2026-11-16): the way the payee chose — by text, or an app offered for that number (the owner: "the same choice"). */
  async requestCode(actor: IntrospectionResult | undefined, phone: string, now: number = Date.now(), via?: CodeWay): Promise<PayoutCodeSent> {
    const payee = this.requirePayee(actor);
    const way = this.wayOf(payee.country);
    if (way === 'by_hand') {
      throw new GlosError('INVALID_STATE', `In ${catalogueEntry(payee.country)?.name ?? payee.country} payouts are made by hand: there is no payout number to set.`);
    }
    if (this.paysTo(payee.country) === 'bank') throw new GlosError('INVALID_STATE', `In ${catalogueEntry(payee.country)?.name ?? payee.country} you are paid to your bank account: set that instead of a number.`);
    const msisdn = way === 'mpesa' ? normaliseMsisdn(phone) : this.numberIn(payee.country, phone);
    if (!msisdn && way === 'mpesa') throw new GlosError('PHONE_INVALID', 'Not a Kenyan mobile number M-Pesa can pay. Write it as 07XX XXX XXX or 01XX XXX XXX.', { field: 'phone' });
    if (!msisdn) throw new GlosError('PHONE_INVALID', `Not a mobile number in ${catalogueEntry(payee.country)?.name ?? payee.country}: write it with its country code, ${catalogueEntry(payee.country)?.dialCode ?? '+'}…`, { field: 'phone' });
    if (this.numbers.get(payee.payeeId)?.msisdn === msisdn) throw new GlosError('INVALID_STATE', 'That is already your payout number.');
    const to = `+${msisdn}`;
    const texts = this.sms?.sends() ?? false;
    const standIn = standInCode(to, texts);
    if (!standIn && !texts && !isSandbox()) throw new GlosError('SMS_NOT_SENT', 'Codes cannot be texted from this server yet, so a payout number cannot be confirmed.');
    if (!standIn && texts && !this.sms?.mayGoTo(to)) throw new GlosError('PHONE_NOT_SERVED', 'Codes are not texted to numbers in that country.');
    this.assertWithinRate(payee.payeeId, now);
    const code = standIn ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
    const minutes = CODE_TTL_MS / 60_000;
    this.pending.set(payee.payeeId, { msisdn, code, expires: now + CODE_TTL_MS, attempts: 0 });
    let used: CodeWay = 'sms';
    try {
      // Handed to the sender whatever it is: a sandbox's keeps it, so what would have been texted can be read back.
      if (!standIn) used = (await this.sms?.sendCode(to, code, minutes, now, via)) ?? 'sms';
    } catch (err) {
      this.pending.delete(payee.payeeId);
      this.giveBack(payee.payeeId);
      throw new GlosError('SMS_NOT_SENT', notSentWords(err, 'The code could not be texted to that number. Try again in a minute.'));
    }
    return { sent: texts || Boolean(standIn), masked: maskMsisdn(msisdn), minutes, via: used, ...(isSandbox() ? { code } : {}) };
  }

  /**
   * The code back: the number is the payee's payout number from now. Replacing one pauses payouts to the new number for
   * a day and texts the old one that it was replaced.
   */
  async confirm(actor: IntrospectionResult | undefined, code: string, now: number = Date.now()): Promise<PayoutNumberSaved> {
    const payee = this.requirePayee(actor);
    const asked = this.pending.get(payee.payeeId);
    if (!asked || asked.expires < now) {
      this.pending.delete(payee.payeeId);
      throw new GlosError('OTP_INVALID', 'Wrong or expired code');
    }
    if (!safeEqual(asked.code, String(code ?? '').trim())) {
      asked.attempts += 1;
      if (asked.attempts >= MAX_ATTEMPTS) {
        this.pending.delete(payee.payeeId);
        throw new GlosError('OTP_LOCKED', 'Too many wrong codes. Ask for a new one.');
      }
      throw new GlosError('OTP_INVALID', 'Wrong or expired code');
    }
    this.pending.delete(payee.payeeId);
    // 2026-11-16 — the code was typed in: the route that texted it got it there (D4).
    this.sms?.codeEntered?.(`+${asked.msisdn}`, now);
    const before = this.numbers.get(payee.payeeId);
    const at = new Date(now).toISOString();
    const masked = maskMsisdn(asked.msisdn);
    const record: PayoutNumberRecord = {
      payeeId: payee.payeeId,
      country: payee.country,
      msisdn: asked.msisdn,
      numberId: `pn_${randomBytes(8).toString('hex')}`,
      confirmedAt: at,
      ...(before ? { heldUntil: new Date(now + PAYOUT_NUMBER_HOLD_MS).toISOString() } : {}),
      history: [...(before?.history ?? []), { at, act: before ? 'changed' : 'set', masked, by: auditActor(actor as IntrospectionResult) }],
    };
    this.numbers.set(payee.payeeId, record);
    let oldNumber: 'texted' | 'kept' | 'not_sent' | undefined;
    if (before) {
      try {
        await this.sms?.sendPayoutNumberChanged(`+${before.msisdn}`, masked);
        oldNumber = this.sms?.sends() ? 'texted' : 'kept';
      } catch {
        // The change stands — the payee proved the new number — and the pause still holds. Said, so it is not assumed.
        oldNumber = 'not_sent';
        this.logger.warn('The old payout number could not be told it was replaced');
      }
    }
    return { ...this.viewOf(payee, now), ...(oldNumber ? { oldNumber } : {}) };
  }

  /**
   * ROUTE PLAN PART 4 — THE PAYEE'S OWN BANK ACCOUNT, where its partner pays to bank accounts. Refused where it does not, for an
   * IBAN that is not one (its check digits, its country's length, a SEPA country), and for the account it already is. Kept sealed.
   * Replacing one pauses payouts to the new one for a day, as a changed number does.
   *
   * 2026-11-26 — WITH THE SIGN-IN ASKED AGAIN (the weakness after part 4b, fixed as recommended): an open app is not proof of who
   * holds the phone, and an IBAN typed in is not proven by a code the way a number is. So the PIN of the person signed in (the
   * Driver and Fleet apps) or the password of the shop or hub (the Shop and Hub apps) is asked — after the account is checked, so
   * a mistyped IBAN costs no try, and before anything is kept; the same count and lock as the door. A change is told at once, in
   * the bell and by email, so a change somebody else made is seen while the day's pause still holds the money.
   */
  setBank(actor: IntrospectionResult | undefined, input: { account: string; holder: string; bic?: string; pin?: string; password?: string }, now: number = Date.now()): PayoutNumberSaved {
    const payee = this.requirePayee(actor);
    const name = catalogueEntry(payee.country)?.name ?? payee.country;
    if (this.paysTo(payee.country) !== 'bank') throw new GlosError('INVALID_STATE', `In ${name} payouts do not go to a bank account.`);
    const account = normaliseIban(input.account);
    const problem = ibanProblem(account);
    if (problem) throw new GlosError('VALIDATION_FAILED', IBAN_WORDS[problem], { field: 'account' });
    const holder = (input.holder ?? '').trim().replace(/\s+/g, ' ');
    if (!/^[\p{L}\p{M}0-9 .,'’&()/-]{2,70}$/u.test(holder)) throw new GlosError('VALIDATION_FAILED', 'Write the account holder’s name as the bank has it', { field: 'holder' });
    const bic = input.bic?.trim() ? input.bic.toUpperCase().replace(/\s/g, '') : undefined;
    if (bic && !isBic(bic)) throw new GlosError('VALIDATION_FAILED', 'Not a BIC: eight or eleven letters and digits, as the bank writes it', { field: 'bic' });
    const before = this.banks.get(payee.payeeId);
    if (before && this.openBank(before)?.account === account) throw new GlosError('INVALID_STATE', 'That is already your payout account.');
    this.proveSignIn(actor, input);
    const at = new Date(now).toISOString();
    const masked = maskIban(account);
    const record: PayoutBankRecord = {
      payeeId: payee.payeeId,
      country: payee.country,
      sealed: this.seal(JSON.stringify({ account, holder, ...(bic ? { bic } : {}) })),
      masked,
      bankId: `pb_${randomBytes(8).toString('hex')}`,
      confirmedAt: at,
      ...(before ? { heldUntil: new Date(now + PAYOUT_NUMBER_HOLD_MS).toISOString() } : {}),
      history: [...(before?.history ?? []), { at, act: before ? 'changed' : 'set', masked, by: auditActor(actor as IntrospectionResult) }],
    };
    this.banks.set(payee.payeeId, record);
    if (before) this.tellBankChanged(actor as IntrospectionResult, payee, masked, now);
    return this.viewOf(payee, now);
  }

  /**
   * 2026-11-26 — THE SIGN-IN AGAIN, before a bank account is kept: the PIN where a person signed in, the password where a shop or
   * a hub did. Refused when neither is given, or where this server cannot check it — never let through unchecked.
   */
  private proveSignIn(actor: IntrospectionResult | undefined, input: { pin?: string; password?: string }): void {
    const byPassword = actor?.role === 'agent' || actor?.role === 'mdp';
    const pin = input.pin?.trim();
    if (pin && actor?.personDid) {
      if (!this.persons) throw new GlosError('INVALID_STATE', 'Your PIN cannot be checked on this server, so the account cannot be saved.');
      this.persons.confirmPin(actor.personDid, pin);
      return;
    }
    if (input.password && byPassword && actor?.did) {
      if (!this.accounts) throw new GlosError('INVALID_STATE', 'The password cannot be checked on this server, so the account cannot be saved.');
      this.accounts.confirmPassword(actor.did, input.password);
      return;
    }
    throw new GlosError('FIELD_REQUIRED', byPassword ? 'Enter the password you sign in with to save the account' : 'Enter your PIN to save the account', { field: byPassword ? 'password' : 'pin' });
  }

  /** A changed bank account, told in the bell (opening it in Settings) and by email where there is an address. Never a text. */
  private tellBankChanged(actor: IntrospectionResult, payee: Payee, masked: string, now: number): void {
    const until = new Date(now + PAYOUT_NUMBER_HOLD_MS).toISOString();
    // 2026-11-26 — in phrases, so the bell and the phone say it in the reader's language; 2026-11-27 — and the email beside it.
    const headlineSaid = said('payout.bankChanged.title');
    const whatSaid = said('payout.bankChanged.what', { account: masked, until: at(`${until.slice(0, 16).replace('T', ' ')} UTC`, until) });
    const nextSaid = said(actor.personDid ? 'payout.bankChanged.nextPin' : 'payout.bankChanged.nextPassword');
    const owner = actor.role === 'mdp' && actor.did ? actor.did : payee.payeeId;
    void this.notices
      ?.notify(owner, { kind: 'security', ...noticeOf(headlineSaid, said('bell.twoParts', { what: whatSaid, next: nextSaid })), link: '/?settings=payout', tag: `payout-bank:${payee.payeeId}:${now}` })
      .catch(() => undefined);
    let address: string | undefined;
    try {
      const person = actor.personDid ? this.persons?.findByDid(actor.personDid) : undefined;
      address = person ? this.persons?.emailOf(person) : actor.did && !actor.personDid ? this.accounts?.emailForDid(actor.did) : undefined;
    } catch {
      address = undefined;
    }
    // Said to whoever signed in: the person, or the shop's or hub's own account.
    const reader = actor.personDid ?? actor.did;
    if (address) void this.mail?.send('account-safety', { address }, safetyMailOf(this.readers, reader, { headline: headlineSaid, what: whatSaid, next: nextSaid }, new Date(now).toISOString())).catch(() => false);
  }

  /** The whole account, its holder and BIC — for the payout, at the moment it sends, and only for the account it was raised to. */
  fullBank(payeeId: string, bankId: string): PayeeAccount | undefined {
    const record = this.banks.get(payeeId);
    return record && record.bankId === bankId ? this.openBank(record) : undefined;
  }

  /** Where the payout run pays this payee, or why it cannot today. Asked only for a country that pays by M-Pesa. */
  destinationOf(payeeId: string, way: PayoutWay, now: number = Date.now()): PayoutDestination | PayoutDestinationRefusal {
    if (way !== 'mpesa') return { reason: 'this country pays by hand' };
    const record = this.numbers.get(payeeId);
    if (!record) return { reason: 'no payout number yet: the payee sets it in Settings' };
    if (record.heldUntil && Date.parse(record.heldUntil) > now) {
      return { reason: `the payout number was changed: nothing is paid to it before ${record.heldUntil.slice(0, 16).replace('T', ' ')} UTC` };
    }
    return { numberId: record.numberId, masked: maskMsisdn(record.msisdn) };
  }

  /**
   * 2026-11-20 — WHERE A PARTNER PAYS THIS HAND (4c): its own number, confirmed with a code — or why not today: none set yet,
   * or changed less than a day ago (the pause that catches a number put on somebody else's account).
   */
  partnerDestination(payeeId: string, now: number = Date.now(), to: 'phone' | 'bank' = 'phone'): PayoutDestination | PayoutDestinationRefusal {
    if (to === 'bank') {
      const bank = this.banks.get(payeeId);
      if (!bank) return { reason: 'no_bank' };
      if (bank.heldUntil && Date.parse(bank.heldUntil) > now) return { reason: 'bank_new' };
      return { numberId: bank.bankId, masked: bank.masked };
    }
    const record = this.numbers.get(payeeId);
    if (!record) return { reason: 'no_number' };
    if (record.heldUntil && Date.parse(record.heldUntil) > now) return { reason: 'number_new' };
    return { numberId: record.numberId, masked: maskMsisdn(record.msisdn) };
  }

  /** 4e — when this payee's payout number was CHANGED (a first number is not a change): what the money checks read. */
  changesOf(payeeId: string): string[] {
    return [...(this.numbers.get(payeeId)?.history ?? []), ...(this.banks.get(payeeId)?.history ?? [])].filter((e) => e.act === 'changed').map((e) => e.at).sort();
  }

  /** The whole number — for the rail, at the moment it sends, and only for the number the payout was raised to. */
  fullNumber(payeeId: string, numberId: string): string | undefined {
    const record = this.numbers.get(payeeId);
    return record && record.numberId === numberId ? record.msisdn : undefined;
  }

  private viewOf(payee: Payee, now: number): PayoutNumberView {
    const way = this.wayOf(payee.country);
    const paysTo = this.paysTo(payee.country);
    const phone = this.numbers.get(payee.payeeId);
    const bank = paysTo === 'bank' ? this.banks.get(payee.payeeId) : undefined;
    const record = paysTo === 'bank' ? (bank ? { masked: bank.masked, confirmedAt: bank.confirmedAt, heldUntil: bank.heldUntil } : undefined) : phone ? { masked: maskMsisdn(phone.msisdn), confirmedAt: phone.confirmedAt, heldUntil: phone.heldUntil } : undefined;
    const held = record?.heldUntil && Date.parse(record.heldUntil) > now ? record.heldUntil : undefined;
    return {
      way,
      ...(way === 'partner' ? { paidBy: this.partners?.partnerAt(payee.country)?.name } : {}),
      ...(paysTo ? { paysTo } : {}),
      country: payee.country,
      ...(record ? { masked: record.masked, confirmedAt: record.confirmedAt } : {}),
      ...(held ? { heldUntil: held } : {}),
    };
  }

  private seal(secret: string): string {
    return this.crypt ? `enc:${this.crypt.encrypt(secret)}` : secret;
  }

  private openBank(record: PayoutBankRecord): PayeeAccount | undefined {
    try {
      const plain = record.sealed.startsWith('enc:') && this.crypt ? this.crypt.decrypt(record.sealed.slice(4)) : record.sealed;
      return JSON.parse(plain) as PayeeAccount;
    } catch {
      return undefined;
    }
  }

  /**
   * Who this caller is paid as. A courier is paid itself; a fleet driver is not — its fleet is; a fleet's office sets the
   * fleet's number; a hub its own. A shop is paid into its float, so it has none. Staff are refused by name.
   */
  private payeeOf(actor: IntrospectionResult | undefined): Payee | { notPayee: string; country: string } {
    const role = actor?.role;
    if (role === 'operator') throw new GlosError('FORBIDDEN', STAFF_SET_NO_PAYOUT_NUMBER);
    if (role === 'driver' && actor?.did) {
      const driver = this.drivers.get(actor.did);
      const country = driver.jurisdiction ?? NETWORK_JURISDICTION;
      if (driver.managerDid) return { notPayee: 'Your fleet is paid for your work: its office sets where.', country };
      return { payeeId: driver.did, country };
    }
    if (role === 'fleet_manager') {
      const fleetDid = actingTenant(actor);
      if (!fleetDid) throw new GlosError('FORBIDDEN', 'Sign in as the fleet’s office');
      const fleet = this.managers.get(fleetDid);
      return { payeeId: fleet.did, country: fleet.jurisdiction ?? NETWORK_JURISDICTION };
    }
    if (role === 'mdp' && actor?.did) {
      const hub = this.mdps.list().find((m) => m.did === actor.did);
      if (!hub) throw new GlosError('NOT_FOUND', 'No hub is signed in');
      return { payeeId: hub.mdpId, country: this.mdps.countryOf(hub) };
    }
    // 2026-11-20 — a shop where a partner contracts is paid by the partner, to its own number (4c); elsewhere, into its float.
    if (role === 'agent' && actor?.did && this.agents) {
      const shop = this.agents.get(actor.did);
      const country = this.agents.countryOf(shop);
      if (this.wayOf(country) === 'partner') return { payeeId: shop.did, country };
      return { notPayee: 'This account is not paid out: a shop is paid into its float.', country };
    }
    return { notPayee: 'This account is not paid out: a shop is paid into its float.', country: NETWORK_JURISDICTION };
  }

  private requirePayee(actor: IntrospectionResult | undefined): Payee {
    const who = this.payeeOf(actor);
    if ('notPayee' in who) throw new GlosError('FORBIDDEN', who.notPayee);
    return who;
  }

  private assertWithinRate(payeeId: string, now: number): void {
    const rate = this.rates.get(payeeId);
    if (!rate) {
      this.rates.set(payeeId, { lastAt: now, windowStart: now, count: 1 });
      return;
    }
    if (now - rate.windowStart > DAY_MS) {
      rate.windowStart = now;
      rate.count = 0;
    }
    if (now - rate.lastAt < RESEND_COOLDOWN_MS) {
      const wait = Math.ceil((RESEND_COOLDOWN_MS - (now - rate.lastAt)) / 1000);
      throw new GlosError('RATE_LIMITED', `Wait ${wait}s before asking for another code`);
    }
    if (rate.count >= MAX_PER_DAY) throw new GlosError('RATE_LIMITED', 'Too many codes asked for today');
    rate.lastAt = now;
    rate.count += 1;
  }

  /** A code that never left does not count against the day. */
  private giveBack(payeeId: string): void {
    const rate = this.rates.get(payeeId);
    if (rate && rate.count > 0) {
      rate.count -= 1;
      rate.lastAt = 0;
    }
  }
}

/** Why an IBAN was refused, said to the payee typing it. */
const IBAN_WORDS: Record<'not_iban' | 'not_sepa' | 'length' | 'check', string> = {
  not_iban: 'Not a bank account number (IBAN): it starts with two letters of its country, then two digits.',
  not_sepa: 'Payouts go to a bank account in the SEPA area (the European Union and its neighbours).',
  length: 'That bank account number is too short or too long for its country: check every character.',
  check: 'That bank account number does not add up: one character is likely mistyped.',
};

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
