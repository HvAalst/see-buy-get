import { Test } from '@nestjs/testing';
import { CredentialService } from './credential.service';
import { LedgerService } from '../ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../ledger/ledger.types';
import { EventBus } from '../events/event-bus.service';
import { GlosEvent } from '../events/glos-events';

describe('CredentialService (VC registry)', () => {
  let credentials: CredentialService;
  let events: EventBus;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [CredentialService, LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
    }).compile();
    credentials = moduleRef.get(CredentialService);
    events = moduleRef.get(EventBus);
  });

  it('issues an anchored, active VC and emits VcIssued', () => {
    const vc = credentials.issue({ subject: 'did:glos:1', type: 'BackgroundCheckPassed', claims: { reference: 'r1' } });
    expect(vc.id).toMatch(/^vc_/);
    expect(vc.type).toContain('VerifiableCredential');
    expect(vc.type).toContain('BackgroundCheckPassed');
    expect(vc.anchorTxId).toContain('glostx_');
    expect(credentials.verify(vc.id).active).toBe(true);
    expect(credentials.hasValid('did:glos:1', 'BackgroundCheckPassed')).toBe(true);
    expect(events.getLog().some((e) => e.type === GlosEvent.Identity.VcIssued)).toBe(true);
  });

  it('treats an expired credential as inactive', () => {
    const vc = credentials.issue({ subject: 'did:glos:1', type: 'Temp', ttlMs: -1 });
    const status = credentials.verify(vc.id);
    expect(status.active).toBe(false);
    expect(status.reason).toBe('expired');
    expect(credentials.hasValid('did:glos:1', 'Temp')).toBe(false);
  });

  it('revokes a credential and emits VcRevoked', () => {
    const vc = credentials.issue({ subject: 'did:glos:1', type: 'Badge' });
    expect(credentials.revoke(vc.id)).toBe(true);
    expect(credentials.verify(vc.id).reason).toBe('revoked');
    expect(events.getLog().some((e) => e.type === GlosEvent.Identity.VcRevoked)).toBe(true);
  });
});
