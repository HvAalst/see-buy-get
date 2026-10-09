import { MailService } from '../mail/mail.service';
import { Injectable, Optional } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';
import { AuthService } from '../auth/auth.service';
import { AccessToken } from '../auth/auth.types';
import { EntityService } from './entity.service';
import { EntityAdmin, EntityAdminView } from './entity.types';

/**
 * The people who administer a COMPANY — a sister, or the group itself.
 *
 * Until now the only way to turn a sister's knobs was an operator token, which is network staff holding
 * one shared key. That is the wrong hand for a commercial decision: what a company charges is its own
 * decision to make and its own to answer for, and "somebody with the operator key changed it" is not an
 * answer. So a company gets administrators of its own, with real credentials and real names attached to
 * what they change.
 *
 * TWO RULES THIS SERVICE EXISTS TO HOLD:
 *
 * 1. **Nobody signs themselves up as the admin of a company.** There is deliberately no public route
 *    into this: an admin is CREATED by somebody who already administers that company — the operator, or
 *    the group's own admin over its sisters. A signup form that could mint "admin of SeeBuyGet Kenya"
 *    for whoever asked would make every other rule here decoration.
 * 2. **Reach follows the company structure, and is not a separate list of permissions.** Your token
 *    carries the entity you administer; you reach that entity, plus any entity that names it as parent.
 *    A sister's admin reaches its own company. The GROUP's admin reaches the group and every sister
 *    under it — which is what a mother company is, expressed once, in the place the structure already
 *    lives. See `EntityService.administrable`.
 */
@Injectable()
export class EntityAdminService {
  /** Keyed by the lower-cased email: one login per person per deployment. */
  private readonly admins = new PersistentMap<string, EntityAdmin>('entity-admins');

  constructor(
    private readonly auth: AuthService,
    private readonly entities: EntityService,
    @Optional() private readonly mail?: MailService,
  ) {}

  /**
   * Create an administrator for a company.
   *
   * The password is GENERATED here and returned exactly once, the same bargain the vendor's signing
   * secret and the merchant API keys make: a credential somebody else chose for you is a credential you
   * change on first use, and one this service could show twice is one it stores in the clear.
   *
   * IT IS RETURNED AS `temporaryPassword`, and that is not a spelling trick to get past the response
   * mask. The mask strips `password` because a field by that name on a response is a STORED credential
   * escaping — the thing it exists to make structurally impossible. This is the opposite: a value that
   * exists for one response and is a hash everywhere else, exactly like the vendor signing secret the
   * mask's own comment carves out. The distinct name keeps the guard as tight as it was written to be,
   * and it says what this actually is: temporary, and meant to be changed.
   */
  create(entityId: string, input: { email: string; name: string }, by = 'SeeBuyGet staff'): EntityAdminView & { temporaryPassword: string } {
    const entity = this.entities.get(entityId); // throws NOT_FOUND for an entity that does not exist
    // A customer's business has no administrator logins: its people sign in with their own phone and PIN and are added
    // by its owners. An email-and-password login here would be a way in that skips both, and the check by two of us.
    if (entity.kind === 'business') throw new GlosError('INVALID_STATE', `${entity.name} is a customer’s business: its owners add its people in the Business app`);
    const email = (input.email || '').trim().toLowerCase();
    if (!email.includes('@')) throw new GlosError('VALIDATION_FAILED', 'An administrator needs a real email address to sign in with');
    if (!input.name?.trim()) throw new GlosError('VALIDATION_FAILED', 'Say who this is — every change they make is recorded against this name');
    if (this.admins.has(email)) throw new GlosError('CONFLICT', `${email} already administers a company here`);

    const password = randomBytes(9).toString('base64url'); // 12 readable characters, system randomness
    const salt = randomBytes(16).toString('hex');
    const admin: EntityAdmin = {
      adminId: `adm_${randomBytes(8).toString('hex')}`,
      email,
      name: input.name.trim(),
      entityId: entity.entityId,
      salt,
      hash: this.hash(password, salt),
      createdAt: new Date().toISOString(),
    };
    this.admins.set(email, admin);
    // Told by email that the login exists — never the password, which is handed over in person.
    void this.mail?.send('company-admin-added', { address: email, name: admin.name }, { name: admin.name, email, company: entity.name, addedBy: by });
    return { ...viewOf(admin), temporaryPassword: password };
  }

