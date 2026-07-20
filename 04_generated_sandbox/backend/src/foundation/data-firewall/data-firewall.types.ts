// Data-firewall contracts (T-003, §3.4). The type system encodes the separation:
// PiiRecord lives only in the vault; OperationalProfile is the only thing the
// Operational Core stores — and it carries no PII, just a vault reference.

/** Sensitive personal data — stored encrypted in the Identity Vault, never in the core. */
export interface PiiRecord {
  fullName: string;
  dateOfBirth?: string;
  governmentId?: string;
  email?: string;
  phone?: string;
  address?: string;
  [extra: string]: unknown;
}

/** Opaque handle to a vault record. Safe to store in the Operational Core. */
export interface VaultReference {
  vaultRef: string;
  /** Residency region the PII is bound to (e.g. 'EU'); non-PII tag. */
  region: string;
}

/** Audited PII access (consent receipt, §3.4). */
export interface VaultAccess {
  /** Why the PII is being revealed (e.g. 'kyc-review', 'customs-handover'). */
  purpose: string;
  /** DID of the requester, for the audit trail. */
  requesterDid: string;
}

export interface VaultAccessRecord extends VaultAccess {
  vaultRef: string;
  at: string;
}

export type Tier = 1 | 2 | 3 | 4;
export type ParticipantStatus = 'pending' | 'active' | 'suspended';

/** The ONLY shape the Operational Core persists. No PII — references the vault by handle. */
export interface OperationalProfile {
  did: string;
  /** Opaque pointer to the participant's PII in the vault (not PII itself). */
  vaultRef?: string;
  tier: Tier;
  status: ParticipantStatus;
  /** Capability VC ids / tags — pseudonymous. */
  capabilities: string[];
  /** Pseudonymous reputation score. */
  reputationScore?: number;
  /** ISO country tag for routing/residency — non-PII. */
  jurisdiction?: string;
  /** Free-form non-PII operational metadata (scanned by the firewall on write). */
  metadata?: Record<string, unknown>;
  /**
   * Revocation counter (S2). Copied into an actor token at mint and compared on every introspect;
   * incrementing it invalidates all of this actor's live tokens ("sign out all my devices"). O(1),
   * no denylist, survives restart because the profile is persisted.
   */
  tokenVersion?: number;
}
