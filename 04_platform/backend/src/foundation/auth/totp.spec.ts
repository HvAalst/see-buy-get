import { fromBase32, toBase32, totpCode, totpStep, verifyTotp } from './totp';

/** The published test vectors (RFC 6238 appendix B, SHA-1), cut to the six digits every authenticator shows. */
describe('time-based one-time codes', () => {
  const secret = toBase32(Buffer.from('12345678901234567890', 'ascii'));

  it('matches RFC 6238 — so any authenticator app agrees with this server', () => {
    const vectors: Array<[number, string]> = [
      [59, '287082'],
      [1111111109, '081804'],
      [1111111111, '050471'],
      [1234567890, '005924'],
      [2000000000, '279037'],
    ];
    for (const [seconds, code] of vectors) expect(totpCode(secret, totpStep(seconds * 1000))).toBe(code);
  });

  it('round-trips base32 and ignores the spaces and case a person types', () => {
    expect(fromBase32(secret.toLowerCase().replace(/(.{4})/g, '$1 ')).toString('ascii')).toBe('12345678901234567890');
  });

  it('refuses anything that is not six digits, and a step already used', () => {
    const now = 1234567890 * 1000;
    expect(verifyTotp(secret, '00592', now)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
    expect(verifyTotp(secret, '005 924', now)).toBe(totpStep(now));
    expect(verifyTotp(secret, '005924', now, totpStep(now))).toBeNull();
  });

  it('accepts one step either side for a drifting phone clock, and no further', () => {
    const now = 1234567890 * 1000;
    const at = totpStep(now);
    expect(verifyTotp(secret, totpCode(secret, at - 1), now)).toBe(at - 1);
    expect(verifyTotp(secret, totpCode(secret, at + 1), now)).toBe(at + 1);
    // A minute old is a code somebody wrote down, not a slow clock.
    expect(verifyTotp(secret, totpCode(secret, at - 2), now)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, at + 2), now)).toBeNull();
  });
});
