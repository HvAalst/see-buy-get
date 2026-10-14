import { Test } from '@nestjs/testing';
import { DidService } from './did.service';
import { LedgerService } from '../ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../ledger/ledger.types';
import { EventBus } from '../events/event-bus.service';
import { GlosEvent } from '../events/glos-events';

describe('DidService', () => {
  let service: DidService;
  let ledger: LedgerService;
  let events: EventBus;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        DidService,
        LedgerService,
        EventBus,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
    }).compile();
    service = moduleRef.get(DidService);
    ledger = moduleRef.get(LedgerService);
    events = moduleRef.get(EventBus);
  });

  it('generates a resolvable, ledger-anchored DID controlled by the caller', () => {
    const doc = service.generate('participant-abc');
    expect(doc.id).toMatch(/^did:glos:[0-9a-f]{32}$/);
    expect(doc.controller).toBe('participant-abc');
    expect(service.resolve(doc.id)).toEqual(doc);
    expect(service.isController(doc.id, 'participant-abc')).toBe(true);
    expect(service.isController(doc.id, 'someone-else')).toBe(false);
    // The anchored document core verifies against the ledger.
    const { anchor, ...core } = doc;
    expect(ledger.verify(core, anchor.txId)).toBe(true);

    // Generation emits the did.generated cascade event.
    const emitted = events.getLog().find((e) => e.type === GlosEvent.Did.Generated);
    expect(emitted).toBeDefined();
    expect((emitted?.payload as { did: string }).did).toBe(doc.id);
  });

  it('issues unique DIDs and rejects an empty controller', () => {
    expect(service.generate('a').id).not.toBe(service.generate('a').id);
    expect(() => service.generate('')).toThrow();
  });
});
