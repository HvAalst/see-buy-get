import { MailService } from '../mail/mail.service';
import { Injectable, Optional } from '@nestjs/common';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';
import { AuthService } from '../auth/auth.service';
import { PASSWORD_NO_SELF_RESET, PasswordTries, keptLocks, spendTime } from '../auth/password-tries';
import { passwordProblem } from '../auth/password-rules';
import { AccessToken } from '../auth/auth.types';
import { newTotpSecret, otpauthUri, verifyTotp } from '../auth/totp';
import { FieldEncryption } from '../data-firewall/field-encryption.service';
import { isSandbox } from '../runtime/sandbox';
import { OperatorAccount, OperatorAccountView, StaffProposal, StaffProposalView } from './entity.types';

/** Wrong authenticator codes in a row before that account's code is refused for a while. */
export const MAX_CODE_MISSES = 5;
const CODE_LOCK_MS = 15 * 60 * 1000;
/** A secret offered for setup and never confirmed is replaced after this long. */
const PENDING_MS = 15 * 60 * 1000;
/** A reset one member of staff asked for waits this long for a second. */
const RESET_WAIT_MS = 24 * 60 * 60 * 1000;
/** A staff account one member of staff asked for waits this many days for a second. */
export const STAFF_PROPOSAL_DAYS = 7;
const PROPOSAL_WAIT_MS = STAFF_PROPOSAL_DAYS * 24 * 60 * 60 * 1000;

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
 *
 * A NEW ACCOUNT TAKES TWO OF THEM (2026-10-11). Until then any one member of staff could make another account alone
 * and was handed its first password. So whoever held ONE staff sign-in — a colleague, or a thief with a stolen
 * session — could make themselves a second person and approve their own decisions: a country switched on,
 * somebody's account moved to another phone number. Every two-person rule in the console rested on a door one
 * person could open. Now one member of staff ASKS for an account and a different one APPROVES it. The first
 * password is made at the approval and shown to the one who approved: they vouched for the person and the address,
 * and they hand it over. The setup key makes an account only while fewer than two people can sign in — the first
 * two, and the second again when one of two has left.
 */
@Injectable()
export class OperatorAccountService {
  /** Keyed by the lower-cased email: one login per person. */
  private readonly accounts = new PersistentMap<string, OperatorAccount>('operator-accounts');
  /** Wrong passwords, counted against the address that was typed — the code from an authenticator has its own count. */
  private readonly tries = new PasswordTries(PASSWORD_NO_SELF_RESET, keptLocks('staff'));
  /** Accounts asked for. Beside the accounts, never among them: nothing here can sign in. */
  private readonly proposals = new PersistentMap<string, StaffProposal>('operator-account-proposals');

  /**
   * A wrong password: counted, and answered — the fifth in a quarter of an hour locks the sign-in and tells its
   * holder. An address nobody holds, and one that was taken away, are counted and timed like any other.
   */
  private wrongPassword(key: string, account: OperatorAccount | undefined, password: string, now: number): GlosError {
    if (!account) spendTime(password);
    const { error, locked } = this.tries.wrong(key, now);
    if (locked && account) {
      void this.mail?.send('password-locked', { address: account.email, name: account.name }, { email: account.email, app: 'console', when: new Date(now).toISOString(), until: new Date(locked.until).toISOString(), recovery: 'ask-admin' });
    }
    return error;
  }

  constructor(
    private readonly auth: AuthService,
    @Optional() private readonly mail?: MailService,
    @Optional() private readonly crypt?: FieldEncryption,
  ) {}

  /**
   * Make a staff account WITHOUT a second person — the setup key's way, and only for the first two. The password is
   * generated here and returned exactly once, as `temporaryPassword`.
   *
   * Outside a sandbox it is refused once two people can sign in: from there a member of staff asks (`propose`) and
   * a second approves. A sandbox is a laptop, where the seeder, the scripts and the tests make as many as they need
   * and the key is anybody's anyway. Whichever it is, everybody already on staff is told.
   */
  create(input: { email: string; name: string }, createdBy: string, now: number = Date.now()): OperatorAccountView & { temporaryPassword: string } {
    const asked = this.checked(input, now);
    const staff = this.active();
    if (!isSandbox() && staff.length >= 2) {
      throw new GlosError('FORBIDDEN', 'Two members of staff add a new one: one asks for the account in the console, a second approves it. The setup key makes an account only while fewer than two people can sign in.');
    }
    const made = this.make(asked, createdBy, now);
    this.tell(
      staff,
      `A network staff account was made for ${asked.name} (${asked.email}) with the setup key, without a second member of staff.`,
      'The setup key can do that only while fewer than two people can sign in. If nobody you know did this, the key is in the wrong hands: tell whoever runs the server at once.',
      now,
    );
    return made;
  }

