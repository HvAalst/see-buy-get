import { Test } from '@nestjs/testing';
import { FundingService } from './funding.service';
import { SandboxFundingRail } from './sandbox-funding-rail.adapter';
import { FUNDING_RAIL, FundingPayer, FundingRail, RailPayment } from './funding.types';

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
/**
 * 2026-11-01 — A PAYBILL PAYMENT CHECKED BEFORE IT IS CREDITED. Its notice proves where it came from and nothing more, so
 * where the rail can ask M-Pesa, the money is held and asked about; M-Pesa's agreeing answer credits it, with no person in
 * the loop; a person reading the statement decides only the ones M-Pesa would not confirm.
 */
describe('a paybill payment checked before it is credited', () => {
  let funding: FundingService;
  let credited: Array<{ payerDid: string; gross: number }>;
  let asked: RailPayment[];
  let askAnswer: () => Promise<{ askedRef: string }>;
  const rail: FundingRail = {
    provider: 'mpesa',
    open: async () => ({ reference: 'SBG-QNTS-QP5D', instructions: 'Paybill 174379, account SBG-QNTS-QP5D' }),
    verify: async () => {
      throw new Error('not used');
    },
    canAsk: () => true,
    askAbout: async (payment) => {
      asked.push(payment);
      return askAnswer();
    },
  };
  const paybill = (over: Partial<RailPayment> = {}): RailPayment => ({ provider: 'mpesa', providerRef: 'RKTQDM7W6S', reference: 'SBGQNTSQP5D', amount: 400, currency: 'KES', uncorroborated: true, ...over });

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({ providers: [FundingService, { provide: FUNDING_RAIL, useValue: rail }] }).compile();
    funding = moduleRef.get(FundingService);
    credited = [];
    asked = [];
    askAnswer = async () => ({ askedRef: 'AG_1' });
    funding.register('agent', {
      resolve: () => ({ entityId: 'ent_ke', currency: 'KES', label: 'Mama Njeri Shop' }),
      credit: (payerDid, c) => {
        credited.push({ payerDid, gross: c.gross });
        return { entryId: `je_${credited.length}` };
      },
      reverse: () => ({ entryId: 'je_rev' }),
    });
  });

  it('holds it and asks M-Pesa — credits nobody — and the shop is told it is being checked, not still awaited', async () => {
    const request = await funding.open({ payerKind: 'agent', payerDid: 'did:shop:njeri', amount: 400 });
    const r = funding.receive(paybill());
    expect(r.held).toBeDefined();
    await r.asked;
    expect(credited).toHaveLength(0);
    expect(asked.map((p) => p.providerRef)).toEqual(['RKTQDM7W6S']);
    expect(funding.get(request.fundingId)).toEqual(expect.objectContaining({ status: 'awaiting', checking: expect.objectContaining({ amount: 400, providerRef: 'RKTQDM7W6S' }) }));
    expect(funding.heldPayments()[0]).toEqual(expect.objectContaining({ askedRef: 'AG_1', fundingId: request.fundingId }));
    // M-Pesa retrying its notice is the same payment, not a second question
    expect(funding.receive(paybill()).duplicate).toBe(true);
    expect(asked).toHaveLength(1);
  });

  it('credits it when M-Pesa’s answer agrees — by M-Pesa, no person — and only once', async () => {
    const request = await funding.open({ payerKind: 'agent', payerDid: 'did:shop:njeri', amount: 400 });
    await funding.receive(paybill()).asked;
    const done = funding.answer({ askedRef: 'AG_1', paid: true, providerRef: 'RKTQDM7W6S', amount: 400, words: 'Completed' });
    expect(done).toEqual(expect.objectContaining({ outcome: 'credited', decidedBy: 'M-Pesa', creditedTo: { fundingId: request.fundingId } }));
    expect(credited).toEqual([{ payerDid: 'did:shop:njeri', gross: 400 }]);
    expect(funding.get(request.fundingId)).toEqual(expect.objectContaining({ status: 'confirmed', confirmedAmount: 400 }));
    expect(funding.get(request.fundingId).checking).toBeUndefined();
    // the same answer again, and the notice again: nothing more
    expect(funding.answer({ askedRef: 'AG_1', paid: true, providerRef: 'RKTQDM7W6S', amount: 400, words: 'Completed' })).toBeNull();
    expect(funding.receive(paybill()).duplicate).toBe(true);
    expect(credited).toHaveLength(1);
    expect(funding.heldPayments()).toHaveLength(0);
  });

  it('leaves it for a person when M-Pesa does not agree — and the person who reads the statement credits it in their name', async () => {
    await funding.open({ payerKind: 'agent', payerDid: 'did:shop:njeri', amount: 400 });
    await funding.receive(paybill()).asked;
    expect(funding.answer({ askedRef: 'AG_1', paid: true, providerRef: 'RKTQDM7W6S', amount: 40, words: 'Completed' })?.answer?.words).toMatch(/40 was paid, not 400/);
    expect(funding.answer({ askedRef: 'AG_1', paid: false, words: 'The transaction was not found' })?.answer?.words).toBe('The transaction was not found');
    // an answer to no question of ours credits nothing
    expect(funding.answer({ askedRef: 'AG_nobody', paid: true, providerRef: 'RKTQDM7W6S', amount: 400, words: 'Completed' })).toBeNull();
    expect(credited).toHaveLength(0);
    const held = funding.heldPayments()[0];
    expect(funding.releaseHeld(held.id, 'Wanjiru (money)')).toEqual(expect.objectContaining({ outcome: 'credited', decidedBy: 'Wanjiru (money)' }));
    expect(credited).toEqual([{ payerDid: 'did:shop:njeri', gross: 400 }]);
    expect(() => funding.releaseHeld(held.id, 'Wanjiru (money)')).toThrow(/already credited/);
  });

  it('refuses one not on the statement: nothing credited, the shop’s request waits again, and the notice retried stays refused', async () => {
    const request = await funding.open({ payerKind: 'agent', payerDid: 'did:shop:njeri', amount: 400 });
    await funding.receive(paybill()).asked;
    const held = funding.heldPayments()[0];
    expect(() => funding.refuseHeld(held.id, ' ', 'Wanjiru')).toThrow(/Say why/);
    expect(funding.refuseHeld(held.id, 'Not on the M-Pesa statement for 22 Nov', 'Wanjiru')).toEqual(expect.objectContaining({ outcome: 'refused', refusalReason: 'Not on the M-Pesa statement for 22 Nov' }));
    expect(funding.get(request.fundingId)).toEqual(expect.objectContaining({ status: 'awaiting' }));
    expect(funding.get(request.fundingId).checking).toBeUndefined();
    expect(funding.receive(paybill()).duplicate).toBe(true);
    expect(() => funding.releaseHeld(held.id, 'Wanjiru')).toThrow(/already refused/);
    expect(credited).toHaveLength(0);
  });

  it('keeps it held, with why, when M-Pesa cannot be asked; and a held payment naming no request goes to the unnamed pile when credited', async () => {
    askAnswer = async () => {
      throw new Error('M-Pesa did not answer in time');
    };
    await funding.receive(paybill({ reference: undefined })).asked;
    const held = funding.heldPayments()[0];
    expect(held).toEqual(expect.objectContaining({ askFailed: 'M-Pesa did not answer in time' }));
    expect(held.fundingId).toBeUndefined();
    const out = funding.releaseHeld(held.id, 'Wanjiru');
    expect(out.creditedTo?.unmatchedId).toBeDefined();
    expect(credited).toHaveLength(0); // the unnamed pile is recorded, not posted
  });

  it('credits at once, as before, where the rail cannot ask — and a payment its notice proves (STK) is never held', async () => {
    const plain = await Test.createTestingModule({ providers: [FundingService, { provide: FUNDING_RAIL, useValue: { ...rail, canAsk: () => false } }] }).compile();
    const service = plain.get(FundingService);
    service.register('agent', { resolve: () => ({ entityId: 'ent_ke', currency: 'KES', label: 'Shop' }), credit: () => ({ entryId: 'je_1' }), reverse: () => ({ entryId: 'je_r' }) });
    await service.open({ payerKind: 'agent', payerDid: 'did:shop:njeri', amount: 400 });
    expect(service.receive(paybill()).funding?.status).toBe('confirmed');
    await funding.open({ payerKind: 'agent', payerDid: 'did:shop:njeri', amount: 400 });
    expect(funding.receive(paybill({ uncorroborated: undefined, providerRef: 'STK1' })).funding?.status).toBe('confirmed');
    expect(asked).toHaveLength(0);
  });
});

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
  async function railSays(fields: { providerRef: string; reference?: string; amount: number; fee?: number; currency?: string }): Promise<RailPayment> {
    const { headers, body } = rail.simulate({ currency: 'KES', ...fields });
    return rail.verify(headers, body);
  }

  describe('asking is not paying', () => {
    it('hands back a reference and credits nobody', async () => {
      const request = await ask(5000);
      expect(request.status).toBe('awaiting');
      expect(request.reference).toMatch(/^SBG-/);
      expect(request.entryId).toBeUndefined();
      expect(credited).toEqual([]);
    });

    it('tells the payer how to pay, in the rail’s own words', async () => {
      expect((await ask()).instructions).toContain('5000.00 KES');
    });

    it('refuses to open one where the payer has no account to credit', async () => {
      await expect(ask(5000, 'did:shop:nowhere')).rejects.toThrow(/no sister holds money/);
    });

    it('refuses an amount of nothing', async () => {
      await expect(ask(0)).rejects.toThrow(/greater than zero/);
    });

    it('supersedes an earlier request rather than leaving two live references', async () => {
      const first = await ask(1000);
      await ask(2000);
      expect(funding.get(first.fundingId).status).toBe('expired');
      expect(funding.openFor('did:shop:njeri')?.amount).toBe(2000);
    });
  });

  describe('the rail is the authority', () => {
    it('creates the money only when the rail confirms it', async () => {
      const request = await ask(5000);
      const { funding: done } = funding.confirm(await railSays({ providerRef: 'RJ84K2LMN0', reference: request.reference, amount: 5000 }));
      expect(done?.status).toBe('confirmed');
      expect(done?.entryId).toBe('je_1');
      expect(credited).toEqual([{ payerDid: 'did:shop:njeri', gross: 5000, fee: 0, reference: 'RJ84K2LMN0' }]);
    });

    it('credits what ARRIVED, not what was asked for', async () => {
      // The trap this rule exists for: ask for 5,000, pay 500. The books must move by 500.
      const request = await ask(5000);
      const { funding: done } = funding.confirm(await railSays({ providerRef: 'RJ84K2LMN0', reference: request.reference, amount: 500 }));
      expect(credited[0].gross).toBe(500);
      expect(done?.confirmedAmount).toBe(500);
      // …and what they asked for is kept beside it, because a half-paid request is a thing somebody rings up about.
      expect(done?.amount).toBe(5000);
    });

    it('passes the provider’s fee through as ours, and credits the payer the gross', async () => {
      const request = await ask(5000);
      funding.confirm(await railSays({ providerRef: 'RJ84K2LMN0', reference: request.reference, amount: 5000, fee: 75 }));
      expect(credited[0]).toMatchObject({ gross: 5000, fee: 75 });
    });

    it('credits once when a provider retries its callback', async () => {
      const request = await ask(5000);
      const payment = await railSays({ providerRef: 'RJ84K2LMN0', reference: request.reference, amount: 5000 });
      funding.confirm(payment);
      const second = funding.confirm(payment);
      expect(second.duplicate).toBe(true);
      expect(credited).toHaveLength(1);
    });

    it('takes the money even when we had given up on the request', async () => {
      // Our bookkeeping state does not get a vote on whether the money came. It came.
      const request = await ask(5000);
      funding.expire(request.fundingId, 'nobody paid it');
      funding.confirm(await railSays({ providerRef: 'RJ84K2LMN0', reference: request.reference, amount: 5000 }));
      expect(funding.get(request.fundingId).status).toBe('confirmed');
      expect(credited).toHaveLength(1);
    });

    it('credits a second, separate payment on the same reference from the same rail', async () => {
      const request = await ask(5000);
      funding.confirm(await railSays({ providerRef: 'RJ84K2LMN0', reference: request.reference, amount: 5000 }));
      funding.confirm(await railSays({ providerRef: 'RJ84K2LMN1', reference: request.reference, amount: 5000 }));
      expect(credited).toHaveLength(2);
    });
  });

  describe('money we cannot put a name to', () => {
    it('records a payment quoting no reference, and posts nothing', async () => {
      const { unmatched } = funding.confirm(await railSays({ providerRef: 'RJ84K2LMN0', amount: 5000 }));
      expect(unmatched?.reason).toMatch(/quoted no reference/);
      expect(credited).toEqual([]);
      expect(funding.unmatchedPayments()).toHaveLength(1);
    });

    it('records a payment quoting a reference nobody is waiting on', async () => {
      const { unmatched } = funding.confirm(await railSays({ providerRef: 'RJ84K2LMN0', reference: 'SBG-ZZZZ-ZZZZ', amount: 5000 }));
      expect(unmatched?.reason).toMatch(/no request is open/);
      expect(credited).toEqual([]);
    });

    it('does not record the same unattributable payment twice', async () => {
      const payment = await railSays({ providerRef: 'RJ84K2LMN0', amount: 5000 });
      funding.confirm(payment);
      expect(funding.confirm(payment).duplicate).toBe(true);
      expect(funding.unmatchedPayments()).toHaveLength(1);
    });

    it('matches the reference as the payer actually typed it', async () => {
      /*
       * We print SBG-QNTS-QP5D; a paybill customer types it on a phone keypad and we get SBGQNTSQP5D, or
       * it lower-cased, or with a space in it. Those are the same string written differently — and the
       * only recovery from a miss is somebody ringing the shop.
       */
      const request = await ask(5000);
      const typed = request.reference.replace(/-/g, '').toLowerCase();
      funding.confirm(await railSays({ providerRef: 'RJ84K2LMN0', reference: typed, amount: 5000 }));
      expect(funding.get(request.fundingId).status).toBe('confirmed');
      expect(credited).toHaveLength(1);
    });

    it('still misses a reference with a wrong CHARACTER in it, rather than guessing', async () => {
      // Forgiving about how it was written, never about what it says: a nearest match credits the wrong shop.
      const request = await ask(5000);
      const wrong = `${request.reference.slice(0, -1)}${request.reference.endsWith('2') ? '3' : '2'}`;
      const { unmatched } = funding.confirm(await railSays({ providerRef: 'RJ84K2LMN0', reference: wrong, amount: 5000 }));
      expect(unmatched).toBeTruthy();
      expect(credited).toEqual([]);
    });

    it('holds a payment made in a currency the account is not kept in', async () => {
      // The rail decides the amount; it does not decide what that amount is denominated in. Crediting
      // "500" from a USD callback into a KES deposit is a balance denominated in nothing.
      const request = await ask(5000);
      const { unmatched } = funding.confirm({ provider: 'sandbox', providerRef: 'RJ84K2LMN9', reference: request.reference, amount: 500, currency: 'USD' });
      expect(unmatched?.reason).toMatch(/paid in USD against a request in KES/);
      expect(credited).toEqual([]);
      // …and the request is left alone, still waiting for the payment that was actually asked for.
      expect(funding.get(request.fundingId).status).toBe('awaiting');
    });

    it('holds a reference already paid by ANOTHER rail rather than crediting it twice', async () => {
      // An operator typing in a statement line for a payment the mobile-money callback already confirmed
      // is far likelier than the same shop paying the same reference on two different rails.
      const request = await ask(5000);
      funding.confirm(await railSays({ providerRef: 'RJ84K2LMN0', reference: request.reference, amount: 5000 }));
      const { unmatched } = funding.confirm({ provider: 'statement', providerRef: 'BANK-991', reference: request.reference, amount: 5000, currency: 'KES' });
      expect(unmatched?.reason).toMatch(/already paid via sandbox/);
      expect(credited).toHaveLength(1);
    });
  });

  describe('saying whose an unattributed payment was', () => {
    /** Money in the account with nobody's name on it — the state an operator has to get out of. */
    const orphan = async (amount = 400, currency = 'KES') => funding.confirm(await railSays({ providerRef: `MPX${amount}`, amount, currency })).unmatched!;

    it('credits it through the same path a matched payment takes', async () => {
      // The books must not be able to tell the two apart — one crediting path, never two.
      const held = await orphan(400);
      const { funding: made } = funding.apply(held.id, { payerKind: 'agent', payerDid: 'did:shop:njeri' }, 'Amina Otieno');
      expect(credited).toEqual([{ payerDid: 'did:shop:njeri', gross: 400, fee: 0, reference: 'MPX400' }]);
      expect(made.status).toBe('confirmed');
      expect(made.providerRef).toBe('MPX400');
      expect(made.payerName).toBe('Mama Njeri Shop');
    });

    it('keeps who decided, and when — because this was a judgement', async () => {
      const held = await orphan(400);
      funding.apply(held.id, { payerKind: 'agent', payerDid: 'did:shop:njeri' }, 'Amina Otieno');
      const [record] = funding.unmatchedPayments(true);
      expect(record.appliedBy).toBe('Amina Otieno');
      expect(record.appliedAt).toBeTruthy();
      expect(record.appliedTo).toBeTruthy();
    });

    it('takes it off the chase list, without deleting the record', async () => {
      const held = await orphan(400);
      funding.apply(held.id, { payerKind: 'agent', payerDid: 'did:shop:njeri' }, 'Amina');
      expect(funding.unmatchedPayments()).toHaveLength(0);
      expect(funding.unmatchedPayments(true)).toHaveLength(1);
    });

    it('refuses to apply the same payment twice', async () => {
      // It arrived once. Applying it twice credits a shop twice, and it is the easiest mistake on the
      // whole screen to make — two operators, one phone call, one list.
      const held = await orphan(400);
      funding.apply(held.id, { payerKind: 'agent', payerDid: 'did:shop:njeri' }, 'Amina');
      expect(() => funding.apply(held.id, { payerKind: 'agent', payerDid: 'did:shop:njeri' }, 'Brian')).toThrow(/already applied/);
      expect(credited).toHaveLength(1);
    });

    it('refuses a payer with no account to credit', async () => {
      const held = await orphan(400);
      expect(() => funding.apply(held.id, { payerKind: 'agent', payerDid: 'did:shop:nowhere' }, 'Amina')).toThrow(/no sister holds money/);
    });

    it('refuses to apply a payment in another currency, rather than converting it', async () => {
      const held = await orphan(400, 'USD');
      expect(() => funding.apply(held.id, { payerKind: 'agent', payerDid: 'did:shop:njeri' }, 'Amina')).toThrow(/invent an exchange rate/);
      expect(credited).toEqual([]);
    });
  });

  describe('a confirmed payment that comes back', () => {
    it('is reversed by its own mirror, never by unwinding the first', async () => {
      const request = await ask(5000);
      funding.confirm(await railSays({ providerRef: 'RJ84K2LMN0', reference: request.reference, amount: 5000 }));
      const done = funding.reverse(request.fundingId, 'recalled by the sender');
      expect(done.status).toBe('reversed');
      expect(done.reversalEntryId).toBe('je_rev_1');
      expect(done.entryId).toBe('je_1'); // the entry that created it still stands
      expect(reversed).toEqual([{ payerDid: 'did:shop:njeri', gross: 5000 }]);
    });

    it('refuses to reverse something that never arrived', async () => {
      const unpaid = await await ask();
      expect(() => funding.reverse(unpaid.fundingId, 'nope')).toThrow(/only a confirmed one can be reversed/);
    });
  });

  describe('the callback door', () => {
    const signed = (amount = 5000) => rail.simulate({ providerRef: 'RJ84K2LMN0', reference: 'SBG-AAAA-BBBB', amount, currency: 'KES' });

    it('accepts what it signed itself', async () => {
      const { headers, body } = signed();
      expect((await rail.verify(headers, body)).amount).toBe(5000);
    });

    it('refuses an unsigned confirmation', async () => {
      const { body } = signed();
      await expect(rail.verify({}, body)).rejects.toThrow(/not signed/);
    });

    it('refuses a confirmation whose amount was changed after signing', async () => {
      // The whole point: a body anybody can edit is a body anybody can create money with.
      const { headers, body } = signed(5000);
      await expect(rail.verify(headers, { ...body, amount: 500000 })).rejects.toThrow(/not signed by the payment provider/);
    });

    it('refuses a confirmation replayed later', async () => {
      const { headers, body } = signed();
      await expect(rail.verify({ ...headers, 'x-sbg-timestamp': String(Date.now() - 60 * 60 * 1000) }, body)).rejects.toThrow(/too old/);
    });

    it('refuses a confirmation that does not say what was paid', async () => {
      const { headers, body } = signed();
      await expect(rail.verify(headers, { ...body, providerRef: '' })).rejects.toThrow(/provider’s own reference/);
    });
  });
});
