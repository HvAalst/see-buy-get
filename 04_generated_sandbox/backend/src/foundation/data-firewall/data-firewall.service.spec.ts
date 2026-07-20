import { Test } from '@nestjs/testing';
import { FieldEncryption } from './field-encryption.service';
import { IdentityVault } from './identity-vault.service';
import { OperationalStore } from './operational-store.service';
import { DataFirewallViolation } from './pii-policy';
import { EventBus } from '../events/event-bus.service';
import { GlosEvent } from '../events/glos-events';

describe('Data firewall (IdentityVault + OperationalStore)', () => {
  let vault: IdentityVault;
  let core: OperationalStore;
  let events: EventBus;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [FieldEncryption, IdentityVault, OperationalStore, EventBus],
    }).compile();
    vault = moduleRef.get(IdentityVault);
    core = moduleRef.get(OperationalStore);
    events = moduleRef.get(EventBus);
  });

  it('keeps PII in the vault and only a reference in the core', () => {
    const ref = vault.store({ fullName: 'Jane Doe', governmentId: 'P1234567' }, { region: 'EU' });
    expect(ref.vaultRef).toMatch(/^vault_/);

    // The core stores only the opaque reference — and accepts it (no PII).
    const profile = core.upsert({
      did: 'did:glos:abc',
      vaultRef: ref.vaultRef,
      tier: 2,
      status: 'active',
      capabilities: ['fragile-handling'],
    });
    expect(profile.vaultRef).toBe(ref.vaultRef);
    // The at-rest vault metadata exposes no PII.
    expect(vault.describe(ref.vaultRef)).toEqual({
      vaultRef: ref.vaultRef,
      region: 'EU',
      createdAt: expect.any(String),
    });
  });

  it('rejects any attempt to put PII into the Operational Core', () => {
    expect(() =>
      core.upsert({
        did: 'did:glos:abc',
        tier: 2,
        status: 'active',
        capabilities: [],
        // @ts-expect-error — PII is not part of OperationalProfile; the guard also blocks it at runtime.
        fullName: 'Jane Doe',
      }),
    ).toThrow(DataFirewallViolation);
  });

  it('reveals PII only via the vault, recording an audited consent receipt', () => {
    const ref = vault.store({ fullName: 'Jane Doe', email: 'jane@example.com' });
    const pii = vault.reveal(ref.vaultRef, { purpose: 'kyc-review', requesterDid: 'did:glos:reviewer' });

    expect(pii.fullName).toBe('Jane Doe');
    const log = vault.getAccessLog();
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ vaultRef: ref.vaultRef, purpose: 'kyc-review', requesterDid: 'did:glos:reviewer' });

    // Access emits a consent/audit event on the bus.
    const audit = events.getLog().find((e) => e.type === GlosEvent.Identity.ConsentReceiptLogged);
    expect(audit).toBeDefined();
  });

  it('supports pseudonymous capability queries without touching identity', () => {
    core.upsert({ did: 'did:glos:1', tier: 2, status: 'active', capabilities: ['reefer'] });
    core.upsert({ did: 'did:glos:2', tier: 2, status: 'active', capabilities: ['flatbed'] });
    expect(core.findByCapability('reefer').map((p) => p.did)).toEqual(['did:glos:1']);
  });
});
