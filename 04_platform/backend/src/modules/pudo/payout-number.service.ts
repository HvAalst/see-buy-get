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
import { PAYOUT_NUMBER_HOLD_MS, PayoutCodeSent, PayoutNumberRecord, PayoutNumberSaved, PayoutNumberView } from './payout-number.types';
import { NETWORK_JURISDICTION } from './pudo.config';

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
  // A code lives ten minutes: kept in memory, like every other code here. A restart only means asking again.
  private readonly pending = new Map<string, { msisdn: string; code: string; expires: number; attempts: number }>();
  private readonly rates = new Map<string, { lastAt: number; windowStart: number; count: number }>();

  constructor(
    private readonly payouts: PayoutService,
    private readonly drivers: DriverService,
    private readonly managers: FleetManagerService,
    private readonly mdps: MdpService,
    @Optional() private readonly sms?: SmsService,
  ) {}

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
  }

  view(actor: IntrospectionResult | undefined, now: number = Date.now()): PayoutNumberView {
    const who = this.payeeOf(actor);
    if ('notPayee' in who) return { way: payoutWayOf(who.country), country: who.country, notPayee: who.notPayee };
    return this.viewOf(who, now);
  }

  /**
   * Text a code to the number the payee wants to be paid to. Refused, before anything is sent, where the country pays by
   * hand, for a number M-Pesa cannot pay, and for the number it already is.
   */
  async requestCode(actor: IntrospectionResult | undefined, phone: string, now: number = Date.now()): Promise<PayoutCodeSent> {
    const payee = this.requirePayee(actor);
    if (payoutWayOf(payee.country) !== 'mpesa') {
      throw new GlosError('INVALID_STATE', `In ${catalogueEntry(payee.country)?.name ?? payee.country} payouts are made by hand: there is no payout number to set.`);
    }
    const msisdn = normaliseMsisdn(phone);
    if (!msisdn) throw new GlosError('PHONE_INVALID', 'Not a Kenyan mobile number M-Pesa can pay. Write it as 07XX XXX XXX or 01XX XXX XXX.', { field: 'phone' });
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
    try {
      // Handed to the sender whatever it is: a sandbox's keeps it, so what would have been texted can be read back.
      if (!standIn) await this.sms?.sendCode(to, code, minutes);
    } catch (err) {
      this.pending.delete(payee.payeeId);
      this.giveBack(payee.payeeId);
      throw new GlosError('SMS_NOT_SENT', notSentWords(err, 'The code could not be texted to that number. Try again in a minute.'));
    }
    return { sent: texts || Boolean(standIn), masked: maskMsisdn(msisdn), minutes, ...(isSandbox() ? { code } : {}) };
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

  /** The whole number — for the rail, at the moment it sends, and only for the number the payout was raised to. */
  fullNumber(payeeId: string, numberId: string): string | undefined {
    const record = this.numbers.get(payeeId);
    return record && record.numberId === numberId ? record.msisdn : undefined;
  }

  private viewOf(payee: Payee, now: number): PayoutNumberView {
    const record = this.numbers.get(payee.payeeId);
    const held = record?.heldUntil && Date.parse(record.heldUntil) > now ? record.heldUntil : undefined;
    return {
      way: payoutWayOf(payee.country),
      country: payee.country,
      ...(record ? { masked: maskMsisdn(record.msisdn), confirmedAt: record.confirmedAt } : {}),
      ...(held ? { heldUntil: held } : {}),
    };
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

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}
