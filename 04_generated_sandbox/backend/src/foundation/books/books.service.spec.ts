import { Test } from '@nestjs/testing';
import { BooksService } from './books.service';
import { ACCOUNT_CODES } from './books.types';
import { EntityService } from '../entity/entity.service';
import { DidService } from '../did/did.service';
import { LedgerService } from '../ledger/ledger.service';
import { LEDGER_ADAPTER } from '../ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../ledger/in-memory-ledger.adapter';
import { EventBus } from '../events/event-bus.service';

describe('books (double entry)', () => {
  let books: BooksService;
  let entities: EntityService;
  let KE: string;
  let GROUP: string;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [BooksService, EntityService, DidService, LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    books = moduleRef.get(BooksService);
    books.reset();
    KE = entities.requireForJurisdiction('KE').entityId;
    GROUP = entities.group().entityId;
  });

  it('refuses an entry that does not balance, and writes nothing when it does', () => {
    expect(() =>
      books.post({
        entityId: KE,
        kind: 'top-up',
        lines: [
          { code: ACCOUNT_CODES.CASH_CUSTODY, amount: 1000 },
          { code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: 'did:agent:1', amount: -900 },
        ],
      }),
    ).toThrow(/does not balance/);

    // A refused entry leaves no trace — a half-posted movement is not a state the books can be in.
    expect(books.journal()).toHaveLength(0);
    expect(books.balance(KE, ACCOUNT_CODES.CASH_CUSTODY)).toBe(0);
  });

  it('posts a top-up the way it was DECIDED: gross credit, the PSP fee as the sister’s expense', () => {
    // A shop sends 1,000. The provider takes 15, so 985 actually lands. The shop is credited the GROSS —
    // what they sent is what they get — and the fee is the sister's cost of doing business.
    const entry = books.post({
      entityId: KE,
      kind: 'top-up',
      ref: 'mpesa-TX123',
      lines: [
        { code: ACCOUNT_CODES.CASH_CUSTODY, amount: 985 },
        { code: ACCOUNT_CODES.EXPENSE_PAYMENT_FEES, amount: 15 },
        { code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: 'did:agent:1', amount: -1000 },
      ],
    });

    expect(entry.lines).toHaveLength(3);
    expect(books.balance(KE, ACCOUNT_CODES.CASH_CUSTODY)).toBe(985);
    expect(books.balance(KE, ACCOUNT_CODES.EXPENSE_PAYMENT_FEES)).toBe(15);
    // The shop is owed 1,000: a liability, so it reads negative in the books.
    expect(books.balance(KE, ACCOUNT_CODES.DEPOSIT_AGENT, undefined, 'did:agent:1')).toBe(-1000);
    // And nothing was earned. A top-up is money held, not money made — we charge for service, not balance.
    expect(books.balance(KE, ACCOUNT_CODES.REVENUE)).toBe(0);
  });

  it('earns revenue when the service is delivered, drawn from the deposit it was prepaid into', () => {
    books.post({
      entityId: KE,
      kind: 'top-up',
      lines: [
        { code: ACCOUNT_CODES.CASH_CUSTODY, amount: 1000 },
        { code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: 'did:agent:1', amount: -1000 },
      ],
    });
    // A parcel ships: the shop's deposit is drawn down and the sister recognises the wholesale unit.
    books.post({
      entityId: KE,
      kind: 'shipping',
      ref: 'PUD-1',
      lines: [
        { code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: 'did:agent:1', amount: 1.6 },
        { code: ACCOUNT_CODES.REVENUE, amount: -1.6 },
      ],
    });

    expect(books.balance(KE, ACCOUNT_CODES.DEPOSIT_AGENT, undefined, 'did:agent:1')).toBe(-998.4);
    expect(books.balance(KE, ACCOUNT_CODES.REVENUE)).toBe(-1.6); // revenue is credit-natured
    expect(books.balance(KE, ACCOUNT_CODES.CASH_CUSTODY)).toBe(1000); // no money moved; only what it is FOR changed
  });

  it('keeps each counterparty’s balance its own', () => {
    for (const agent of ['did:agent:1', 'did:agent:2']) {
      books.post({ entityId: KE, kind: 'top-up', lines: [{ code: ACCOUNT_CODES.CASH_CUSTODY, amount: 500 }, { code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: agent, amount: -500 }] });
    }
    books.post({ entityId: KE, kind: 'shipping', lines: [{ code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: 'did:agent:1', amount: 10 }, { code: ACCOUNT_CODES.REVENUE, amount: -10 }] });

    expect(books.balance(KE, ACCOUNT_CODES.DEPOSIT_AGENT, undefined, 'did:agent:1')).toBe(-490);
    expect(books.balance(KE, ACCOUNT_CODES.DEPOSIT_AGENT, undefined, 'did:agent:2')).toBe(-500); // untouched
  });

  it('stays internally consistent — the whole book sums to zero, entry by entry', () => {
    books.post({ entityId: KE, kind: 'top-up', lines: [{ code: ACCOUNT_CODES.CASH_CUSTODY, amount: 985 }, { code: ACCOUNT_CODES.EXPENSE_PAYMENT_FEES, amount: 15 }, { code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: 'did:agent:1', amount: -1000 }] });
    books.post({ entityId: KE, kind: 'shipping', lines: [{ code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: 'did:agent:1', amount: 1.6 }, { code: ACCOUNT_CODES.REVENUE, amount: -1.6 }] });
    books.post({ entityId: KE, kind: 'labour', lines: [{ code: ACCOUNT_CODES.REVENUE, amount: 0.4 }, { code: ACCOUNT_CODES.PAYABLE_PROVIDER, counterparty: 'did:agent:1', amount: -0.4 }] });

    expect(books.balances(KE)).toEqual({ balanced: true, drift: 0 });
    expect(books.trialBalance(KE).length).toBeGreaterThan(3);
    expect(books.journal({ entityId: KE })).toHaveLength(3);
  });

  it('reads coverage as a human would: money held against money owed', () => {
    books.post({ entityId: KE, kind: 'top-up', lines: [{ code: ACCOUNT_CODES.CASH_CUSTODY, amount: 985 }, { code: ACCOUNT_CODES.EXPENSE_PAYMENT_FEES, amount: 15 }, { code: ACCOUNT_CODES.DEPOSIT_AGENT, counterparty: 'did:agent:1', amount: -1000 }] });

    // Held 985, owed 1,000 — under-covered by the fee the sister absorbed, which is exactly the honest
    // picture: gross-crediting is a real cost, and the margin has to carry it.
    expect(books.coverage(KE)).toEqual({ currency: 'KES', held: 985, lent: 0, owed: 1000, cover: -15 });
  });

  describe('the mother keeps no books', () => {
    it('refuses to open her an account', () => {
      expect(() => books.account(GROUP, ACCOUNT_CODES.CASH_CUSTODY)).toThrow(/holds no custody/);
    });

    it('refuses to post to her', () => {
      expect(() =>
        books.post({ entityId: GROUP, currency: 'KES', kind: 'top-up', lines: [{ code: ACCOUNT_CODES.CASH_CUSTODY, amount: 1 }, { code: ACCOUNT_CODES.REVENUE, amount: -1 }] }),
      ).toThrow(/holding company/);
      expect(books.journal()).toHaveLength(0);
    });
  });

  it('opens accounts lazily, under a stable id, in the entity’s own currency', () => {
    const a = books.account(KE, ACCOUNT_CODES.DEPOSIT_AGENT, undefined, 'did:agent:1');
    expect(a.accountId).toBe(`${KE}:${ACCOUNT_CODES.DEPOSIT_AGENT}:KES:did:agent:1`);
    expect(a.currency).toBe('KES');
    expect(a.kind).toBe('liability');
    expect(books.account(KE, ACCOUNT_CODES.DEPOSIT_AGENT, undefined, 'did:agent:1').accountId).toBe(a.accountId); // idempotent
  });

  it('refuses a line whose amount is not a number', () => {
    expect(() => books.post({ entityId: KE, kind: 'x', lines: [{ code: ACCOUNT_CODES.CASH_CUSTODY, amount: NaN }, { code: ACCOUNT_CODES.REVENUE, amount: 0 }] })).toThrow(/not a number/);
    expect(() => books.post({ entityId: KE, kind: 'x', lines: [] })).toThrow(/needs lines/);
  });
});
