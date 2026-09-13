import { MailService } from '../mail/mail.service';
import { Injectable, Optional } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';
import { AuthService } from '../auth/auth.service';
import { AccessToken } from '../auth/auth.types';
import { OperatorAccount, OperatorAccountView } from './entity.types';

/**
 * The people who work for the NETWORK — one account each.
 *
 * Until now network staff shared one operator key. It reaches everything and cannot say who is holding it, so the
 * console asked for a name beside it and said plainly that the name was not verified. That made every two-person
 * rule (switching a country on, verifying a company's papers) a rule about two TYPED names: one person with the key
 * could approve their own change by typing somebody else's name.
 *
 * An account here carries a name the network established when it was created, and the token carries that name —
 * so "a different person must approve this" is finally a statement about people. The shared key stays, for exactly
 * two jobs: creating the first of these accounts, and scripts. Outside a sandbox the two-person rules refuse it.
 *
 * Same bargain as a company's administrators (`EntityAdminService`): created by somebody who already has operator
 * rights, never signed up for; a generated password shown once; kept, not deleted, when revoked.
 */
@Injectable()
export class OperatorAccountService {
  /** Keyed by the lower-cased email: one login per person. */
  private readonly accounts = new PersistentMap<string, OperatorAccount>('operator-accounts');

  constructor(
    private readonly auth: AuthService,
    @Optional() private readonly mail?: MailService,
  ) {}

  /** Create a staff account. The password is generated here and returned exactly once, as `temporaryPassword`. */
  create(input: { email: string; name: string }, createdBy: string): OperatorAccountView & { temporaryPassword: string } {
    const email = (input.email || '').trim().toLowerCase();
    if (!email.includes('@')) throw new GlosError('VALIDATION_FAILED', 'Network staff need a real email address to sign in with');
    if (!input.name?.trim()) throw new GlosError('VALIDATION_FAILED', 'Say who this is — every decision they make is recorded against this name');
    if (this.accounts.has(email)) throw new GlosError('CONFLICT', `${email} already has a staff account`);
    const password = randomBytes(9).toString('base64url');
    const salt = randomBytes(16).toString('hex');
    const account: OperatorAccount = {
      operatorId: `opr_${randomBytes(8).toString('hex')}`,
      email,
      name: input.name.trim(),
      salt,
      hash: this.hash(password, salt),
      createdAt: new Date().toISOString(),
      createdBy,
    };
    this.accounts.set(email, account);
    void this.mail?.send('staff-account-added', { address: email, name: account.name }, { name: account.name, email, addedBy: createdBy });
    return { ...viewOf(account), temporaryPassword: password };
  }

  /** Sign in → an operator token that carries this person's NAME, and can be signed out on its own. */
  login(email: string, password: string): OperatorAccountView & { token: AccessToken } {
    const account = this.accounts.get((email || '').trim().toLowerCase());
    // One answer for "no such person" and "wrong password", naming neither.
    if (!account || account.revokedAt || !this.verify(password, account)) throw new GlosError('AUTH_FAILED', 'Wrong email or password');
    account.lastSeenAt = new Date().toISOString();
    this.accounts.set(account.email, account);
    return { ...viewOf(account), token: this.auth.mintOperatorSession({ name: account.name, revocationKey: operatorKey(account.operatorId) }) };
  }

  /** Change your own password, proven with the current one. Your other sessions end; nobody else's do. */
  changePassword(email: string, current: string, next: string): { ok: true } {
    const account = this.accounts.get((email || '').trim().toLowerCase());
    if (!account || account.revokedAt || !this.verify(current, account)) throw new GlosError('AUTH_FAILED', 'Wrong email or password');
    if ((next ?? '').length < 10) throw new GlosError('VALIDATION_FAILED', 'A password for a console with operator rights needs at least 10 characters');
    if (current === next) throw new GlosError('VALIDATION_FAILED', 'Choose a password different from the current one');
    account.salt = randomBytes(16).toString('hex');
    account.hash = this.hash(next, account.salt);
    account.passwordChangedAt = new Date().toISOString();
    this.accounts.set(account.email, account);
    this.auth.revokeAll(operatorKey(account.operatorId));
    void this.mail?.send('password-changed', { address: account.email, name: account.name }, { email: account.email, when: account.passwordChangedAt!, app: 'console', recovery: 'ask-admin' });
    return { ok: true };
  }

  /** Every staff account still able to sign in, oldest first. Never a salt or a hash. */
  list(): OperatorAccountView[] {
    return [...this.accounts.values()]
      .filter((a) => !a.revokedAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(viewOf);
  }

  /** Take a login away, and end its open sessions at once. KEPT: the decisions it made still need a name. */
  revoke(operatorId: string, by: string): OperatorAccountView {
    const account = [...this.accounts.values()].find((a) => a.operatorId === operatorId);
    if (!account) throw new GlosError('NOT_FOUND', 'No such staff account');
    if (account.revokedAt) return viewOf(account);
    Object.assign(account, { revokedAt: new Date().toISOString(), revokedBy: by });
    this.accounts.set(account.email, account);
    this.auth.revokeAll(operatorKey(account.operatorId));
    void this.mail?.send('access-removed', { address: account.email, name: account.name }, { email: account.email, what: 'network staff account', removedBy: by, when: account.revokedAt! });
    return viewOf(account);
  }

  private hash(password: string, salt: string): string {
    return scryptSync(password, salt, 64).toString('hex');
  }

  private verify(password: string, account: OperatorAccount): boolean {
    const candidate = Buffer.from(this.hash(password || '', account.salt), 'hex');
    const stored = Buffer.from(account.hash, 'hex');
    return candidate.length === stored.length && timingSafeEqual(candidate, stored);
  }
}

function viewOf(a: OperatorAccount): OperatorAccountView {
  return {
    operatorId: a.operatorId,
    email: a.email,
    name: a.name,
    createdAt: a.createdAt,
    ...(a.lastSeenAt ? { lastSeenAt: a.lastSeenAt } : {}),
    ...(a.passwordChangedAt ? { passwordChangedAt: a.passwordChangedAt } : {}),
    ...(a.revokedAt ? { revokedAt: a.revokedAt } : {}),
  };
}

/** The sign-out key of one staff account: operator tokens have no DID to be signed out by. */
function operatorKey(operatorId: string): string {
  return `operator:${operatorId}`;
}
