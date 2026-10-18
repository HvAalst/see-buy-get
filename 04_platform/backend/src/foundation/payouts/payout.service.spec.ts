import { Test } from '@nestjs/testing';
import { PayoutService } from './payout.service';
import { SandboxPayoutRail } from './sandbox-rail.adapter';
import { PAYOUT_RAIL, type PayoutInstruction, type RailOutcome } from './payout.types';
import { BooksService } from '../books/books.service';
import { ACCOUNT_CODES } from '../books/books.types';
import { EntityService } from '../entity/entity.service';
import { DidService } from '../did/did.service';
import { LedgerService } from '../ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../ledger/ledger.types';
import { EventBus } from '../events/event-bus.service';

/**
 * Paying the people the network owes — the half of the money model that never existed.
 *
 * The books have accrued what a sister owes a fleet, a courier or a hub since the postings were wired,
 * and nothing ever drew one down: the payable simply grew. For an independent courier whose cash-flow
 * horizon is measured in hours, that is not an accounting detail — it decides whether the work was worth
 * taking at all.
 *
 * These tests are mostly about the two rules that make it honest rather than merely convenient. Money
 * leaves ONLY when a rail says it left, so requesting and submitting move nothing. And a run cannot
 * promise cash the sister does not hold, because the alternative is spending the shops' float on the
 * drivers and finding out at the counter.
 */
