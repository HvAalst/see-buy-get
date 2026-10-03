import { Test } from '@nestjs/testing';
import { MAX_CODE_MISSES, OperatorAccountService, staffIdOf, type StaffLoginResult } from './operator-account.service';
import { AuthService } from '../auth/auth.service';
import { DidService } from '../did/did.service';
import { LedgerService } from '../ledger/ledger.service';
import { LEDGER_ADAPTER } from '../ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../ledger/in-memory-ledger.adapter';
import { EventBus } from '../events/event-bus.service';
import { OperationalStore } from '../data-firewall/operational-store.service';
import { FieldEncryption } from '../data-firewall/field-encryption.service';
import { MailService } from '../mail/mail.service';
import { OutboxMailSender } from '../mail/outbox-mail.sender';
import { MAIL_SENDER } from '../mail/mail.types';
import { TOTP_STEP_SECONDS, totpCode, totpStep } from '../auth/totp';
import { staffNetworkAllows } from '../auth/staff-network';

const tokenOf = (r: StaffLoginResult) => {
  if (!('token' in r)) throw new Error('expected a token, got a set-up');
  return r.token;
};
const setupOf = (r: StaffLoginResult) => {
  if (!('setup' in r)) throw new Error('expected a set-up, got a token');
  return r.setup;
};

/**
 * Network staff, one account each — so that "a different person must approve this" is about people, not about
 * two names typed beside one shared key.
 */
