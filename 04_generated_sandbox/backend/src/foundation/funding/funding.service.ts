import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';
import { FUNDING_OPEN, FUNDING_RAIL, Funding, FundingPayer, FundingPayerKind, FundingPurpose, FundingRail, FundingStatus, RailPayment, UnmatchedPayment } from './funding.types';

/**
 * The reference a payer quotes, and the reason it looks the way it does.
 *
 * Read off one phone screen and typed into another, often by somebody standing at a counter with a
 * customer waiting. So: no `0`/`O`, no `1`/`I`/`L`, uppercase, and short enough to hold in your head for
 * the three seconds between reading and typing. The prefix survives a screenshot with the number cut off,
 * which is how these actually reach us over WhatsApp.
 */
const ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

/** A reference as the payer may have typed it: letters and digits only, upper case. See `byReference`. */
export function normaliseReference(reference: string): string {
  return reference.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

function payerReference(): string {
  const bytes = randomBytes(8);
  let out = '';
  for (let i = 0; i < 8; i += 1) out += ALPHABET[bytes[i] % ALPHABET.length];
  return `SBG-${out.slice(0, 4)}-${out.slice(4)}`;
}

/**
 * Money coming in, and the single door it comes through.
 *
 * See `funding.types.ts` for the three rules. This is where they are enforced, and the shape is the mirror
 * of `PayoutService` on purpose — a reader who knows how money leaves should recognise how it arrives.
 *
 * WHAT THIS SERVICE DOES NOT DO IS CREDIT ANYBODY. It owns the lifecycle and the idempotency; the posting
 * belongs to whoever knows which account a payer's money lives in, and that knowledge stays beside the
 * payer (`FundingPayer`, registered at boot). Foundation does not reach into modules, and a shop's float
 * and a store's prepaid balance are two different liabilities that must never be credited by one branch.
 */
@Injectable()
export class FundingService {
  private readonly fundings = new PersistentMap<string, Funding>('funding');
  private readonly unmatched = new PersistentMap<string, UnmatchedPayment>('funding-unmatched');
  private readonly payers = new Map<FundingPayerKind, FundingPayer>();

  constructor(@Inject(FUNDING_RAIL) private readonly rail: FundingRail) {}

  /** Say how a kind of payer is resolved and credited. One registration at boot — see FundingPayer. */
  register(kind: FundingPayerKind, payer: FundingPayer): void {
    this.payers.set(kind, payer);
  }

  /**
   * Ask to be paid. **Nothing moves here** — this hands back a reference and the words to pay against it.
   *
   * Any earlier open intent of the same payer for the same purpose is expired as superseded. A shop that
   * taps Top up twice has not asked for two payments, and two live references is how the second one gets
   * paid against the first one's number and lands in the unmatched pile.
   */
  async open(
    input: { payerKind: FundingPayerKind; payerDid: string; purpose?: FundingPurpose; amount: number; payerPhone?: string },
    now: number = Date.now(),
  ): Promise<Funding> {
    const amount = Math.round((Number.isFinite(input.amount) ? input.amount : 0) * 100) / 100;
    if (amount <= 0) throw new GlosError('AMOUNT_INVALID', 'Ask for an amount greater than zero');
    const purpose: FundingPurpose = input.purpose ?? 'float';
    const payer = this.payerFor(input.payerKind);
    // Refuses where we hold no money in their country, BEFORE a reference exists: an intent that could
    // never be posted is a promise to a shopkeeper that nobody can keep.
    const { entityId, currency, label } = payer.resolve(input.payerDid);

    for (const open of this.list({ payerDid: input.payerDid, purpose }).filter((f) => FUNDING_OPEN.includes(f.status))) {
      this.expire(open.fundingId, 'superseded by a newer request', now);
    }

    const fundingId = `fnd_${randomBytes(8).toString('hex')}`;
    const railed = await this.rail.open({ fundingId, payerDid: input.payerDid, purpose, amount, currency, payerPhone: input.payerPhone });
    const funding: Funding = {
      fundingId,
      entityId,
      payerKind: input.payerKind,
      payerDid: input.payerDid,
      payerName: label,
      purpose,
      amount,
      currency,
      status: 'awaiting',
      reference: railed.reference || payerReference(),
      provider: this.rail.provider,
      instructions: railed.instructions,
      ...(railed.pushed ? { pushed: true } : {}),
      ...(railed.railRef ? { railRef: railed.railRef } : {}),
      openedAt: new Date(now).toISOString(),
    };
    return this.save(funding);
  }

  /**
   * THE RAIL SAYS MONEY ARRIVED. This is the only place money is created.
   *
   * Refused for exactly one reason: we have already recorded this provider reference. Not for an expired
   * intent, not for one that was marked failed, not for an amount that differs from what was asked —
   * none of those are facts about whether the money came, and our bookkeeping state does not get a vote
   * on that. The rail is the authority; we are the record.
   */
  confirm(payment: RailPayment, now: number = Date.now()): { funding?: Funding; unmatched?: UnmatchedPayment; duplicate: boolean } {
    const amount = Math.round((Number.isFinite(payment.amount) ? payment.amount : 0) * 100) / 100;
    const fee = Math.max(0, Math.round((Number.isFinite(payment.fee ?? 0) ? (payment.fee as number) : 0) * 100) / 100);

    // Idempotency, first and before anything else can have an effect. A provider that retries its
    // callback until it gets a 200 — which is how every one of them behaves — must not credit twice.
    const seen = this.byProviderRef(payment.provider, payment.providerRef);
    if (seen) return { ...seen, duplicate: true };

    if (amount <= 0) {
      return { unmatched: this.recordUnmatched(payment, 'the rail reported an amount of zero or less', now), duplicate: false };
    }

    const match = this.byReference(payment.reference);
    if (!match) {
      // Real money, no name on it. Recorded, not posted — see UnmatchedPayment.
      const reason = payment.reference ? `no request is open under reference ${payment.reference}` : 'the payer quoted no reference';
      return { unmatched: this.recordUnmatched(payment, reason, now), duplicate: false };
    }

    /*
     * PAID IN A DIFFERENT CURRENCY FROM THE ONE THE ACCOUNT IS KEPT IN.
     *
     * The rule above says the rail decides the AMOUNT. It does not get to decide what that amount is
     * denominated in, and the difference matters: a shop's deposit account is per sister and per currency,
     * so crediting "500" from a USD callback into a KES deposit produces a balance that is a figure
     * denominated in nothing — the exact failure the money model refuses everywhere else ("you may compare
     * across sisters, you may never total across them").
     *
     * NOT CONVERTED HERE, deliberately, even though an FX service exists. A conversion needs a rate, a
     * moment and somebody who carries the spread; the shipment path stamps its rate on the parcel and shows
     * the buyer both figures. Doing it silently on a callback would hand a shopkeeper a balance set by our
     * mid-rate at a moment they never saw, on a number they cannot check. So it is held, visibly, with both
     * currencies named, and a person decides — the same answer as a payment with nobody's name on it, for
     * the same reason: we would be guessing.
     */
    if (payment.currency && match.currency && payment.currency.toUpperCase() !== match.currency.toUpperCase()) {
      return {
        unmatched: this.recordUnmatched(payment, `paid in ${payment.currency} against a request in ${match.currency} — this account is kept in ${match.currency}, and converting it here would invent a rate`, now),
        duplicate: false,
      };
    }

    /*
     * PAID TWICE AGAINST ONE REFERENCE. It happens: a paybill payment that looked like it failed is made
     * again, quoting the same number. Both payments are real and both are this shop's money, so the second
     * one is credited as a funding of its own that was paid without being asked for — openedAt equal to
     * confirmedAt, which is exactly what happened. Refusing it would leave a shopkeeper short by the
     * amount of a payment we can see in our own account.
     *
     * ONLY FROM THE SAME RAIL, though. Two references from one provider are two payments. The same
     * reference confirmed by a DIFFERENT provider — a statement line typed in by staff for a payment a
     * mobile-money callback has already confirmed — is far more likely to be one payment recorded twice,
     * and crediting it would double a shop's float on an operator's slip. Held as unmatched instead:
     * visible, unposted, and somebody goes and looks.
     */
    const settled = match.status === 'confirmed' || match.status === 'reversed';
    if (settled && match.provider !== payment.provider) {
      return {
        unmatched: this.recordUnmatched(payment, `reference ${match.reference} was already paid via ${match.provider} — confirm by hand only if this is a second, separate payment`, now),
        duplicate: false,
      };
    }
    const target = settled ? this.followOn(match, amount, now) : match;

    const payer = this.payerFor(target.payerKind);
    const { entryId } = payer.credit(target.payerDid, { purpose: target.purpose, gross: amount, fee, reference: payment.providerRef, fundingId: target.fundingId });

    target.status = 'confirmed';
    // The rail that actually carried it, which is not always the one the intent was opened against — a
    // shop can be told a paybill number and pay by bank transfer instead. What paid is what is recorded.
    target.provider = payment.provider;
    target.providerRef = payment.providerRef;
    target.confirmedAmount = amount;
    target.fee = fee;
    target.confirmedAt = payment.paidAt ?? new Date(now).toISOString();
    target.entryId = entryId;
    target.failureReason = undefined;
    return { funding: this.save(target), duplicate: false };
  }

  /** The payer said no, or the rail did. Nothing moved, so nothing is unwound. */
  fail(fundingId: string, reason: string, now: number = Date.now()): Funding {
    const funding = this.require(fundingId);
    if (funding.status !== 'awaiting') throw new GlosError('INVALID_STATE', `This request is ${funding.status} — only one still waiting can fail`);
    funding.status = 'failed';
    funding.failedAt = new Date(now).toISOString();
    funding.failureReason = reason;
    return this.save(funding);
  }

  /**
   * THE PROVIDER SAYS THE PAYER DID NOT PAY — a prompt cancelled, a phone that never answered, a wrong PIN.
   *
   * Separate from `fail` because the caller is different and so is what it may assume. `fail` is a person
   * closing a request they are looking at, and it refuses anything that is not still waiting, loudly.
   * This is a callback: it arrives out of nowhere, possibly twice, possibly about a request somebody
   * already expired by asking again. None of that is worth an exception — the money did not arrive either
   * way, and a provider retrying a cancellation must not be answered with an error it will retry again.
   *
   * Idempotent and total: it closes the one awaiting request that prompt belongs to, and otherwise does
   * nothing at all.
   */
  notePaymentRefused(outcome: { railRef?: string; reason: string }, now: number = Date.now()): Funding | undefined {
    if (!outcome.railRef) return undefined;
    const funding = this.list().find((f) => f.railRef === outcome.railRef);
    if (!funding || funding.status !== 'awaiting') return funding;
    funding.status = 'failed';
    funding.failedAt = new Date(now).toISOString();
    funding.failureReason = outcome.reason;
    return this.save(funding);
  }

  /** Nobody ever paid it. A list full of stale "waiting" rows reads as money on its way, and it is not. */
  expire(fundingId: string, reason: string, now: number = Date.now()): Funding {
    const funding = this.require(fundingId);
    if (funding.status !== 'awaiting') throw new GlosError('INVALID_STATE', `This request is ${funding.status} — only one still waiting can be closed`);
    funding.status = 'expired';
    funding.expiredAt = new Date(now).toISOString();
    funding.failureReason = reason;
    return this.save(funding);
  }

  /**
   * A confirmed payment that came back — a mobile-money reversal, a recalled transfer, a chargeback.
   *
   * The credit is undone by its exact mirror rather than by deleting the first entry: the money did
   * arrive and did go back, and a book that shows neither cannot be reconciled against a statement that
   * shows both. A shop that has already spent it goes honestly negative, which the float has always
   * allowed and which is the true state of affairs.
   */
  reverse(fundingId: string, reason: string, now: number = Date.now()): Funding {
    const funding = this.require(fundingId);
    if (funding.status !== 'confirmed') throw new GlosError('INVALID_STATE', `This payment is ${funding.status} — only a confirmed one can be reversed`);
    const payer = this.payerFor(funding.payerKind);
    const { entryId } = payer.reverse(funding.payerDid, {
      purpose: funding.purpose,
      gross: funding.confirmedAmount ?? funding.amount,
      fee: funding.fee ?? 0,
      reference: funding.providerRef ?? funding.reference,
      fundingId: funding.fundingId,
    });
    funding.status = 'reversed';
    funding.reversedAt = new Date(now).toISOString();
    funding.reversalEntryId = entryId;
    funding.failureReason = reason;
    return this.save(funding);
  }

  list(filter: { entityId?: string; payerDid?: string; status?: FundingStatus; purpose?: FundingPurpose } = {}): Funding[] {
    return [...this.fundings.values()]
      .filter(
        (f) =>
          (!filter.entityId || f.entityId === filter.entityId) &&
          (!filter.payerDid || f.payerDid === filter.payerDid) &&
          (!filter.status || f.status === filter.status) &&
          (!filter.purpose || f.purpose === filter.purpose),
      )
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  }

  get(fundingId: string): Funding {
    return this.require(fundingId);
  }

  /** What this payer is waiting on right now, if anything — the shop's own view of its own request. */
  openFor(payerDid: string, purpose: FundingPurpose = 'float'): Funding | null {
    return this.list({ payerDid, purpose }).find((f) => FUNDING_OPEN.includes(f.status)) ?? null;
  }

  /**
   * Money that arrived with nobody's name on it — the operator's chase list, newest first.
   *
   * Applied ones are excluded: this list is work, and a payment somebody has already attributed is not
   * work any more. It is still held (see `UnmatchedPayment.appliedAt`) so the decision can be traced.
   */
  unmatchedPayments(includeApplied = false): UnmatchedPayment[] {
    return [...this.unmatched.values()].filter((u) => includeApplied || !u.appliedAt).sort((a, b) => b.at.localeCompare(a.at));
  }

  /**
   * SAY WHOSE PAYMENT THIS WAS, and credit it.
   *
   * The only way out of the unmatched list, and deliberately a judgement rather than a rule: somebody
   * looked at a paybill payment with a mistyped reference, rang the shop, and now says it is theirs. The
   * alternative was what existed before — the money sat visible and unposted for ever, and the shopkeeper
   * who paid it was short.
   *
   * WHAT IT PRODUCES IS AN ORDINARY CONFIRMED FUNDING, on purpose: the posting path is the same one a
   * rail-matched payment takes, so the books cannot be told apart by an auditor and no second code path
   * exists for crediting money. What is NOT the same is the record — the funding carries the provider's
   * reference, and the unmatched record keeps who applied it and when.
   *
   * Refused if already applied. A payment applied twice is a shop credited twice for money that arrived
   * once, and it would be the easiest mistake on the whole screen to make.
   */
  apply(unmatchedId: string, to: { payerKind: FundingPayerKind; payerDid: string }, by: string, now: number = Date.now()): { funding: Funding; unmatchedId: string } {
    const record = this.unmatched.get(unmatchedId);
    if (!record) throw new GlosError('NOT_FOUND', `No unattributed payment found: ${unmatchedId}`);
    if (record.appliedAt) throw new GlosError('INVALID_STATE', `That payment was already applied on ${record.appliedAt} — it arrived once and can only be credited once`);

    const payer = this.payerFor(to.payerKind);
    // Refuses a payer with no account to credit, exactly as opening a request does.
    const { entityId, currency, label } = payer.resolve(to.payerDid);
    if (record.currency && record.currency.toUpperCase() !== currency.toUpperCase()) {
      // The same rule `confirm` holds: we do not convert on somebody's behalf at a rate they never saw.
      throw new GlosError('AMOUNT_INVALID', `That payment is in ${record.currency} and ${label} is settled in ${currency} — applying it here would invent an exchange rate`);
    }

    const { entryId } = payer.credit(to.payerDid, { purpose: 'float', gross: record.amount, fee: 0, reference: record.providerRef, fundingId: unmatchedId });
    const funding: Funding = {
      fundingId: `fnd_${randomBytes(8).toString('hex')}`,
      entityId,
      payerKind: to.payerKind,
      payerDid: to.payerDid,
      payerName: label,
      purpose: 'float',
      // Asked for and received are the same figure here: nobody asked for it, it simply arrived.
      amount: record.amount,
      currency: record.currency,
      status: 'confirmed',
      reference: record.reference || record.providerRef,
      provider: record.provider,
      instructions: `Attributed by hand: this payment arrived with no request open against it (${record.reason}).`,
      openedAt: new Date(now).toISOString(),
      providerRef: record.providerRef,
      confirmedAmount: record.amount,
      fee: 0,
      confirmedAt: record.at,
      entryId,
    };
    this.save(funding);

    record.appliedAt = new Date(now).toISOString();
    record.appliedTo = funding.fundingId;
    record.appliedBy = by;
    this.unmatched.set(record.id, record);
    return { funding, unmatchedId };
  }

  private followOn(paid: Funding, amount: number, now: number): Funding {
    const clone: Funding = {
      ...paid,
      fundingId: `fnd_${randomBytes(8).toString('hex')}`,
      amount,
      status: 'awaiting',
      openedAt: new Date(now).toISOString(),
      providerRef: undefined,
      confirmedAmount: undefined,
      fee: undefined,
      confirmedAt: undefined,
      entryId: undefined,
      reversedAt: undefined,
      reversalEntryId: undefined,
      failureReason: undefined,
    };
    return this.save(clone);
  }

  private recordUnmatched(payment: RailPayment, reason: string, now: number): UnmatchedPayment {
    const record: UnmatchedPayment = {
      id: `unm_${randomBytes(6).toString('hex')}`,
      provider: payment.provider,
      providerRef: payment.providerRef,
      reference: payment.reference,
      amount: Math.round((Number.isFinite(payment.amount) ? payment.amount : 0) * 100) / 100,
      currency: payment.currency,
      payerLabel: payment.payerLabel,
      at: payment.paidAt ?? new Date(now).toISOString(),
      reason,
    };
    this.unmatched.set(record.id, record);
    return record;
  }

  /** Have we already recorded this exact payment? Both piles are searched — a payment that landed as
   *  unmatched yesterday must not be credited when the provider retries its callback today. */
  private byProviderRef(provider: string, providerRef: string): { funding?: Funding; unmatched?: UnmatchedPayment } | null {
    if (!providerRef) return null;
    const funding = [...this.fundings.values()].find((f) => f.provider === provider && f.providerRef === providerRef);
    if (funding) return { funding };
    const unmatched = [...this.unmatched.values()].find((u) => u.provider === provider && u.providerRef === providerRef);
    return unmatched ? { unmatched } : null;
  }

  /**
   * Match what the payer actually typed — WHICH IS NOT WHAT WE PRINTED FOR THEM.
   *
   * We show `SBG-QNTS-QP5D`. On a paybill the customer types the account number on a phone keypad, from
   * memory or off a screenshot, and what reaches the callback is `SBGQNTSQP5D`, `sbg qnts qp5d`, or the
   * same thing with a stray full stop. An exact match would send every one of those to the unmatched pile
   * — a pile whose only recovery today is a phone call — and the first live payment would probably land
   * in it.
   *
   * So separators and case are ignored on both sides. That is NOT guessing at a typo: it is the same
   * string written differently, and the alphabet was chosen with no 0/O and no 1/I/L precisely so that
   * two different references cannot collapse into one. A genuinely mistyped CHARACTER still misses, and
   * it should — inventing a nearest match would credit the wrong shop.
   */
  private byReference(reference?: string): Funding | undefined {
    const wanted = normaliseReference(reference ?? '');
    if (!wanted) return undefined;
    // Newest first (list() sorts that way), so a reference reused across a superseded intent resolves to
    // the live one rather than to whichever the map happened to hold first.
    return this.list().find((f) => normaliseReference(f.reference) === wanted);
  }

  private payerFor(kind: FundingPayerKind): FundingPayer {
    const payer = this.payers.get(kind);
    // A wiring failure, not a caller's mistake: nothing registered this kind at boot. It surfaces as an
    // error rather than a silent no-op, because the silent version would leave money confirmed by a rail
    // and credited to nobody.
    if (!payer) throw new GlosError('INTERNAL', `Nothing knows how to take money from a ${kind}`);
    return payer;
  }

  private save(funding: Funding): Funding {
    this.fundings.set(funding.fundingId, funding);
    return funding;
  }

  private require(fundingId: string): Funding {
    const funding = this.fundings.get(fundingId);
    if (!funding) throw new GlosError('NOT_FOUND', `Funding request not found: ${fundingId}`);
    return funding;
  }
}
