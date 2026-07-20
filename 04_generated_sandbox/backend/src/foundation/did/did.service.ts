import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { LedgerService } from '../ledger/ledger.service';
import { EventBus } from '../events/event-bus.service';
import { GlosEvent } from '../events/glos-events';
import { DidDocument, DID_METHOD, VerificationMethod } from './did.types';

/**
 * DidService — generates and resolves GLOS DIDs (T-005, UDIW-030).
 * On generation the DID document is anchored to the permissioned ledger (T-004), stored in
 * the registry, and a `did.generated` event is published (T-002) — the cascade spine that
 * later unblocks M2 party anchoring. Resolvable by any module (M2 linking, M6 auth shim).
 */
@Injectable()
export class DidService {
  private readonly registry = new Map<string, DidDocument>();

  constructor(
    private readonly ledger: LedgerService,
    private readonly events: EventBus,
  ) {}

  /**
   * Generate a DID for a controller. In production this is triggered by M1 on successful
   * verification; exposed here so the auth shim and tests can bootstrap identities.
   */
  generate(controller: string, metadata?: Record<string, unknown>): DidDocument {
    if (!controller || !controller.trim()) {
      throw new Error('A controller is required to generate a DID');
    }
    const id = `did:${DID_METHOD}:${randomBytes(16).toString('hex')}`;
    const verificationMethod: VerificationMethod[] = [
      {
        id: `${id}#keys-1`,
        type: 'Ed25519VerificationKey2020',
        controller,
        // Placeholder key material for the sandbox (real keys come from M1 wallet/HSM).
        publicKeyMultibase: `z${randomBytes(32).toString('hex')}`,
      },
    ];

    const core = { id, controller, verificationMethod, created: new Date().toISOString(), metadata };
    const anchor = this.ledger.anchor(core);
    const document: DidDocument = { ...core, anchor };

    this.registry.set(id, document);

    // Fire-and-forget domain event (the cascade spine). Delivery + retry is the bus's job;
    // we don't block DID issuance on subscribers.
    void this.events
      .publish(GlosEvent.Did.Generated, { did: id, controller }, { source: 'did' })
      .catch(() => undefined);

    return document;
  }

  resolve(did: string): DidDocument | undefined {
    return this.registry.get(did);
  }

  exists(did: string): boolean {
    return this.registry.has(did);
  }

  isController(did: string, controller: string): boolean {
    const doc = this.registry.get(did);
    return Boolean(doc && doc.controller === controller);
  }
}
