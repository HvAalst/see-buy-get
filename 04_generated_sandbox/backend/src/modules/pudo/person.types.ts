import { ActorRole } from '../../foundation/auth/auth.types';

/**
 * The person identity model (S20) — "one person, one account, many roles."
 *
 * A human is a single identity, keyed by their verified phone, that CARRIES roles. Roles attach to the
 * person; they are never separate accounts. A driver who also sends a parcel acts under the same
 * identity — the fragmentation the old email-per-role Account forced is gone.
 *
 * The data firewall holds: the Person's key is a `phoneHash` (peppered sha256, never the cleartext
 * number), its id is a pseudonymous DID, and its cleartext phone lives only in the Identity Vault.
 */

/** The roles a person may hold. These are the PRODUCT-facing names; `ROLE_TO_ACTOR` maps to token roles. */
export type PersonRole = 'consumer' | 'driver' | 'agent' | 'mdp' | 'fleet_manager' | 'vendor';

export type RoleStatus = 'active' | 'pending' | 'suspended';

/**
 * One role a person may act as. `entityDid` is the domain entity's own DID (the existing
 * agent/driver/mdp/vendor/manager records keep theirs); for the `consumer` role the entity IS the
 * person, so `entityDid === personDid`. `tenant` is the scope boundary (a fleet driver/manager's
 * owning manager DID), passed straight through to the actor token exactly as the role apps do today.
 */
export interface RoleLink {
  role: PersonRole;
  entityDid: string;
  tenant?: string;
  status: RoleStatus;
  linkedAt: string;
}

export interface Person {
  /** did:glos:… — stable pseudonymous id. The actor token's subject when acting as the consumer. */
  personDid: string;
  /** sha256(pepper:e164) — the unique key and the parcel/role join key. Never the cleartext number. */
  phoneHash: string;
  /** scrypt(pin, pinSalt) — set after OTP verification. Absent until the person chooses a PIN. */
  pinHash?: string;
  pinSalt?: string;
  /** Brute-force defence on the 4-digit PIN: wrong attempts, and a lockout window once exceeded. */
  pinAttempts?: number;
  pinLockedUntil?: number;
  /** Identity Vault reference for the person's cleartext PII (phone; later avatar/name/address). */
  vaultRef?: string;
  roles: RoleLink[];
  createdAt: string;
}

/** The safe, PII-free projection returned to a signed-in person (no hashes, no vault ref, no PIN). */
export interface PersonView {
  personId: string; // the personDid
  roles: Array<{ role: PersonRole; entityDid: string; status: RoleStatus }>;
  hasPin: boolean;
  createdAt: string;
}

/**
 * PersonRole → ActorRole. The token vocabulary names some roles differently (a PUDO participant's app
 * token is `agent`; a vendor operator's is `genesis`) — this is the single mapping the role-switch mint
 * draws from, so a person's held role becomes the right actor token with the right scopes.
 */
export const ROLE_TO_ACTOR: Record<PersonRole, ActorRole> = {
  consumer: 'consumer',
  driver: 'driver',
  agent: 'agent',
  mdp: 'mdp',
  fleet_manager: 'fleet_manager',
  vendor: 'genesis',
};

export function toView(person: Person): PersonView {
  return {
    personId: person.personDid,
    roles: person.roles.map((r) => ({ role: r.role, entityDid: r.entityDid, status: r.status })),
    hasPin: Boolean(person.pinHash),
    createdAt: person.createdAt,
  };
}
