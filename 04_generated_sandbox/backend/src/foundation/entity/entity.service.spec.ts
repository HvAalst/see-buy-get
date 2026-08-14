import { Test } from '@nestjs/testing';
import { EntityService } from './entity.service';
import { DidService } from '../did/did.service';
import { LedgerService } from '../ledger/ledger.service';
import { LEDGER_ADAPTER } from '../ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../ledger/in-memory-ledger.adapter';
import { EventBus } from '../events/event-bus.service';
import { NETWORK_JURISDICTION } from '../../modules/pudo/pudo.config';

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
});
