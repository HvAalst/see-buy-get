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

/**
 * A DID DOCUMENT AS ANYBODY MAY READ IT. The controller registered for a shop, a driver or a fleet is its mobile number
 * (`pudo:<mobile>`), and the identities of shops are on the public map: answering with it handed every shopkeeper's
 * number to whoever asked. So the document names itself as its controller unless the controller is another DID, and it
 * leaves out the ledger receipt, whose hash covers the original document — phone included — and everything else in it
 * is public, so a phone number could be found by trying them.
 */
export type PublicDidDocument = Omit<DidDocument, 'anchor'>;

export function publicDidDocument(doc: DidDocument): PublicDidDocument {
  const own = (c: string) => (c.startsWith('did:') ? c : doc.id);
  return {
    id: doc.id,
    controller: own(doc.controller),
    verificationMethod: doc.verificationMethod.map((v) => ({ ...v, controller: own(v.controller) })),
    created: doc.created,
    ...(doc.metadata ? { metadata: doc.metadata } : {}),
  };
}