  /**
   * Change your own password.
   *
   * The other half of handing somebody a generated one: without this, "have them change it" is advice
   * nobody can take, and the person who created the account keeps a working credential for it forever.
   * Verifies the current one rather than trusting the session, because a signed-in tab left open is not
   * proof that the person at it is the account holder.
   */
  changePassword(email: string, current: string, next: string): { ok: true } {
    const admin = this.admins.get((email || '').trim().toLowerCase());
    if (!admin || admin.revokedAt || !this.verify(current, admin)) throw new GlosError('AUTH_FAILED', 'Wrong email or password');
    if ((next ?? '').length < 10) throw new GlosError('VALIDATION_FAILED', 'A password for a console that sets prices needs at least 10 characters');
    admin.salt = randomBytes(16).toString('hex');
    admin.hash = this.hash(next, admin.salt);
    admin.passwordChangedAt = new Date().toISOString();
    this.admins.set(admin.email, admin);
    // THIS administrator's other sessions end — not the company's, which every other administrator shares.
    this.auth.revokeAll(adminKey(admin.adminId));
    void this.mail?.send('password-changed', { address: admin.email, name: admin.name }, { email: admin.email, when: admin.passwordChangedAt!, app: 'console', recovery: 'ask-admin' });
    return { ok: true };
  }

  /** Sign in → a token carrying the ENTITY this person administers. */
  login(email: string, password: string): EntityAdminView & { token: AccessToken } {
    const admin = this.admins.get((email || '').trim().toLowerCase());
    // One answer for "no such person" and "wrong password", and it names neither: a login that
    // distinguishes them tells a stranger which of our companies has an administrator called this.
    if (!admin || admin.revokedAt || !this.verify(password, admin)) {
      throw new GlosError('AUTH_FAILED', 'Wrong email or password');
    }
    const entity = this.entities.get(admin.entityId);
    admin.lastSeenAt = new Date().toISOString();
    this.admins.set(admin.email, admin);
    return {
      ...viewOf(admin),
      // The DID is the ENTITY's own — an entity is a first-class actor in this system, and this person
      // is acting as the company rather than as themselves. Their NAME is what the audit trail carries.
      token: this.auth.mintActorToken({ role: 'entity_admin', did: entity.did, tenant: entity.entityId, actorName: admin.name, revocationKey: adminKey(admin.adminId) }),
    };
  }

  /** Who administers this company. Never the salt or the hash, and never anybody else's company. */
  list(entityId: string): EntityAdminView[] {
    return [...this.admins.values()]
      .filter((a) => a.entityId === entityId && !a.revokedAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(viewOf);
  }

  /**
   * Revoke a login. KEPT, not deleted: the record is what makes "who changed this rate in March" still
   * answerable after somebody leaves the company.
   */
  revoke(entityId: string, adminId: string, by = 'An administrator of your company'): EntityAdminView {
    const admin = [...this.admins.values()].find((a) => a.adminId === adminId && a.entityId === entityId);
    if (!admin) throw new GlosError('NOT_FOUND', 'No such administrator for this company');
    admin.revokedAt = new Date().toISOString();
    this.admins.set(admin.email, admin);
    // Revoking a login used to leave its open sessions working for the rest of their ten hours.
    this.auth.revokeAll(adminKey(admin.adminId));
    const company = this.entities.get(admin.entityId).name;
    void this.mail?.send('access-removed', { address: admin.email, name: admin.name }, { email: admin.email, what: `administrator login for ${company}`, removedBy: by, when: admin.revokedAt! });
    return viewOf(admin);
  }

  /** The name behind a token, for the audit trail. Absent for an operator, who has no account here. */
  nameOf(email: string): string | undefined {
    return this.admins.get((email || '').trim().toLowerCase())?.name;
  }

  private hash(password: string, salt: string): string {
    return scryptSync(password, salt, 64).toString('hex');
  }

  private verify(password: string, admin: EntityAdmin): boolean {
    const candidate = Buffer.from(this.hash(password || '', admin.salt), 'hex');
    const stored = Buffer.from(admin.hash, 'hex');
    return candidate.length === stored.length && timingSafeEqual(candidate, stored);
  }
}

function viewOf(a: EntityAdmin): EntityAdminView {
  return {
    adminId: a.adminId,
    email: a.email,
    name: a.name,
    entityId: a.entityId,
    createdAt: a.createdAt,
    ...(a.lastSeenAt ? { lastSeenAt: a.lastSeenAt } : {}),
    ...(a.revokedAt ? { revokedAt: a.revokedAt } : {}),
  };
}

/** The sign-out key of one administrator — their sessions share the company's DID, so the DID alone is too coarse. */
/** The key one administrator's sessions answer to — which says WHICH administrator a token belongs to. */
export function adminKey(adminId: string): string {
  return `entity-admin:${adminId}`;
}
