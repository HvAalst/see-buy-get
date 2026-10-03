import { MailService } from '../mail/mail.service';
import { Injectable, Optional } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';
import { AuthService } from '../auth/auth.service';
import { AccessToken } from '../auth/auth.types';
import { newTotpSecret, otpauthUri, verifyTotp } from '../auth/totp';
import { FieldEncryption } from '../data-firewall/field-encryption.service';
import { isSandbox } from '../runtime/sandbox';
import { OperatorAccount, OperatorAccountView } from './entity.types';

/** Wrong authenticator codes in a row before that account's code is refused for a while. */
export const MAX_CODE_MISSES = 5;
const CODE_LOCK_MS = 15 * 60 * 1000;
/** A secret offered for setup and never confirmed is replaced after this long. */
const PENDING_MS = 15 * 60 * 1000;
/** A reset one member of staff asked for waits this long for a second. */
const RESET_WAIT_MS = 24 * 60 * 60 * 1000;

/** What an authenticator app needs: the secret to type, and the same thing as a URI for a QR code. */
export interface TwoStepSetup {
  secret: string;
  uri: string;
}

export type StaffLoginResult = (OperatorAccountView & { token: AccessToken }) | (OperatorAccountView & { setup: TwoStepSetup });

/**
 * TWO-STEP SIGN-IN IS REQUIRED of every member of staff outside a sandbox — the account reaches every country,
 * every company's money and soon other people's accounts, and a password alone is one phishing email from all of
 * it. In a sandbox it is offered and kept once set up (so the seeded staff and the scripts still sign in with a
 * password); `GLOS_STAFF_TWO_STEP=required` makes a sandbox behave like production.
 */
export function twoStepRequired(): boolean {
  return !isSandbox() || process.env.GLOS_STAFF_TWO_STEP === 'required';
}

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
 *
 * And a second step (the user, 2026-10-03: a professional entrance): the password, then the six digits an
 * authenticator app shows. Set up the first time somebody signs in; lost, it is reset only by two OTHER members of
 * staff — the same two-person rule as everything else this console decides.
 */
@Injectable()
export class OperatorAccountService {
  /** Keyed by the lower-cased email: one login per person. */
  private readonly accounts = new PersistentMap<string, OperatorAccount>('operator-accounts');

