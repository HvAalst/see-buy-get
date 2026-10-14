import { ParticipantStatus, Tier } from '../../foundation/data-firewall/data-firewall.types';

// M1 participant domain (T-101/T-102). A master account holds multiple operational roles
// (UDIW-010) and a progressive identity-assurance tier (UDIW-011). The account is operational
// (no PII) — personal data lives in the Identity Vault, referenced by vaultRef.

export enum ParticipantRole {
  Shipper = 'shipper',
  Carrier = 'carrier',
  WarehouseOperator = 'warehouse_operator',
  CustomsBroker = 'customs_broker',
}

export interface RoleRegistration {
  role: ParticipantRole;
  /** 'active' once the account tier meets the role's minimum, else 'pending'. */
  status: 'pending' | 'active';
  /** Minimum identity tier required to activate this role. */
  requiredTier: Tier;
  addedAt: string;
}

/** Operational master account — NO PII (that's in the vault behind vaultRef). */
export interface MasterAccount {
  accountId: string;
  did?: string;
  tier: Tier;
  status: ParticipantStatus;
  roles: RoleRegistration[];
  vaultRef: string;
  jurisdiction?: string;
  createdAt: string;
}

/** Public, PII-free view returned by the API. */
export interface AccountSummary {
  accountId: string;
  did?: string;
  tier: Tier;
  status: ParticipantStatus;
  roles: RoleRegistration[];
  jurisdiction?: string;
  capabilities: string[];
}