  /**
   * ASK for a staff account. Nothing is made: no password exists and nobody can sign in with it until a second,
   * different member of staff approves. Every other member of staff is told at once — it is work for one of them,
   * and it is the alarm when nobody they know asked.
   */
  propose(input: { email: string; name: string }, by: { operatorId: string }, now: number = Date.now()): StaffProposalView {
    const asker = this.byId(by.operatorId);
    const asked = this.checked(input, now);
    const others = this.active().filter((a) => a.operatorId !== asker.operatorId);
    if (!others.length) {
      throw new GlosError('INVALID_STATE', 'Nobody else on staff can sign in, so nobody could approve this. The second staff account is made with the setup key.');
    }
    const proposal: StaffProposal = {
      proposalId: `spr_${randomBytes(8).toString('hex')}`,
      ...asked,
      askedBy: asker.name,
      askedById: asker.operatorId,
      askedAt: new Date(now).toISOString(),
      state: 'asked',
    };
    this.proposals.set(proposal.proposalId, proposal);
    this.tell(
      others,
      `${asker.name} asked for a network staff account for ${asked.name} (${asked.email}).`,
      `Nothing was made, and nobody can sign in with it until a second member of staff approves it: Overview, then Network staff. Approve it only if you know this person and this is their address. If ${asker.name} did not ask for it, decline it and take their sign-in away: it may be in somebody else's hands.`,
      now,
    );
    return proposalView(proposal, asker.operatorId);
  }

  /**
   * The SECOND member of staff says yes — never the one who asked. The account is made now, and its first password
   * is returned once to the one approving: they vouched for this person and this address, and they hand it over.
   */
  approve(proposalId: string, by: { operatorId: string }, now: number = Date.now()): OperatorAccountView & { temporaryPassword: string } {
    const proposal = this.pending(proposalId, now);
    const approver = this.byId(by.operatorId);
    if (proposal.askedById === approver.operatorId) throw new GlosError('CONFLICT', 'A second member of staff has to approve — not the one who asked');
    const made = this.make({ email: proposal.email, name: proposal.name }, proposal.askedBy, now, approver.name);
    Object.assign(proposal, { state: 'approved', decidedBy: approver.name, decidedAt: new Date(now).toISOString(), operatorId: made.operatorId });
    this.proposals.set(proposal.proposalId, proposal);
    this.tell(
      this.active().filter((a) => a.operatorId === proposal.askedById),
      `${approver.name} approved the network staff account you asked for, for ${proposal.name} (${proposal.email}).`,
      `${approver.name} was shown its first password, once, and hands it to ${proposal.name} in person. It is not in this email and was not shown to you.`,
      now,
    );
    return made;
  }

  /**
   * Say no — any member of staff, and the one who asked taking it back. Somebody else's is declined with a reason,
   * and the one who asked is told it. The address is free to be asked for again.
   */
  decline(proposalId: string, by: { operatorId: string }, reason?: string, now: number = Date.now()): { ok: true } {
    const proposal = this.pending(proposalId, now);
    const who = this.byId(by.operatorId);
    const own = proposal.askedById === who.operatorId;
    const why = reason?.trim();
    if (!own && !why) throw new GlosError('FIELD_REQUIRED', 'Say why — the member of staff who asked is told', { field: 'reason' });
    this.close(proposal, who.name, why, now);
    if (!own) {
      this.tell(
        this.active().filter((a) => a.operatorId === proposal.askedById),
        `${who.name} declined the network staff account you asked for, for ${proposal.name} (${proposal.email}).`,
        `Their reason: “${(why as string).replace(/[.\s]+$/, '')}”. Nothing was made. You can ask again.`,
        now,
      );
    }
    return { ok: true };
  }

