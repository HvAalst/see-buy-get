import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { deploymentSecret } from '../runtime/secrets';

/**
 * FieldEncryption — AES-256-GCM encryption for PII at rest in the Identity Vault (T-003).
 * Output blob is base64(iv | authTag | ciphertext). The key derives from GLOS_VAULT_KEY
 * (a sandbox default here); production injects a real KMS/HSM-managed key.
 */
@Injectable()
export class FieldEncryption {
  private readonly key = createHash('sha256')
    .update(deploymentSecret('GLOS_VAULT_KEY', 'glos-dev-vault-key-change-me'))
    .digest(); // 32 bytes

  /**
   * THE DEFAULT KEY IS PRINTED IN THIS FILE, so outside a sandbox the server refuses to start without a
   * real one.
   *
   * While the vault lived only in memory, the default key protected nothing that outlived the process.
   * The vault now keeps its ciphertext on disk, and ciphertext under a key anyone can read in the source
   * is the Golden Record in plain text with extra steps. Refused at boot rather than warned about: a
   * warning in a deploy log is read after the file has been copied.
   *
   * The refusal is where the key is read, above (`deploymentSecret`): it used to ask only whether the variable
   * was set, and the example environment file sets it — to the printed key.
   */

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
