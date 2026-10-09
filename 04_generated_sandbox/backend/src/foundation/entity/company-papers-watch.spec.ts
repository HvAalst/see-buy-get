import { Test } from '@nestjs/testing';
import { EntityService } from './entity.service';
import { EntityAdminService } from './entity-admin.service';
import { CompanyPapersWatch, PAPER_REMINDER_DAYS, paperWords, stageOf, stopsWords } from './company-papers-watch.service';
import { AuthService } from '../auth/auth.service';
import { DidService } from '../did/did.service';
import { LedgerService } from '../ledger/ledger.service';
import { LEDGER_ADAPTER } from '../ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../ledger/in-memory-ledger.adapter';
import { EventBus } from '../events/event-bus.service';
import { OperationalStore } from '../data-firewall/operational-store.service';
import { MailService } from '../mail/mail.service';
import { OutboxMailSender } from '../mail/outbox-mail.sender';
import { MAIL_SENDER, MailSendError } from '../mail/mail.types';

/**
 * A COMPANY OF OURS IS TOLD BEFORE ITS OWN PAPER LAPSES — on the real company, administrator and mail services, and
 * read where it arrives: the administrators' inboxes.
 *
 * The design note says it in one sentence (country_activation.md §6): "A licence or policy has an expiry date. Ahead of
 * it, the company's administrators are told. When it lapses, the capability it supports drops automatically." The
 * second half was built. The first was not: staff had a list, and the people who could renew the paper heard nothing.
 */
