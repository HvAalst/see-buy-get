import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { LedgerService } from '../ledger/ledger.service';
import { EventBus } from '../events/event-bus.service';
import { GlosEvent } from '../events/glos-events';
import { CredentialStatus, IssueCredentialInput, VerifiableCredential } from './credential.types';

/**
 * CredentialService — the GLOS Verifiable Credential registry (UDIW-020/023).
 * Issues anchored W3C-style VCs, verifies status + expiry, and revokes. Emits
 * `identity.vc_issued` / `identity.vc_revoked` on the cascade spine.
 */
@Injectable()
export class CredentialService {
  private readonly registry = new Map<string, VerifiableCredential>();

  constructor(
    private readonly ledger: LedgerService,
    private readonly events: EventBus,
  ) {}

  issue(input: IssueCredentialInput): VerifiableCredential {
    const types = Array.isArray(input.type) ? input.type : [input.type];
    if (!types.includes('VerifiableCredential')) types.unshift('VerifiableCredential');

    const issuedAt = new Date();
    const id = `vc_${randomBytes(12).toString('hex')}`;
    const core = {
      id,
      type: types,
      issuer: input.issuer ?? 'did:glos:issuer',
      subject: input.subject,
      claims: input.claims ?? {},
      issuedAt: issuedAt.toISOString(),
      expiresAt: input.ttlMs ? new Date(issuedAt.getTime() + input.ttlMs).toISOString() : undefined,
    };
    const anchor = this.ledger.anchor(core);
    const credential: VerifiableCredential = { ...core, status: 'active', anchorTxId: anchor.txId };
    this.registry.set(id, credential);

    void this.events
      .publish(GlosEvent.Identity.VcIssued, { id, type: types, subject: input.subject }, { source: 'credentials' })
      .catch(() => undefined);
    return credential;
  }

  resolve(id: string): VerifiableCredential | undefined {
    return this.registry.get(id);
  }

  verify(id: string): CredentialStatus {
    const credential = this.registry.get(id);
    if (!credential) return { active: false, reason: 'not_found' };
    if (credential.status === 'revoked') return { active: false, reason: 'revoked', credential };
    if (this.isExpired(credential)) return { active: false, reason: 'expired', credential };
    return { active: true, credential };
  }

  revoke(id: string): boolean {
    const credential = this.registry.get(id);
    if (!credential || credential.status === 'revoked') return false;
    credential.status = 'revoked';
    void this.events
      .publish(GlosEvent.Identity.VcRevoked, { id, subject: credential.subject }, { source: 'credentials' })
      .catch(() => undefined);
    return true;
  }

  /** Active, non-expired credentials for a subject, optionally filtered by type. */
  listForSubject(subject: string, type?: string): VerifiableCredential[] {
    return Array.from(this.registry.values()).filter(
      (c) =>
        c.subject === subject &&
        c.status === 'active' &&
        !this.isExpired(c) &&
        (type ? c.type.includes(type) : true),
    );
  }

  hasValid(subject: string, type: string): boolean {
    return this.listForSubject(subject, type).length > 0;
  }

  private isExpired(c: VerifiableCredential): boolean {
    return Boolean(c.expiresAt && new Date(c.expiresAt).getTime() <= Date.now());
  }
}
