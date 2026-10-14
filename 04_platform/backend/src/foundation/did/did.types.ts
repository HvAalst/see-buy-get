import { AnchorReceipt } from '../ledger/ledger.types';

// Decentralized Identifier primitive (T-005, UDIW-030). W3C-style DID document,
// anchored to the permissioned ledger. The participant remains the controller.

export interface VerificationMethod {
  id: string;
  type: string;
  controller: string;
  publicKeyMultibase: string;
}

export interface DidDocument {
  /** e.g. did:glos:9f1c… */
  id: string;
  /** The controller identifier (participant/account reference). Controls the document. */
  controller: string;
  verificationMethod: VerificationMethod[];
  created: string;
  /** Ledger receipt proving the document was anchored. */
  anchor: AnchorReceipt;
  metadata?: Record<string, unknown>;
}

export const DID_METHOD = 'glos';
