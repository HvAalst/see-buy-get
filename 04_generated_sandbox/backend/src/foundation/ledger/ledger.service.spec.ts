import { Test } from '@nestjs/testing';
import { LedgerService } from './ledger.service';
import { InMemoryLedgerAdapter } from './in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from './ledger.types';

describe('LedgerService', () => {
  let service: LedgerService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [LedgerService, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
    }).compile();
    service = moduleRef.get(LedgerService);
  });

  it('produces the same hash regardless of key order', () => {
    expect(service.hash({ a: 1, b: 2 })).toBe(service.hash({ b: 2, a: 1 }));
  });

  it('anchors a payload and verifies it', () => {
    const payload = { glosId: 'SHIP-1', weight: 12 };
    const receipt = service.anchor(payload);
    expect(receipt.hash).toHaveLength(64);
    expect(receipt.txId).toContain('glostx_');
    expect(receipt.blockHeight).toBeGreaterThan(0);
    expect(service.verify(payload)).toBe(true);
    expect(service.verify(payload, receipt.txId)).toBe(true);
  });

  it('fails verification for an unanchored or tampered payload', () => {
    service.anchor({ glosId: 'SHIP-1', weight: 12 });
    expect(service.verify({ glosId: 'SHIP-1', weight: 99 })).toBe(false);
    expect(service.verify({ glosId: 'SHIP-2' }, 'wrong-tx')).toBe(false);
  });
});