  /** The accounts asked for that still wait for a second member of staff, oldest first. `mine` marks the reader's own. */
  waitingFor(readerId: string | undefined, now: number = Date.now()): StaffProposalView[] {
    return this.waiting(now).map((p) => proposalView(p, readerId));
  }

  /**
   * Sign in. The password first; then, for an account with two-step sign-in, the code its authenticator shows.
   *
   * An account WITHOUT it, where it is required, gets no token: it gets a secret to put in an authenticator app, and
   * signs in by sending the password again with the first code that app shows. That first code is what turns it on.
   */
  login(email: string, password: string, code?: string, now: number = Date.now()): StaffLoginResult {
    const key = (email || '').trim().toLowerCase();
    this.tries.check(key, now);
    const held = this.accounts.get(key);
    const account = held && !held.revokedAt ? held : undefined;
    // One answer for "no such person" and "wrong password", naming neither.
    if (!account || !this.verify(password, account)) throw this.wrongPassword(key, account, password, now);
    this.tries.forget(key);

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
      return viewOf(account, now);
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
    const key = (email || '').trim().toLowerCase();
    this.tries.check(key);
    const held = this.accounts.get(key);
    const account = held && !held.revokedAt ? held : undefined;
    if (!account || !this.verify(current, account)) throw this.wrongPassword(key, account, current, Date.now());
    this.tries.forget(key);
    if ((next ?? '').length < 10) throw new GlosError('VALIDATION_FAILED', 'A password for a console with operator rights needs at least 10 characters');
    if (passwordProblem(next, [account.email, account.name], 10) === 'guessable') throw new GlosError('PASSWORD_GUESSABLE', 'That password is too easy to guess. Avoid a common word with a number on the end, your own name or email address, only digits, and runs like 12345678 or qwerty.');
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
  list(now: number = Date.now()): OperatorAccountView[] {
    // Not `.map(viewOf)`: that hands the row's position to the view as its clock, and a reset that lapsed a week ago
    // read as still asked for.
    return this.active()
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((a) => viewOf(a, now));
  }

  /** One account, as the console shows it — what the signed-in person's own Settings reads. */
  view(operatorId: string): OperatorAccountView {
    return viewOf(this.byId(operatorId));
  }

  /** Take a login away, and end its open sessions at once. KEPT: the decisions it made still need a name. */
  revoke(operatorId: string, by: string, now: number = Date.now()): OperatorAccountView {
    const account = [...this.accounts.values()].find((a) => a.operatorId === operatorId);
    if (!account) throw new GlosError('NOT_FOUND', 'No such staff account');
    if (account.revokedAt) return viewOf(account, now);
    Object.assign(account, { revokedAt: new Date(now).toISOString(), revokedBy: by });
    this.accounts.set(account.email, account);
    this.auth.revokeAll(operatorKey(account.operatorId));
    // What they asked for goes with them: an account asked for from a sign-in that had to be taken away is not one
    // for a colleague to approve in good faith a day later.
    for (const p of this.waiting(now)) {
      if (p.askedById === operatorId) this.close(p, by, 'The member of staff who asked no longer has a sign-in.', now);
    }
    void this.mail?.send('access-removed', { address: account.email, name: account.name }, { email: account.email, what: 'network staff account', removedBy: by, when: account.revokedAt! });
    return viewOf(account);
  }

  /* ------------------------------------------------------------------ internals -- */

  /** Everybody who can sign in. */
  private active(): OperatorAccount[] {
    return [...this.accounts.values()].filter((a) => !a.revokedAt);
  }

  /** What was typed, tidied — and refused when that address has an account, or one already asked for and waiting. */
  private checked(input: { email: string; name: string }, now: number): { email: string; name: string } {
    const email = (input.email || '').trim().toLowerCase();
    if (!email.includes('@')) throw new GlosError('VALIDATION_FAILED', 'Network staff need a real email address to sign in with');
    const name = input.name?.trim();
    if (!name) throw new GlosError('VALIDATION_FAILED', 'Say who this is — every decision they make is recorded against this name');
    if (this.accounts.has(email)) throw new GlosError('CONFLICT', `${email} already has a staff account`);
    const waiting = this.waiting(now).find((p) => p.email === email);
    if (waiting) throw new GlosError('CONFLICT', `${waiting.askedBy} already asked for a staff account for ${email}. A second member of staff approves or declines that one first`);
    return { email, name };
  }

  /** THE ACT: an account that can sign in, and its first password, which exists nowhere but in what this returns. */
  private make(asked: { email: string; name: string }, createdBy: string, now: number, approvedBy?: string): OperatorAccountView & { temporaryPassword: string } {
    const password = randomBytes(9).toString('base64url');
    const salt = randomBytes(16).toString('hex');
    const account: OperatorAccount = {
      operatorId: `opr_${randomBytes(8).toString('hex')}`,
      email: asked.email,
      name: asked.name,
      salt,
      hash: this.hash(password, salt),
      createdAt: new Date(now).toISOString(),
      createdBy,
      ...(approvedBy ? { approvedBy } : {}),
    };
    this.accounts.set(account.email, account);
    void this.mail?.send('staff-account-added', { address: account.email, name: account.name }, { name: account.name, email: account.email, addedBy: approvedBy ? `${createdBy} and ${approvedBy}` : createdBy });
    return { ...viewOf(account, now), temporaryPassword: password };
  }

  /** Asked for, not yet decided, and not waiting longer than a week. Oldest first. */
  private waiting(now: number): StaffProposal[] {
    return [...this.proposals.values()]
      .filter((p) => p.state === 'asked' && Date.parse(p.askedAt) + PROPOSAL_WAIT_MS > now)
      .sort((a, b) => a.askedAt.localeCompare(b.askedAt));
  }

  /** One that can still be decided — or the reason it cannot. */
  private pending(proposalId: string, now: number): StaffProposal {
    const proposal = this.proposals.get(proposalId);
    if (!proposal) throw new GlosError('NOT_FOUND', 'Nobody asked for that staff account');
    if (proposal.state !== 'asked') throw new GlosError('INVALID_STATE', `This was already ${proposal.state} by ${proposal.decidedBy}`);
    if (Date.parse(proposal.askedAt) + PROPOSAL_WAIT_MS <= now) {
      throw new GlosError('INVALID_STATE', `This waited ${STAFF_PROPOSAL_DAYS} days for a second member of staff and has lapsed. Ask for the account again`);
    }
    return proposal;
  }

  private close(proposal: StaffProposal, by: string, reason: string | undefined, now: number): void {
    Object.assign(proposal, { state: 'declined', decidedBy: by, decidedAt: new Date(now).toISOString(), ...(reason ? { reason } : {}) });
    this.proposals.set(proposal.proposalId, proposal);
  }

  /** Said to members of staff by email, each in their own: who is on staff decides who can approve what. */
  private tell(to: OperatorAccount[], what: string, next: string, now: number): void {
    for (const a of to) void this.mail?.send('staff-account-news', { address: a.email, name: a.name }, { what, next, when: new Date(now).toISOString() });
  }

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

/**
 * `now` is the clock of whatever just acted. The view used to read the wall clock while the act it answers read the
 * one it was given, so a reset asked for "now" in a test pinned to a past date showed as already expired: the two
 * halves of one answer disagreed about what time it was.
 */
function viewOf(a: OperatorAccount, now: number = Date.now()): OperatorAccountView {
  return {
    operatorId: a.operatorId,
    email: a.email,
    name: a.name,
    createdAt: a.createdAt,
    twoStep: Boolean(a.totpSecret),
    ...(a.lastSeenAt ? { lastSeenAt: a.lastSeenAt } : {}),
    ...(a.passwordChangedAt ? { passwordChangedAt: a.passwordChangedAt } : {}),
    ...(a.revokedAt ? { revokedAt: a.revokedAt } : {}),
    ...(a.totpReset && now - Date.parse(a.totpReset.at) < RESET_WAIT_MS ? { twoStepResetAskedBy: a.totpReset.by } : {}),
  };
}

function proposalView(p: StaffProposal, readerId: string | undefined): StaffProposalView {
  return {
    proposalId: p.proposalId,
    email: p.email,
    name: p.name,
    askedBy: p.askedBy,
    askedAt: p.askedAt,
    until: new Date(Date.parse(p.askedAt) + PROPOSAL_WAIT_MS).toISOString(),
    mine: p.askedById === readerId,
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