describe('a company is told before its own paper lapses', () => {
  let entities: EntityService;
  let admins: EntityAdminService;
  let watch: CompanyPapersWatch;
  let outbox: OutboxMailSender;
  let mail: MailService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EntityService, EntityAdminService, CompanyPapersWatch, AuthService, DidService, LedgerService, EventBus, OperationalStore,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        MailService, OutboxMailSender, { provide: MAIL_SENDER, useExisting: OutboxMailSender },
      ],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    admins = moduleRef.get(EntityAdminService);
    watch = moduleRef.get(CompanyPapersWatch);
    outbox = moduleRef.get(OutboxMailSender);
    mail = moduleRef.get(MailService);
  });

  afterEach(() => {
    watch.onModuleDestroy();
    mail.onModuleDestroy();
  });

  const DAY = 86_400_000;
  const KE = 'sbg-ke';
  const group = () => entities.group().entityId;
  /** Nine in the morning (UTC) on a day that many before the paper's expiry date. */
  const daysBefore = (expiresAt: string, days: number) => Date.parse(`${expiresAt}T09:00:00.000Z`) - days * DAY;
  const courier = (expiresAt: string, number = 'CA/CL/0042') => entities.updateRecord(KE, { licences: [{ kind: 'courier', number, issuer: 'Communications Authority', expiresAt }] }, 'Amina Otieno');
  const anAdmin = (entityId: string, name: string) => {
    const email = `${name.toLowerCase().replace(/\W+/g, '.')}@sbg.co.ke`;
    admins.create(entityId, { email, name }, 'Amina Otieno');
    return email;
  };
  /** What that address was sent about a paper — and nothing else it was sent. */
  const papersTo = (address: string) => outbox.recent(address).filter((m) => m.template === 'company-paper-lapsing');
  const subjects = (address: string) => papersTo(address).map((m) => m.subject);

  /* ------------------------------------------------------------------ the marks -- */

  it('tells every administrator of the company at each mark, once — sixty days out, thirty, fourteen, seven, the day before, and the day it has lapsed', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    const otieno = anAdmin(KE, 'Otieno Odhiambo');
    const EXPIRES = '2026-12-10';
    courier(EXPIRES);
    // Seventy days out nothing is said; then the clock is looked at every six hours until two days after the date.
    expect(await watch.sweep(daysBefore(EXPIRES, 70))).toEqual({ mails: 0, papers: 0, nobody: 0 });
    for (let t = daysBefore(EXPIRES, 65); t <= daysBefore(EXPIRES, -2); t += 6 * 3_600_000) await watch.sweep(t);

    const expected = [
      'Courier licence runs out in 59 days — SeeBuyGet Kenya',
      'Courier licence runs out in 30 days — SeeBuyGet Kenya',
      'Courier licence runs out in 14 days — SeeBuyGet Kenya',
      'Courier licence runs out in 7 days — SeeBuyGet Kenya',
      'Courier licence runs out tomorrow — SeeBuyGet Kenya',
      'Courier licence has lapsed — SeeBuyGet Kenya',
    ];
    expect(expected).toHaveLength(PAPER_REMINDER_DAYS.length + 1);
    expect(subjects(wanjiru).sort()).toEqual([...expected].sort());
    expect(subjects(otieno).sort()).toEqual([...expected].sort());
  });

  it('says which paper, until when, what stops — in the console’s own words — and what to do about it', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    courier('2026-12-10');
    await watch.sweep(daysBefore('2026-12-10', 14));
    const [mail] = papersTo(wanjiru);
    expect(mail.to).toEqual({ address: wanjiru, name: 'Wanjiru Kamau' });
    expect(mail.text).toContain('SeeBuyGet Kenya’s courier licence is good until 10 Dec 2026.');
    expect(mail.text).toContain('From the day after, SeeBuyGet Kenya can no longer charge customers.');
    expect(mail.text).toContain('CA/CL/0042');
    // Not "type the new date": a company's record is changed by network staff, so the email must not send them to a form that refuses them.
    expect(mail.text).toContain('under Papers put the renewed licence on record with its new expiry date');
    expect(mail.text).toContain('SeeBuyGet staff check it and enter the new date');
  });

  it('a lapsed paper says what is switched off and that it comes back; one nothing depends on says that nothing stops', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    entities.updateRecord(
      KE,
      {
        insurance: [
          { kind: 'goods_in_transit', insurer: 'Jubilee', policyNumber: 'GIT-88', expiresAt: '2026-10-07' },
          { kind: 'public_liability', insurer: 'Jubilee', policyNumber: 'PL-17', expiresAt: '2026-11-06' },
        ],
      },
      'Amina Otieno',
    );
    await watch.sweep(Date.parse('2026-10-08T09:00:00.000Z'));
    const lapsed = papersTo(wanjiru).find((m) => m.subject === 'Goods-in-transit insurance has lapsed — SeeBuyGet Kenya')!;
    expect(lapsed.text).toContain('SeeBuyGet Kenya can no longer pay claims until a new one is on its record.');
    expect(lapsed.text).toContain('What is switched off comes back the moment the new date is on record.');
    const quiet = papersTo(wanjiru).find((m) => m.subject === 'Public liability insurance runs out in 29 days — SeeBuyGet Kenya')!;
    expect(quiet.text).toContain('Nothing switches off by itself when it does');
    expect(quiet.text).not.toContain('can no longer');
  });

  it('a company not switched on yet is told its paper is running out — and not that something stops, because nothing of its runs', async () => {
    const draft = entities.createCompany({ kind: 'sister', jurisdiction: 'UG', name: 'SeeBuyGet Uganda' }, 'Amina Otieno');
    expect(draft.status).toBe('draft');
    const nakato = anAdmin(draft.entityId, 'Nakato Namuli');
    entities.updateRecord(draft.entityId, { licences: [{ kind: 'courier', number: 'UCC/CL/0007', issuer: 'Uganda Communications Commission', expiresAt: '2026-12-10' }] }, 'Amina Otieno');
    await watch.sweep(daysBefore('2026-12-10', 14));
    const [mail] = papersTo(nakato);
    expect(mail.subject).toBe('Courier licence runs out in 14 days — SeeBuyGet Uganda');
    expect(mail.text).not.toContain('can no longer');
    expect(mail.text).toContain('Nothing switches off by itself when it does');

    // Switched on, the same paper at its next mark says what stops.
    entities.activate(draft.entityId, 'Amina Otieno');
    await watch.sweep(daysBefore('2026-12-10', 7));
    expect(papersTo(nakato).map((m) => m.text).filter((text) => text.includes('From the day after, SeeBuyGet Uganda can no longer charge customers.'))).toHaveLength(1);
  });

  it('a paper first seen close to its date is told the mark it is at, once — not every mark it has already passed', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    courier('2026-12-10');
    const now = daysBefore('2026-12-10', 10);
    expect(await watch.sweep(now)).toEqual({ mails: 1, papers: 1, nobody: 0 });
    expect(await watch.sweep(now + 6 * 3_600_000)).toEqual({ mails: 0, papers: 0, nobody: 0 });
    expect(subjects(wanjiru)).toEqual(['Courier licence runs out in 10 days — SeeBuyGet Kenya']);
    // And it is not told the fourteen-day mark later for having been told inside it: the next is seven.
    await watch.sweep(daysBefore('2026-12-10', 8));
    expect(subjects(wanjiru)).toHaveLength(1);
    await watch.sweep(daysBefore('2026-12-10', 7));
    expect(subjects(wanjiru)).toHaveLength(2);
  });

  it('a renewed paper has a new date, and starts again', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    courier('2026-12-10');
    await watch.sweep(daysBefore('2026-12-10', 14));
    expect(subjects(wanjiru)).toHaveLength(1);
    // Staff enter the renewal: nothing more is said of the old date, and next year's is told in its own time.
    courier('2027-12-10');
    for (const d of [7, 1, 0, -1]) await watch.sweep(daysBefore('2026-12-10', d));
    expect(subjects(wanjiru)).toHaveLength(1);
    await watch.sweep(daysBefore('2027-12-10', 30));
    expect(subjects(wanjiru)).toEqual(expect.arrayContaining(['Courier licence runs out in 30 days — SeeBuyGet Kenya']));
    expect(subjects(wanjiru)).toHaveLength(2);
  });

  /* ------------------------------------------------------------------ who is told -- */

  it('from a week out the parent’s administrators are told too — and not before, while the company has its own', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    const hans = anAdmin(group(), 'Hans van Aalst');
    const elsewhere = anAdmin('sbg-et', 'Selam Tesfaye');
    courier('2026-12-10');
    await watch.sweep(daysBefore('2026-12-10', 30));
    await watch.sweep(daysBefore('2026-12-10', 14));
    expect(subjects(wanjiru)).toHaveLength(2);
    expect(subjects(hans)).toEqual([]);

    await watch.sweep(daysBefore('2026-12-10', 7));
    await watch.sweep(daysBefore('2026-12-10', 1));
    await watch.sweep(daysBefore('2026-12-10', -1));
    expect(subjects(hans).sort()).toEqual(['Courier licence has lapsed — SeeBuyGet Kenya', 'Courier licence runs out in 7 days — SeeBuyGet Kenya', 'Courier licence runs out tomorrow — SeeBuyGet Kenya']);
    expect(subjects(wanjiru)).toHaveLength(5);
    // Another country's company hears nothing of this one's papers.
    expect(subjects(elsewhere)).toEqual([]);
  });

  it('a company with no administrator of its own: its parent’s are told from the first mark', async () => {
    const hans = anAdmin(group(), 'Hans van Aalst');
    courier('2026-12-10');
    expect(await watch.sweep(daysBefore('2026-12-10', 30))).toEqual({ mails: 1, papers: 1, nobody: 0 });
    expect(subjects(hans)).toEqual(['Courier licence runs out in 30 days — SeeBuyGet Kenya']);
  });

  it('NOBODY to tell is kept and shown — and the day somebody can be told, they are, at the same mark', async () => {
    courier('2026-12-10');
    const now = daysBefore('2026-12-10', 14);
    expect(await watch.sweep(now)).toEqual({ mails: 0, papers: 0, nobody: 1 });
    // Not counted again every six hours, and staff reading the list see that the reminder went nowhere.
    expect(await watch.sweep(now + 6 * 3_600_000)).toEqual({ mails: 0, papers: 0, nobody: 0 });
    expect(watch.list(now + DAY)[0]).toMatchObject({ entityId: KE, reference: 'CA/CL/0042', told: { stage: 14, to: 0, of: 0, nobody: true } });

    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    expect(await watch.sweep(now + DAY)).toEqual({ mails: 1, papers: 1, nobody: 0 });
    expect(subjects(wanjiru)).toEqual(['Courier licence runs out in 13 days — SeeBuyGet Kenya']);
    expect(watch.list(now + DAY)[0].told).toEqual({ stage: 14, at: new Date(now + DAY).toISOString(), to: 1, of: 1 });
    expect(await watch.sweep(now + DAY + 6 * 3_600_000)).toEqual({ mails: 0, papers: 0, nobody: 0 });
  });

  it('somebody whose login was taken away is not told', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    const gone = anAdmin(KE, 'Former Admin');
    const formerId = admins.list(KE).find((a) => a.email === gone)!.adminId;
    admins.revoke(KE, formerId, 'Amina Otieno');
    courier('2026-12-10');
    await watch.sweep(daysBefore('2026-12-10', 14));
    expect(subjects(wanjiru)).toHaveLength(1);
    expect(subjects(gone)).toEqual([]);
  });

  /* ------------------------------------------------------------------ when it cannot be handed over -- */

  it('a mark is noted once it was ATTEMPTED: where the provider was not there the mail service keeps it, and it arrives once — a second attempt from here would make it two', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    courier('2026-12-10');
    const now = daysBefore('2026-12-10', 14);
    const down = jest.spyOn(outbox, 'send').mockRejectedValue(new MailSendError('unreachable', 'the mail provider could not be reached', undefined, true));
    expect(await watch.sweep(now)).toEqual({ mails: 0, papers: 1, nobody: 0 });
    // The list says that it was not handed over: none of the one there was to tell.
    expect(watch.list(now)[0].told).toMatchObject({ stage: 14, to: 0, of: 1 });
    expect(watch.list(now)[0].told!.nobody).toBeUndefined();
    down.mockRestore();
    // The provider is back. The mail service sends what it kept…
    await mail.tryWaiting(now + 2 * 3_600_000);
    expect(subjects(wanjiru)).toEqual(['Courier licence runs out in 14 days — SeeBuyGet Kenya']);
    // …and the next look at the papers does not send it again.
    expect(await watch.sweep(now + 6 * 3_600_000)).toEqual({ mails: 0, papers: 0, nobody: 0 });
    expect(subjects(wanjiru)).toHaveLength(1);
  });

  it('an email that was TURNED DOWN is not asked again at the same mark: the list says nobody could be emailed, and the next mark sends its own', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    courier('2026-12-10');
    const now = daysBefore('2026-12-10', 14);
    const refused = jest.spyOn(outbox, 'send').mockRejectedValue(new MailSendError('refused', 'the mail provider turned this email down'));
    expect(await watch.sweep(now)).toEqual({ mails: 0, papers: 1, nobody: 0 });
    refused.mockRestore();
    // Nothing was kept to be tried again, and nothing is tried from here either: it would be the same refusal.
    await mail.tryWaiting(now + 2 * 3_600_000);
    expect(await watch.sweep(now + 6 * 3_600_000)).toEqual({ mails: 0, papers: 0, nobody: 0 });
    expect(subjects(wanjiru)).toEqual([]);
    expect(watch.list(now + DAY)[0].told).toMatchObject({ stage: 14, to: 0, of: 1 });
    // The seven-day mark is its own email.
    expect(await watch.sweep(daysBefore('2026-12-10', 7))).toEqual({ mails: 1, papers: 1, nobody: 0 });
    expect(subjects(wanjiru)).toEqual(['Courier licence runs out in 7 days — SeeBuyGet Kenya']);
    expect(watch.list(daysBefore('2026-12-10', 7))[0].told).toMatchObject({ stage: 7, to: 1, of: 1 });
  });

  it('a licence and a policy that run out on the same day are two papers: each is told, and each is noted', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    courier('2026-12-31');
    entities.updateRecord(KE, { insurance: [{ kind: 'goods_in_transit', insurer: 'Jubilee', policyNumber: 'GIT-88', expiresAt: '2026-12-31' }] }, 'Amina Otieno');
    const now = daysBefore('2026-12-31', 14);
    expect(await watch.sweep(now)).toEqual({ mails: 2, papers: 2, nobody: 0 });
    expect(subjects(wanjiru).sort()).toEqual(['Courier licence runs out in 14 days — SeeBuyGet Kenya', 'Goods-in-transit insurance runs out in 14 days — SeeBuyGet Kenya']);
    expect(watch.list(now).map((p) => [p.reference, p.told?.stage]).sort()).toEqual([['CA/CL/0042', 14], ['GIT-88', 14]]);
  });

  /* ------------------------------------------------------------------ the list -- */

  it('the list says what each company was last told — and can be cut to the companies somebody reaches', async () => {
    anAdmin(KE, 'Wanjiru Kamau');
    courier('2026-12-10');
    entities.updateRecord('sbg-et', { licences: [{ kind: 'courier', number: 'ET-7', issuer: 'ECA', expiresAt: '2026-12-01' }] }, 'Amina Otieno');
    const now = daysBefore('2026-12-10', 20);
    await watch.sweep(now);

    const all = watch.list(now);
    expect(all.map((p) => [p.entityId, p.reference, p.told?.stage, p.told?.nobody ?? false])).toEqual([
      ['sbg-et', 'ET-7', 14, true],
      [KE, 'CA/CL/0042', 30, false],
    ]);
    expect(watch.list(now, 60, new Set([KE])).map((p) => p.entityId)).toEqual([KE]);
    expect(watch.list(now, 60, new Set())).toEqual([]);
    // Before anything was said of it, a paper is listed with nothing told.
    entities.updateRecord(KE, { insurance: [{ kind: 'goods_in_transit', insurer: 'Jubilee', policyNumber: 'GIT-88', expiresAt: '2026-12-20' }] }, 'Amina Otieno');
    expect(watch.list(now).find((p) => p.reference === 'GIT-88')!.told).toBeUndefined();
  });

  /* ------------------------------------------------------------------ the words, and the clock -- */

  it('names the mark a paper has reached, and the paper and what it permits in plain words', () => {
    expect([59, 31, 30, 15, 14, 8, 7, 2, 1, 0].map((daysLeft) => stageOf({ lapsed: false, daysLeft }))).toEqual([60, 60, 30, 30, 14, 14, 7, 7, 1, 1]);
    expect(stageOf({ lapsed: false, daysLeft: 61 })).toBeUndefined();
    expect(stageOf({ lapsed: true, daysLeft: -1 })).toBe('lapsed');
    expect(paperWords('licence', 'money_handling')).toBe('Money handling licence');
    expect(paperWords('insurance', 'motor_fleet')).toBe('Motor fleet insurance');
    expect([paperWords('licence', 'other'), paperWords('insurance', 'something new')]).toEqual(['Licence', 'Insurance policy']);
    expect(stopsWords(['holdFloat', 'cashOnDelivery', 'not a capability'])).toEqual(['hold float', 'handle cash']);
  });

  it('goes by the clock: looked at when the server starts and every six hours after, with nobody calling it — and not once it stops', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    jest.useFakeTimers({ now: daysBefore('2026-12-10', 31) });
    try {
      courier('2026-12-10');
      watch.onApplicationBootstrap();
      await jest.advanceTimersByTimeAsync(1000);
      expect(subjects(wanjiru)).toEqual(['Courier licence runs out in 31 days — SeeBuyGet Kenya']);
      // Two more looks the same day (15:00 and 21:00): nothing new to say.
      await jest.advanceTimersByTimeAsync(12 * 3_600_000);
      expect(subjects(wanjiru)).toHaveLength(1);
      // The look after midnight finds the thirty-day mark.
      await jest.advanceTimersByTimeAsync(6 * 3_600_000);
      expect(subjects(wanjiru)).toEqual(expect.arrayContaining(['Courier licence runs out in 30 days — SeeBuyGet Kenya']));
      watch.onModuleDestroy();
      expect(jest.getTimerCount()).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });
});
