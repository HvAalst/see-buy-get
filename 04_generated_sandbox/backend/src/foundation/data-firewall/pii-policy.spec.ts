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
});
