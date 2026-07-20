import { Test } from '@nestjs/testing';
import { AuthService, DEFAULT_TTL_SECONDS, MAX_TTL_SECONDS } from './auth.service';
import { DidService } from '../did/did.service';
import { LedgerService } from '../ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../ledger/ledger.types';
import { EventBus } from '../events/event-bus.service';

describe('AuthService', () => {
  let auth: AuthService;
  let did: DidService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AuthService,
        DidService,
        LedgerService,
        EventBus,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
    }).compile();
    auth = moduleRef.get(AuthService);
    did = moduleRef.get(DidService);
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

  it('gates the public grant on the client secret once one is configured', () => {
    expect(() => auth.assertClientCredentials(undefined)).not.toThrow(); // unset in tests → open

    const gated = new AuthService(did);
    (gated as unknown as { clientSecret?: string }).clientSecret = 's3cret';
    expect(() => gated.assertClientCredentials('s3cret')).not.toThrow();
    expect(() => gated.assertClientCredentials('wrong')).toThrow();
    expect(() => gated.assertClientCredentials(undefined)).toThrow();
  });
});
