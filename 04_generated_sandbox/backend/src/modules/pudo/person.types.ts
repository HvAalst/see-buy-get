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
  /**
   * Brute-force defence on the 4-digit PIN: wrong attempts, and the moment the PIN locked. A locked PIN stays
   * locked until the phone is verified again by code. It used to open itself after fifteen minutes, which let
   * anybody who knew the number try twenty PINs an hour, every hour, with the owner never told.
   */
  pinAttempts?: number;
  pinLockedAt?: string;
  /** The old fifteen-minute window, still honoured while it runs so a record written before the change stays locked. */
  pinLockedUntil?: number;
  /** When the PIN was last set or changed. */
  pinChangedAt?: string;
  /** Identity Vault reference for the person's cleartext PII (phone + displayName; later address). */
  vaultRef?: string;
  /** Opaque handle to the person's avatar image (S29). The bytes are owner-gated in MediaService; the
   *  person carries only the id, and replacing it purges the old blob. */
  avatarMediaId?: string;
  /**
   * THE SECOND CHANNEL. A phone number can be lost, deregistered or handed to somebody else by an operator; an
   * inbox is what a person still holds when that happens. Confirmed by a code before it is relied on. The address
   * itself is in the vault; here is its key (one inbox, one account), a masked form to show, and when it was proved.
   */
  emailHash?: string;
  emailMasked?: string;
  emailVerifiedAt?: string;
  /** A number change still inside its 24 hours — see PhoneChange. Cleared when it is undone or the window closes. */
  phoneChange?: PhoneChange;
  roles: RoleLink[];
  createdAt: string;
}

/**
 * A NUMBER THAT MOVED, FOR AS LONG AS IT CAN BE MOVED BACK.
 *
 * Whoever knows the PIN can move an account to their own number — a colleague, say — and the owner would be
 * locked out for good. So for 24 hours the move can be undone: with the OLD number and the PIN as it was
 * (kept here, because the mover may change it), or with a code to the email. Until the window closes the old
 * number is held: nobody else can register it, so there is somewhere to move back to.
 */
export interface PhoneChange {
  fromHash: string;
  at: string;
  undoUntil: string;
  /** Who moved it: the person signed in with their PIN, the inbox when the number was gone, or two members of staff. */
  how: 'self' | 'email' | 'staff';
  /** The PIN as it was before the move — the mover may know the PIN and change it; the owner knows this one. */
  pinHash?: string;
  pinSalt?: string;
  /** Wrong tries at undoing it with the old number. Five, and only the email can undo it. */
  undoAttempts?: number;
  /** Register prints still held on the OLD number (a driver's, a shop's) — freed when the window closes. */
  held: Array<{ register: 'driver' | 'shop'; did: string; key: string }>;
}

/** The safe, PII-free projection returned to a signed-in person (no hashes, no vault ref, no PIN). */
export interface PersonView {
  personId: string; // the personDid
  roles: Array<{ role: PersonRole; entityDid: string; status: RoleStatus }>;
  hasPin: boolean;
  createdAt: string;
  /** Self-view profile (S29). `displayName` is revealed from the vault; both are shown only to the
   *  person themselves, never in any counterparty projection. Absent until the person sets a profile. */
  displayName?: string;
  avatarMediaId?: string;
  /** Self-view only, and revealed from the vault like the name. Where they live is the most sensitive
   *  field this product holds about a courier — it never appears in a counterparty projection. */
  address?: string;
  /** Self-view only: when the PIN was last changed. */
  pinChangedAt?: string;
  /** Self-view only: the recovery email, masked ("a…@example.com"). Absent: none confirmed yet. */
  email?: string;
  /** Self-view only: a number change that can still be undone, and until when. */
  numberChange?: { at: string; undoUntil: string };
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
    // avatarMediaId is opaque + self-view, so it rides the pure projection; displayName lives in the
    // vault and is grafted on by PersonService.view() (a reveal), never here.
    avatarMediaId: person.avatarMediaId,
    ...(person.emailMasked && person.emailVerifiedAt ? { email: person.emailMasked } : {}),
    ...(person.phoneChange ? { numberChange: { at: person.phoneChange.at, undoUntil: person.phoneChange.undoUntil } } : {}),
  };
}
