import { Test } from '@nestjs/testing';
import { MAX_CODE_MISSES, OperatorAccountService, STAFF_PROPOSAL_DAYS, staffIdOf, type StaffLoginResult } from './operator-account.service';
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
  const where = process.env.GLOS_ENV;
  afterEach(() => {
    if (required === undefined) delete process.env.GLOS_STAFF_TWO_STEP;
    else process.env.GLOS_STAFF_TWO_STEP = required;
    if (where === undefined) delete process.env.GLOS_ENV;
    else process.env.GLOS_ENV = where;
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

  /* ------------------------------------------------------- a new account takes two -- */

  /**
   * One member of staff used to make another account alone and be handed its password: whoever held one staff
   * sign-in could become a second person and approve their own decisions. Now one asks and a different one approves.
   */
  describe('a new staff account takes two members of staff', () => {
    const t0 = Date.UTC(2026, 9, 11, 9, 0, 0);
    const DAY = 24 * 60 * 60 * 1000;
    const settled = () => new Promise((r) => setImmediate(r));
    const news = (to: string) => outbox.recent(to).filter((m) => m.template === 'staff-account-news');
    const two = () => ({
      amina: staff.create({ email: email('amina'), name: 'Amina Otieno' }, 'setup key', t0),
      brian: staff.create({ email: email('brian'), name: 'Brian Kamau' }, 'setup key', t0),
    });

    it('one asks and a different one approves: nothing can sign in until then, and the first password goes to the one who approved', async () => {
      const { amina, brian } = two();
      const chloe = email('chloe');
      const asked = staff.propose({ email: ` ${chloe.toUpperCase()} `, name: ' Chloe Wanjiru ' }, amina, t0);
      expect(asked).toEqual({ proposalId: expect.stringMatching(/^spr_[0-9a-f]{16}$/), email: chloe, name: 'Chloe Wanjiru', askedBy: 'Amina Otieno', askedAt: new Date(t0).toISOString(), until: new Date(t0 + STAFF_PROPOSAL_DAYS * DAY).toISOString(), mine: true });
      // Asked for is not made: no account, no password anywhere, and nothing to sign in with.
      expect(staff.list(t0).map((a) => a.email)).toEqual([amina.email, brian.email]);
      expect(JSON.stringify(asked)).not.toMatch(/password|hash|salt/i);
      expect(() => staff.login(chloe, 'anything-at-all', undefined, t0)).toThrow('Wrong email or password');
      // The reader's own is marked, so the console offers them "take it back" and not "approve".
      expect(staff.waitingFor(brian.operatorId, t0)).toEqual([{ ...asked, mine: false }]);
      expect(staff.waitingFor(undefined, t0)[0].mine).toBe(false);

      expect(() => staff.approve(asked.proposalId, amina, t0 + 1000)).toThrow('A second member of staff has to approve — not the one who asked');
      expect(staff.list(t0).length).toBe(2);

      const made = staff.approve(asked.proposalId, brian, t0 + 2000);
      expect(made).toMatchObject({ email: chloe, name: 'Chloe Wanjiru', twoStep: false, createdAt: new Date(t0 + 2000).toISOString() });
      expect(made.temporaryPassword).toHaveLength(12);
      expect(auth.introspect(tokenOf(staff.login(chloe, made.temporaryPassword, undefined, t0 + 3000)).access_token)).toMatchObject({ active: true, actorName: 'Chloe Wanjiru' });
      expect(staff.waitingFor(brian.operatorId, t0 + 3000)).toEqual([]);
      // Decided once: a second yes makes no second account and no second password.
      expect(() => staff.approve(asked.proposalId, brian, t0 + 4000)).toThrow('This was already approved by Brian Kamau');
      expect(() => staff.decline(asked.proposalId, brian, 'changed my mind', t0 + 4000)).toThrow('This was already approved by Brian Kamau');
      expect(staff.list(t0 + 4000).length).toBe(3);
      // The new person is told who the two were.
      await settled();
      expect(outbox.recent(chloe).find((m) => m.template === 'staff-account-added')?.text).toContain('Amina Otieno and Brian Kamau made a network staff account for you');
    });

    it('tells every other member of staff when one is asked for, and the one who asked what became of it — never the password', async () => {
      const { amina, brian } = two();
      const dan = staff.create({ email: email('dan'), name: 'Dan Mutua' }, 'setup key', t0);
      await settled();
      const before = { amina: news(amina.email).length, brian: news(brian.email).length, dan: news(dan.email).length };

      const chloe = email('chloe');
      const asked = staff.propose({ email: chloe, name: 'Chloe Wanjiru' }, amina, t0);
      await settled();
      for (const other of [brian, dan]) {
        const said = news(other.email)[0];
        expect(said.text).toContain(`Amina Otieno asked for a network staff account for Chloe Wanjiru (${chloe}).`);
        expect(said.text).toContain('Approve it only if you know this person and this is their address');
      }
      expect([news(brian.email).length, news(dan.email).length]).toEqual([before.brian + 1, before.dan + 1]);
      // Not the one who asked: they know.
      expect(news(amina.email).length).toBe(before.amina);

      const made = staff.approve(asked.proposalId, brian, t0 + 1000);
      await settled();
      expect(news(amina.email).length).toBe(before.amina + 1);
      expect(news(amina.email)[0].text).toContain(`Brian Kamau approved the network staff account you asked for, for Chloe Wanjiru (${chloe}).`);
      expect(news(dan.email).length).toBe(before.dan + 1);
      for (const m of outbox.recent()) expect(m.text + m.html).not.toContain(made.temporaryPassword);
    });

    it('is declined with a reason the one who asked is told, or taken back by them without one', async () => {
      const { amina, brian } = two();
      const eve = email('eve');
      const asked = staff.propose({ email: eve, name: 'Eve Njeri' }, amina, t0);
      expect(() => staff.decline(asked.proposalId, brian, '   ', t0)).toThrow('Say why — the member of staff who asked is told');
      expect(staff.waitingFor(brian.operatorId, t0)).toHaveLength(1);
      await settled();
      const before = news(amina.email).length;

      expect(staff.decline(asked.proposalId, brian, ' Nobody of that name works here. ', t0 + 1000)).toEqual({ ok: true });
      expect(staff.waitingFor(brian.operatorId, t0 + 1000)).toEqual([]);
      expect(() => staff.approve(asked.proposalId, brian, t0 + 2000)).toThrow('This was already declined by Brian Kamau');
      expect(staff.list(t0 + 2000).length).toBe(2);
      await settled();
      expect(news(amina.email).length).toBe(before + 1);
      expect(news(amina.email)[0].text).toContain(`Brian Kamau declined the network staff account you asked for, for Eve Njeri (${eve}).`);
      expect(news(amina.email)[0].text).toContain('Their reason: “Nobody of that name works here”. Nothing was made. You can ask again.');

      // Taking back your own needs no reason, and tells nobody.
      const again = staff.propose({ email: eve, name: 'Eve Njeri' }, amina, t0 + 3000);
      await settled();
      const quiet = { amina: news(amina.email).length, brian: news(brian.email).length };
      expect(staff.decline(again.proposalId, amina, undefined, t0 + 4000)).toEqual({ ok: true });
      await settled();
      expect({ amina: news(amina.email).length, brian: news(brian.email).length }).toEqual(quiet);
      expect(staff.waitingFor(amina.operatorId, t0 + 4000)).toEqual([]);
    });

    it('keeps the address taken while it waits, and frees it when it is declined or a week has passed', () => {
      const { amina, brian } = two();
      const fay = email('fay');
      const asked = staff.propose({ email: fay, name: 'Fay Achieng' }, amina, t0);
      expect(() => staff.propose({ email: fay.toUpperCase(), name: 'Fay again' }, brian, t0 + 1000)).toThrow(`Amina Otieno already asked for a staff account for ${fay}`);
      expect(() => staff.create({ email: fay, name: 'Fay by key' }, 'setup key', t0 + 1000)).toThrow(`Amina Otieno already asked for a staff account for ${fay}`);
      expect(() => staff.propose({ email: brian.email, name: 'Brian twice' }, amina, t0 + 1000)).toThrow('already has a staff account');
      expect(() => staff.propose({ email: 'no-at-sign', name: 'Nobody' }, amina, t0)).toThrow('real email address');
      expect(() => staff.propose({ email: email('blank'), name: '  ' }, amina, t0)).toThrow('Say who this is');
      expect(() => staff.approve('spr_0000000000000000', brian, t0)).toThrow('Nobody asked for that staff account');

      // The last moment of the week it still waits; the next, it has lapsed and the address can be asked for again.
      const week = t0 + STAFF_PROPOSAL_DAYS * DAY;
      expect(staff.waitingFor(brian.operatorId, week - 1)).toHaveLength(1);
      expect(staff.waitingFor(brian.operatorId, week)).toEqual([]);
      expect(() => staff.approve(asked.proposalId, brian, week)).toThrow('This waited 7 days for a second member of staff and has lapsed. Ask for the account again');
      expect(() => staff.decline(asked.proposalId, brian, 'too late', week)).toThrow('has lapsed');
      expect(staff.list(week).length).toBe(2);
      const again = staff.propose({ email: fay, name: 'Fay Achieng' }, amina, week);
      expect(staff.approve(again.proposalId, brian, week + 1000).email).toBe(fay);
    });

    it('cannot be asked for by somebody with nobody to approve it, or by a sign-in that was taken away', () => {
      const alone = staff.create({ email: email('alone'), name: 'Alone' }, 'setup key', t0);
      expect(() => staff.propose({ email: email('second'), name: 'Second' }, alone, t0)).toThrow('Nobody else on staff can sign in, so nobody could approve this. The second staff account is made with the setup key.');
      expect(staff.waitingFor(alone.operatorId, t0)).toEqual([]);

      const other = staff.create({ email: email('other'), name: 'Other' }, 'setup key', t0);
      const asked = staff.propose({ email: email('third'), name: 'Third' }, alone, t0);
      staff.revoke(other.operatorId, 'Alone', t0 + 1000);
      // The one who could have approved has gone: gone accounts neither ask nor approve.
      expect(() => staff.approve(asked.proposalId, other, t0 + 2000)).toThrow('No such staff account');
      expect(() => staff.propose({ email: email('fourth'), name: 'Fourth' }, other, t0 + 2000)).toThrow('No such staff account');
      expect(() => staff.propose({ email: email('fifth'), name: 'Fifth' }, alone, t0 + 2000)).toThrow('Nobody else on staff can sign in');
    });

    it('lets what somebody asked for go with their sign-in when it is taken away', () => {
      const { amina, brian } = two();
      const dan = staff.create({ email: email('dan'), name: 'Dan Mutua' }, 'setup key', t0);
      const hers = staff.propose({ email: email('ghost'), name: 'A Ghost' }, amina, t0);
      const his = staff.propose({ email: email('real'), name: 'A Real Colleague' }, dan, t0);
      staff.revoke(amina.operatorId, 'Brian Kamau', t0 + 1000);
      expect(staff.waitingFor(brian.operatorId, t0 + 1000).map((p) => p.proposalId)).toEqual([his.proposalId]);
      expect(() => staff.approve(hers.proposalId, brian, t0 + 2000)).toThrow('This was already declined by Brian Kamau');
      expect(staff.approve(his.proposalId, brian, t0 + 2000).name).toBe('A Real Colleague');
    });

    it('outside a sandbox the setup key makes the first two and no more — and whoever is already on staff is told', async () => {
      process.env.GLOS_ENV = 'production';
      const first = staff.create({ email: email('first'), name: 'First' }, 'setup key', t0);
      const second = staff.create({ email: email('second'), name: 'Second' }, 'setup key', t0);
      await settled();
      expect(news(first.email)[0].text).toContain(`A network staff account was made for Second (${second.email}) with the setup key, without a second member of staff.`);
      expect(news(second.email)).toEqual([]);

      const third = email('third');
      expect(() => staff.create({ email: third, name: 'Third' }, 'setup key', t0 + 1000)).toThrow('Two members of staff add a new one: one asks for the account in the console, a second approves it.');
      expect(staff.list(t0 + 1000).length).toBe(2);
      expect(() => staff.login(third, 'anything-at-all', undefined, t0 + 1000)).toThrow('Wrong email or password');
      // From here it takes two — and that is open to them.
      expect(staff.approve(staff.propose({ email: third, name: 'Third' }, first, t0 + 2000).proposalId, second, t0 + 3000).email).toBe(third);
      expect(() => staff.create({ email: email('fourth'), name: 'Fourth' }, 'setup key', t0 + 4000)).toThrow('Two members of staff add a new one');

      // Down to one again, the key makes the second again: otherwise nobody could ever approve anything.
      staff.revoke(second.operatorId, 'First', t0 + 5000);
      staff.revoke(staff.list(t0 + 5000).find((a) => a.email === third)!.operatorId, 'First', t0 + 5000);
      expect(staff.create({ email: email('fifth'), name: 'Fifth' }, 'setup key', t0 + 6000).name).toBe('Fifth');
    });

    it('on a laptop the setup key makes as many as the seeder and the scripts need', () => {
      two();
      expect(staff.create({ email: email('third'), name: 'Third' }, 'setup key', t0).name).toBe('Third');
      expect(staff.create({ email: email('fourth'), name: 'Fourth' }, 'setup key', t0).name).toBe('Fourth');
    });
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
      // The list says so for the day it waits, and stops saying so when it has lapsed — by the clock it is given.
      const listed = (at: number) => staff.list(at).find((a) => a.operatorId === lost.operatorId)?.twoStepResetAskedBy;
      expect(listed(later(3))).toBe('Amina Otieno');
      expect(listed(later(2) + 24 * 60 * 60 * 1000)).toBeUndefined();
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
