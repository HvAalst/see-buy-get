import { hashPhone, isPlausiblePhone, normalizePhone } from './phone';

describe('phone (identity join key)', () => {
  it('normalizes the same number in any format to one E.164', () => {
    const forms = ['0712 345 678', '+254712345678', '254712345678', '00254712345678', '(0712)-345.678'];
    const canonical = normalizePhone(forms[0]);
    expect(canonical).toBe('+254712345678');
    for (const f of forms) expect(normalizePhone(f)).toBe(canonical);
  });

  it('hashes to a stable, non-reversible join key — same number → same hash, regardless of format', () => {
    const a = hashPhone('0712 345 678');
    const b = hashPhone('+254712345678');
    expect(a).toBe(b); // formats collapse to one identity
    expect(a).toMatch(/^[0-9a-f]{64}$/); // sha-256 hex
    expect(a).not.toContain('712345678'); // the number is not recoverable from the hash
  });

  it('separates different numbers', () => {
    expect(hashPhone('+254712345678')).not.toBe(hashPhone('+254712345679'));
  });

  it('treats an empty/blank number as "no link" (empty hash), not a collision', () => {
    expect(hashPhone('')).toBe('');
    expect(hashPhone('   ')).toBe('');
    expect(normalizePhone('')).toBe('');
  });

  it('rejects implausibly short numbers', () => {
    expect(isPlausiblePhone('123')).toBe(false);
    expect(isPlausiblePhone('+254712345678')).toBe(true);
  });
});
