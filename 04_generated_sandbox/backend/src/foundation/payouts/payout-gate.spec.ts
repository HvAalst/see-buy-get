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
 * "Owed, not paid" (user, 2026-09-13).
 *
 * A payee the network may not pay out to — a shop in a country where money may not leave to a supplier — is
 * OWED, and the run must say so by name. Not raise a payment that must never be submitted, and not report the
 * debt as settled or as short of cash, which would each be a different lie about the same shilling.
 */
describe('a payee who may not be paid out', () => {
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
    entities.seed();
    books = moduleRef.get(BooksService);
    books.reset();
    payouts = moduleRef.get(PayoutService);
  });

  const ke = () => entities.requireForJurisdiction('KE').entityId;

  it('is skipped by name, and the debt stays exactly where it was', () => {
    books.post({
      entityId: ke(),
      kind: 'purchased-service',
      ref: 'PUD-1',
      lines: [
        { code: ACCOUNT_CODES.EXPENSE_PROVIDER_FEES, amount: 10 },
        { code: ACCOUNT_CODES.PAYABLE_PROVIDER, counterparty: 'did:shop:berlin', amount: -10 },
      ],
    });
    payouts.registerPayeeGate((did) => (did === 'did:shop:berlin' ? 'Kiez Kiosk is owed this, but we cannot pay out in DE yet' : null));

    const run = payouts.runFor(ke());
    expect(run.raised).toEqual([]);
    expect(run.skipped).toEqual([{ payeeDid: 'did:shop:berlin', reason: 'Kiez Kiosk is owed this, but we cannot pay out in DE yet' }]);
    const owed = books.outstanding(ke(), ACCOUNT_CODES.PAYABLE_PROVIDER, entities.get(ke()).currency ?? '').find((o) => o.counterparty === 'did:shop:berlin');
    expect(owed?.amount).toBe(10);
  });

  it('bars nobody when no gate is registered', () => {
    // A deployment without the PUDO module has no shops standing where no sister does.
    expect(() => payouts.runFor(ke())).not.toThrow();
  });
});
