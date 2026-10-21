import { MailService } from '../mail/mail.service';
import { appUrl, formatWhen } from '../mail/mail.templates';
import { Injectable, Optional } from '@nestjs/common';
import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';
import { AuthService } from '../auth/auth.service';
import { STAFF_KEY_PREFIX } from '../auth/setup-key';
import { PASSWORD_NO_SELF_RESET, PasswordTries, keptLocks, spendTime } from '../auth/password-tries';
import { passwordProblem } from '../auth/password-rules';
import { AccessToken } from '../auth/auth.types';
import { newTotpSecret, otpauthUri, verifyTotp } from '../auth/totp';
import { rolesOf, STAFF_ROLES, type StaffRole } from '../auth/staff-roles';
import { FieldEncryption } from '../data-firewall/field-encryption.service';
import { isSandbox } from '../runtime/sandbox';
import { OperatorAccount, OperatorAccountView, StaffInvited, StaffProposal, StaffProposalView } from './entity.types';

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
/** The link a new member of staff is emailed to choose their password works this many hours, once. */
export const STAFF_WELCOME_HOURS = 48;
const WELCOME_MS = STAFF_WELCOME_HOURS * 60 * 60 * 1000;
/** The setup key takes a sign-in away this many hours after everybody on staff was told — unless one of them stops it. */
export const KEY_REMOVAL_WAIT_HOURS = 24;
const REMOVAL_WAIT_MS = KEY_REMOVAL_WAIT_HOURS * 60 * 60 * 1000;
/** Asked for and neither stopped nor finished, it is forgotten after a week: it has to be asked — and announced — again. */
const REMOVAL_KEPT_MS = 7 * 24 * 60 * 60 * 1000;
/** What the record says did it, where no member of staff did. */
export const SETUP_KEY = 'the setup key';
/** Who is acting on a request for a staff account: a member of staff with their own account, or the setup key. */
export type StaffOrKey = { operatorId: string } | { setupKey: true };

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
 * password was at first made at the approval and shown to the one who approved.
 *
 * NO FIRST PASSWORD, AND A SETUP KEY THAT CANNOT BECOME TWO PEOPLE (the user, the same day: "all of your 'not done'
 * should be wired in"). A password shown to the colleague who approved is a password that colleague holds: they could
 * sign in as the new person before handing it over. So there is none. The approval emails the new person a link, to
 * their own address and to nobody else, to choose a password themselves — once, for 48 hours.
 * And the setup key was still a way round every rule: it could take sign-ins away until one was left, and then add.
 * Outside a sandbox it now makes an account alone only while NOBODY can sign in; when exactly one person can, that
 * person asks and the setup key is the second; with two or more it adds nobody. And it takes no sign-in away without
 * everybody on staff being told and a day passing, in which any one of them can stop it — the way back when a sign-in
 * is truly lost, and no quiet way in for whoever finds the key.
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
   * Make a staff account ALONE, with the setup key. The password is generated here and returned exactly once, as
   * `temporaryPassword`: whoever holds the setup key is setting the installation up, and this is their own way in.
   *
   * Outside a sandbox that is allowed only while NOBODY can sign in — the first account, and the first again if every
   * sign-in is ever gone. With one member of staff, that member asks and the setup key approves (`approve`); with two
   * or more the setup key adds nobody. A sandbox is a laptop, where the seeder, the scripts and the tests make as
   * many as they need and the key is anybody's anyway. Whichever it is, everybody already on staff is told.
   */
  create(input: { email: string; name: string }, createdBy: string, now: number = Date.now()): OperatorAccountView & { temporaryPassword: string } {
    const asked = this.checked(input, now);
    if (!isSandbox() && this.signers().length >= 1) {
      throw new GlosError('FORBIDDEN', 'The setup key makes a staff account alone only while nobody can sign in. With one member of staff, that member asks for the account and the setup key approves it; with two or more, a second member of staff approves it.');
    }
    const staff = this.active();
    const password = randomBytes(9).toString('base64url');
    const account = this.make(asked, createdBy, now, undefined, password, [...STAFF_ROLES]);
    void this.mail?.send('staff-account-added', { address: account.email, name: account.name }, { name: account.name, email: account.email, addedBy: createdBy });
    this.tell(
      staff,
      `A network staff account was made for ${asked.name} (${asked.email}) with the setup key, without a second person.`,
      'The setup key can do that only while nobody can sign in. If nobody you know did this, the key is in the wrong hands: tell whoever runs the server at once.',
      now,
    );
    return { ...viewOf(account, now), temporaryPassword: password };
  }

  /**
   * ASK for a staff account. Nothing is made: nobody can sign in with it until a second, different person approves.
   * Every other member of staff is told at once — it is work for one of them, and it is the alarm when nobody they
   * know asked. Somebody who is the only one able to sign in may ask too: the setup key is their second.
   */
  propose(input: { email: string; name: string; roles?: readonly string[] }, by: { operatorId: string }, now: number = Date.now()): StaffProposalView {
    const asker = this.byId(by.operatorId);
    const asked = this.checked(input, now);
    // Round 38 — the roles they are to hold, said when they are asked for: at least one.
    const roles = this.someRoles(input.roles);
    this.assertLinkCanTravel();
    const proposal: StaffProposal = {
      proposalId: `spr_${randomBytes(8).toString('hex')}`,
      ...asked,
      askedBy: asker.name,
      askedById: asker.operatorId,
      askedAt: new Date(now).toISOString(),
      state: 'asked',
      roles,
    };
    this.proposals.set(proposal.proposalId, proposal);
    this.tell(
      this.signers().filter((a) => a.operatorId !== asker.operatorId),
      `${asker.name} asked for a network staff account for ${asked.name} (${asked.email}), to hold ${rolesLine(roles)}.`,
      `Nothing was made, and nobody can sign in with it until a second member of staff approves it: Overview, then Network staff. Approve it only if you know this person and this is their address. If ${asker.name} did not ask for it, decline it and take their sign-in away: it may be in somebody else's hands.`,
      now,
    );
    return this.proposalView(proposal, asker.operatorId);
  }

  /**
   * The SECOND person says yes — never the one who asked. A member of staff; or the setup key, and then only for
   * somebody who is the only one able to sign in.
   *
   * NO PASSWORD IS MADE. The account cannot sign in until its holder has chosen one, by a link emailed to the
   * account's own address and to nobody else. Neither of the two who made the account ever holds a way into it.
   */
  async approve(proposalId: string, by: StaffOrKey, now: number = Date.now()): Promise<StaffInvited> {
    const proposal = this.pending(proposalId, now);
    if (proposal.kind === 'roles') return this.approveRoles(proposal, by, now);
    const approvedBy = 'operatorId' in by ? this.secondFor(proposal, by.operatorId) : this.keyFor(proposal);
    this.assertLinkCanTravel();
    const account = this.make({ email: proposal.email, name: proposal.name }, proposal.askedBy, now, approvedBy, undefined, proposal.roles ? rolesOf(proposal.roles) : [...STAFF_ROLES]);
    Object.assign(proposal, { state: 'approved', decidedBy: approvedBy, decidedAt: new Date(now).toISOString(), operatorId: account.operatorId });
    this.proposals.set(proposal.proposalId, proposal);
    const welcome = await this.welcome(account, now);
    this.tell(
      this.active().filter((a) => a.operatorId === proposal.askedById),
      `${approvedBy === SETUP_KEY ? 'The setup key' : approvedBy} approved the network staff account you asked for, for ${proposal.name} (${proposal.email}).`,
      `${proposal.name} is emailed a link, at that address, to choose a password: nobody on staff is shown one. It works for ${STAFF_WELCOME_HOURS} hours. If it does not arrive, anybody on staff can send a new one: Overview, then Network staff.`,
      now,
    );
    return { ...viewOf(account, now), ...welcome };
  }

  /**
   * Say no — any member of staff, and the one who asked taking it back. Somebody else's is declined with a reason,
   * and the one who asked is told it. The address is free to be asked for again.
   */
  decline(proposalId: string, by: { operatorId: string }, reason?: string, now: number = Date.now()): { ok: true } {
    const proposal = this.pending(proposalId, now);
    const who = this.byId(by.operatorId);
    const own = proposal.askedById === who.operatorId;
    // Round 38 — a change of somebody's roles is decided by others: they may not wave through their own, nor stop it.
    if (!own && proposal.kind === 'roles' && proposal.operatorId === who.operatorId) throw new GlosError('FORBIDDEN', OWN_ROLES);
    const why = reason?.trim();
    if (!own && !why) throw new GlosError('FIELD_REQUIRED', 'Say why — the member of staff who asked is told', { field: 'reason' });
    this.close(proposal, who.name, why, now);
    if (!own) {
      const roles = proposal.kind === 'roles';
      this.tell(
        this.active().filter((a) => a.operatorId === proposal.askedById),
        roles ? `${who.name} declined the change of ${proposal.name}'s roles you asked for.` : `${who.name} declined the network staff account you asked for, for ${proposal.name} (${proposal.email}).`,
        `Their reason: “${(why as string).replace(/[.\s]+$/, '')}”. ${roles ? 'Nothing changed' : 'Nothing was made'}. You can ask again.`,
        now,
      );
    }
    return { ok: true };
  }

  /** The accounts asked for that still wait for a second person, oldest first. `mine` marks the reader's own. */
  waitingFor(readerId: string | undefined, now: number = Date.now()): StaffProposalView[] {
    return this.waiting(now).map((p) => this.proposalView(p, readerId));
  }

  /* ----------------------------------------------- choosing your own first password -- */

  /**
   * WHOSE LINK IS THIS — what the console shows before a password is typed. A link that was used, has lapsed, was
   * replaced by a newer one or was made up all get one answer, which says nothing about any account.
   */
  welcomeFor(token: string, now: number = Date.now()): { email: string; name: string } {
    const account = this.invited(token, now);
    return { email: account.email, name: account.name };
  }

  /**
   * The new member of staff chooses their own password, proven by the link they were emailed. The link is spent by
   * it — and only by it: a password that will not do is refused and the link still works.
   */
  choosePassword(token: string, password: string, now: number = Date.now()): { ok: true; email: string } {
    const account = this.invited(token, now);
    this.assertPassword(password, account);
    account.salt = randomBytes(16).toString('hex');
    account.hash = this.hash(password, account.salt);
    account.passwordChangedAt = new Date(now).toISOString();
    delete account.welcome;
    this.accounts.set(account.email, account);
    return { ok: true, email: account.email };
  }

  /**
   * Send the link again — a new one, and the old one stops working. For an account whose holder has not chosen a
   * password yet: the email did not arrive, or the two days passed. It goes to the account's own address, whoever asks.
   */
  async sendWelcome(operatorId: string, now: number = Date.now()): Promise<StaffInvited> {
    const account = this.byId(operatorId);
    if (account.hash) throw new GlosError('INVALID_STATE', `${account.name} has already chosen a password`);
    this.assertLinkCanTravel();
    return { ...viewOf(account, now), ...(await this.welcome(account, now)) };
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
    return { ...viewOf(account), token: this.auth.mintOperatorSession({ name: account.name, revocationKey: operatorKey(account.operatorId), staffRoles: heldRoles(account) }) };
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
    this.assertPassword(next, account);
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

  /**
   * THE SETUP KEY TAKES A SIGN-IN AWAY — announced, and a day later.
   *
   * A member of staff takes a colleague's sign-in away at once: a sign-in in the wrong hands must not wait. The setup
   * key is nobody in particular, and whoever holds it could otherwise empty the staff list and start again as two
   * people. So outside a sandbox its first asking only ANNOUNCES it: everybody on staff is told, the one concerned
   * included, and any one of them can stop it. A day later, not stopped, the key can finish. That is the way back when
   * a sign-in is truly lost — somebody alone on staff who lost their phone — and it is no quiet way in.
   */
  removeByKey(operatorId: string, now: number = Date.now()): OperatorAccountView {
    if (isSandbox()) return this.revoke(operatorId, SETUP_KEY, now);
    const account = this.byId(operatorId);
    const asked = account.removal && now - Date.parse(account.removal.askedAt) < REMOVAL_KEPT_MS ? account.removal : undefined;
    if (!asked) {
      account.removal = { askedAt: new Date(now).toISOString() };
      this.accounts.set(account.email, account);
      this.tell(
        this.active(),
        `The setup key asked to take away the staff sign-in of ${account.name} (${account.email}).`,
        `Nothing happens for ${KEY_REMOVAL_WAIT_HOURS} hours. If nobody on staff asked for this, stop it — Overview, then Network staff, then “Stop it” beside that name — and tell whoever runs the server that the setup key is in the wrong hands. If nobody stops it, whoever holds the setup key can finish it after that.`,
        now,
      );
      return viewOf(account, now);
    }
    const from = Date.parse(asked.askedAt) + REMOVAL_WAIT_MS;
    if (now < from) {
      throw new GlosError('INVALID_STATE', `Everybody on staff has been told. The setup key can finish this from ${formatWhen(new Date(from).toISOString())}, unless a member of staff stops it first`);
    }
    delete account.removal;
    return this.revoke(operatorId, SETUP_KEY, now);
  }

  /** Any member of staff — the one concerned included — stops what the setup key asked for. Everybody else is told. */
  stopRemoval(operatorId: string, by: { operatorId: string }, now: number = Date.now()): OperatorAccountView {
    const who = this.byId(by.operatorId);
    const account = this.byId(operatorId);
    if (!account.removal) throw new GlosError('INVALID_STATE', `Nobody asked to take the sign-in of ${account.name} away`);
    delete account.removal;
    this.accounts.set(account.email, account);
    this.tell(
      this.active().filter((a) => a.operatorId !== who.operatorId),
      `${who.name} stopped the setup key taking away the staff sign-in of ${account.name}.`,
      'If the setup key is in the wrong hands, whoever runs the server replaces it (GLOS_CLIENT_SECRET). Until then it can ask again, and everybody is told again.',
      now,
    );
    return viewOf(account, now);
  }

  /* ------------------------------------------------------------------ internals -- */

  /** Every account that has not been taken away — whether or not its holder has chosen a password yet. */
  private active(): OperatorAccount[] {
    return [...this.accounts.values()].filter((a) => !a.revokedAt);
  }

  /** Everybody who CAN SIGN IN: not taken away, and with a password. Who counts as "on staff" for every rule of two. */
  private signers(): OperatorAccount[] {
    return this.active().filter((a) => Boolean(a.hash));
  }

  /** Is this member of staff the only one able to sign in — so that there is no colleague to be their second? */
  private aloneOnStaff(operatorId: string): boolean {
    const signers = this.signers();
    return signers.length === 1 && signers[0].operatorId === operatorId;
  }

  /** The second person, when it is a member of staff: anybody on staff but the one who asked. Their name, for the record. */
  private secondFor(proposal: StaffProposal, operatorId: string): string {
    const approver = this.byId(operatorId);
    if (proposal.askedById === approver.operatorId) throw new GlosError('CONFLICT', 'A second member of staff has to approve — not the one who asked');
    return approver.name;
  }

  /** The second person, when it is the SETUP KEY: only for somebody who is the only one able to sign in. */
  private keyFor(proposal: StaffProposal): string {
    if (!this.aloneOnStaff(proposal.askedById)) {
      throw new GlosError('FORBIDDEN', 'A second member of staff approves this. The setup key approves only for somebody who is the only one able to sign in.');
    }
    return SETUP_KEY;
  }

  /**
   * Outside a sandbox the link to choose a password goes by email and in no other way. With no email leaving the
   * server, that is said before anything is asked for or made — not found out by a new colleague waiting for it.
   */
  private assertLinkCanTravel(): void {
    if (isSandbox() || this.mail?.connection().sends) return;
    throw new GlosError('INVALID_STATE', 'No email leaves this server yet, and a new member of staff is sent the link to choose their password by email and in no other way. Set email up first: Connections shows what is missing.');
  }

  /** A password for a console with operator rights: long, and not one that is easy to guess. */
  private assertPassword(next: string, account: OperatorAccount): void {
    if ((next ?? '').length < 10) throw new GlosError('VALIDATION_FAILED', 'A password for a console with operator rights needs at least 10 characters');
    if (passwordProblem(next, [account.email, account.name], 10) === 'guessable') throw new GlosError('PASSWORD_GUESSABLE', 'That password is too easy to guess. Avoid a common word with a number on the end, your own name or email address, only digits, and runs like 12345678 or qwerty.');
  }

  /**
   * A FRESH LINK to choose a password — from now the only one that works — emailed to the account's own address and to
   * nobody else. Only its fingerprint is kept. In a sandbox, where no email leaves, the link is handed back as well.
   */
  private async welcome(account: OperatorAccount, now: number): Promise<{ sent: boolean; link?: string; passwordLinkUntil: string }> {
    const token = randomBytes(24).toString('base64url');
    const until = new Date(now + WELCOME_MS).toISOString();
    account.welcome = { hash: fingerprint(token), sentAt: new Date(now).toISOString(), until };
    this.accounts.set(account.email, account);
    const link = `${appUrl('console')}#welcome=${token}`;
    const addedBy = account.approvedBy ? `${account.createdBy} and ${account.approvedBy}` : account.createdBy;
    const sent = (await this.mail?.send('staff-account-welcome', { address: account.email, name: account.name }, { name: account.name, email: account.email, addedBy, link, hours: STAFF_WELCOME_HOURS }, now)) ?? false;
    return { sent, passwordLinkUntil: until, ...(isSandbox() ? { link } : {}) };
  }

  /**
   * The account a link belongs to: not taken away, this very link, and inside its two days. (A link is forgotten the
   * moment a password is chosen by it, so an account that has one has no link to be found by.)
   */
  private invited(token: string, now: number): OperatorAccount {
    const print = fingerprint((token || '').trim());
    const account = this.active().find((a) => a.welcome?.hash === print);
    if (!account || Date.parse(account.welcome!.until) <= now) {
      throw new GlosError('WINDOW_EXPIRED', 'This link has been used, or it has lapsed. Ask a colleague on staff to send you a new one.');
    }
    return account;
  }

  private proposalView(p: StaffProposal, readerId: string | undefined): StaffProposalView {
    return {
      proposalId: p.proposalId,
      email: p.email,
      name: p.name,
      askedBy: p.askedBy,
      askedAt: p.askedAt,
      until: new Date(Date.parse(p.askedAt) + PROPOSAL_WAIT_MS).toISOString(),
      mine: p.askedById === readerId,
      forSetupKey: p.kind === 'roles' ? false : this.aloneOnStaff(p.askedById),
      roles: p.roles ? rolesOf(p.roles) : [...STAFF_ROLES],
      ...(p.kind === 'roles' ? { kind: 'roles' as const } : {}),
      ...(p.kind === 'roles' && p.operatorId ? { operatorId: p.operatorId, rolesNow: this.rolesNow(p.operatorId), aboutYou: p.operatorId === readerId } : {}),
    };
  }

  /**
   * Round 38 — ASK THAT A MEMBER OF STAFF HOLD OTHER ROLES (the user: "Four roles"). Nothing changes until a second member
   * of staff approves: who holds the money or the administration of the network is a decision two people make, as an
   * account is. Everybody on staff is told. One waiting at a time for a person.
   */
  proposeRoles(operatorId: string, roles: readonly string[], by: { operatorId: string }, now: number = Date.now()): StaffProposalView {
    const asker = this.byId(by.operatorId);
    const target = this.byId(operatorId);
    if (target.revokedAt) throw new GlosError('INVALID_STATE', `${target.name}'s sign-in was taken away: there are no roles to change`);
    const next = this.someRoles(roles);
    if (next.join() === heldRoles(target).join()) throw new GlosError('VALIDATION_FAILED', `${target.name} holds ${rolesLine(next)} already`);
    const waiting = this.waiting(now).find((p) => p.kind === 'roles' && p.operatorId === target.operatorId);
    if (waiting) throw new GlosError('CONFLICT', `${waiting.askedBy} already asked to change ${target.name}'s roles. A second person approves or declines that one first`);
    const proposal: StaffProposal = {
      proposalId: `spr_${randomBytes(8).toString('hex')}`,
      email: target.email,
      name: target.name,
      askedBy: asker.name,
      askedById: asker.operatorId,
      askedAt: new Date(now).toISOString(),
      state: 'asked',
      kind: 'roles',
      operatorId: target.operatorId,
      roles: next,
    };
    this.proposals.set(proposal.proposalId, proposal);
    this.tell(
      this.signers().filter((a) => a.operatorId !== asker.operatorId),
      `${asker.name} asked that ${target.name} hold ${rolesLine(next)}, in place of ${rolesLine(heldRoles(target))}.`,
      `Nothing changes until a second member of staff approves it: Overview, then Network staff. If ${asker.name} did not ask for it, decline it.`,
      now,
    );
    return this.proposalView(proposal, asker.operatorId);
  }

  /** The second person approves a change of roles — never the one who asked, and never the setup key. The person is signed out. */
  private approveRoles(proposal: StaffProposal, by: StaffOrKey, now: number): StaffInvited {
    if (!('operatorId' in by)) throw new GlosError('FORBIDDEN', 'A change of roles is approved by a second member of staff, never by the setup key');
    if (by.operatorId === proposal.operatorId) throw new GlosError('FORBIDDEN', OWN_ROLES);
    const approvedBy = this.secondFor(proposal, by.operatorId);
    const target = this.byId(proposal.operatorId!);
    const before = heldRoles(target);
    target.roles = rolesOf(proposal.roles);
    this.accounts.set(target.email, target);
    Object.assign(proposal, { state: 'approved', decidedBy: approvedBy, decidedAt: new Date(now).toISOString() });
    this.proposals.set(proposal.proposalId, proposal);
    // Signed out: the token they hold says the roles they had. Their next sign-in carries the new ones.
    this.auth.revokeAll(operatorKey(target.operatorId));
    this.tell(
      this.active().filter((a) => a.operatorId === target.operatorId || a.operatorId === proposal.askedById),
      `${target.name} now holds ${rolesLine(heldRoles(target))}, in place of ${rolesLine(before)} — asked by ${proposal.askedBy}, approved by ${approvedBy}.`,
      `${target.name} was signed out and signs in again to work with the new roles.`,
      now,
    );
    return { ...viewOf(target, now), sent: true };
  }

  /** The roles a person holds now, for a change of roles to be read beside. */
  private rolesNow(operatorId: string): StaffRole[] {
    try {
      return heldRoles(this.byId(operatorId));
    } catch {
      return [];
    }
  }

  /** Roles as asked: known ones, at least one. */
  private someRoles(raw: readonly unknown[] | undefined): StaffRole[] {
    const roles = rolesOf(raw);
    if (!roles.length) throw new GlosError('VALIDATION_FAILED', 'Say which roles they hold: support, vetting, money or administration — at least one', { field: 'roles' });
    return roles;
  }

  /** What was typed, tidied — and refused when that address has an account, or one already asked for and waiting. */
  private checked(input: { email: string; name: string }, now: number): { email: string; name: string } {
    const email = (input.email || '').trim().toLowerCase();
    if (!email.includes('@')) throw new GlosError('VALIDATION_FAILED', 'Network staff need a real email address to sign in with');
    const name = input.name?.trim();
    if (!name) throw new GlosError('VALIDATION_FAILED', 'Say who this is — every decision they make is recorded against this name');
    // A sign-in that was taken away leaves its address free: the person may come back, and somebody locked out gets a new one.
    const held = this.accounts.get(email);
    if (held && !held.revokedAt) throw new GlosError('CONFLICT', `${email} already has a staff account`);
    const waiting = this.waiting(now).find((p) => p.email === email);
    if (waiting) throw new GlosError('CONFLICT', `${waiting.askedBy} already asked for a staff account for ${email}. A second person approves or declines that one first`);
    return { email, name };
  }

  /**
   * THE ACT: a staff account. With `password` it can sign in at once (the setup key's own first account); without, it
   * cannot until its holder has chosen one by the link emailed to them.
   */
  private make(asked: { email: string; name: string }, createdBy: string, now: number, approvedBy?: string, password?: string, roles: StaffRole[] = []): OperatorAccount {
    // The record of a sign-in that was taken away is KEPT — its decisions still need its name — beside the address it
    // gives up, never under it.
    const old = this.accounts.get(asked.email);
    if (old) {
      this.accounts.delete(asked.email);
      this.accounts.set(`${old.email}#${old.operatorId}`, old);
    }
    const salt = password ? randomBytes(16).toString('hex') : '';
    const account: OperatorAccount = {
      operatorId: `opr_${randomBytes(8).toString('hex')}`,
      email: asked.email,
      name: asked.name,
      salt,
      hash: password ? this.hash(password, salt) : '',
      createdAt: new Date(now).toISOString(),
      createdBy,
      ...(approvedBy ? { approvedBy } : {}),
      roles,
    };
    this.accounts.set(account.email, account);
    return account;
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
    // No password chosen yet: nothing signs in, whatever is typed.
    if (!account.hash) return false;
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
    roles: heldRoles(a),
    ...(a.lastSeenAt ? { lastSeenAt: a.lastSeenAt } : {}),
    ...(a.passwordChangedAt ? { passwordChangedAt: a.passwordChangedAt } : {}),
    ...(a.revokedAt ? { revokedAt: a.revokedAt } : {}),
    ...(a.totpReset && now - Date.parse(a.totpReset.at) < RESET_WAIT_MS ? { twoStepResetAskedBy: a.totpReset.by } : {}),
    ...(!a.hash && a.welcome ? { passwordLinkUntil: a.welcome.until } : {}),
    ...(a.removal && now - Date.parse(a.removal.askedAt) < REMOVAL_KEPT_MS ? { removalFrom: new Date(Date.parse(a.removal.askedAt) + REMOVAL_WAIT_MS).toISOString() } : {}),
  };
}

/** Round 38 — said to somebody at a change of their own roles: two OTHER people decide it, the one who asked and a second. */
const OWN_ROLES = 'A change of your own roles is decided by somebody else: whoever asked for it, and a second member of staff';

/** Round 38 — the roles a person holds: theirs, or all four on an account from before roles (a sandbox's; production starts empty). */
export function heldRoles(a: Pick<OperatorAccount, 'roles'>): StaffRole[] {
  return a.roles ? rolesOf(a.roles) : [...STAFF_ROLES];
}

/** Roles as a sentence says them. */
function rolesLine(roles: readonly StaffRole[]): string {
  const words = roles.map((r) => (r === 'admin' ? 'administration' : r));
  return words.length > 1 ? `${words.slice(0, -1).join(', ')} and ${words[words.length - 1]}` : (words[0] ?? 'no role');
}

/** What is kept of a link's token: enough to know it again, never enough to use it. */
function fingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The sign-out key of one staff account: operator tokens have no DID to be signed out by. */
export function operatorKey(operatorId: string): string {
  return `${STAFF_KEY_PREFIX}${operatorId}`;
}

/** The staff account behind an operator token — none for the shared setup key, which is nobody in particular. */
export function staffIdOf(revocationKey: string | undefined): string | undefined {
  return revocationKey?.startsWith(STAFF_KEY_PREFIX) ? revocationKey.slice(STAFF_KEY_PREFIX.length) : undefined;
}
