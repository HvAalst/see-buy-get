import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { FieldEncryption } from './field-encryption.service';
import { EventBus } from '../events/event-bus.service';
import { GlosEvent } from '../events/glos-events';
import { DATA_DIR, PersistentMap, persistenceEnabled } from '../store/persistent-map';
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
  /**
   * THE GOLDEN RECORD SURVIVES A RESTART — ciphertext only, never a readable field.
   *
   * This was an in-memory Map while every record pointing INTO it (a driver's vaultRef, a person's) was
   * persisted, so each restart left the whole network holding handles to nothing: no courier's phone, no
   * person's legal name. PersonService learned to degrade around it; the operator console could not,
   * because "how do we reach this courier" has no degraded answer. Entries are AES-256-GCM blobs (see
   * FieldEncryption, which refuses the source-code key outside a sandbox), so what reaches the disk is
   * what the vault was always meant to hold at rest.
   */
  private readonly records = new PersistentMap<string, StoredEntry>('identity-vault');
  private readonly accessLog: VaultAccessRecord[] = [];
  private readonly logger = new Logger(IdentityVault.name);

  /**
   * THE RECEIPTS SURVIVE A RESTART TOO — who read whose record, for what, when. No PII: an opaque ref, a
   * requester, a purpose and a time.
   *
   * Once the records were durable, a receipt log that vanished on restart had it backwards: the personal
   * data outlived the record of who had read it. The console now tells staff "this look is recorded
   * against your account", and that sentence has to be true the next morning.
   *
   * APPEND-ONLY, one JSON line per receipt, rather than a PersistentMap: a snapshot store rewrites its whole
   * file on every change, and this is written on every reveal. Off under Jest by the same rule as every
   * other store here.
   */
  private readonly receiptFile?: string;

  constructor(
    private readonly crypto: FieldEncryption,
    private readonly events: EventBus,
  ) {
    if (!persistenceEnabled()) return;
    this.receiptFile = join(DATA_DIR, 'identity-vault-access.jsonl');
    if (!existsSync(this.receiptFile)) return;
    // The newest ACCESS_LOG_CAP, as getAccessLog has always answered; the file itself keeps them all.
    const lines = readFileSync(this.receiptFile, 'utf8').split('\n').filter(Boolean).slice(-IdentityVault.ACCESS_LOG_CAP);
    for (const line of lines) {
      try {
        this.accessLog.push(JSON.parse(line) as VaultAccessRecord);
      } catch {
        this.logger.warn('skipped an unreadable line in the vault access log');
      }
    }
  }

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
    if (this.receiptFile) {
      // Written before the PII is handed back: a reveal whose receipt could not be kept is refused, never
      // served unrecorded — an audit trail with gaps in it is worse than one that says it stopped.
      mkdirSync(DATA_DIR, { recursive: true });
      appendFileSync(this.receiptFile, JSON.stringify(record) + '\n');
    }
    this.accessLog.push(record);
    if (this.accessLog.length > IdentityVault.ACCESS_LOG_CAP) this.accessLog.splice(0, this.accessLog.length - IdentityVault.ACCESS_LOG_CAP);
    void this.events
      .publish(GlosEvent.Identity.ConsentReceiptLogged, record, { source: 'identity-vault' })
      .catch(() => undefined);

    return this.crypto.decryptObject<PiiRecord>(entry.ciphertext);
  }

  /**
   * FORGET A RECORD — its owner closed their account (2026-10-22). The ciphertext goes; a receipt says who asked and
   * why, as every reveal does, so the trail shows a record was forgotten and never what it held.
   */
  forget(vaultRef: string, access: VaultAccess): void {
    if (!this.records.has(vaultRef)) return;
    const record: VaultAccessRecord = { ...access, vaultRef, at: new Date().toISOString() };
    if (this.receiptFile) {
      mkdirSync(DATA_DIR, { recursive: true });
      appendFileSync(this.receiptFile, JSON.stringify(record) + '\n');
    }
    this.accessLog.push(record);
    if (this.accessLog.length > IdentityVault.ACCESS_LOG_CAP) this.accessLog.splice(0, this.accessLog.length - IdentityVault.ACCESS_LOG_CAP);
    this.records.delete(vaultRef);
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
