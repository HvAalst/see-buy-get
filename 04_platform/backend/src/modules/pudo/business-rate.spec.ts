import { Test } from '@nestjs/testing';
import { EntityService } from '../../foundation/entity/entity.service';
import { DidService } from '../../foundation/did/did.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { EventBus } from '../../foundation/events/event-bus.service';
import { BusinessRateService } from './business-rate.service';
import { PriceCardService, FIXED_STEPS } from './price-card.service';

/*
 * 2026-11-12 — A LARGE SENDER'S OWN RATE (the owner's D3: "Large senders negotiate. On a fixed card they get their own lower
 * card — volume tiers or a contract card for one business account; on factors, a discount on the formula"). What is pinned:
 * staff propose a contract card (a price for each of the country's weights, never cheaper for a heavier parcel) or a discount
 * (at most half); a second member of staff approves it — never the one who proposed it; only then does it price; one of
 * another country's senders is refused; a card idles on factors, a discount on a fixed card; staff end it; every change logged.
 */
describe('a large sender’s own rate (the owner’s D3, 2026-11-12)', () => {
  let entities: EntityService;
  let rates: BusinessRateService;
  const NJERI = { name: 'Njeri W.', id: 'acct-1' };
  const OTIENO = { name: 'Otieno K.', id: 'acct-2' };
  const senders = [
    { vendorId: 'v-big', name: 'Big Store', country: 'KE' },
    { vendorId: 'v-small', name: 'Small Store', country: 'KE' },
    { vendorId: 'v-addis', name: 'Addis Store', country: 'ET' },
  ];
  const vendors = {
    list: () => senders,
    get: (id: string) => {
      const v = senders.find((s) => s.vendorId === id);
      if (!v) throw new Error('Vendor not found');
      return v;
    },
    entityIdOrNone: (v: { country: string }) => (v.country === 'KE' ? 'sbg-ke' : 'sbg-et'),
  };

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [EntityService, DidService, LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    const cards = new PriceCardService(entities, { setup: () => ({ versions: [] }) } as never);
    rates = new BusinessRateService(entities, vendors as never, cards);
  });

  it('lists the country’s own senders and the weights a contract card is priced at; nothing prices before a second person approves', () => {
    const v = rates.view('sbg-ke');
    expect(v).toMatchObject({ entityId: 'sbg-ke', currency: 'KES', mode: 'fixed', rows: [] });
    expect(v.steps).toEqual([...FIXED_STEPS]);
    expect(v.senders.map((s) => s.name)).toEqual(['Big Store', 'Small Store']);
    // A contract card: a price for each weight, more than nothing, never cheaper for a heavier parcel.
    expect(() => rates.propose('sbg-ke', { vendorId: 'v-big', kind: 'card', prices: [60, 90] }, NJERI)).toThrow(/a price for each of the 4 weights/);
    expect(() => rates.propose('sbg-ke', { vendorId: 'v-big', kind: 'card', prices: [60, 0, 150, 240] }, NJERI)).toThrow(/above nothing/);
    expect(() => rates.propose('sbg-ke', { vendorId: 'v-big', kind: 'card', prices: [60, 90, 80, 240] }, NJERI)).toThrow(/never costs less/);
    // Another country's sender is not this company's to price.
    expect(() => rates.propose('sbg-ke', { vendorId: 'v-addis', kind: 'card', prices: [60, 90, 150, 240] }, NJERI)).toThrow(/not one of this country’s sender accounts/);
    const proposed = rates.propose('sbg-ke', { vendorId: 'v-big', kind: 'card', prices: [60, 90, 150, 240], perExtraKg: 5, note: 'Two-year contract' }, NJERI);
    expect(proposed.rows).toEqual([expect.objectContaining({ vendorId: 'v-big', name: 'Big Store', idle: false, proposed: expect.objectContaining({ kind: 'card', steps: [...FIXED_STEPS], prices: [60, 90, 150, 240], perExtraKg: 5, note: 'Two-year contract', proposedBy: 'Njeri W.' }) })]);
    expect(proposed.rows[0].approved).toBeUndefined();
    expect(rates.rateFor('sbg-ke', 'v-big')).toBeUndefined();
    // A second person approves it — never the one who proposed it.
    expect(() => rates.approve('sbg-ke', 'v-big', NJERI)).toThrow(/A second person approves it/);
    const approved = rates.approve('sbg-ke', 'v-big', OTIENO);
    expect(approved.rows[0]).toMatchObject({ approved: { kind: 'card', approvedBy: 'Otieno K.' } });
    expect(approved.rows[0].proposed).toBeUndefined();
    expect(rates.rateFor('sbg-ke', 'v-big')).toMatchObject({ kind: 'card', prices: [60, 90, 150, 240] });
    expect(rates.rateFor('sbg-ke', 'v-small')).toBeUndefined();
    expect(() => rates.approve('sbg-ke', 'v-big', OTIENO)).toThrow(/No rate is waiting/);
    const log = entities.changes('sbg-ke').filter((c) => c.what === 'businessRates');
    expect(log.map((c) => c.to)).toEqual(expect.arrayContaining(['Big Store: a contract card (60 / 90 / 150 / 240), proposed', 'Big Store: a contract card (60 / 90 / 150 / 240)']));
    // What the sender reads of its own rate.
    expect(rates.ownRate('v-big')).toMatchObject({ kind: 'card', prices: [60, 90, 150, 240], idle: false });
    expect(rates.ownRate('v-small')).toBeUndefined();
  });

  it('a card idles while the country prices by factors, a discount while it prices by a fixed card; a new rate waits beside the one in force; staff end it', () => {
    rates.propose('sbg-ke', { vendorId: 'v-big', kind: 'card', prices: [60, 90, 150, 240] }, NJERI);
    rates.approve('sbg-ke', 'v-big', OTIENO);
    entities.setPricingMode('sbg-ke', 'factors', 'Njeri W.');
    expect(rates.view('sbg-ke').rows[0].idle).toBe(true);
    expect(rates.ownRate('v-big')?.idle).toBe(true);
    // A discount: more than nothing, at most half.
    expect(() => rates.propose('sbg-ke', { vendorId: 'v-big', kind: 'discount', discountPct: 0.6 }, NJERI)).toThrow(/at most 50%/);
    expect(() => rates.propose('sbg-ke', { vendorId: 'v-big', kind: 'discount' }, NJERI)).toThrow(/at most 50%/);
    const waiting = rates.propose('sbg-ke', { vendorId: 'v-big', kind: 'discount', discountPct: 0.1 }, NJERI);
    // The card stays in force until the discount is approved.
    expect(waiting.rows[0]).toMatchObject({ approved: { kind: 'card' }, proposed: { kind: 'discount', discountPct: 0.1 } });
    expect(rates.rateFor('sbg-ke', 'v-big')?.kind).toBe('card');
    rates.approve('sbg-ke', 'v-big', OTIENO);
    expect(rates.rateFor('sbg-ke', 'v-big')).toMatchObject({ kind: 'discount', discountPct: 0.1 });
    expect(rates.view('sbg-ke').rows[0].idle).toBe(false);
    entities.setPricingMode('sbg-ke', 'fixed', 'Njeri W.');
    expect(rates.view('sbg-ke').rows[0].idle).toBe(true);
    // Ended: priced as everybody from now; logged.
    rates.end('sbg-ke', 'v-big', NJERI);
    expect(rates.rateFor('sbg-ke', 'v-big')).toBeUndefined();
    expect(rates.view('sbg-ke').rows).toEqual([]);
    expect(entities.changes('sbg-ke').find((c) => c.what === 'businessRates' && c.to === 'Big Store: the country’s prices')).toBeTruthy();
    expect(() => rates.end('sbg-ke', 'v-big', NJERI)).toThrow(/no rate of its own/);
    // A company that runs no country has no senders' rates.
    expect(() => rates.view('sbg-holding')).toThrow();
  });
});
