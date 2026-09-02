import { Test } from '@nestjs/testing';
import { EntityService } from './entity.service';
import { DidService } from '../did/did.service';
import { LedgerService } from '../ledger/ledger.service';
import { LEDGER_ADAPTER } from '../ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../ledger/in-memory-ledger.adapter';
import { EventBus } from '../events/event-bus.service';
import { NETWORK_JURISDICTION, PLATFORM_FEE_PCT } from '../../modules/pudo/pudo.config';

describe('entities (the group and its sisters)', () => {
  let entities: EntityService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [EntityService, DidService, LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
  });

  it('seeds a group and a sister per operating jurisdiction, each with a real DID', () => {
    const group = entities.group();
    expect(group.kind).toBe('group');
    expect(group.did).toMatch(/^did:glos:/);

    const sisters = entities.sisters();
    expect(sisters.length).toBeGreaterThan(0);
    for (const s of sisters) {
      expect(s.did).toMatch(/^did:glos:/);
      expect(s.parentEntityId).toBe(group.entityId);
      expect(s.jurisdiction).toMatch(/^[A-Z]{2}$/);
    }
  });

  it('gives Kenya a sister that settles in shillings', () => {
    const ke = entities.requireForJurisdiction('KE');
    expect(ke.kind).toBe('sister');
    expect(ke.currency).toBe('KES');
    expect(entities.requireForJurisdiction('ke').entityId).toBe(ke.entityId); // case-insensitive
  });

  it('has a sister for the jurisdiction this deployment operates in', () => {
    // Keeps the entity seed and the network's own config honest with each other without coupling them.
    expect(entities.forJurisdiction(NETWORK_JURISDICTION)).toBeDefined();
  });

  describe('the mother is isolated', () => {
    it('holds no custody and settles in no currency', () => {
      const group = entities.group();
      expect(entities.canHoldCustody(group.entityId)).toBe(false);
      expect(group.currency).toBeUndefined();
      expect(group.jurisdiction).toBeUndefined();
    });

    it('cannot be named as a party to a transaction', () => {
      // The whole point of the sister structure: an entity that is not registered in a jurisdiction must
      // never become a counterparty there, or one country's problem reaches every other company.
      expect(() => entities.requireTransacting(entities.group().entityId)).toThrow(/holding company/);
    });

    it('lets a sister transact, and lets it hold custody', () => {
      const ke = entities.requireForJurisdiction('KE');
      expect(entities.requireTransacting(ke.entityId).entityId).toBe(ke.entityId);
      expect(entities.canHoldCustody(ke.entityId)).toBe(true);
    });
  });

  it('refuses a jurisdiction with no daughter company rather than falling back to another', () => {
    // Silently settling a Dutch vendor through Nairobi would put revenue, tax and liability in the wrong
    // company — the same class of error as the missing KE currency, and far more expensive.
    expect(entities.forJurisdiction('NL')).toBeUndefined();
    expect(() => entities.requireForJurisdiction('NL')).toThrow(/No daughter company operates in NL/);
    expect(() => entities.requireForJurisdiction(undefined)).toThrow(/that jurisdiction/);
  });

  it('keeps an entity DID stable across re-seeds — other records point at it', () => {
    const before = entities.group().did;
    entities.seed();
    entities.seed();
    expect(entities.group().did).toBe(before);
    expect(entities.list().filter((e) => e.kind === 'group')).toHaveLength(1);
  });

  it('refuses to resolve an unknown entity', () => {
    expect(() => entities.get('sbg-zz')).toThrow(/No such entity/);
    expect(entities.find(undefined)).toBeUndefined();
  });

  describe('the three rate knobs', () => {
    const sister = () => entities.sisters()[0].entityId;

    it('a sister that has never touched them prices exactly as it always did', () => {
      // The whole point of shipping this without repricing anything: layers absent means margin is the
      // network default and the other two are zero.
      const r = entities.ratesFor(sister());
      expect(r).toMatchObject({ costOfRiskPct: 0, profitOnRiskPct: 0, marginPct: PLATFORM_FEE_PCT, totalPct: PLATFORM_FEE_PCT });
    });

    it('reads the OLD single knob as the margin it always was', () => {
      // `feePct` predates the layers. It is read as margin rather than migrated on write — a value that
      // rewrites itself the first time something reads it makes the record's history unreadable.
      entities.setFeePct(sister(), 0.05);
      const r = entities.ratesFor(sister());
      expect(r.marginPct).toBe(0.05);
      expect(r.totalPct).toBe(0.05);
    });

    it('ADDS the layers — it does not compound them', () => {
      // 5 + 5 + 5 applied in sequence is 15.76%. A knob whose effect an admin cannot predict in their head
      // is not a knob worth having.
      entities.setRates(sister(), { costOfRiskPct: 0.05, profitOnRiskPct: 0.05, marginPct: 0.05 });
      expect(entities.ratesFor(sister()).totalPct).toBe(0.15);
    });

    it('prices a lane differently without disturbing the rest', () => {
      // A letter through the shop network and a dedicated truck haul are different businesses carrying
      // different risk. Setting one must not silently reset the other.
      entities.setRates(sister(), { marginPct: 0.03 });
      entities.setRates(sister(), { lane: 'dedicated', profitOnRiskPct: 0.06 });

      expect(entities.ratesFor(sister(), 'dedicated')).toMatchObject({ profitOnRiskPct: 0.06, marginPct: 0.03, totalPct: 0.09 });
      expect(entities.ratesFor(sister(), 'pudo')).toMatchObject({ profitOnRiskPct: 0, marginPct: 0.03, totalPct: 0.03 });
      expect(entities.ratesFor(sister()).totalPct).toBe(0.03); // the default is untouched
    });

    it('resolves each layer independently, so a partial override keeps the rest', () => {
      // The trap: treating the lane override as a whole object would drop this sister's own 3% margin the
      // moment it set a cost of risk on one lane, and quietly reprice that lane to the network default.
      entities.setRates(sister(), { marginPct: 0.03, costOfRiskPct: 0.01 });
      entities.setRates(sister(), { lane: 'mdp', costOfRiskPct: 0.04 });
      expect(entities.ratesFor(sister(), 'mdp')).toMatchObject({ costOfRiskPct: 0.04, marginPct: 0.03 });
    });

    it('leaves unmentioned knobs alone, and clears one only when told to', () => {
      entities.setRates(sister(), { costOfRiskPct: 0.02, marginPct: 0.03 });
      entities.setRates(sister(), { costOfRiskPct: 0.04 }); // margin not mentioned
      expect(entities.ratesFor(sister())).toMatchObject({ costOfRiskPct: 0.04, marginPct: 0.03 });

      entities.setRates(sister(), { costOfRiskPct: null }); // explicitly back to the fallback
      expect(entities.ratesFor(sister()).costOfRiskPct).toBe(0);
    });

    it('bounds the SUM, not just each layer', () => {
      // Three innocent-looking numbers, each inside its own range, that together price a market out of
      // existence. The ceiling has to be on what the customer would actually be charged.
      expect(() => entities.setRates(sister(), { costOfRiskPct: 0.1, profitOnRiskPct: 0.1, marginPct: 0.1 })).toThrow(/ADD UP/);
      expect(() => entities.setRates(sister(), { marginPct: 0.9 })).toThrow(/between/);
    });

    it('does not apply a rejected rate', () => {
      // Validating a record we had already mutated would refuse the change and apply it at the same time.
      entities.setRates(sister(), { marginPct: 0.04 });
      expect(() => entities.setRates(sister(), { costOfRiskPct: 0.2, profitOnRiskPct: 0.2 })).toThrow();
      expect(entities.ratesFor(sister())).toMatchObject({ costOfRiskPct: 0, profitOnRiskPct: 0, marginPct: 0.04 });
    });
  });
});