  constructor(
    private readonly auth: AuthService,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly crypt?: FieldEncryption,
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

  /**
   * Sign in. The password first; then, for an account with two-step sign-in, the code its authenticator shows.
   *
   * An account WITHOUT it, where it is required, gets no token: it gets a secret to put in an authenticator app, and
   * signs in by sending the password again with the first code that app shows. That first code is what turns it on.
   */
  login(email: string, password: string, code?: string, now: number = Date.now()): StaffLoginResult {
    const account = this.accounts.get((email || '').trim().toLowerCase());
    // One answer for "no such person" and "wrong password", naming neither.
    if (!account || account.revokedAt || !this.verify(password, account)) throw new GlosError('AUTH_FAILED', 'Wrong email or password');

    if (account.totpSecret) {
      this.checkCode(account, account.totpSecret, code, now);
    } else if (code?.trim() && account.totpPending) {
      // The first code from the app: it proves the secret arrived, and two-step sign-in is on from here.
      this.checkCode(account, account.totpPending.secret, code, now);
      this.enable(account, now);
    } else if (twoStepRequired()) {
      return { ...viewOf(account), setup: this.offer(account, now) };
    }

    account.lastSeenAt = new Date(now).toISOString();
    this.accounts.set(account.email, account);
    return { ...viewOf(account), token: this.auth.mintOperatorSession({ name: account.name, revocationKey: operatorKey(account.operatorId) }) };
  }

  /** Signed in already, and setting up two-step sign-in from Settings (a sandbox, where it is not forced at sign-in). */
  startTwoStep(operatorId: string, now: number = Date.now()): TwoStepSetup {
    const account = this.byId(operatorId);
    if (account.totpSecret) throw new GlosError('INVALID_STATE', 'Two-step sign-in is already on for this account');
    return this.offer(account, now);
  }

  /** The first code from the app turns it on. */
  confirmTwoStep(operatorId: string, code: string, now: number = Date.now()): OperatorAccountView {
    const account = this.byId(operatorId);
    if (account.totpSecret) throw new GlosError('INVALID_STATE', 'Two-step sign-in is already on for this account');
    if (!account.totpPending) throw new GlosError('INVALID_STATE', 'Start the set-up first — it shows the code to scan');
    this.checkCode(account, account.totpPending.secret, code, now);
    this.enable(account, now);
    this.accounts.set(account.email, account);
    return viewOf(account);
  }

  /**
   * A member of staff lost their authenticator. TWO OTHER members of staff reset it: the first asks, a second —
   * neither of them the person concerned — completes it. Their sessions end and the next sign-in sets it up again.
   * Asked for by somebody signed in with their own account: the shared key cannot tell two people apart.
   */
  resetTwoStep(targetId: string, by: { operatorId: string; name: string }, now: number = Date.now()): OperatorAccountView {
    const account = this.byId(targetId);
    if (by.operatorId === account.operatorId) throw new GlosError('FORBIDDEN', 'Two other members of staff reset your two-step sign-in — not you');
    if (!account.totpSecret) throw new GlosError('INVALID_STATE', `${account.name} has no two-step sign-in to reset`);
    const asked = account.totpReset && now - Date.parse(account.totpReset.at) < RESET_WAIT_MS ? account.totpReset : undefined;
    if (!asked) {
      account.totpReset = { by: by.name, byId: by.operatorId, at: new Date(now).toISOString() };
      this.accounts.set(account.email, account);
      return viewOf(account);
    }
    if (asked.byId === by.operatorId) throw new GlosError('CONFLICT', 'A different member of staff must approve the reset you asked for');
    delete account.totpSecret;
    delete account.totpEnabledAt;
    delete account.totpLastStep;
    delete account.totpPending;
    delete account.totpReset;
    account.totpMisses = 0;
    delete account.totpLockedUntil;
    this.accounts.set(account.email, account);
    this.auth.revokeAll(operatorKey(account.operatorId));
    void this.mail?.send(
      'staff-two-step',
      { address: account.email, name: account.name },
      { name: account.name, what: `Your two-step sign-in was reset by ${asked.by} and ${by.name}.`, next: 'You were signed out. The next time you sign in, scan the new QR code with your authenticator app. If you did not ask for this, tell them at once.', when: new Date(now).toISOString() },
    );
    return viewOf(account);
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

  /** Every staff account still able to sign in, oldest first. Never a salt, a hash or a secret. */
  list(): OperatorAccountView[] {
    return [...this.accounts.values()]
      .filter((a) => !a.revokedAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map(viewOf);
  }

  /** One account, as the console shows it — what the signed-in person's own Settings reads. */
  view(operatorId: string): OperatorAccountView {
    return viewOf(this.byId(operatorId));
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

  /* ------------------------------------------------------------------ internals -- */

  private byId(operatorId: string): OperatorAccount {
    const account = [...this.accounts.values()].find((a) => a.operatorId === operatorId && !a.revokedAt);
    if (!account) throw new GlosError('NOT_FOUND', 'No such staff account');
    return account;
  }

  /** A secret for the app, kept until its first code arrives — the same one for fifteen minutes, so a reload does not change the QR code under somebody scanning it. */
  private offer(account: OperatorAccount, now: number): TwoStepSetup {
    const fresh = account.totpPending && now - Date.parse(account.totpPending.at) < PENDING_MS;
    if (!fresh) {
      account.totpPending = { secret: this.seal(newTotpSecret()), at: new Date(now).toISOString() };
      this.accounts.set(account.email, account);
    }
    const secret = this.open(account.totpPending!.secret);
    return { secret, uri: otpauthUri('SeeBuyGet', account.email, secret) };
  }

  private enable(account: OperatorAccount, now: number): void {
    account.totpSecret = account.totpPending!.secret;
    account.totpEnabledAt = new Date(now).toISOString();
    delete account.totpPending;
  }

  /** The code for one sealed secret. Wrong five times in a row and this account's code is refused for fifteen minutes. */
  private checkCode(account: OperatorAccount, sealed: string, code: string | undefined, now: number): void {
    if (account.totpLockedUntil && Date.parse(account.totpLockedUntil) > now) {
      throw new GlosError('RATE_LIMITED', 'Too many wrong codes. Wait 15 minutes, then use the code your authenticator app shows.');
    }
    if (!code?.trim()) throw new GlosError('FIELD_REQUIRED', 'Type the 6-digit code from your authenticator app', { field: 'code' });
    const step = verifyTotp(this.open(sealed), code, now, account.totpLastStep ?? -1);
    if (step === null) {
      account.totpMisses = (account.totpMisses ?? 0) + 1;
      if (account.totpMisses >= MAX_CODE_MISSES) {
        account.totpLockedUntil = new Date(now + CODE_LOCK_MS).toISOString();
        account.totpMisses = 0;
      }
      this.accounts.set(account.email, account);
      throw new GlosError('AUTH_FAILED', 'That code is not right — type the one your authenticator app shows now', { field: 'code' });
    }
    // A code is good once: the same six digits seen over a shoulder do not open a second session.
    account.totpLastStep = step;
    account.totpMisses = 0;
    delete account.totpLockedUntil;
  }

  /** Secrets rest encrypted under the vault key, like every other thing this server must be able to read back. */
  private seal(secret: string): string {
    return this.crypt ? `enc:${this.crypt.encrypt(secret)}` : secret;
  }

  private open(sealed: string): string {
    return sealed.startsWith('enc:') && this.crypt ? this.crypt.decrypt(sealed.slice(4)) : sealed;
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
    twoStep: Boolean(a.totpSecret),
    ...(a.lastSeenAt ? { lastSeenAt: a.lastSeenAt } : {}),
    ...(a.passwordChangedAt ? { passwordChangedAt: a.passwordChangedAt } : {}),
    ...(a.revokedAt ? { revokedAt: a.revokedAt } : {}),
    ...(a.totpReset && Date.now() - Date.parse(a.totpReset.at) < RESET_WAIT_MS ? { twoStepResetAskedBy: a.totpReset.by } : {}),
  };
}

/** The sign-out key of one staff account: operator tokens have no DID to be signed out by. */
export function operatorKey(operatorId: string): string {
  return `operator:${operatorId}`;
}

/** The staff account behind an operator token — none for the shared setup key, which is nobody in particular. */
export function staffIdOf(revocationKey: string | undefined): string | undefined {
  return revocationKey?.startsWith('operator:') ? revocationKey.slice('operator:'.length) : undefined;
}
