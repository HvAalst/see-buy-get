import { Test } from '@nestjs/testing';
import { AuthService, DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS } from './auth.service';
import { DidService } from '../did/did.service';
import { OperationalStore } from '../data-firewall/operational-store.service';
import { LedgerService } from '../ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../ledger/ledger.types';
import { EventBus } from '../events/event-bus.service';

describe('AuthService', () => {
  let auth: AuthService;
  let did: DidService;
  let profiles: OperationalStore;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        DidService,
        OperationalStore,
        LedgerService,
        EventBus,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
    }).compile();
    auth = moduleRef.get(AuthService);
    did = moduleRef.get(DidService);
    profiles = moduleRef.get(OperationalStore);
  });

  it('keeps the trusted-caller grant open only in a sandbox when no client secret is set', () => {
    const subject = did.generate('pudo-driver:+254700990031');
    const before = process.env.GLOS_ENV;
    try {
      delete process.env.GLOS_ENV;
      expect(auth.mintActorTokenFor(undefined, { role: 'driver', did: subject.id }).access_token).toBeTruthy();
      process.env.GLOS_ENV = 'production';
      expect(() => auth.mintActorTokenFor(undefined, { role: 'driver', did: subject.id })).toThrow(/no client secret/);
      expect(() => auth.mintOperatorToken(undefined)).toThrow(/no client secret/);
    } finally {
      if (before === undefined) delete process.env.GLOS_ENV;
      else process.env.GLOS_ENV = before;
    }
  });

  it('issues and accepts a client-credentials token', () => {
    const { access_token } = auth.issueToken({ sub: 'client-1', type: 'client_credentials' });
    const result = auth.introspect(access_token);
    expect(result.active).toBe(true);
    expect(result.sub).toBe('client-1');
    expect(result.type).toBe('client_credentials');
  });

  it('issues a DID-bound token only for a known DID', () => {
    const doc = did.generate('participant-1');
    const { access_token } = auth.issueToken({ sub: doc.id, type: 'did' });
    expect(auth.introspect(access_token).active).toBe(true);
    expect(() => auth.issueToken({ sub: 'did:glos:unknown', type: 'did' })).toThrow();
  });

  it('rejects tampered tokens', () => {
    const { access_token } = auth.issueToken({ sub: 'client-1', type: 'client_credentials' });
    const tampered = access_token.slice(0, -2) + 'xy';
    expect(auth.introspect(tampered).active).toBe(false);
  });

  it('rejects an expired token', () => {
    // Reach expiry by advancing the clock. A negative/zero ttlSeconds no longer mints an
    // already-dead token — issueToken clamps to a 60s floor (S0).
    const { access_token, expires_in } = auth.issueToken({ sub: 'client-1', type: 'client_credentials' });
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + (expires_in + 1) * 1000);
    try {
      const result = auth.introspect(access_token);
      expect(result.active).toBe(false);
      expect(result.reason).toBe('expired');
    } finally {
      spy.mockRestore();
    }
  });

  it('clamps a caller-supplied lifetime (no permanent credentials)', () => {
    expect(auth.issueToken({ sub: 'c', type: 'client_credentials', ttlSeconds: 999999999 }).expires_in).toBe(MAX_TTL_SECONDS);
    expect(auth.issueToken({ sub: 'c', type: 'client_credentials', ttlSeconds: -1 }).expires_in).toBe(60);
    expect(auth.issueToken({ sub: 'c', type: 'client_credentials' }).expires_in).toBe(DEFAULT_TTL_SECONDS);
  });

  it('mints an actor token whose claims survive the introspect projection (S2)', () => {
    const doc = did.generate('pudo:+254700');
    profiles.upsert({ did: doc.id, tier: 2, status: 'active', capabilities: ['pudo-agent'] });

    const { access_token } = auth.mintActorToken({ role: 'agent', did: doc.id, tenant: 'fleet-1' });
    const r = auth.introspect(access_token);

    expect(r.active).toBe(true);
    expect(r.role).toBe('agent');
    expect(r.did).toBe(doc.id);
    expect(r.tenant).toBe('fleet-1');
    expect(r.tier).toBe(2);
    expect(r.scopes).toContain('parcel:accept'); // proves scopes are projected, not dropped
  });

  it('revokes all of an actor\'s live tokens when tokenVersion is bumped', () => {
    const doc = did.generate('pudo:+254701');
    profiles.upsert({ did: doc.id, tier: 2, status: 'active', capabilities: ['pudo-agent'], tokenVersion: 0 });
    const { access_token } = auth.mintActorToken({ role: 'agent', did: doc.id });
    expect(auth.introspect(access_token).active).toBe(true);

    profiles.bumpTokenVersion(doc.id); // "sign out all my devices"
    const r = auth.introspect(access_token);
    expect(r.active).toBe(false);
    expect(r.reason).toBe('revoked');
  });

  it('signs out an actor with no operational profile — a person or a company', () => {
    const person = did.generate('person:+254702');
    const { access_token } = auth.mintActorToken({ role: 'consumer', did: person.id });
    expect(auth.introspect(access_token).active).toBe(true);
    auth.revokeAll(person.id);
    expect(auth.introspect(access_token)).toMatchObject({ active: false, reason: 'revoked' });
    // A sign-in AFTER the change carries the new counter, so the device that made it stays in.
    expect(auth.introspect(auth.mintActorToken({ role: 'consumer', did: person.id }).access_token).active).toBe(true);
  });

  it('signs out ONE holder of a shared DID by their own key, and leaves the others', () => {
    const company = did.generate('entity:sbg-ke');
    const amina = auth.mintActorToken({ role: 'entity_admin', did: company.id, revocationKey: 'entity-admin:adm_amina' }).access_token;
    const brian = auth.mintActorToken({ role: 'entity_admin', did: company.id, revocationKey: 'entity-admin:adm_brian' }).access_token;
    auth.revokeAll('entity-admin:adm_amina');
    expect(auth.introspect(amina)).toMatchObject({ active: false, reason: 'revoked' });
    expect(auth.introspect(brian).active).toBe(true);
  });

  it('gates the public grant on the client secret once one is configured', () => {
    expect(() => auth.assertClientCredentials(undefined)).not.toThrow(); // unset in tests → open

    const gated = new AuthService(did, profiles);
    (gated as unknown as { clientSecret?: string }).clientSecret = 's3cret';
    expect(() => gated.assertClientCredentials('s3cret')).not.toThrow();
    expect(() => gated.assertClientCredentials('wrong')).toThrow();
    expect(() => gated.assertClientCredentials(undefined)).toThrow();
  });
});
