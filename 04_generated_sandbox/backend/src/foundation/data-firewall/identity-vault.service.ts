import { Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { FieldEncryption } from './field-encryption.service';
import { EventBus } from '../events/event-bus.service';
import { GlosEvent } from '../events/glos-events';
import { PiiRecord, VaultAccess, VaultAccessRecord, VaultReference } from './data-firewall.types';

interface StoredEntry {
  vaultRef: string;
  region: string;
  ciphertext: string;
  createdAt: string;
}

/**
 * IdentityVault — the encrypted PII side of the data firewall (T-003, §3.4).
 * PII is encrypted at rest (AES-256-GCM) and only ever leaves via `reveal`, which records
 * a cryptographic-style access receipt and emits a consent/audit event. The Operational
 * Core only ever holds the returned opaque VaultReference.
 */
@Injectable()
export class IdentityVault {
  /** Cap on the retained in-memory access log. Newest kept, oldest dropped (getAccessLog copies it). */
  private static readonly ACCESS_LOG_CAP = 50_000;
  private readonly records = new Map<string, StoredEntry>();
  private readonly accessLog: VaultAccessRecord[] = [];

  constructor(
    private readonly crypto: FieldEncryption,
    private readonly events: EventBus,
  ) {}

  /** Encrypt and store a PII record. Returns an opaque, core-safe reference. */
  store(pii: PiiRecord, options: { region?: string } = {}): VaultReference {
    const vaultRef = `vault_${randomBytes(16).toString('hex')}`;
    const region = options.region ?? 'GLOBAL';
    this.records.set(vaultRef, {
      vaultRef,
      region,
      ciphertext: this.crypto.encryptObject(pii),
      createdAt: new Date().toISOString(),
    });
    return { vaultRef, region };
  }

  /** Replace the PII behind an existing ref (e.g. a profile edit), keeping the same opaque handle. */
  update(vaultRef: string, pii: PiiRecord): void {
    const entry = this.records.get(vaultRef);
    if (!entry) throw new NotFoundException(`Vault record not found: ${vaultRef}`);
    entry.ciphertext = this.crypto.encryptObject(pii);
  }

  /** Reveal PII for an authorized purpose. Logs + audits every access (consent receipt). */
  reveal(vaultRef: string, access: VaultAccess): PiiRecord {
    const entry = this.records.get(vaultRef);
    if (!entry) throw new NotFoundException(`Vault record not found: ${vaultRef}`);

    const record: VaultAccessRecord = { ...access, vaultRef, at: new Date().toISOString() };
    this.accessLog.push(record);
    if (this.accessLog.length > IdentityVault.ACCESS_LOG_CAP) this.accessLog.splice(0, this.accessLog.length - IdentityVault.ACCESS_LOG_CAP);
    void this.events
      .publish(GlosEvent.Identity.ConsentReceiptLogged, record, { source: 'identity-vault' })
      .catch(() => undefined);

    return this.crypto.decryptObject<PiiRecord>(entry.ciphertext);
  }

  exists(vaultRef: string): boolean {
    return this.records.has(vaultRef);
  }

  /** The at-rest entry metadata (no ciphertext, never PII) — for residency/audit tooling. */
  describe(vaultRef: string): Omit<StoredEntry, 'ciphertext'> | undefined {
    const entry = this.records.get(vaultRef);
    if (!entry) return undefined;
    return { vaultRef: entry.vaultRef, region: entry.region, createdAt: entry.createdAt };
  }

  getAccessLog(): ReadonlyArray<VaultAccessRecord> {
    return [...this.accessLog];
  }
}
