import { Test } from '@nestjs/testing';
import { PresenceService } from './presence.service';
import { EntityService } from '../entity/entity.service';
import { DidService } from '../did/did.service';
import { LedgerService } from '../ledger/ledger.service';
import { LEDGER_ADAPTER } from '../ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../ledger/in-memory-ledger.adapter';
import { EventBus } from '../events/event-bus.service';

/**
 * HOW ESTABLISHED WE ARE, COUNTRY BY COUNTRY.
 *
 * Everything here guards one idea: the network can match, carry and PROVE in a country where it cannot
 * spend a shilling, and the difference must be impossible to blur. The failures worth writing tests
 * against are all the same failure wearing different clothes — a country quietly inheriting permissions
 * it was never granted:
 *
 *   - an unknown country falling back to the home sister's capabilities;
 *   - "established" being claimed by setting a flag, with no company behind it;
 *   - a cover limit surviving into a country where no provision can pay it;
 *   - goods taken in under nobody's promise at all.
 */
describe('presence', () => {
  let presence: PresenceService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [PresenceService, EntityService, DidService, LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
    }).compile();
    moduleRef.get(EntityService).seed();
    presence = moduleRef.get(PresenceService);
  });

  describe('a country nobody recorded', () => {
    it('is OBSERVED, and may do nothing at all', () => {
      const zm = presence.resolve('ZM');
      expect(zm.level).toBe('observed');
      expect(zm.recorded).toBe(false);
      expect(Object.values(zm.capabilities).every((v) => v === false)).toBe(true);
    });

    it('never inherits the home sister, however the question is asked', () => {
      // The whole design in one assertion. A default that happens to be generous is how a shop in a
      // country we have never heard of ends up taking money on our behalf.
      expect(presence.resolve(undefined).level).toBe('observed');
      expect(presence.resolve('').capabilities.merchantOfRecord).toBe(false);
      expect(presence.can('XX', 'takeIn')).toBe(false);
    });
  });

  describe('a country with a sister', () => {
    it('is ESTABLISHED without anybody saying so', () => {
      // Derived, not declared: the company existing IS the fact. Kenya has a sister in the seed.
      const ke = presence.resolve('KE');
      expect(ke.level).toBe('established');
      expect(ke.hasEntity).toBe(true);
      expect(ke.capabilities.merchantOfRecord).toBe(true);
      expect(ke.capabilities.claims).toBe(true);
    });

    it('is found whatever case the country arrives in', () => {
      expect(presence.resolve('ke').level).toBe('established');
    });
  });

  describe('setting a standing', () => {
    it('refuses ESTABLISHED where no company transacts', () => {
      // This flag must never be the thing that creates a Merchant of Record, a float and a claims
      // provision out of nothing.
      expect(() => presence.set({ jurisdiction: 'ZM', level: 'established', by: 'A. Mwangi' })).toThrow(/cannot be established/i);
    });

    it('records who decided it and why', () => {
      const zm = presence.set({ jurisdiction: 'ZM', level: 'matched', note: 'Carrier-led entry, no company yet', by: 'A. Mwangi' });
      expect(zm.level).toBe('matched');
      expect(zm.setBy).toBe('A. Mwangi');
      expect(zm.note).toBe('Carrier-led entry, no company yet');
      expect(zm.setAt).toBeTruthy();
    });

    it('grants MATCHED the custody rails and not one capability that touches money', () => {
      const zm = presence.set({ jurisdiction: 'ZM', level: 'matched' });
      expect(zm.capabilities.takeIn).toBe(true);
      expect(zm.capabilities.merchantOfRecord).toBe(false);
      expect(zm.capabilities.holdFloat).toBe(false);
      expect(zm.capabilities.cashOnDelivery).toBe(false);
      expect(zm.capabilities.claims).toBe(false);
      expect(zm.capabilities.payouts).toBe(false);
    });

    it('lets one capability move on its own, up or down', () => {
      // They arrive on different days: a country can pay local suppliers long before it collects tax,
      // and a country with a company can still be barred from holding float.
      const zm = presence.set({ jurisdiction: 'ZM', level: 'matched', overrides: { payouts: true } });
      expect(zm.capabilities.payouts).toBe(true);
      expect(zm.capabilities.merchantOfRecord).toBe(false);

      const ke = presence.set({ jurisdiction: 'KE', level: 'established', overrides: { holdFloat: false } });
      expect(ke.capabilities.holdFloat).toBe(false);
      expect(ke.capabilities.merchantOfRecord).toBe(true);
    });

    it('refuses an override for a capability that does not exist', () => {
      // A silent no-op on a permission is how somebody believes they granted something they did not.
      expect(() => presence.set({ jurisdiction: 'ZM', level: 'matched', overrides: { flying: true } as never })).toThrow(/unknown capability/i);
    });

    it('keeps only the exceptions, so a later level change still moves everything else', () => {
      presence.set({ jurisdiction: 'ZM', level: 'matched', overrides: { payouts: true } });
      const raised = presence.set({ jurisdiction: 'ZM', level: 'partnered' });
      expect(raised.capabilities.payouts).toBe(false); // the override was not carried forward silently
    });
  });

  describe('who answers for goods taken in', () => {
    it('says OURS where a sister is on the hook', () => {
      expect(presence.takeInPromise('KE')).toBe('ours');
    });

    it('says NONE where goods may not be taken in at all', () => {
      expect(presence.takeInPromise('ZM')).toBe('none'); // unrecorded → observed
    });

    it('says THEIRS where goods may move but no sister can answer', () => {
      presence.set({ jurisdiction: 'ZM', level: 'matched' });
      expect(presence.takeInPromise('ZM')).toBe('theirs');
    });

    it('says OURS when the PAYER sits where a sister already carries it', () => {
      // The journey decides, not the shop. A Kenyan buyer's parcel is our sister's promise even where
      // it is handed over, and the foreign leg is a service we purchased.
      presence.set({ jurisdiction: 'ZM', level: 'matched' });
      expect(presence.takeInPromise('ZM', 'KE')).toBe('ours');
    });

    it('never lets a paying country conjure a take-in where take-in is refused', () => {
      // Somebody abroad being willing to pay does not make a counter we are not allowed to use legal.
      expect(presence.takeInPromise('ZM', 'KE')).toBe('none');
    });
  });

  describe('cover', () => {
    it('is zero by construction where no provision can pay an award', () => {
      presence.set({ jurisdiction: 'ZM', level: 'matched' });
      expect(presence.coverCeiling('ZM', 5000)).toBe(0);
      expect(presence.coverCeiling('KE', 5000)).toBe(5000);
    });
  });

  describe('the operator’s map', () => {
    it('lists every country with a company and every country on record', () => {
      presence.set({ jurisdiction: 'ZM', level: 'matched' });
      const map = presence.list();
      expect(map.map((p) => p.jurisdiction)).toEqual(expect.arrayContaining(['KE', 'ET', 'ZM']));
      expect(map.find((p) => p.jurisdiction === 'KE')?.level).toBe('established');
      expect(map.find((p) => p.jurisdiction === 'ZM')?.level).toBe('matched');
    });
  });
});
