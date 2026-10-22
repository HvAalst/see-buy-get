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
  /**
   * When the RIGHT PIN was last given — at the door, or asked again inside an app. It is evidence, kept for one
   * question: was this account's PIN used after somebody told staff they had lost it?
   */
  pinUsedAt?: string;
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
  /** The number this account moved off, once that can no longer be undone and while it is still the account's — see OldNumber. */
  oldNumber?: OldNumber;
  roles: RoleLink[];
  createdAt: string;
  /**
   * MUTED BY ITS OWNER, and since when (the user, 2026-10-22). The account rests: nothing new reaches it — no
   * notification or email beyond codes and safety, no new parcel at its shop, no load for its driver, no work for its
   * fleet, no order for its store — and the owner can still sign in, read, and unmute. Absent: not muted.
   */
  mutedAt?: string;
  /**
   * The DAY this person last signed in — at any door, or switching to a role (AuthService tells the spine). Written
   * at most once a day. After 48 months without one, the owner is told the account can be closed. Absent on a
   * record from before it was kept: such an account counts from when it was made.
   */
  lastSignInAt?: string;
  /**
   * TOLD THAT IT CAN BE CLOSED — after 48 months without a sign-in — and since when. It stays offered after they sign in
   * to act on it: being told is what opened it, and reading the notice must not shut it again.
   */
  closableSince?: string;
  /** When that was last said, so it is said once for each four years without a sign-in, never every day. */
  closableNoticeAt?: string;
  /**
   * CLOSED BY ITS OWNER. Their name, ID numbers, phone, email and ID photographs are gone; the record stays, under a
   * key that is nobody's number, so the parcels, hand-overs and notes that point at it still read "closed account".
   */
  closedAt?: string;
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

/**
 * THE NUMBER AN ACCOUNT USED TO BE ON, WHILE IT IS STILL THE ACCOUNT'S.
 *
 * The user, 2026-10-08: "the user blocks their own old phone number in the account. We remind them to do that for 7
 * days, after that we free the account and a dual phone number doesn't work anymore."
 *
 * For a week after a move the account has two numbers in one sense only: what is SENT to the old one still reaches the
 * account, and nobody else can open an account on it. It does not sign in. The week is for telling the people and the
 * stores that send to you; when that is done the holder blocks the old number themselves, and at the end of the week it
 * is let go whether they did or not. The first day of the week is the day the move can still be undone (PhoneChange),
 * and the number cannot be blocked in it: there has to be somewhere to move back to.
 */
export interface OldNumber {
  hash: string;
  /** When the account moved off it. */
  since: string;
  /** When it stops being the account's, if its holder has not blocked it sooner. */
  until: string;
  /** Register prints still held on it (a driver's, a shop's) — freed when it is let go. */
  held: PhoneChange['held'];
  /** The day (UTC) its holder was last reminded of it. Once a day, and no more. */
  remindedOn?: string;
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
  /**
   * Email to that address CAME BACK, for good — so the one way we have of reaching this person without their phone
   * does not work, and they would not otherwise know. Gone once they confirm the address again, or replace it.
   */
  emailBounced?: boolean;
  /** Self-view only: a number change that can still be undone, and until when. */
  numberChange?: { at: string; undoUntil: string };
  /** Self-view only: muted by its owner, since when. Absent: not muted. */
  mutedAt?: string;
  /** Self-view only: told it can be closed (48 months without a sign-in), since when. Absent: it cannot be closed yet. */
  closableSince?: string;
  /**
   * Self-view only: the number this account moved off is still its own until then — what is sent to it arrives here.
   * `canBlock` once the move can no longer be undone: the holder lets the old number go themselves.
   */
  oldNumber?: { since: string; until: string; canBlock: boolean };
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
    ...(person.mutedAt ? { mutedAt: person.mutedAt } : {}),
    ...(person.closableSince && !person.closedAt ? { closableSince: person.closableSince } : {}),
  };
}
