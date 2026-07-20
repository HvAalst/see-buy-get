import { FieldEncryption } from './field-encryption.service';

describe('FieldEncryption', () => {
  const crypto = new FieldEncryption();

  it('round-trips a string', () => {
    const blob = crypto.encrypt('Jane Doe');
    expect(crypto.decrypt(blob)).toBe('Jane Doe');
  });

  it('round-trips an object', () => {
    const pii = { fullName: 'Jane Doe', governmentId: 'P1234567' };
    const blob = crypto.encryptObject(pii);
    expect(crypto.decryptObject(blob)).toEqual(pii);
  });

  it('does not leave plaintext in the at-rest blob', () => {
    const blob = crypto.encrypt('Jane Doe');
    expect(blob).not.toContain('Jane');
    // Distinct IV each time → distinct ciphertext for identical input.
    expect(crypto.encrypt('Jane Doe')).not.toBe(blob);
  });

  it('fails to decrypt a tampered blob (GCM auth)', () => {
    const blob = crypto.encrypt('secret');
    const tampered = Buffer.from(blob, 'base64');
    tampered[tampered.length - 1] ^= 0xff;
    expect(() => crypto.decrypt(tampered.toString('base64'))).toThrow();
  });
});
