import { Test } from '@nestjs/testing';
import { PayoutService } from './payout.service';
import { SandboxPayoutRail } from './sandbox-rail.adapter';
import { PAYOUT_RAIL } from './payout.types';
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
});
