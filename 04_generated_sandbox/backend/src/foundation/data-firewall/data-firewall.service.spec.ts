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

/**
 * THE GOLDEN RECORD SURVIVES A RESTART, and only as ciphertext.
 *
 * The vault was an in-memory Map while every record pointing into it was persisted, so each restart left
 * drivers and people holding handles to nothing. This drives the real disk path: a vault writes, a second
 * vault — a new process — reads the same record back, and the file itself holds no readable name.
 * Persistence is off under Jest by design, so the guard is lifted and the data directory pointed at a
 * temp folder for this test alone; the modules are loaded fresh so they read that directory.
 */
describe('IdentityVault on disk', () => {
  const origWorker = process.env.JEST_WORKER_ID;
  const origDir = process.env.GLOS_DATA_DIR;
  let dir: string;

  beforeEach(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { mkdtempSync } = require('fs') as typeof import('fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { tmpdir } = require('os') as typeof import('os');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { join } = require('path') as typeof import('path');
    dir = mkdtempSync(join(tmpdir(), 'glos-vault-'));
    process.env.GLOS_DATA_DIR = dir;
    delete process.env.JEST_WORKER_ID;
  });
  afterEach(() => {
    if (origWorker !== undefined) process.env.JEST_WORKER_ID = origWorker;
    if (origDir === undefined) delete process.env.GLOS_DATA_DIR;
    else process.env.GLOS_DATA_DIR = origDir;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    (require('fs') as typeof import('fs')).rmSync(dir, { recursive: true, force: true });
  });

  it('reads a record back in a second vault, and keeps no plaintext in the file', () => {
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { IdentityVault: Vault } = require('./identity-vault.service') as typeof import('./identity-vault.service');
      const { FieldEncryption: Crypto } = require('./field-encryption.service') as typeof import('./field-encryption.service');
      const { EventBus: Bus } = require('../events/event-bus.service') as typeof import('../events/event-bus.service');
      const { readFileSync, existsSync } = require('fs') as typeof import('fs');
      const { join } = require('path') as typeof import('path');
      /* eslint-enable @typescript-eslint/no-require-imports */
      const first = new Vault(new Crypto(), new Bus());
      const { vaultRef } = first.store({ fullName: 'Wanjiru Njeri', phone: '+254700123456' });

      const second = new Vault(new Crypto(), new Bus());
      expect(second.exists(vaultRef)).toBe(true);
      expect(second.reveal(vaultRef, { purpose: 'test', requesterDid: 'did:glos:test' })).toMatchObject({ fullName: 'Wanjiru Njeri', phone: '+254700123456' });

      const file = join(dir, 'identity-vault.json');
      expect(existsSync(file)).toBe(true);
      const onDisk = readFileSync(file, 'utf8');
      expect(onDisk).toContain(vaultRef);
      expect(onDisk).not.toContain('Wanjiru');
      expect(onDisk).not.toContain('254700123456');
    });
  });

  it('keeps the receipt of every look across a restart — who, why, when — and no personal data in it', () => {
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports */
      const { IdentityVault: Vault } = require('./identity-vault.service') as typeof import('./identity-vault.service');
      const { FieldEncryption: Crypto } = require('./field-encryption.service') as typeof import('./field-encryption.service');
      const { EventBus: Bus } = require('../events/event-bus.service') as typeof import('../events/event-bus.service');
      const { readFileSync } = require('fs') as typeof import('fs');
      const { join } = require('path') as typeof import('path');
      /* eslint-enable @typescript-eslint/no-require-imports */
      const first = new Vault(new Crypto(), new Bus());
      const { vaultRef } = first.store({ fullName: 'Grace Wambui', phone: '+254711223344' });
      first.reveal(vaultRef, { purpose: 'papers-renewal', requesterDid: 'operator:opr_y' });

      // The next morning: a new process, and the look is still on the record.
      const second = new Vault(new Crypto(), new Bus());
      expect(second.getAccessLog()).toEqual([expect.objectContaining({ vaultRef, purpose: 'papers-renewal', requesterDid: 'operator:opr_y' })]);
      const receipts = readFileSync(join(dir, 'identity-vault-access.jsonl'), 'utf8');
      expect(receipts).not.toContain('Grace');
      expect(receipts).not.toContain('711223344');
    });
  });
});

describe('FieldEncryption outside a sandbox', () => {
  const origEnv = process.env.GLOS_ENV;
  const origKey = process.env.GLOS_VAULT_KEY;
  afterEach(() => {
    if (origEnv === undefined) delete process.env.GLOS_ENV;
    else process.env.GLOS_ENV = origEnv;
    if (origKey === undefined) delete process.env.GLOS_VAULT_KEY;
    else process.env.GLOS_VAULT_KEY = origKey;
  });

  it('refuses to start on the key printed in the source, and starts on a real one', () => {
    process.env.GLOS_ENV = 'production';
    delete process.env.GLOS_VAULT_KEY;
    expect(() => new FieldEncryption()).toThrow(/GLOS_VAULT_KEY/);
    process.env.GLOS_VAULT_KEY = 'a-real-key-from-the-deployment';
    expect(() => new FieldEncryption()).not.toThrow();
    delete process.env.GLOS_ENV;
    delete process.env.GLOS_VAULT_KEY;
    expect(() => new FieldEncryption()).not.toThrow(); // a laptop keeps working without one
  });
});