describe('network staff accounts', () => {
  let staff: OperatorAccountService;
  let auth: AuthService;
  let outbox: OutboxMailSender;
  const email = (n: string) => `${n}-${Math.random().toString(36).slice(2, 8)}@sbg.test`;
  const required = process.env.GLOS_STAFF_TWO_STEP;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        OperatorAccountService,
        AuthService,
        DidService,
        LedgerService,
        EventBus,
        OperationalStore,
        FieldEncryption,
        MailService,
        OutboxMailSender,
        { provide: MAIL_SENDER, useExisting: OutboxMailSender },
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
    }).compile();
    staff = moduleRef.get(OperatorAccountService);
    auth = moduleRef.get(AuthService);
    outbox = moduleRef.get(OutboxMailSender);
  });
  afterEach(() => {
    if (required === undefined) delete process.env.GLOS_STAFF_TWO_STEP;
    else process.env.GLOS_STAFF_TWO_STEP = required;
  });

  it('signs a person in as an operator whose token carries the name the account was created with', () => {
    const made = staff.create({ email: email('amina'), name: 'Amina Otieno' }, 'setup key');
    expect(made.temporaryPassword).toHaveLength(12);
    const token = tokenOf(staff.login(made.email, made.temporaryPassword));
    const seen = auth.introspect(token.access_token);
    expect(seen).toMatchObject({ active: true, role: 'operator', actorName: 'Amina Otieno', scopes: ['*'] });
    // …and which ACCOUNT it is, so a two-person rule can tell two people apart even if they share a name.
    expect(staffIdOf(seen.revocationKey)).toBe(made.operatorId);
  });

  it('never shows a hash, refuses a second account on one email, and names neither half of a failed login', () => {
    const made = staff.create({ email: email('brian'), name: 'Brian' }, 'setup key');
    expect(JSON.stringify(staff.list())).not.toMatch(/hash|salt|temporaryPassword/);
    expect(() => staff.create({ email: made.email.toUpperCase(), name: 'Brian again' }, 'setup key')).toThrow(/already has a staff account/);
    expect(() => staff.login(made.email, 'not-it')).toThrow('Wrong email or password');
    expect(() => staff.login('nobody@sbg.test', 'not-it')).toThrow('Wrong email or password');
  });

  it('ends that person’s other sessions when they change their password, and nobody else’s', () => {
    const a = staff.create({ email: email('a'), name: 'A' }, 'setup key');
    const b = staff.create({ email: email('b'), name: 'B' }, 'setup key');
    const aLaptop = tokenOf(staff.login(a.email, a.temporaryPassword)).access_token;
    const bLaptop = tokenOf(staff.login(b.email, b.temporaryPassword)).access_token;
    expect(() => staff.changePassword(a.email, a.temporaryPassword, 'short')).toThrow(/at least 10/);
    staff.changePassword(a.email, a.temporaryPassword, 'a-long-new-password');
    expect(auth.introspect(aLaptop)).toMatchObject({ active: false, reason: 'revoked' });
    expect(auth.introspect(bLaptop).active).toBe(true);
    expect(auth.introspect(tokenOf(staff.login(a.email, 'a-long-new-password')).access_token).active).toBe(true);
  });

  it('revokes a login at once, and keeps the record', () => {
    const leaver = staff.create({ email: email('leaver'), name: 'Leaver' }, 'setup key');
    const session = tokenOf(staff.login(leaver.email, leaver.temporaryPassword)).access_token;
    const revoked = staff.revoke(leaver.operatorId, 'Amina Otieno');
    expect(revoked.revokedAt).toBeDefined();
    expect(auth.introspect(session)).toMatchObject({ active: false, reason: 'revoked' });
    expect(() => staff.login(leaver.email, leaver.temporaryPassword)).toThrow('Wrong email or password');
    expect(staff.list().some((a) => a.operatorId === leaver.operatorId)).toBe(false);
  });

  /* ------------------------------------------------------------------ the second step -- */

  describe('two-step sign-in: the password, then the code an authenticator app shows', () => {
    const t0 = Date.UTC(2026, 9, 3, 9, 0, 0);
    const later = (steps: number) => t0 + steps * TOTP_STEP_SECONDS * 1000;
    const codeAt = (secret: string, at: number) => totpCode(secret, totpStep(at));

    it('where it is required, a password alone gets a secret to scan — no token — and the first code turns it on', () => {
      process.env.GLOS_STAFF_TWO_STEP = 'required';
      const made = staff.create({ email: email('chloe'), name: 'Chloe' }, 'setup key');
      const setup = setupOf(staff.login(made.email, made.temporaryPassword, undefined, t0));
      expect(setup.uri).toMatch(/^otpauth:\/\/totp\/SeeBuyGet:/);
      expect(setup.uri).toContain(`secret=${setup.secret}`);
      // Asking again inside a quarter of an hour shows the same secret, so a reload does not change the QR code mid-scan.
      expect(setupOf(staff.login(made.email, made.temporaryPassword, undefined, later(4))).secret).toBe(setup.secret);
      expect(() => staff.login(made.email, made.temporaryPassword, '000000', later(4))).toThrow(/code is not right/);

      const token = tokenOf(staff.login(made.email, made.temporaryPassword, codeAt(setup.secret, later(5)), later(5)));
      expect(auth.introspect(token.access_token).active).toBe(true);
      expect(staff.view(made.operatorId).twoStep).toBe(true);
      // From now on the password alone opens nothing, and the secret never appears in a listing.
      expect(() => staff.login(made.email, made.temporaryPassword, undefined, later(6))).toThrow(/6-digit code/);
      expect(JSON.stringify(staff.list())).not.toContain(setup.secret);
    });

    it('takes each code once, a step either side for a slow phone clock, and nothing older', () => {
      const made = staff.create({ email: email('dan'), name: 'Dan' }, 'setup key');
      const secret = staff.startTwoStep(made.operatorId, t0).secret;
      staff.confirmTwoStep(made.operatorId, codeAt(secret, t0), t0);

      const now = later(10);
      expect(tokenOf(staff.login(made.email, made.temporaryPassword, totpCode(secret, totpStep(now) - 1), now))).toBeTruthy();
      // The same code again — seen over a shoulder — is refused.
      expect(() => staff.login(made.email, made.temporaryPassword, totpCode(secret, totpStep(now) - 1), now)).toThrow(/code is not right/);
      expect(() => staff.login(made.email, made.temporaryPassword, totpCode(secret, totpStep(now) - 3), now)).toThrow(/code is not right/);
      expect(tokenOf(staff.login(made.email, made.temporaryPassword, codeAt(secret, now), now))).toBeTruthy();
    });

    it('refuses the code for fifteen minutes after five wrong ones in a row', () => {
      const made = staff.create({ email: email('eve'), name: 'Eve' }, 'setup key');
      const secret = staff.startTwoStep(made.operatorId, t0).secret;
      staff.confirmTwoStep(made.operatorId, codeAt(secret, t0), t0);
      for (let i = 0; i < MAX_CODE_MISSES; i++) expect(() => staff.login(made.email, made.temporaryPassword, '111111', later(2))).toThrow(/code is not right/);
      // Even the right code waits now.
      expect(() => staff.login(made.email, made.temporaryPassword, codeAt(secret, later(3)), later(3))).toThrow(/Wait 15 minutes/);
      expect(tokenOf(staff.login(made.email, made.temporaryPassword, codeAt(secret, later(40)), later(40)))).toBeTruthy();
    });

    it('keeps the secret encrypted at rest', () => {
      const made = staff.create({ email: email('fay'), name: 'Fay' }, 'setup key');
      const secret = staff.startTwoStep(made.operatorId, t0).secret;
      const stored = (staff as unknown as { accounts: Map<string, { totpPending?: { secret: string } }> }).accounts.get(made.email);
      expect(stored?.totpPending?.secret.startsWith('enc:')).toBe(true);
      expect(stored?.totpPending?.secret).not.toContain(secret);
    });

    it('is reset only by two OTHER members of staff — then that person is signed out and told', async () => {
      const lost = staff.create({ email: email('lost'), name: 'Lost Phone' }, 'setup key');
      const amina = staff.create({ email: email('amina'), name: 'Amina Otieno' }, 'setup key');
      const brian = staff.create({ email: email('brian'), name: 'Brian Kamau' }, 'setup key');
      const secret = staff.startTwoStep(lost.operatorId, t0).secret;
      staff.confirmTwoStep(lost.operatorId, codeAt(secret, t0), t0);
      const session = tokenOf(staff.login(lost.email, lost.temporaryPassword, codeAt(secret, later(1)), later(1))).access_token;

      const as = (a: { operatorId: string; name: string }) => ({ operatorId: a.operatorId, name: a.name });
      expect(() => staff.resetTwoStep(lost.operatorId, as(lost), later(2))).toThrow(/not you/);
      expect(staff.resetTwoStep(lost.operatorId, as(amina), later(2))).toMatchObject({ twoStep: true, twoStepResetAskedBy: 'Amina Otieno' });
      // The one who asked cannot also approve.
      expect(() => staff.resetTwoStep(lost.operatorId, as(amina), later(3))).toThrow(/different member of staff/);
      expect(auth.introspect(session).active).toBe(true);

      expect(staff.resetTwoStep(lost.operatorId, as(brian), later(3)).twoStep).toBe(false);
      expect(auth.introspect(session)).toMatchObject({ active: false, reason: 'revoked' });
      await new Promise((r) => setImmediate(r));
      const mail = outbox.recent(lost.email).find((m) => m.template === 'staff-two-step');
      expect(mail?.text).toContain('Amina Otieno and Brian Kamau');
    });
  });

  describe('the staff network fence (GLOS_STAFF_NETWORKS)', () => {
    it('lets everybody through when no network is named, and only the named ones when some are', () => {
      expect(staffNetworkAllows('203.0.113.9', [])).toBe(true);
      const office = ['196.201.214.0/24', '41.90.3.7', '2001:db8::1'];
      expect(staffNetworkAllows('196.201.214.77', office)).toBe(true);
      expect(staffNetworkAllows('::ffff:196.201.214.1', office)).toBe(true); // IPv4 on a dual-stack socket
      expect(staffNetworkAllows('41.90.3.7', office)).toBe(true);
      expect(staffNetworkAllows('2001:db8::1', office)).toBe(true);
      expect(staffNetworkAllows('196.201.215.1', office)).toBe(false);
      expect(staffNetworkAllows('41.90.3.8', office)).toBe(false);
      expect(staffNetworkAllows(undefined, office)).toBe(false);
      expect(staffNetworkAllows('not-an-ip', office)).toBe(false);
    });
  });
});
