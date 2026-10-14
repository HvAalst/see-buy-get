// Verifiable Credential registry contracts (UDIW-020/023). W3C-style VCs issued by GLOS,
// anchored to the ledger, with expiry + revocation. M1 issues them (background-check,
// capability); M5 will issue trust badges against the same registry.

export interface VerifiableCredential {
  id: string; // vc_...
  type: string[]; // ['VerifiableCredential', 'BackgroundCheckPassed']
  issuer: string;
  subject: string; // subject DID
  claims: Record<string, unknown>;
  issuedAt: string;
  expiresAt?: string;
  status: 'active' | 'revoked';
  anchorTxId: string;
}

export interface IssueCredentialInput {
  subject: string;
  type: string | string[];
  claims?: Record<string, unknown>;
  /** Time-to-live in ms; omit for a non-expiring credential. */
  ttlMs?: number;
  issuer?: string;
}

export interface CredentialStatus {
  active: boolean;
  reason?: 'revoked' | 'expired' | 'not_found';
  credential?: VerifiableCredential;
}