describe('paying providers', () => {
  let payouts: PayoutService;
  let books: BooksService;
  let entities: EntityService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        PayoutService,
        BooksService,
        EntityService,
        DidService,
        LedgerService,
        EventBus,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        SandboxPayoutRail,
        { provide: PAYOUT_RAIL, useExisting: SandboxPayoutRail },
      ],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed(); // compile() runs no lifecycle hooks — the sisters are seeded by hand, as at boot
    books = moduleRef.get(BooksService);
    books.reset();
    payouts = moduleRef.get(PayoutService);
  });

  const ke = () => entities.requireForJurisdiction('KE').entityId;

  /** Work done and not yet paid for: an expense recognised, a payable raised. */
  function owe(payeeDid: string, amount: number) {
    books.post({
      entityId: ke(),
      kind: 'driver-payout',
      ref: payeeDid,
      lines: [
        { code: ACCOUNT_CODES.EXPENSE_PROVIDER_FEES, amount },
        { code: ACCOUNT_CODES.PAYABLE_PROVIDER, counterparty: payeeDid, amount: -amount },
      ],
    });
  }

  /** Real money in the account — a shop's top-up is what actually puts cash in custody. */
  function fund(amount: number) {
    books.post({
      entityId: ke(),
      kind: 'top-up',
      ref: 'funding',
      lines: [
        { code: ACCOUNT_CODES.CASH_CUSTODY, amount },
        { code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: 'did:glos:shop', amount: -amount },
      ],
    });
  }

  const owedTo = (payeeDid: string) => -books.balance(ke(), ACCOUNT_CODES.PAYABLE_PROVIDER, undefined, payeeDid) || 0;
  const held = () => books.coverage(ke()).held;

  describe('two people', () => {
    it('is approved to the rail by a different member of staff from the one who raised it', () => {
      fund(1000);
      owe('did:glos:courier-a', 40);
      const amina = { name: 'Amina O', key: 'opr_amina' };
      const [p] = payouts.runFor(ke(), Date.now(), amina).raised;
      expect(p.requestedBy).toEqual({ name: 'Amina O', key: 'opr_amina' });
      // The one who raised it cannot send it — refused before anything moves.
      expect(() => payouts.submit(p.payoutId, Date.now(), amina)).toThrow(/second member of staff/);
      expect(payouts.get(p.payoutId).status).toBe('requested');
      // Two accounts are two people whatever they are called; one account is one person whatever it is called.
      expect(() => payouts.submit(p.payoutId, Date.now(), { name: 'Amina (desk 2)', key: 'opr_amina' })).toThrow(/second member of staff/);
      const sent = payouts.submit(p.payoutId, Date.now(), { name: 'Amina O', key: 'opr_other_amina' });
      expect(sent).toMatchObject({ status: 'submitted', approvedBy: { name: 'Amina O', key: 'opr_other_amina' } });
    });

    it('tells two typed names apart only by the name, case and spacing aside, where there is no account to go by', () => {
      fund(1000);
      owe('did:glos:courier-a', 40);
      const [p] = payouts.runFor(ke(), Date.now(), { name: 'Otieno', key: 'typed:Otieno' }).raised;
      expect(() => payouts.submit(p.payoutId, Date.now(), { name: ' otieno ', key: 'typed: otieno ' })).toThrow(/second member of staff/);
      expect(payouts.submit(p.payoutId, Date.now(), { name: 'Wanjiru', key: 'typed:Wanjiru' }).approvedBy?.name).toBe('Wanjiru');
    });
  });

  describe('the run', () => {
    it('raises one payout for everybody owed', () => {
      fund(1000);
      owe('did:glos:courier-a', 40);
      owe('did:glos:fleet-b', 25);

      const run = payouts.runFor(ke());
      expect(run.raised.map((p) => [p.payeeDid, p.amount, p.status])).toEqual([
        ['did:glos:courier-a', 40, 'requested'],
        ['did:glos:fleet-b', 25, 'requested'],
      ]);
    });

    it('pays one day of work once, however many times it runs', () => {
      // A retry, an overlapping cron, two operators pressing the same button. Same-day settlement is a
      // promise about WHEN, so the day is the natural key — a batch id is a thing nobody can reason about
      // at the moment they are wondering whether to press it again.
      fund(1000);
      owe('did:glos:courier-a', 40);
      expect(payouts.runFor(ke()).raised).toHaveLength(1);
      const second = payouts.runFor(ke());
      expect(second.raised).toHaveLength(0);
      expect(second.skipped).toEqual([{ payeeDid: 'did:glos:courier-a', reason: 'already settled today' }]);
    });

    it('never raises a second payment beside one still on its way', () => {
      // A payment we handed over and have not heard back about might still land. Raising another next to
      // it is how somebody gets paid twice for one day.
      fund(1000);
      owe('did:glos:courier-a', 40);
      const [first] = payouts.runFor(ke()).raised;
      payouts.submit(first.payoutId);
      owe('did:glos:courier-a', 10); // more work, same payee, same day
      expect(payouts.runFor(ke()).skipped[0].reason).toMatch(/already/);
    });

    it('will not promise cash the sister does not hold, and says so', () => {
      // The rule that stops a settlement run spending the shops' float on the drivers. Skipped whole and
      // stated rather than trimmed: a part-payment nobody asked for reads as a wrong amount, not as short
      // cash, and the driver goes looking for the missing half instead of asking when the rest arrives.
      fund(30);
      owe('did:glos:courier-a', 40);
      const run = payouts.runFor(ke());
      expect(run.raised).toHaveLength(0);
      expect(run.skipped).toEqual([{ payeeDid: 'did:glos:courier-a', reason: 'not enough cash held to cover it' }]);
    });

    it('does not promise the same shilling to two people', () => {
      // The cash is read once for the whole run and drawn down as it commits. Without that, three payees
      // each pass a check against the same balance and the third payment bounces at the rail.
      fund(50);
      owe('did:glos:courier-a', 40);
      owe('did:glos:fleet-b', 30);
      const run = payouts.runFor(ke());
      expect(run.raised.map((p) => p.payeeDid)).toEqual(['did:glos:courier-a']);
      expect(run.skipped.map((s) => s.payeeDid)).toEqual(['did:glos:fleet-b']);
    });

    it('leaves alone a payee who is owed nothing', () => {
      // An account opened and settled back to zero is not somebody waiting for money.
      fund(1000);
      owe('did:glos:courier-a', 40);
      const [p] = payouts.runFor(ke()).raised;
      payouts.settle(payouts.submit(p.payoutId).payoutId);
      expect(owedTo('did:glos:courier-a')).toBe(0);
      // A fresh day, nothing new earned: nobody to pay.
      expect(payouts.runFor(ke(), Date.parse('2030-01-01T09:00:00.000Z')).raised).toHaveLength(0);
    });
  });

  describe('money leaves only when a rail says it left', () => {
    it('moves nothing at all while it is merely requested', () => {
      fund(1000);
      owe('did:glos:courier-a', 40);
      const before = held();
      const [p] = payouts.runFor(ke()).raised;
      expect(held()).toBe(before);
      expect(owedTo('did:glos:courier-a')).toBe(40);
      expect(p.entryId).toBeUndefined(); // nothing to point at, because nothing happened
    });

    it('moves nothing when it is handed to the rail either', () => {
      // Submitting is a handover, not a payment. The sandbox rail cannot settle anything — deliberately,
      // because a stub that returns "paid" teaches every screen above it that money moves instantly.
      fund(1000);
      owe('did:glos:courier-a', 40);
      const before = held();
      const submitted = payouts.submit(payouts.runFor(ke()).raised[0].payoutId);
      expect(submitted.status).toBe('submitted');
      expect(submitted.providerRef).toMatch(/^SBX/); // a reference for the attempt, and only that
      expect(held()).toBe(before);
      expect(owedTo('did:glos:courier-a')).toBe(40);
    });

    it('moves the money when the rail confirms, and only then', () => {
      fund(1000);
      owe('did:glos:courier-a', 40);
      const p = payouts.submit(payouts.runFor(ke()).raised[0].payoutId);
      const settled = payouts.settle(p.payoutId, 'MPESA-QWE123');

      expect(settled.status).toBe('settled');
      expect(settled.entryId).toBeDefined();
      expect(settled.providerRef).toBe('MPESA-QWE123'); // the thing you quote when somebody says they were not paid
      // Less cash, and less owed — which is what paying somebody actually is.
      expect(held()).toBe(960);
      expect(owedTo('did:glos:courier-a')).toBe(0);
    });

    it('does not pay twice when a rail confirms twice', () => {
      fund(1000);
      owe('did:glos:courier-a', 40);
      const p = payouts.submit(payouts.runFor(ke()).raised[0].payoutId);
      payouts.settle(p.payoutId);
      payouts.settle(p.payoutId); // a callback that arrives again, as they do
      expect(held()).toBe(960);
    });

    it('refuses to settle something never handed over', () => {
      fund(1000);
      owe('did:glos:courier-a', 40);
      const [p] = payouts.runFor(ke()).raised;
      expect(() => payouts.settle(p.payoutId)).toThrow(/only a submitted payout can settle/);
    });
  });

  describe('when it does not go', () => {
    it('leaves the money owed, because it still is', () => {
      fund(1000);
      owe('did:glos:courier-a', 40);
      const p = payouts.submit(payouts.runFor(ke()).raised[0].payoutId);
      const failed = payouts.fail(p.payoutId, 'wrong number');

      expect(failed.status).toBe('failed');
      expect(failed.failureReason).toBe('wrong number');
      expect(held()).toBe(1000);
      expect(owedTo('did:glos:courier-a')).toBe(40);
    });

    it('lets the next run try again — a failure is not a settled day', () => {
      // The reason `paidToday` counts settled and in-flight but not failed. Somebody whose payment bounced
      // this morning is exactly who a second run exists for.
      fund(1000);
      owe('did:glos:courier-a', 40);
      const p = payouts.submit(payouts.runFor(ke()).raised[0].payoutId);
      payouts.fail(p.payoutId, 'wrong number');
      expect(payouts.runFor(ke()).raised).toHaveLength(1);
    });
  });

  describe('when it goes and comes back', () => {
    it('reverses with its own entry rather than by unwinding the first', () => {
      // The money did leave and did come back. A book showing neither cannot be reconciled against a bank
      // statement showing both, and a deleted payment is a conversation nobody can have afterwards.
      fund(1000);
      owe('did:glos:courier-a', 40);
      const p = payouts.submit(payouts.runFor(ke()).raised[0].payoutId);
      payouts.settle(p.payoutId);
      const reversed = payouts.reverse(p.payoutId, 'account closed');

      expect(reversed.status).toBe('reversed');
      expect(reversed.entryId).toBeDefined(); // the payment is still there…
      expect(reversed.reversalEntryId).toBeDefined(); // …and so is its return
      expect(reversed.reversalEntryId).not.toBe(reversed.entryId);
      expect(held()).toBe(1000);
      expect(owedTo('did:glos:courier-a')).toBe(40); // owed again, which is true
    });

    it('refuses to reverse something that never settled', () => {
      fund(1000);
      owe('did:glos:courier-a', 40);
      const [p] = payouts.runFor(ke()).raised;
      expect(() => payouts.reverse(p.payoutId, 'nope')).toThrow(/only a settled payout can be reversed/);
    });
  });

  describe('what a payee can be told', () => {
    it('separates what has landed from what is on its way', () => {
      // The two questions somebody waiting for money actually asks, and they have different answers.
      fund(1000);
      owe('did:glos:courier-a', 40);
      const first = payouts.submit(payouts.runFor(ke()).raised[0].payoutId);
      payouts.settle(first.payoutId);

      owe('did:glos:courier-a', 15);
      const second = payouts.runFor(ke(), Date.parse('2030-01-02T09:00:00.000Z')).raised[0];
      payouts.submit(second.payoutId);

      expect(payouts.forPayee('did:glos:courier-a')).toMatchObject({ settled: 40, inFlight: 15 });
    });
  });

  describe('where it goes (the user, 2026-10-18: a number the payee set, where the country pays by M-Pesa)', () => {
    /** Payees' numbers as a payee's own Settings would have them: one each, a fresh id per change, held after a change. */
    function numbers() {
      const kept = new Map<string, { numberId: string; masked: string; heldUntil?: number }>();
      payouts.registerDestinations({
        of: (payeeId, _way, now) => {
          const n = kept.get(payeeId);
          if (!n) return { reason: 'no payout number yet: the payee sets it in Settings' };
          if (n.heldUntil && n.heldUntil > now) return { reason: 'the payout number was changed' };
          return { numberId: n.numberId, masked: n.masked };
        },
        full: () => undefined,
      });
      return kept;
    }

    it('skips a payee with no number, and raises the rest to the number each set', () => {
      fund(1000);
      owe('did:glos:courier-a', 40);
      owe('did:glos:courier-b', 30);
      numbers().set('did:glos:courier-b', { numberId: 'pn_b1', masked: '254712***678' });
      const run = payouts.runFor(ke(), Date.now(), { name: 'Amina O' });
      expect(run.skipped).toEqual([{ payeeDid: 'did:glos:courier-a', reason: 'no payout number yet: the payee sets it in Settings' }]);
      expect(run.raised.map((p) => [p.payeeDid, p.way, p.destination])).toEqual([['did:glos:courier-b', 'mpesa', { numberId: 'pn_b1', masked: '254712***678' }]]);
      // Nothing set aside for the payee who could not be paid: the cash stays for whoever can.
      expect(held()).toBe(1000);
    });

    it('never sends a payout to a number other than the one it was raised to, nor to one paused after a change', () => {
      fund(1000);
      owe('did:glos:courier-b', 30);
      const kept = numbers();
      kept.set('did:glos:courier-b', { numberId: 'pn_b1', masked: '254712***678' });
      const [p] = payouts.runFor(ke(), Date.now(), { name: 'Amina O' }).raised;
      kept.set('did:glos:courier-b', { numberId: 'pn_b2', masked: '254799***111', heldUntil: Date.now() + 86_400_000 });
      expect(() => payouts.submit(p.payoutId, Date.now(), { name: 'Brian K' })).toThrow(/Not sent: the payout number was changed/);
      kept.set('did:glos:courier-b', { numberId: 'pn_b2', masked: '254799***111' });
      expect(() => payouts.submit(p.payoutId, Date.now(), { name: 'Brian K' })).toThrow(/changed after this payout was raised/);
      expect(payouts.get(p.payoutId).status).toBe('requested');
    });

    it('asks no number of a payee in a country that pays by hand', () => {
      const et = entities.requireForJurisdiction('ET').entityId;
      numbers();
      books.post({ entityId: et, kind: 'top-up', ref: 'funding', lines: [{ code: ACCOUNT_CODES.CASH_CUSTODY, amount: 500 }, { code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: 'did:glos:shop', amount: -500 }] });
      books.post({ entityId: et, kind: 'driver-payout', ref: 'x', lines: [{ code: ACCOUNT_CODES.EXPENSE_PROVIDER_FEES, amount: 20 }, { code: ACCOUNT_CODES.PAYABLE_PROVIDER, counterparty: 'did:glos:et-courier', amount: -20 }] });
      const [p] = payouts.runFor(et, Date.now(), { name: 'Amina O' }).raised;
      expect(p).toMatchObject({ payeeDid: 'did:glos:et-courier', way: 'by_hand' });
      expect(p.destination).toBeUndefined();
    });
  });

  describe('by M-Pesa, through a live rail (Kenya’s way)', () => {
    /** A rail whose answer the test gives when it chooses: the network is never this prompt. */
    function liveRail() {
      let answer!: (o: RailOutcome) => void;
      const sent: PayoutInstruction[] = [];
      const rail = {
        submit: (i: PayoutInstruction) => {
          sent.push(i);
          return new Promise<RailOutcome>((resolve) => (answer = resolve));
        },
      };
      const live = new PayoutService(books, entities, new SandboxPayoutRail(), rail as never);
      live.registerDestinations({
        of: () => ({ numberId: 'pn_1', masked: '254712***678' }),
        full: (_payee, numberId) => (numberId === 'pn_1' ? '254712345678' : undefined),
      });
      return { live, sent, answer: (o: RailOutcome) => answer(o) };
    }
    const amina = { name: 'Amina O', key: 'opr_amina' };
    const brian = { name: 'Brian K', key: 'opr_brian' };

    it('raises whole shillings — the cents stay owed — and claims the payout before the rail is asked', async () => {
      fund(1000);
      owe('did:glos:courier-a', 40.5);
      const { live, sent, answer } = liveRail();
      const [p] = live.runFor(ke(), Date.now(), amina).raised;
      expect(p.amount).toBe(40);
      live.submit(p.payoutId, Date.now(), brian);
      // On its way while the rail has not answered: a second approval finds nothing to send.
      expect(live.get(p.payoutId).status).toBe('submitted');
      expect(() => live.submit(p.payoutId, Date.now(), { name: 'Otieno', key: 'opr_otieno' })).toThrow(/only a requested payout/);
      expect(sent).toEqual([{ payoutId: p.payoutId, payeeDid: 'did:glos:courier-a', amount: 40, currency: 'KES', msisdn: '254712345678' }]);
      answer({ taken: true, railRef: 'orig-1', providerRef: 'AG_1' });
      expect(await live.handedOver(p.payoutId)).toMatchObject({ status: 'submitted', railRef: 'orig-1', providerRef: 'AG_1' });
      expect(JSON.stringify(live.get(p.payoutId))).not.toContain('254712345678');
    });

    it('fails a payout the rail refused, and keeps one it could not tell on its way, said', async () => {
      fund(1000);
      owe('did:glos:courier-a', 40);
      owe('did:glos:courier-b', 30);
      const a = liveRail();
      const [pa, pb] = a.live.runFor(ke(), Date.now(), amina).raised;
      a.live.submit(pa.payoutId, Date.now(), brian);
      a.answer({ taken: false, refused: 'Bad Request - Invalid PartyB' });
      expect(await a.live.handedOver(pa.payoutId)).toMatchObject({ status: 'failed', failureReason: 'Bad Request - Invalid PartyB' });
      a.live.submit(pb.payoutId, Date.now(), brian);
      a.answer({ taken: 'unknown', railRef: 'orig-2', why: 'M-Pesa did not answer. The payment may have gone.' });
      expect(await a.live.handedOver(pb.payoutId)).toMatchObject({ status: 'submitted', railRef: 'orig-2', railNote: expect.stringMatching(/may have gone/) });
    });

    it('settles on M-Pesa’s word — even after staff marked it failed, and says so — and fails on its refusal', async () => {
      fund(1000);
      owe('did:glos:courier-a', 40);
      const { live, answer } = liveRail();
      const [p] = live.runFor(ke(), Date.now(), amina).raised;
      live.submit(p.payoutId, Date.now(), brian);
      answer({ taken: true, railRef: 'orig-1' });
      await live.handedOver(p.payoutId);
      expect(live.fromRail({ payoutId: p.payoutId, repeat: true }).status).toBe('submitted');
      live.fromRail({ payoutId: p.payoutId, unsure: 'M-Pesa’s queue timed out on this payment.' });
      // Staff may fail it once M-Pesa said it could not tell; then M-Pesa pays after all: the books say so.
      live.failByHand(p.payoutId, 'portal shows nothing');
      const late = live.fromRail({ payoutId: p.payoutId, paid: true, receipt: 'NLJ41HAY6Q' });
      expect(late).toMatchObject({ status: 'settled', providerRef: 'NLJ41HAY6Q', railNote: expect.stringMatching(/after it was marked failed/) });
      expect(owedTo('did:glos:courier-a')).toBe(0);
      expect(held()).toBe(960);
      // A refusal after it settled changes nothing.
      expect(live.fromRail({ payoutId: p.payoutId, paid: false, reason: 'late noise' }).status).toBe('settled');
    });

    it('lets staff fail a payout M-Pesa is working on only once M-Pesa could not tell, or a day has passed — and settle it only with M-Pesa’s receipt', async () => {
      fund(1000);
      owe('did:glos:courier-a', 40);
      const { live, answer } = liveRail();
      const t0 = Date.now();
      const [p] = live.runFor(ke(), t0, amina).raised;
      live.submit(p.payoutId, t0, brian);
      answer({ taken: true, railRef: 'orig-1' });
      await live.handedOver(p.payoutId);
      expect(() => live.failByHand(p.payoutId, 'impatient', t0 + 60_000)).toThrow(/has not answered this payment yet/);
      expect(() => live.settleByHand(p.payoutId, '  ', t0 + 60_000)).toThrow(/M-Pesa receipt/);
      expect(live.failByHand(p.payoutId, 'no answer for a day; portal shows nothing', t0 + 25 * 3_600_000).status).toBe('failed');
    });

    it('sends nothing to M-Pesa when it is not set up off a sandbox, and stands in for it on one', () => {
      fund(1000);
      owe('did:glos:courier-a', 40);
      const plain = new PayoutService(books, entities, new SandboxPayoutRail(), null);
      const [p] = plain.runFor(ke(), Date.now(), amina).raised;
      const before = process.env.GLOS_ENV;
      process.env.GLOS_ENV = 'production';
      try {
        expect(() => plain.submit(p.payoutId, Date.now(), brian)).toThrow(/not set up on this server/);
        expect(plain.get(p.payoutId).status).toBe('requested');
      } finally {
        if (before === undefined) delete process.env.GLOS_ENV;
        else process.env.GLOS_ENV = before;
      }
      expect(plain.submit(p.payoutId, Date.now(), brian)).toMatchObject({ status: 'submitted', providerRef: expect.stringMatching(/^SBX/) });
    });
  });
});
