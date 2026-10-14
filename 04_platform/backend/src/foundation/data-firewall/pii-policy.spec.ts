import { assertNoPii, DataFirewallViolation } from './pii-policy';

describe('assertNoPii (firewall guard)', () => {
  it('passes a clean operational profile', () => {
    expect(() =>
      assertNoPii({
        did: 'did:glos:abc',
        vaultRef: 'vault_123',
        tier: 2,
        status: 'active',
        capabilities: ['dg-certified', 'fragile-handling'],
        reputationScore: 4.2,
        jurisdiction: 'NL',
      }),
    ).not.toThrow();
  });

  it('rejects a top-level PII field by name', () => {
    expect(() => assertNoPii({ did: 'did:glos:abc', fullName: 'Jane Doe' })).toThrow(DataFirewallViolation);
  });

  it('rejects PII nested in metadata, with the path', () => {
    const call = () => assertNoPii({ did: 'x', metadata: { driver: { dateOfBirth: '1990-01-01' } } });
    expect(call).toThrow(DataFirewallViolation);
    expect(call).toThrow('metadata.driver.dateOfBirth');
  });

  it('normalizes separators (date_of_birth, phone-number)', () => {
    expect(() => assertNoPii({ date_of_birth: 'x' })).toThrow(DataFirewallViolation);
    expect(() => assertNoPii({ 'phone-number': 'x' })).toThrow(DataFirewallViolation);
  });

  it('catches email-like string values as a backstop', () => {
    expect(() => assertNoPii({ note: 'contact me at jane@example.com' })).toThrow(DataFirewallViolation);
  });

  it('catches compound qualifiers that evade the exact match (camelCase tokens)', () => {
    // These all passed the old normalizeKey exact-match and leaked PII into the operational core.
    for (const field of ['senderMobile', 'receiverMobile', 'buyerEmail', 'contactPhone', 'physicalAddress']) {
      expect(() => assertNoPii({ [field]: 'x' })).toThrow(DataFirewallViolation);
    }
  });

  it('does not over-match benign compounds that merely contain a weak word', () => {
    // `name`/`photo`/`city` are excluded from the token set precisely to keep these clean.
    expect(() => assertNoPii({ shopName: 'Mama Sarah', companyName: 'Acme', displayName: 'S' })).not.toThrow();
    expect(() => assertNoPii({ contentPhotoRef: 'ref-1', dropoffPhotoRef: 'ref-2' })).not.toThrow();
    expect(() => assertNoPii({ destZone: 'SouthTown', trackingKey: 'trk_1' })).not.toThrow();
  });
});
