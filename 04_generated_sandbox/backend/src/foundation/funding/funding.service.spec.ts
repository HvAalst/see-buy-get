import { Test } from '@nestjs/testing';
import { FundingService } from './funding.service';
import { SandboxFundingRail } from './sandbox-funding-rail.adapter';
import { FUNDING_RAIL, FundingPayer, RailPayment } from './funding.types';

/**
 * Money coming in — rule 5 of the money model, finally enforced.
 *
 * *"Money is created only by an observed external event, with a provider reference, verified and
 * idempotent."* Decided 2026-08-14, obeyed by the payout side since `da94709`, and ignored by the inbound
 * side until now: a shop typed a number and the books recorded cash the network could not prove it held.
 *
 * These tests are about the three rules that make that honest rather than merely plausible. Asking moves
 * nothing. The amount is the rail's, never the payer's. And our own bookkeeping state does not get a vote
 * on whether money arrived — only a provider reference we have already seen can refuse a confirmation.
 */
describe('money coming in', () => {
  let funding: FundingService;
  let rail: SandboxFundingRail;
  /** What the registered payer was asked to credit — the stand-in for a shop's float. */
  let credited: Array<{ payerDid: string; gross: number; fee: number; reference: string }>;
  let reversed: Array<{ payerDid: string; gross: number }>;

  const payer = (): FundingPayer => ({
    resolve: (payerDid) => {
      if (payerDid === 'did:shop:nowhere') throw new Error('no sister holds money in their country');
      return { entityId: 'ent_ke', currency: 'KES', label: 'Mama Njeri Shop' };
    },
    credit: (payerDid, c) => {
      credited.push({ payerDid, gross: c.gross, fee: c.fee, reference: c.reference });
      return { entryId: `je_${credited.length}` };
    },
    reverse: (payerDid, c) => {
      reversed.push({ payerDid, gross: c.gross });
      return { entryId: `je_rev_${reversed.length}` };
    },
  });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [FundingService, SandboxFundingRail, { provide: FUNDING_RAIL, useExisting: SandboxFundingRail }],
    }).compile();
    funding = moduleRef.get(FundingService);
    rail = moduleRef.get(SandboxFundingRail);
    credited = [];
    reversed = [];
    funding.register('agent', payer());
  });

  const ask = (amount = 5000, payerDid = 'did:shop:njeri') => funding.open({ payerKind: 'agent', payerDid, amount });

  /** A confirmation as it arrives from the rail, signed — never a hand-built RailPayment, because the
   *  signature check is the thing that makes a webhook better than the shop's own word. */
  function railSays(fields: { providerRef: string; reference?: string; amount: number; fee?: number }): RailPayment {
    const { headers, body } = rail.simulate({ currency: 'KES', ...fields });
    return rail.verify(headers, body);
  }

  describe('asking is not paying', () => {
    it('hands back a reference and credits nobody', () => {
      const request = ask(5000);
      expect(request.status).toBe('awaiting');
      expect(request.reference).toMatch(/^SBG-/);
      expect(request.entryId).toBeUndefined();
      expect(credited).toEqual([]);
    });

    it('tells the payer how to pay, in the rail’s own words', () => {
      expect(ask().instructions).toContain('5000.00 KES');
    });

    it('refuses to open one where the payer has no account to credit', () => {
      expect(() => ask(5000, 'did:shop:nowhere')).toThrow(/no sister holds money/);
    });

    it('refuses an amount of nothing', () => {
      expect(() => ask(0)).toThrow(/greater than zero/);
    });

    it('supersedes an earlier request rather than leaving two live references', () => {
      const first = ask(1000);
      ask(2000);
      expect(funding.get(first.fundingId).status).toBe('expired');
      expect(funding.openFor('did:shop:njeri')?.amount).toBe(2000);
    });
  });

  describe('the rail is the authority', () => {
    it('creates the money only when the rail confirms it', () => {
      const request = ask(5000);
      const { funding: done } = funding.confirm(railSays({ providerRef: 'RJ84K2LMN0', reference: request.reference, amount: 5000 }));
      expect(done?.status).toBe('confirmed');
      expect(done?.entryId).toBe('je_1');
      expect(credited).toEqual([{ payerDid: 'did:shop:njeri', gross: 5000, fee: 0, reference: 'RJ84K2LMN0' }]);
    });

    it('credits what ARRIVED, not what was asked for', () => {
      // The trap this rule exists for: ask for 5,000, pay 500. The books must move by 500.
      const request = ask(5000);
      const { funding: done } = funding.confirm(railSays({ providerRef: 'RJ84K2LMN0', reference: request.reference, amount: 500 }));
      expect(credited[0].gross).toBe(500);
      expect(done?.confirmedAmount).toBe(500);
      // …and what they asked for is kept beside it, because a half-paid request is a thing somebody rings up about.
      expect(done?.amount).toBe(5000);
    });

    it('passes the provider’s fee through as ours, and credits the payer the gross', () => {
      const request = ask(5000);
      funding.confirm(railSays({ providerRef: 'RJ84K2LMN0', reference: request.reference, amount: 5000, fee: 75 }));
      expect(credited[0]).toMatchObject({ gross: 5000, fee: 75 });
    });

    it('credits once when a provider retries its callback', () => {
      const request = ask(5000);
      const payment = railSays({ providerRef: 'RJ84K2LMN0', reference: request.reference, amount: 5000 });
      funding.confirm(payment);
      const second = funding.confirm(payment);
      expect(second.duplicate).toBe(true);
      expect(credited).toHaveLength(1);
    });

    it('takes the money even when we had given up on the request', () => {
      // Our bookkeeping state does not get a vote on whether the money came. It came.
      const request = ask(5000);
      funding.expire(request.fundingId, 'nobody paid it');
      funding.confirm(railSays({ providerRef: 'RJ84K2LMN0', reference: request.reference, amount: 5000 }));
      expect(funding.get(request.fundingId).status).toBe('confirmed');
      expect(credited).toHaveLength(1);
    });

    it('credits a second, separate payment on the same reference from the same rail', () => {
      const request = ask(5000);
      funding.confirm(railSays({ providerRef: 'RJ84K2LMN0', reference: request.reference, amount: 5000 }));
      funding.confirm(railSays({ providerRef: 'RJ84K2LMN1', reference: request.reference, amount: 5000 }));
      expect(credited).toHaveLength(2);
    });
  });

  describe('money we cannot put a name to', () => {
    it('records a payment quoting no reference, and posts nothing', () => {
      const { unmatched } = funding.confirm(railSays({ providerRef: 'RJ84K2LMN0', amount: 5000 }));
      expect(unmatched?.reason).toMatch(/quoted no reference/);
      expect(credited).toEqual([]);
      expect(funding.unmatchedPayments()).toHaveLength(1);
    });

    it('records a payment quoting a reference nobody is waiting on', () => {
      const { unmatched } = funding.confirm(railSays({ providerRef: 'RJ84K2LMN0', reference: 'SBG-ZZZZ-ZZZZ', amount: 5000 }));
      expect(unmatched?.reason).toMatch(/no request is open/);
      expect(credited).toEqual([]);
    });

    it('does not record the same unattributable payment twice', () => {
      const payment = railSays({ providerRef: 'RJ84K2LMN0', amount: 5000 });
      funding.confirm(payment);
      expect(funding.confirm(payment).duplicate).toBe(true);
      expect(funding.unmatchedPayments()).toHaveLength(1);
    });

    it('holds a payment made in a currency the account is not kept in', () => {
      // The rail decides the amount; it does not decide what that amount is denominated in. Crediting
      // "500" from a USD callback into a KES deposit is a balance denominated in nothing.
      const request = ask(5000);
      const { unmatched } = funding.confirm({ provider: 'sandbox', providerRef: 'RJ84K2LMN9', reference: request.reference, amount: 500, currency: 'USD' });
      expect(unmatched?.reason).toMatch(/paid in USD against a request in KES/);
      expect(credited).toEqual([]);
      // …and the request is left alone, still waiting for the payment that was actually asked for.
      expect(funding.get(request.fundingId).status).toBe('awaiting');
    });

    it('holds a reference already paid by ANOTHER rail rather than crediting it twice', () => {
      // An operator typing in a statement line for a payment the mobile-money callback already confirmed
      // is far likelier than the same shop paying the same reference on two different rails.
      const request = ask(5000);
      funding.confirm(railSays({ providerRef: 'RJ84K2LMN0', reference: request.reference, amount: 5000 }));
      const { unmatched } = funding.confirm({ provider: 'statement', providerRef: 'BANK-991', reference: request.reference, amount: 5000, currency: 'KES' });
      expect(unmatched?.reason).toMatch(/already paid via sandbox/);
      expect(credited).toHaveLength(1);
    });
  });

  describe('a confirmed payment that comes back', () => {
    it('is reversed by its own mirror, never by unwinding the first', () => {
      const request = ask(5000);
      funding.confirm(railSays({ providerRef: 'RJ84K2LMN0', reference: request.reference, amount: 5000 }));
      const done = funding.reverse(request.fundingId, 'recalled by the sender');
      expect(done.status).toBe('reversed');
      expect(done.reversalEntryId).toBe('je_rev_1');
      expect(done.entryId).toBe('je_1'); // the entry that created it still stands
      expect(reversed).toEqual([{ payerDid: 'did:shop:njeri', gross: 5000 }]);
    });

    it('refuses to reverse something that never arrived', () => {
      expect(() => funding.reverse(ask().fundingId, 'nope')).toThrow(/only a confirmed one can be reversed/);
    });
  });

  describe('the callback door', () => {
    const signed = (amount = 5000) => rail.simulate({ providerRef: 'RJ84K2LMN0', reference: 'SBG-AAAA-BBBB', amount, currency: 'KES' });

    it('accepts what it signed itself', () => {
      const { headers, body } = signed();
      expect(rail.verify(headers, body).amount).toBe(5000);
    });

    it('refuses an unsigned confirmation', () => {
      const { body } = signed();
      expect(() => rail.verify({}, body)).toThrow(/not signed/);
    });

    it('refuses a confirmation whose amount was changed after signing', () => {
      // The whole point: a body anybody can edit is a body anybody can create money with.
      const { headers, body } = signed(5000);
      expect(() => rail.verify(headers, { ...body, amount: 500000 })).toThrow(/not signed by the payment provider/);
    });

    it('refuses a confirmation replayed later', () => {
      const { headers, body } = signed();
      expect(() => rail.verify({ ...headers, 'x-sbg-timestamp': String(Date.now() - 60 * 60 * 1000) }, body)).toThrow(/too old/);
    });

    it('refuses a confirmation that does not say what was paid', () => {
      const { headers, body } = signed();
      expect(() => rail.verify(headers, { ...body, providerRef: '' })).toThrow(/provider’s own reference/);
    });
  });
});
