import { Test } from '@nestjs/testing';
import { KEY_REMOVAL_WAIT_HOURS, MAX_CODE_MISSES, OperatorAccountService, STAFF_PROPOSAL_DAYS, STAFF_WELCOME_HOURS, staffIdOf, type StaffLoginResult } from './operator-account.service';
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
import { MAIL_SENDER, type OutgoingMail } from '../mail/mail.types';
import { TOTP_STEP_SECONDS, totpCode, totpStep } from '../auth/totp';
import { staffNetworkAllows } from '../auth/staff-network';

/** Round 38 — every account is asked for with the roles it is to hold. */
const ALL_ROLES = ['support', 'vetting', 'money', 'admin'];
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
   * sign-in could become a second person and approve their own decisions. Now one asks and a different one approves —
   * and no password is made at all: the new person chooses their own, by a link emailed to them and to nobody else.
   */
  describe('a new staff account takes two people, and nobody is ever shown its password', () => {
    const t0 = Date.UTC(2026, 9, 11, 9, 0, 0);
    const HOUR = 60 * 60 * 1000;
    const DAY = 24 * HOUR;
    const iso = (at: number) => new Date(at).toISOString();
    const settled = () => new Promise((r) => setImmediate(r));
    const news = (to: string) => outbox.recent(to).filter((m) => m.template === 'staff-account-news');
    const invitations = (to: string) => outbox.recent(to).filter((m) => m.template === 'staff-account-welcome');
    const tokenIn = (link: string | undefined) => {
      if (!link?.includes('#welcome=')) throw new Error('no link');
      return link.split('#welcome=')[1];
    };
    const two = () => ({
      amina: staff.create({ email: email('amina'), name: 'Amina Otieno' }, 'setup key', t0),
      brian: staff.create({ email: email('brian'), name: 'Brian Kamau' }, 'setup key', t0),
    });
    /** Asked by one, approved by the other, and the new person has chosen their password: somebody who can sign in. */
    const joined = async (name: string, by: { operatorId: string }, second: { operatorId: string }, at: number) => {
      const made = await staff.approve(staff.propose({ email: email(name.toLowerCase()), name, roles: ALL_ROLES }, by, at).proposalId, second, at);
      staff.choosePassword(tokenIn(made.link), `${name}-chose-this-one`, at);
      return made;
    };

    it('one asks and a different one approves: no password is made, and the new person chooses their own by the link emailed to them', async () => {
      const { amina, brian } = two();
      const chloe = email('chloe');
      const asked = staff.propose({ email: ` ${chloe.toUpperCase()} `, name: ' Chloe Wanjiru ', roles: ALL_ROLES }, amina, t0);
      expect(asked).toEqual({ proposalId: expect.stringMatching(/^spr_[0-9a-f]{16}$/), email: chloe, name: 'Chloe Wanjiru', askedBy: 'Amina Otieno', askedAt: iso(t0), until: iso(t0 + STAFF_PROPOSAL_DAYS * DAY), mine: true, forSetupKey: false, roles: ALL_ROLES });
      // Asked for is not made: no account, and nothing to sign in with.
      expect(staff.list(t0).map((a) => a.email)).toEqual([amina.email, brian.email]);
      expect(() => staff.login(chloe, 'anything-at-all', undefined, t0)).toThrow('Wrong email or password');
      // The reader's own is marked, so the console offers them "take it back" and not "approve".
      expect(staff.waitingFor(brian.operatorId, t0)).toEqual([{ ...asked, mine: false }]);
      expect(staff.waitingFor(undefined, t0)[0].mine).toBe(false);

      await expect(staff.approve(asked.proposalId, amina, t0 + 1000)).rejects.toThrow('A second member of staff has to approve — not the one who asked');
      expect(staff.list(t0).length).toBe(2);

      const made = await staff.approve(asked.proposalId, brian, t0 + 2000);
      expect(made).toMatchObject({ email: chloe, name: 'Chloe Wanjiru', twoStep: false, createdAt: iso(t0 + 2000), sent: true, passwordLinkUntil: iso(t0 + 2000 + STAFF_WELCOME_HOURS * HOUR) });
      // NO PASSWORD, for anybody: not in what the one who approved is answered, and not anywhere to be typed.
      expect(made).not.toHaveProperty('temporaryPassword');
      expect(JSON.stringify(made)).not.toMatch(/password"|hash|salt/i);
      expect(made.link).toMatch(/^http:\/\/localhost:5181\/#welcome=[\w-]{32}$/);
      const token = tokenIn(made.link);
      // (Two guesses, not more: the fifth wrong one in a quarter of an hour locks an address, this one like any other.)
      for (const guess of ['', token]) expect(() => staff.login(chloe, guess, undefined, t0 + 3000)).toThrow('Wrong email or password');
      expect(staff.list(t0 + 3000).find((a) => a.email === chloe)).toMatchObject({ passwordLinkUntil: made.passwordLinkUntil });

      // The link went to the new person's own address, and to nobody else's.
      await settled();
      expect(invitations(chloe)).toHaveLength(1);
      expect(invitations(chloe)[0].text).toContain(made.link);
      expect(invitations(chloe)[0].text).toContain('Amina Otieno and Brian Kamau made a network staff account for you');
      expect(invitations(chloe)[0].text).toContain('The link works once, for 48 hours');
      for (const m of outbox.recent()) if (m.to.address !== chloe) expect(m.text + m.html).not.toContain(token);
      // Only its fingerprint is kept: the stored account could not be used to make the link again.
      expect(JSON.stringify((staff as unknown as { accounts: Map<string, unknown> }).accounts.get(chloe))).not.toContain(token);

      // The console asks whose link it is; a password that will not do is refused WITHOUT spending the link.
      expect(staff.welcomeFor(` ${token} `, t0 + 4000)).toEqual({ email: chloe, name: 'Chloe Wanjiru' });
      expect(() => staff.choosePassword(token, 'too-short', t0 + 4000)).toThrow('at least 10 characters');
      expect(() => staff.choosePassword(token, 'chloe wanjiru 2026', t0 + 4000)).toThrow('too easy to guess');
      expect(() => staff.login(chloe, 'chloe wanjiru 2026', undefined, t0 + 4000)).toThrow('Wrong email or password');
      expect(staff.choosePassword(token, 'a-long-chosen-password', t0 + 5000)).toEqual({ ok: true, email: chloe });
      expect(auth.introspect(tokenOf(staff.login(chloe, 'a-long-chosen-password', undefined, t0 + 6000)).access_token)).toMatchObject({ active: true, actorName: 'Chloe Wanjiru' });
      const listed = staff.list(t0 + 6000).find((a) => a.email === chloe)!;
      expect(listed.passwordChangedAt).toBe(iso(t0 + 5000));
      expect(listed).not.toHaveProperty('passwordLinkUntil');

      // Once: the link opens nothing a second time — not for whoever finds the email later.
      expect(() => staff.choosePassword(token, 'another-long-password', t0 + 7000)).toThrow('This link has been used, or it has lapsed');
      expect(() => staff.welcomeFor(token, t0 + 7000)).toThrow('This link has been used, or it has lapsed');
      expect(() => staff.login(chloe, 'another-long-password', undefined, t0 + 7000)).toThrow('Wrong email or password');
      // Decided once: a second yes makes no second account and no second link.
      await expect(staff.approve(asked.proposalId, brian, t0 + 8000)).rejects.toThrow('This was already approved by Brian Kamau');
      expect(() => staff.decline(asked.proposalId, brian, 'changed my mind', t0 + 8000)).toThrow('This was already approved by Brian Kamau');
      expect(staff.list(t0 + 8000).length).toBe(3);
      await settled();
      expect(invitations(chloe)).toHaveLength(1);
    });

    it('the link works for two days and only the newest one works; a new one is sent to the same address, whoever asks', async () => {
      const { amina, brian } = two();
      const dan = email('dan');
      const made = await staff.approve(staff.propose({ email: dan, name: 'Dan Mutua', roles: ALL_ROLES }, amina, t0).proposalId, brian, t0);
      const first = tokenIn(made.link);
      const lapses = t0 + STAFF_WELCOME_HOURS * HOUR;
      expect(staff.welcomeFor(first, lapses - 1).email).toBe(dan);
      expect(() => staff.welcomeFor(first, lapses)).toThrow('This link has been used, or it has lapsed');
      expect(() => staff.choosePassword(first, 'a-long-chosen-password', lapses)).toThrow('This link has been used, or it has lapsed');
      // A link nobody made, and no link at all, get the same answer.
      expect(() => staff.welcomeFor('A'.repeat(32), t0)).toThrow('This link has been used, or it has lapsed');
      expect(() => staff.welcomeFor('', t0)).toThrow('This link has been used, or it has lapsed');

      const again = await staff.sendWelcome(made.operatorId, lapses + HOUR);
      expect(again).toMatchObject({ email: dan, sent: true, passwordLinkUntil: iso(lapses + HOUR + STAFF_WELCOME_HOURS * HOUR) });
      const second = tokenIn(again.link);
      expect(second).not.toBe(first);
      await settled();
      expect(invitations(dan)).toHaveLength(2);
      expect(invitations(dan)[0].text).toContain(again.link);
      // A third, while the second is still good: the second stops working at once.
      const third = tokenIn((await staff.sendWelcome(made.operatorId, lapses + 2 * HOUR)).link);
      expect(() => staff.welcomeFor(second, lapses + 2 * HOUR)).toThrow('This link has been used, or it has lapsed');
      expect(() => staff.welcomeFor(first, lapses + 2 * HOUR)).toThrow('This link has been used, or it has lapsed');
      expect(staff.choosePassword(third, 'a-long-chosen-password', lapses + 3 * HOUR).email).toBe(dan);

      // Nothing to send to somebody who has a password — chosen by them, or the setup key's own first one.
      await expect(staff.sendWelcome(made.operatorId, lapses + 4 * HOUR)).rejects.toThrow('Dan Mutua has already chosen a password');
      await expect(staff.sendWelcome(amina.operatorId, lapses + 4 * HOUR)).rejects.toThrow('Amina Otieno has already chosen a password');

      // A sign-in taken away before its holder ever came: the link dies with it.
      const eve = await staff.approve(staff.propose({ email: email('eve'), name: 'Eve Njeri', roles: ALL_ROLES }, amina, t0).proposalId, brian, t0);
      staff.revoke(eve.operatorId, 'Brian Kamau', t0 + HOUR);
      expect(() => staff.choosePassword(tokenIn(eve.link), 'a-long-chosen-password', t0 + 2 * HOUR)).toThrow('This link has been used, or it has lapsed');
      await expect(staff.sendWelcome(eve.operatorId, t0 + 2 * HOUR)).rejects.toThrow('No such staff account');
    });

    it('tells every other member of staff when one is asked for, and the one who asked what became of it', async () => {
      const { amina, brian } = two();
      const dan = staff.create({ email: email('dan'), name: 'Dan Mutua' }, 'setup key', t0);
      await settled();
      const before = { amina: news(amina.email).length, brian: news(brian.email).length, dan: news(dan.email).length };

      const chloe = email('chloe');
      const asked = staff.propose({ email: chloe, name: 'Chloe Wanjiru', roles: ALL_ROLES }, amina, t0);
      await settled();
      for (const other of [brian, dan]) {
        const said = news(other.email)[0];
        expect(said.text).toContain(`Amina Otieno asked for a network staff account for Chloe Wanjiru (${chloe}), to hold support, vetting, money and administration.`);
        expect(said.text).toContain('Approve it only if you know this person and this is their address');
      }
      expect([news(brian.email).length, news(dan.email).length]).toEqual([before.brian + 1, before.dan + 1]);
      // Not the one who asked: they know.
      expect(news(amina.email).length).toBe(before.amina);

      await staff.approve(asked.proposalId, brian, t0 + 1000);
      await settled();
      expect(news(amina.email).length).toBe(before.amina + 1);
      expect(news(amina.email)[0].text).toContain(`Brian Kamau approved the network staff account you asked for, for Chloe Wanjiru (${chloe}).`);
      expect(news(amina.email)[0].text).toContain('nobody on staff is shown one');
      expect(news(dan.email).length).toBe(before.dan + 1);
    });

    it('is declined with a reason the one who asked is told, or taken back by them without one', async () => {
      const { amina, brian } = two();
      const eve = email('eve');
      const asked = staff.propose({ email: eve, name: 'Eve Njeri', roles: ALL_ROLES }, amina, t0);
      expect(() => staff.decline(asked.proposalId, brian, '   ', t0)).toThrow('Say why — the member of staff who asked is told');
      expect(staff.waitingFor(brian.operatorId, t0)).toHaveLength(1);
      await settled();
      const before = news(amina.email).length;

      expect(staff.decline(asked.proposalId, brian, ' Nobody of that name works here. ', t0 + 1000)).toEqual({ ok: true });
      expect(staff.waitingFor(brian.operatorId, t0 + 1000)).toEqual([]);
      await expect(staff.approve(asked.proposalId, brian, t0 + 2000)).rejects.toThrow('This was already declined by Brian Kamau');
      expect(staff.list(t0 + 2000).length).toBe(2);
      await settled();
      expect(news(amina.email).length).toBe(before + 1);
      expect(news(amina.email)[0].text).toContain(`Brian Kamau declined the network staff account you asked for, for Eve Njeri (${eve}).`);
      expect(news(amina.email)[0].text).toContain('Their reason: “Nobody of that name works here”. Nothing was made. You can ask again.');
      expect(invitations(eve)).toEqual([]);

      // Taking back your own needs no reason, and tells nobody.
      const again = staff.propose({ email: eve, name: 'Eve Njeri', roles: ALL_ROLES }, amina, t0 + 3000);
      await settled();
      const quiet = { amina: news(amina.email).length, brian: news(brian.email).length };
      expect(staff.decline(again.proposalId, amina, undefined, t0 + 4000)).toEqual({ ok: true });
      await settled();
      expect({ amina: news(amina.email).length, brian: news(brian.email).length }).toEqual(quiet);
      expect(staff.waitingFor(amina.operatorId, t0 + 4000)).toEqual([]);
    });

    it('keeps the address taken while it waits, and frees it when it is declined or a week has passed', async () => {
      const { amina, brian } = two();
      const fay = email('fay');
      const asked = staff.propose({ email: fay, name: 'Fay Achieng', roles: ALL_ROLES }, amina, t0);
      expect(() => staff.propose({ email: fay.toUpperCase(), name: 'Fay again', roles: ALL_ROLES }, brian, t0 + 1000)).toThrow(`Amina Otieno already asked for a staff account for ${fay}`);
      expect(() => staff.create({ email: fay, name: 'Fay by key' }, 'setup key', t0 + 1000)).toThrow(`Amina Otieno already asked for a staff account for ${fay}`);
      expect(() => staff.propose({ email: brian.email, name: 'Brian twice', roles: ALL_ROLES }, amina, t0 + 1000)).toThrow('already has a staff account');
      expect(() => staff.propose({ email: 'no-at-sign', name: 'Nobody', roles: ALL_ROLES }, amina, t0)).toThrow('real email address');
      expect(() => staff.propose({ email: email('blank'), name: '  ', roles: ALL_ROLES }, amina, t0)).toThrow('Say who this is');
      await expect(staff.approve('spr_0000000000000000', brian, t0)).rejects.toThrow('Nobody asked for that staff account');

      // The last moment of the week it still waits; the next, it has lapsed and the address can be asked for again.
      const week = t0 + STAFF_PROPOSAL_DAYS * DAY;
      expect(staff.waitingFor(brian.operatorId, week - 1)).toHaveLength(1);
      expect(staff.waitingFor(brian.operatorId, week)).toEqual([]);
      await expect(staff.approve(asked.proposalId, brian, week)).rejects.toThrow('This waited 7 days for a second member of staff and has lapsed. Ask for the account again');
      expect(() => staff.decline(asked.proposalId, brian, 'too late', week)).toThrow('has lapsed');
      expect(staff.list(week).length).toBe(2);
      const again = staff.propose({ email: fay, name: 'Fay Achieng', roles: ALL_ROLES }, amina, week);
      expect((await staff.approve(again.proposalId, brian, week + 1000)).email).toBe(fay);
      // Made, it holds the address — even before its holder has chosen a password.
      expect(() => staff.propose({ email: fay, name: 'Fay a third time', roles: ALL_ROLES }, amina, week + 2000)).toThrow('already has a staff account');
    });

    it('somebody who is the only one able to sign in asks, and the setup key is their second — for them, and for nobody else', async () => {
      const alone = staff.create({ email: email('alone'), name: 'Alone Otieno' }, 'setup key', t0);
      const second = email('second');
      const asked = staff.propose({ email: second, name: 'Second Kamau', roles: ALL_ROLES }, alone, t0);
      expect(asked).toMatchObject({ mine: true, forSetupKey: true });
      // Still never their own second.
      await expect(staff.approve(asked.proposalId, alone, t0)).rejects.toThrow('A second member of staff has to approve — not the one who asked');
      const made = await staff.approve(asked.proposalId, { setupKey: true }, t0 + 1000);
      expect(made).toMatchObject({ email: second, sent: true });
      await settled();
      expect(invitations(second)[0].text).toContain('Alone Otieno and the setup key made a network staff account for you');
      expect(news(alone.email)[0].text).toContain(`The setup key approved the network staff account you asked for, for Second Kamau (${second}).`);

      // Somebody asked for who has not chosen a password yet cannot sign in: they are nobody's second, so the key still is.
      const third = staff.propose({ email: email('third'), name: 'Third Mutua', roles: ALL_ROLES }, alone, t0 + 2000);
      expect(third.forSetupKey).toBe(true);
      staff.choosePassword(tokenIn(made.link), 'second-chose-this-one', t0 + 3000);
      // Now two people can sign in: the setup key is nobody's second any more, and the colleague is.
      expect(staff.waitingFor(alone.operatorId, t0 + 4000)[0]).toMatchObject({ proposalId: third.proposalId, forSetupKey: false });
      await expect(staff.approve(third.proposalId, { setupKey: true }, t0 + 4000)).rejects.toThrow('A second member of staff approves this. The setup key approves only for somebody who is the only one able to sign in.');
      expect(staff.list(t0 + 4000).length).toBe(2);
      expect((await staff.approve(third.proposalId, { operatorId: made.operatorId }, t0 + 5000)).name).toBe('Third Mutua');
    });

    it('lets what somebody asked for go with their sign-in, and gives nothing to a sign-in that was taken away', async () => {
      const { amina, brian } = two();
      const dan = staff.create({ email: email('dan'), name: 'Dan Mutua' }, 'setup key', t0);
      const hers = staff.propose({ email: email('ghost'), name: 'A Ghost', roles: ALL_ROLES }, amina, t0);
      const his = staff.propose({ email: email('real'), name: 'A Real Colleague', roles: ALL_ROLES }, dan, t0);
      staff.revoke(amina.operatorId, 'Brian Kamau', t0 + 1000);
      expect(staff.waitingFor(brian.operatorId, t0 + 1000).map((p) => p.proposalId)).toEqual([his.proposalId]);
      await expect(staff.approve(hers.proposalId, brian, t0 + 2000)).rejects.toThrow('This was already declined by Brian Kamau');
      // Gone accounts neither ask nor approve.
      await expect(staff.approve(his.proposalId, amina, t0 + 2000)).rejects.toThrow('No such staff account');
      expect(() => staff.propose({ email: email('fourth'), name: 'Fourth', roles: ALL_ROLES }, amina, t0 + 2000)).toThrow('No such staff account');
      expect((await staff.approve(his.proposalId, brian, t0 + 2000)).name).toBe('A Real Colleague');
    });

    it('frees the address of a sign-in that was taken away, and keeps the record of it', async () => {
      const { amina, brian } = two();
      const dan = staff.create({ email: email('dan'), name: 'Dan Mutua' }, 'setup key', t0);
      staff.revoke(dan.operatorId, 'Amina Otieno', t0 + 1000);
      // Locked out and let back in, or gone and returned: the same address, a new account, a password of their own choosing.
      const back = await staff.approve(staff.propose({ email: dan.email, name: 'Dan Mutua', roles: ALL_ROLES }, amina, t0 + 2000).proposalId, brian, t0 + 3000);
      expect(back.email).toBe(dan.email);
      expect(back.operatorId).not.toBe(dan.operatorId);
      expect(() => staff.login(dan.email, dan.temporaryPassword, undefined, t0 + 4000)).toThrow('Wrong email or password');
      staff.choosePassword(tokenIn(back.link), 'dan-chose-this-one', t0 + 4000);
      expect(tokenOf(staff.login(dan.email, 'dan-chose-this-one', undefined, t0 + 5000))).toBeTruthy();
      expect(staff.list(t0 + 5000).filter((a) => a.email === dan.email)).toHaveLength(1);
      // The old record is still there, taken away, under a key nobody signs in with.
      const kept = [...(staff as unknown as { accounts: Map<string, { operatorId: string; revokedAt?: string }> }).accounts.values()].find((a) => a.operatorId === dan.operatorId);
      expect(kept?.revokedAt).toBe(iso(t0 + 1000));
    });

    it('tells whoever is already on staff when the setup key makes an account alone', async () => {
      const { amina, brian } = two();
      await settled();
      expect(news(amina.email)[0].text).toContain(`A network staff account was made for Brian Kamau (${brian.email}) with the setup key, without a second person.`);
      // Not the one it was made for: they have their own email about it.
      expect(news(brian.email)).toEqual([]);
    });

    it('on a laptop the setup key makes as many as the seeder and the scripts need, and takes one away at once', () => {
      two();
      expect(staff.create({ email: email('third'), name: 'Third' }, 'setup key', t0).name).toBe('Third');
      const fourth = staff.create({ email: email('fourth'), name: 'Fourth' }, 'setup key', t0);
      expect(staff.removeByKey(fourth.operatorId, t0 + 1000).revokedAt).toBe(iso(t0 + 1000));
      expect(staff.list(t0 + 1000).some((a) => a.operatorId === fourth.operatorId)).toBe(false);
    });

    /* ------------------------------------------------- outside a sandbox: the setup key -- */

    describe('outside a sandbox', () => {
      // Real addresses: one on a domain kept for tests is never handed to a sender that sends.
      const real = (n: string) => `${n}-${Math.random().toString(36).slice(2, 8)}@staff.seebuyget.com`;
      /** A server whose email LEAVES it — a sender that takes each one — built on a laptop and then called production. */
      const live = async () => {
        const sent: OutgoingMail[] = [];
        const moduleRef = await Test.createTestingModule({
          providers: [OperatorAccountService, AuthService, DidService, LedgerService, EventBus, OperationalStore, FieldEncryption, MailService, { provide: MAIL_SENDER, useValue: { send: async (m: OutgoingMail) => void sent.push(m) } }, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter }],
        }).compile();
        const to = (address: string, template: string) => sent.filter((m) => m.to.address === address && m.template === template);
        return { staff: moduleRef.get(OperatorAccountService), auth: moduleRef.get(AuthService), sent, to };
      };
      const linkIn = (mail: OutgoingMail | undefined) => mail?.text.match(/\S+#welcome=[\w-]{32}/)?.[0];

      it('the setup key makes an account alone only while nobody can sign in; one person asks and the key approves; with two it adds nobody', async () => {
        const s = await live();
        process.env.GLOS_ENV = 'production';
        const first = s.staff.create({ email: real('first'), name: 'First Otieno' }, 'setup key', t0);
        expect(first.temporaryPassword).toHaveLength(12);
        const second = real('second');
        expect(() => s.staff.create({ email: second, name: 'Second Kamau' }, 'setup key', t0 + 1000)).toThrow('The setup key makes a staff account alone only while nobody can sign in.');
        expect(s.staff.list(t0 + 1000).length).toBe(1);

        // One person on staff: they ask, and the setup key is the second. The link goes by email and is in no answer.
        const asked = s.staff.propose({ email: second, name: 'Second Kamau', roles: ALL_ROLES }, first, t0 + 2000);
        expect(asked.forSetupKey).toBe(true);
        const made = await s.staff.approve(asked.proposalId, { setupKey: true }, t0 + 3000);
        expect(made).toMatchObject({ email: second, sent: true });
        expect(made).not.toHaveProperty('link');
        expect(JSON.stringify(made)).not.toContain('welcome=');
        const link = linkIn(s.to(second, 'staff-account-welcome')[0]);
        expect(link).toBeDefined();
        // Asked for, approved, and still not somebody who can sign in: the key may not make another alone meanwhile.
        expect(() => s.staff.create({ email: real('sneak'), name: 'Sneak' }, 'setup key', t0 + 4000)).toThrow('only while nobody can sign in');
        s.staff.choosePassword(tokenIn(link), 'second-chose-this-one', t0 + 5000);

        // Two can sign in: the setup key adds nobody, alone or as a second.
        const third = real('third');
        expect(() => s.staff.create({ email: third, name: 'Third Mutua' }, 'setup key', t0 + 6000)).toThrow('only while nobody can sign in');
        const wanted = s.staff.propose({ email: third, name: 'Third Mutua', roles: ALL_ROLES }, first, t0 + 6000);
        await expect(s.staff.approve(wanted.proposalId, { setupKey: true }, t0 + 7000)).rejects.toThrow('The setup key approves only for somebody who is the only one able to sign in');
        expect(s.staff.list(t0 + 7000).length).toBe(2);
        expect((await s.staff.approve(wanted.proposalId, { operatorId: made.operatorId }, t0 + 8000)).email).toBe(third);
      });

      it('with no email leaving the server, a staff account is not asked for at all: the link could not travel', async () => {
        const first = staff.create({ email: real('first'), name: 'First Otieno' }, 'setup key', t0);
        const waiting = staff.propose({ email: real('early'), name: 'Asked On A Laptop', roles: ALL_ROLES }, first, t0);
        process.env.GLOS_ENV = 'production';
        expect(() => staff.propose({ email: real('second'), name: 'Second Kamau', roles: ALL_ROLES }, first, t0 + 1000)).toThrow('No email leaves this server yet');
        await expect(staff.approve(waiting.proposalId, { setupKey: true }, t0 + 1000)).rejects.toThrow('No email leaves this server yet');
        expect(staff.list(t0 + 1000).length).toBe(1);
        expect(staff.waitingFor(first.operatorId, t0 + 1000).map((p) => p.proposalId)).toEqual([waiting.proposalId]);
      });

      it('an address that cannot exist is not written to: the one who approved is told the email did not go', async () => {
        const s = await live();
        const first = s.staff.create({ email: real('first'), name: 'First Otieno' }, 'setup key', t0);
        process.env.GLOS_ENV = 'production';
        const nowhere = email('nowhere');
        const made = await s.staff.approve(s.staff.propose({ email: nowhere, name: 'No Where', roles: ALL_ROLES }, first, t0).proposalId, { setupKey: true }, t0 + 1000);
        expect(made).toMatchObject({ email: nowhere, sent: false });
        expect(s.to(nowhere, 'staff-account-welcome')).toEqual([]);
      });

      it('the setup key takes a sign-in away only after everybody on staff was told and a day passed — and any one of them can stop it', async () => {
        const s = await live();
        const amina = s.staff.create({ email: real('amina'), name: 'Amina Otieno' }, 'setup key', t0);
        const brian = s.staff.create({ email: real('brian'), name: 'Brian Kamau' }, 'setup key', t0);
        const session = tokenOf(s.staff.login(brian.email, brian.temporaryPassword, undefined, t0)).access_token;
        process.env.GLOS_ENV = 'production';
        const told = (who: { email: string }) => s.to(who.email, 'staff-account-news').map((m) => m.text);
        const WAIT = KEY_REMOVAL_WAIT_HOURS * HOUR;

        // Asked: nothing is taken away. Everybody is told — the one concerned too.
        expect(s.staff.removeByKey(brian.operatorId, t0)).toMatchObject({ email: brian.email, removalFrom: iso(t0 + WAIT) });
        expect(s.staff.list(t0).map((a) => a.email)).toEqual([amina.email, brian.email]);
        expect(s.auth.introspect(session).active).toBe(true);
        await settled();
        for (const who of [amina, brian]) expect(told(who).some((t) => t.includes(`The setup key asked to take away the staff sign-in of Brian Kamau (${brian.email}).`) && t.includes('Nothing happens for 24 hours'))).toBe(true);
        // Not a moment early.
        expect(() => s.staff.removeByKey(brian.operatorId, t0 + WAIT - 1)).toThrow('Everybody on staff has been told. The setup key can finish this from');
        expect(s.staff.list(t0 + WAIT - 1).length).toBe(2);

        // Stopped by a colleague: it is as if it had not been asked, and the others hear who stopped it.
        expect(s.staff.stopRemoval(brian.operatorId, amina, t0 + HOUR)).not.toHaveProperty('removalFrom');
        await settled();
        expect(told(brian).some((t) => t.includes('Amina Otieno stopped the setup key taking away the staff sign-in of Brian Kamau.'))).toBe(true);
        expect(() => s.staff.stopRemoval(brian.operatorId, amina, t0 + HOUR)).toThrow('Nobody asked to take the sign-in of Brian Kamau away');
        // So a day after the FIRST asking the key does not finish anything: it has to ask — and announce — again.
        const again = t0 + WAIT + HOUR;
        expect(s.staff.removeByKey(brian.operatorId, again)).toMatchObject({ removalFrom: iso(again + WAIT) });
        expect(s.staff.list(again).length).toBe(2);
        // The one concerned can stop it themselves.
        expect(s.staff.stopRemoval(brian.operatorId, brian, again + HOUR)).not.toHaveProperty('removalFrom');

        // Asked a third time and stopped by nobody: a day later it is finished, and the sign-in is gone.
        const third = again + 2 * HOUR;
        s.staff.removeByKey(brian.operatorId, third);
        const gone = s.staff.removeByKey(brian.operatorId, third + WAIT);
        expect(gone.revokedAt).toBe(iso(third + WAIT));
        expect(s.staff.list(third + WAIT).map((a) => a.email)).toEqual([amina.email]);
        expect(s.auth.introspect(session)).toMatchObject({ active: false, reason: 'revoked' });
        await settled();
        expect(s.to(brian.email, 'access-removed')[0].text).toContain('the setup key removed your network staff account');

        // Asked and then left for more than a week, it is forgotten: the next asking announces, and takes nothing away.
        s.staff.removeByKey(amina.operatorId, third + WAIT);
        const muchLater = third + WAIT + 8 * DAY;
        expect(s.staff.removeByKey(amina.operatorId, muchLater)).toMatchObject({ removalFrom: iso(muchLater + WAIT) });
        expect(s.staff.list(muchLater).map((a) => a.email)).toEqual([amina.email]);
        // A member of staff still takes a colleague's sign-in away at once — that is not the setup key's rule.
      });

      it('somebody alone on staff who lost their way in is let back by the setup key: announced, a day later, and then the first account again', async () => {
        const s = await live();
        const only = s.staff.create({ email: real('only'), name: 'Only Otieno' }, 'setup key', t0);
        process.env.GLOS_ENV = 'production';
        const WAIT = KEY_REMOVAL_WAIT_HOURS * HOUR;
        expect(() => s.staff.create({ email: real('other'), name: 'Other' }, 'setup key', t0)).toThrow('only while nobody can sign in');
        s.staff.removeByKey(only.operatorId, t0);
        s.staff.removeByKey(only.operatorId, t0 + WAIT);
        // Nobody can sign in: the key makes the first account again — at the same address.
        const back = s.staff.create({ email: only.email, name: 'Only Otieno' }, 'setup key', t0 + WAIT + 1000);
        expect(back.operatorId).not.toBe(only.operatorId);
        expect(back.temporaryPassword).toHaveLength(12);
        expect(() => s.staff.login(only.email, only.temporaryPassword, undefined, t0 + WAIT + 2000)).toThrow('Wrong email or password');
      });
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
