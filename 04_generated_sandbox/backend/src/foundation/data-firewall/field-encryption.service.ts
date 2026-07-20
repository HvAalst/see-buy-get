import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';

/**
 * FieldEncryption — AES-256-GCM encryption for PII at rest in the Identity Vault (T-003).
 * Output blob is base64(iv | authTag | ciphertext). The key derives from GLOS_VAULT_KEY
 * (a sandbox default here); production injects a real KMS/HSM-managed key.
 */
@Injectable()
export class FieldEncryption {
  private readonly key = createHash('sha256')
    .update(process.env.GLOS_VAULT_KEY || 'glos-dev-vault-key-change-me')
    .digest(); // 32 bytes

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return Buffer.concat([iv, authTag, ciphertext]).toString('base64');
  }

  decrypt(blob: string): string {
    const buf = Buffer.from(blob, 'base64');
    const iv = buf.subarray(0, 12);
    const authTag = buf.subarray(12, 28);
    const ciphertext = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
  }

  encryptObject(value: unknown): string {
    return this.encrypt(JSON.stringify(value));
  }

  decryptObject<T>(blob: string): T {
    return JSON.parse(this.decrypt(blob)) as T;
  }
}
