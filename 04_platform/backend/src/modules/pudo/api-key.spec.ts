import { ApiKeyService, ANONYMOUS } from './api-key.service';

/**
 * Merchant keys — who is asking, on a surface where anybody may ask.
 *
 * The rules worth pinning are all about EXPOSURE rather than permission: which key may sit in a page,
 * which may never leave a server, and what a stolen copy of this table is worth.
 */
describe('merchant API keys', () => {
  let keys: ApiKeyService;
  beforeEach(() => {
    keys = new ApiKeyService(); // a key store needs nothing but keys
  });

  it('says what it is in the key itself — kind, then world', () => {
    // A glance at a config file should tell you whether it points at anything real.
    expect(keys.issue('ven_1', 'publishable', 'test').secret).toMatch(/^pk_test_[0-9a-f]{32}$/);
    expect(keys.issue('ven_1', 'secret', 'live').secret).toMatch(/^sk_live_[0-9a-f]{48}$/);
  });

  it('shows a secret ONCE and keeps only a hash', () => {
    // So a stolen database is a list of hashes rather than a set of working credentials — and so
    // "I lost my key" has exactly one honest answer: make another and revoke the old one.
    const { key, secret } = keys.issue('ven_1', 'secret', 'live');
    expect(key.hash).toBeDefined();
    expect(key.value).toBeUndefined();
    expect(JSON.stringify(keys.list('ven_1'))).not.toContain(secret);
    expect(keys.list('ven_1')[0].value).toBeUndefined();
    expect(keys.list('ven_1')[0].hint).toBe(secret.slice(-4)); // enough to tell two keys apart, useless alone
  });

  it('keeps a publishable key whole, because it was never a secret', () => {
    // It lives in a page in plain sight. Hiding it from its owner, who has to paste it into a template
    // again the next time they rebuild one, would be theatre.
    const { secret } = keys.issue('ven_1', 'publishable', 'live');
    expect(keys.list('ven_1')[0].value).toBe(secret);
  });

  it('resolves a key to its store, and remembers that it was used', () => {
    const { key, secret } = keys.issue('ven_7', 'secret', 'test');
    const caller = keys.resolve(secret);
    expect(caller).toMatchObject({ kind: 'secret', mode: 'test', vendorId: 'ven_7', keyId: key.keyId });
    expect(caller.rateKey).toBe(key.keyId); // the limit is theirs, not their visitors' shared one
    expect(keys.list('ven_7')[0].lastUsedAt).toBeDefined(); // which key is the stale one, answerable
  });

  it('treats no key as anonymous and a wrong key as an error', () => {
    // The quote surface is public and stays so. But silently degrading a TYPO to anonymous would let a
    // broken integration look like a working one right until the limits started to matter.
    expect(keys.resolve(undefined)).toEqual(ANONYMOUS);
    expect(keys.resolve('   ')).toEqual(ANONYMOUS);
    expect(() => keys.resolve('pk_live_nope')).toThrow(/not one of ours/);
    expect(() => keys.resolve('sk_live_nope')).toThrow(/not one of ours/);
  });

  it('stops a revoked key working, and keeps the record', () => {
    const { key, secret } = keys.issue('ven_1', 'secret', 'live');
    keys.revoke('ven_1', key.keyId);
    expect(() => keys.resolve(secret)).toThrow(/revoked/);
    expect(keys.list('ven_1')[0].revokedAt).toBeDefined(); // kept, not deleted: "what was that key doing"
    expect(() => keys.revoke('ven_1', key.keyId)).not.toThrow(); // revoking twice is not an error
  });

  it('will not let one store touch another’s keys', () => {
    const { key } = keys.issue('ven_1', 'secret', 'live');
    expect(() => keys.revoke('ven_2', key.keyId)).toThrow(/No such key/);
    expect(keys.list('ven_2')).toEqual([]);
  });

  it('lets only a server-side key see the costed route', () => {
    // A key that sits in a page is a key a competitor can read off the page.
    expect(ApiKeyService.seesBreakdown(keys.resolve(keys.issue('v', 'secret', 'live').secret))).toBe(true);
    expect(ApiKeyService.seesBreakdown(keys.resolve(keys.issue('v', 'publishable', 'live').secret))).toBe(false);
    expect(ApiKeyService.seesBreakdown(ANONYMOUS)).toBe(false);
  });
});
