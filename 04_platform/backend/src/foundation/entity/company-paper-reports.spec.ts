import { Test } from '@nestjs/testing';
import { EntityService } from './entity.service';
import { adminKey, EntityAdminService } from './entity-admin.service';
import { CompanyDocumentService } from './company-documents.service';
import { CompanyDeclarationService } from './company-declarations.service';
import { CompanyPaperReportService, REPORT_ANSWER_DAYS } from './company-paper-reports.service';
import { AuthService } from '../auth/auth.service';
import { DidService } from '../did/did.service';
import { LedgerService } from '../ledger/ledger.service';
import { LEDGER_ADAPTER } from '../ledger/ledger.types';
import { InMemoryLedgerAdapter } from '../ledger/in-memory-ledger.adapter';
import { EventBus } from '../events/event-bus.service';
import { OperationalStore } from '../data-firewall/operational-store.service';
import { MailService } from '../mail/mail.service';
import { OutboxMailSender } from '../mail/outbox-mail.sender';
import { MAIL_SENDER } from '../mail/mail.types';

/**
 * SOMEBODY SAYS A COMPANY'S PAPER IS NOT RIGHT — on the real company, document, declaration and mail services.
 *
 * The user's four decisions (2026-10-09) are each a sentence here: signed-in people who are connected report (who is
 * "connected" is the route's to say, and the wire test's to prove); THE PAPER KEEPS COUNTING; and STRIKING IT TAKES
 * TWO. Around them: the company is told what was said and never by whom, is heard before a strike, and a strike puts
 * back exactly what the paper changed.
 */
describe('a company’s paper is reported, answered, dismissed or struck', () => {
  let entities: EntityService;
  let admins: EntityAdminService;
  let documents: CompanyDocumentService;
  let declarations: CompanyDeclarationService;
  let reports: CompanyPaperReportService;
  let outbox: OutboxMailSender;
  let mail: MailService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        EntityService, EntityAdminService, CompanyDocumentService, CompanyDeclarationService, CompanyPaperReportService, AuthService, DidService, LedgerService, EventBus, OperationalStore,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        MailService, OutboxMailSender, { provide: MAIL_SENDER, useExisting: OutboxMailSender },
      ],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    admins = moduleRef.get(EntityAdminService);
    documents = moduleRef.get(CompanyDocumentService);
    declarations = moduleRef.get(CompanyDeclarationService);
    reports = moduleRef.get(CompanyPaperReportService);
    outbox = moduleRef.get(OutboxMailSender);
    mail = moduleRef.get(MailService);
  });

  afterEach(() => mail.onModuleDestroy());

  const KE = 'sbg-ke';
  const DAY = 86_400_000;
  const NOW = Date.parse('2026-10-09T09:00:00.000Z');
  const HEARD = NOW + REPORT_ANSWER_DAYS * DAY; // the company's time to answer has run out
  const pdf = (label: string) => `data:application/pdf;base64,${Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`).toString('base64')}`;
  const shot = (label: string) => `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(label)]).toString('base64')}`;
  const anAdmin = (entityId: string, name: string) => {
    const email = `${name.toLowerCase().replace(/\W+/g, '.')}@sbg.co.ke`;
    const made = admins.create(entityId, { email, name }, 'Amina Otieno');
    return { email, name, key: adminKey(made.adminId) };
  };
  const AMINA = { name: 'Amina Otieno', key: 'operator:amina' };
  const BARAKA = { name: 'Baraka Mwangi', key: 'operator:baraka' };
  const staffReporter = (s: { name: string; key: string }) => ({ key: s.key, name: s.name, role: 'SeeBuyGet staff' });
  const COURIER = { kind: 'courier', number: 'CA/CL/0042', issuer: 'Communications Authority', expiresAt: '2026-10-01' };
  const licence = () => entities.recordOf(KE).licences[0];
  const mailed = (address: string, template: string) => outbox.recent(address).filter((m) => m.template === template);

  /** Kenya's licence ran out on 1 Oct; on 9 Oct one of its administrators "renews" it to 2027 with a paper. */
  async function renewed(by: { name: string; key: string }) {
    await declarations.declare({ entityId: KE, section: 'licences', item: COURIER, paper: { dataUrl: pdf('the 2026 licence') }, by: by.name, byKey: by.key }, NOW - 30 * DAY);
    const { document } = await declarations.declare({ entityId: KE, section: 'licences', was: COURIER.number, item: { ...COURIER, expiresAt: '2027-10-01' }, paper: { dataUrl: pdf('the paper said to be the 2027 licence') }, by: by.name, byKey: by.key }, NOW);
    return document!;
  }
  const reportIt = (documentId: string, by = AMINA, now = NOW) =>
    reports.report({ entityId: KE, documentId, category: 'expired', note: 'The Communications Authority’s public register shows this licence as expired on 1 Oct 2026.', evidenceDataUrl: shot(`register seen by ${by.name}`), reporter: staffReporter(by) }, now);

  /* ------------------------------------------------------------------ the report -- */

  it('A REPORT CHANGES NOTHING: the paper keeps counting; the company is told what was said, never by whom, and until when it may answer', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    const hans = anAdmin(entities.group().entityId, 'Hans van Aalst');
    const paper = await renewed(wanjiru);
    expect(entities.lapsesFor('KE', NOW)).toEqual([]);

    const made = await reportIt(paper.documentId);
    expect(made).toMatchObject({ answerBy: new Date(NOW + 7 * DAY).toISOString(), told: 2 });

    // Nothing on the record moved, and the paper counts exactly as before.
    expect(licence().expiresAt).toBe('2027-10-01');
    expect(documents.get(KE, paper.documentId).status).toBe('declared');
    expect(entities.lapsesFor('KE', NOW + DAY)).toEqual([]);

    // Staff read all of it: who, what they said, what they attached, and what the paper claimed.
    const [c] = reports.list();
    expect(c).toMatchObject({
      caseId: made.caseId,
      entityId: KE,
      company: 'SeeBuyGet Kenya',
      state: 'open',
      strikeFrom: made.answerBy,
      paper: { kind: 'licence', relatesTo: 'CA/CL/0042', status: 'declared', uploadedBy: 'Wanjiru Kamau' },
      claimed: { was: 'courier licence CA/CL/0042, good until 2026-10-01', now: 'courier licence CA/CL/0042, good until 2027-10-01', by: 'Wanjiru Kamau' },
    });
    expect(c.reports).toEqual([{ reportId: made.reportId, at: new Date(NOW).toISOString(), category: 'expired', note: expect.stringContaining('public register'), by: 'Amina Otieno', role: 'SeeBuyGet staff', evidenceId: expect.stringMatching(/^ev_/) }]);
    const file = reports.evidenceFile(c.caseId, c.reports[0].evidenceId!);
    expect(file).toMatchObject({ contentType: 'image/png', intact: true });
    expect(file.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(reports.waiting()).toBe(1);

    // The company — and the company above it — are told WHAT, and not WHO: not in the email, and not on its record.
    for (const address of [wanjiru.email, hans.email]) {
      const [told] = mailed(address, 'company-paper-reported');
      expect(told.subject).toBe('A paper on SeeBuyGet Kenya’s record was reported — answer by 16 Oct 2026');
      expect(told.text).toContain('it has run out, or been withdrawn');
      expect(told.text).toContain('What was said: The Communications Authority’s public register shows this licence as expired on 1 Oct 2026.');
      expect(told.text).toContain('The paper keeps counting while this is looked at');
      expect(told.text).toContain('We do not say who reported it.');
      expect(told.text).not.toContain('Amina');
    }
    const [theirs] = reports.forEntity(KE, 'company');
    expect(theirs.reports).toEqual([{ reportId: made.reportId, at: new Date(NOW).toISOString(), category: 'expired', note: expect.stringContaining('public register') }]);
    expect(JSON.stringify(theirs)).not.toContain('Amina');
  });

  it('what is reported is a paper that COUNTS, of a company that keeps its own — in words, and with what shows it', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    const paper = await renewed(wanjiru);
    const good = { entityId: KE, documentId: paper.documentId, category: 'expired', note: 'The register shows it expired.', evidenceDataUrl: shot('register'), reporter: staffReporter(AMINA) };

    await expect(reports.report({ ...good, note: '  ' }, NOW)).rejects.toMatchObject({ code: 'FIELD_REQUIRED' });
    await expect(reports.report({ ...good, evidenceDataUrl: undefined }, NOW)).rejects.toMatchObject({ code: 'FIELD_REQUIRED' });
    await expect(reports.report({ ...good, category: 'i-do-not-like-them' }, NOW)).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    await expect(reports.report({ ...good, evidenceDataUrl: 'data:text/plain;base64,aGVsbG8gd29ybGQ=' }, NOW)).rejects.toMatchObject({ code: 'UNSUPPORTED_MEDIA' });
    await expect(reports.report({ ...good, reporter: { key: '', name: 'Nobody', role: 'nobody' } }, NOW)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    await expect(reports.report({ ...good, documentId: 'doc_nope' }, NOW)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    // Refused, every one of them, with nothing kept and nobody told.
    expect(reports.list()).toEqual([]);
    expect(mailed(wanjiru.email, 'company-paper-reported')).toEqual([]);

    // The paper it replaced no longer counts: there is nothing to report in it.
    const replaced = documents.list(KE).find((d) => d.status === 'superseded')!;
    await expect(reports.report({ ...good, documentId: replaced.documentId }, NOW)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    // A consignment's packing list is not a paper the company keeps about itself — even one a second person verified.
    const packing = documents.upload({ entityId: KE, kind: 'packing_list', title: 'Packing list', relatesTo: 'MSKU1234567', dataUrl: pdf('packing'), by: 'Amina Otieno' });
    documents.verify(KE, packing.documentId, 'Baraka Mwangi');
    await expect(reports.report({ ...good, documentId: packing.documentId }, NOW)).rejects.toThrow(/paper of a consignment/);
    // A company not switched on yet: its papers are verified by staff, not reported.
    const draft = entities.createCompany({ kind: 'sister', jurisdiction: 'UG', name: 'SeeBuyGet Uganda' }, 'Amina Otieno');
    const theirs = documents.upload({ entityId: draft.entityId, kind: 'licence', title: 'Licence', relatesTo: 'UCC/1', dataUrl: pdf('ug'), by: 'Amina Otieno' });
    documents.verify(draft.entityId, theirs.documentId, 'Baraka Mwangi');
    await expect(reports.report({ ...good, entityId: draft.entityId, documentId: theirs.documentId }, NOW)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(reports.list()).toEqual([]);
  });

  it('several people reporting one paper are ONE question; nobody reports it twice; the company is emailed once, and its time runs from the first', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    const paper = await renewed(wanjiru);
    const first = await reportIt(paper.documentId, AMINA, NOW);
    const second = await reportIt(paper.documentId, BARAKA, NOW + 2 * DAY);
    expect(second).toMatchObject({ caseId: first.caseId, answerBy: first.answerBy, told: 0 });
    await expect(reportIt(paper.documentId, AMINA, NOW + 3 * DAY)).rejects.toMatchObject({ code: 'CONFLICT' });

    const cases = reports.list();
    expect(cases).toHaveLength(1);
    expect(cases[0].reports.map((r) => r.by)).toEqual(['Amina Otieno', 'Baraka Mwangi']);
    expect(mailed(wanjiru.email, 'company-paper-reported')).toHaveLength(1);
  });

  /* ------------------------------------------------------------------ the answer -- */

  it('THE COMPANY ANSWERS, with what shows it, and may say it again while it is open — and from then a strike may be proposed', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    const paper = await renewed(wanjiru);
    const { caseId } = await reportIt(paper.documentId);

    await expect(async () => reports.answer({ caseId, note: ' ', by: 'Wanjiru Kamau' }, NOW + DAY)).rejects.toMatchObject({ code: 'FIELD_REQUIRED' });
    await expect(async () => reports.answer({ caseId, note: 'It was renewed.', by: '' }, NOW + DAY)).rejects.toMatchObject({ code: 'FIELD_REQUIRED' });
    reports.answer({ caseId, note: 'It was renewed on 28 Sep.', by: 'Wanjiru Kamau' }, NOW + DAY);
    const said = reports.answer({ caseId, note: 'It was renewed on 28 Sep; the register is updated monthly. The receipt is attached.', evidenceDataUrl: shot('receipt'), by: 'Wanjiru Kamau' }, NOW + 2 * DAY);
    expect(said.answer).toMatchObject({ by: 'Wanjiru Kamau', at: new Date(NOW + 2 * DAY).toISOString(), note: expect.stringContaining('receipt is attached') });

    const c = reports.one(caseId);
    expect(c.strikeFrom).toBe(new Date(NOW + 2 * DAY).toISOString());
    expect(reports.evidenceFile(caseId, c.answer!.evidenceId!).intact).toBe(true);
    // What belongs to one report cannot be read through another.
    expect(() => reports.evidenceFile('pc_another', c.answer!.evidenceId!)).toThrow(/No such evidence/);
  });

  /* ------------------------------------------------------------------ the decision -- */

  it('ONE member of staff dismisses it, with the reason: nothing on the record changes, and the company is told why', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    const paper = await renewed(wanjiru);
    const { caseId } = await reportIt(paper.documentId);

    await expect(reports.dismiss(caseId, '   ', AMINA, NOW + DAY)).rejects.toMatchObject({ code: 'FIELD_REQUIRED' });
    // It does not wait for the company: dismissing leaves everything as it is.
    const done = await reports.dismiss(caseId, 'The register was checked on 10 Oct and shows the licence renewed until 1 Oct 2027.', AMINA, NOW + DAY);
    expect(done).toMatchObject({ state: 'dismissed', decision: { outcome: 'dismissed', reason: expect.stringContaining('renewed until'), by: 'Amina Otieno' } });
    expect(licence().expiresAt).toBe('2027-10-01');
    expect(documents.get(KE, paper.documentId).status).toBe('declared');
    expect(reports.waiting()).toBe(0);

    const [told] = mailed(wanjiru.email, 'company-paper-decided');
    expect(told.subject).toBe('The report on SeeBuyGet Kenya’s paper was dismissed');
    expect(told.text).toContain('Reason: The register was checked on 10 Oct');
    expect(told.text).toContain('the paper counts as before');
    // The company reads the decision and its reason, not which member of staff.
    expect(reports.forEntity(KE, 'company')[0].decision).toEqual({ outcome: 'dismissed', reason: expect.any(String), at: new Date(NOW + DAY).toISOString() });
    // Decided is decided.
    await expect(reports.dismiss(caseId, 'again', BARAKA, NOW + 2 * DAY)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(() => reports.proposeStrike(caseId, 'after all', BARAKA, HEARD)).toThrow(/already been decided/);
    expect(() => reports.answer({ caseId, note: 'too late', by: 'Wanjiru Kamau' }, NOW + 2 * DAY)).toThrow(/decided/);
    // And the paper can be reported again, as a new question.
    expect((await reportIt(paper.documentId, AMINA, NOW + 3 * DAY)).caseId).not.toBe(caseId);
  });

  it('NOT BEFORE THE COMPANY HAS BEEN HEARD: a strike is not proposed until it has answered or its seven days are up', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    const paper = await renewed(wanjiru);
    const { caseId } = await reportIt(paper.documentId);

    expect(() => reports.proposeStrike(caseId, 'The register shows it expired.', AMINA, NOW + DAY)).toThrow(/has until 2026-10-16 to answer/);
    expect(() => reports.proposeStrike(caseId, 'The register shows it expired.', AMINA, HEARD - 1)).toThrow(/to answer/);
    expect(reports.one(caseId).proposal).toBeUndefined();
    // Its time has run out, to the millisecond.
    expect(reports.proposeStrike(caseId, 'The register shows it expired.', AMINA, HEARD).proposal).toMatchObject({ by: 'Amina Otieno' });

    // Or it has answered: then there is nothing more to wait for.
    const again = await declarations.declare({ entityId: KE, section: 'bankAccounts', item: { bankName: 'KCB', accountName: 'SeeBuyGet Kenya Ltd', accountNumber: '1100223344', currency: 'KES' }, paper: { dataUrl: pdf('bank') }, by: 'Wanjiru Kamau', byKey: wanjiru.key }, NOW);
    const other = await reports.report({ entityId: KE, documentId: again.document!.documentId, category: 'not_theirs', note: 'That account is in another company’s name.', evidenceDataUrl: shot('statement'), reporter: staffReporter(BARAKA) }, NOW);
    reports.answer({ caseId: other.caseId, note: 'It is ours.', by: 'Wanjiru Kamau' }, NOW + DAY);
    expect(reports.proposeStrike(other.caseId, 'The statement names another company.', BARAKA, NOW + DAY + 1).proposal).toMatchObject({ by: 'Baraka Mwangi' });
  });

  it('STRIKING A PAPER TAKES TWO: proposed by one with the reason, approved by another — never the same person, and nothing is struck by the first', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    const paper = await renewed(wanjiru);
    const { caseId } = await reportIt(paper.documentId);

    await expect(reports.approveStrike(caseId, BARAKA, HEARD)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(() => reports.proposeStrike(caseId, ' ', AMINA, HEARD)).toThrow(/Say why/);
    const proposed = reports.proposeStrike(caseId, 'The register shows the licence expired on 1 Oct 2026.', AMINA, HEARD);
    expect(proposed).toMatchObject({ state: 'open', proposal: { by: 'Amina Otieno', reason: expect.stringContaining('expired on 1 Oct'), byYou: true } });
    // PROPOSING STRIKES NOTHING.
    expect(licence().expiresAt).toBe('2027-10-01');
    expect(documents.get(KE, paper.documentId).status).toBe('declared');
    expect(mailed(wanjiru.email, 'company-paper-decided')).toEqual([]);
    // The company is not shown what staff have proposed among themselves.
    expect(reports.forEntity(KE, 'company')[0].proposal).toBeUndefined();

    // Not proposed twice, and not approved by the one who proposed it.
    expect(() => reports.proposeStrike(caseId, 'me too', BARAKA, HEARD)).toThrow(/already proposed/);
    await expect(reports.approveStrike(caseId, AMINA, HEARD + 1)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(documents.get(KE, paper.documentId).status).toBe('declared');
    // The second one reads who proposed it, and that it was not them.
    expect(reports.one(caseId, BARAKA.key).proposal).toEqual({ by: 'Amina Otieno', at: new Date(HEARD).toISOString(), reason: expect.any(String) });

    const struck = await reports.approveStrike(caseId, BARAKA, HEARD + 2);
    expect(struck).toMatchObject({ state: 'struck', decision: { outcome: 'struck', by: 'Amina Otieno and Baraka Mwangi', reason: 'The register shows the licence expired on 1 Oct 2026.' } });
    expect(documents.get(KE, paper.documentId).status).toBe('struck');
    // The second one may also dismiss instead: either may refuse.
    const genuine = await renewedAgain(wanjiru);
    const other = await reportIt(genuine.documentId, AMINA, HEARD + 3);
    reports.proposeStrike(other.caseId, 'Again.', AMINA, HEARD + 3 + 7 * DAY);
    expect((await reports.dismiss(other.caseId, 'The new paper is genuine: seen at the Authority.', BARAKA, HEARD + 4 + 7 * DAY)).proposal).toBeUndefined();
    expect(documents.get(KE, genuine.documentId).status).toBe('declared');
  });
  /** After a strike the company puts the right paper on record. */
  async function renewedAgain(by: { name: string; key: string }) {
    const { document } = await declarations.declare({ entityId: KE, section: 'licences', was: COURIER.number, item: { ...COURIER, expiresAt: '2027-10-01' }, paper: { dataUrl: pdf('the genuine 2027 licence') }, by: by.name, byKey: by.key }, HEARD + 3);
    return { documentId: document!.documentId };
  }

  /* ------------------------------------------------------------------ what a strike puts back -- */

  it('A STRUCK RENEWAL: the previous date counts again and what it had switched back on is off; the previous paper is the current one; the struck one is kept with who and why', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    const paper = await renewed(wanjiru);
    const before = documents.list(KE).find((d) => d.status === 'superseded')!;
    const { caseId } = await reportIt(paper.documentId);
    reports.proposeStrike(caseId, 'The register shows the licence expired on 1 Oct 2026.', AMINA, HEARD);
    const struck = await reports.approveStrike(caseId, BARAKA, HEARD + 1);

    expect(licence()).toEqual({ ...COURIER, supports: ['merchantOfRecord'] });
    expect(entities.lapsesFor('KE', HEARD + 1).map((l) => l.capability)).toEqual(['merchantOfRecord']);
    expect(struck.decision!.effect).toBe('The record is back as it was: courier licence CA/CL/0042, good until 2026-10-01.');
    expect(documents.get(KE, paper.documentId)).toMatchObject({ status: 'struck', struckBy: 'Amina Otieno and Baraka Mwangi', struckAt: new Date(HEARD + 1).toISOString(), strikeReason: 'The register shows the licence expired on 1 Oct 2026.' });
    const prior = documents.get(KE, before.documentId);
    expect(prior.status).toBe('declared');
    expect(prior.supersededBy).toBeUndefined();
    expect(documents.currentOf(KE, 'licence', 'CA/CL/0042')!.documentId).toBe(before.documentId);
    expect(declarations.ofDocument(paper.documentId)!.struckAt).toBe(new Date(HEARD + 1).toISOString());
    expect(entities.changes(KE, 1)[0]).toMatchObject({ by: 'Amina Otieno and Baraka Mwangi', what: 'record', from: 'courier licence CA/CL/0042, good until 2027-10-01', to: 'struck — back as it was: courier licence CA/CL/0042, good until 2026-10-01' });

    const [told] = mailed(wanjiru.email, 'company-paper-decided');
    expect(told.subject).toBe('A paper was struck from SeeBuyGet Kenya’s record');
    expect(told.text).toContain('The record is back as it was: courier licence CA/CL/0042, good until 2026-10-01.');
    expect(told.text).toContain('Reason: The register shows the licence expired on 1 Oct 2026.');
    expect(told.text).toContain('Put the right paper on record');
    expect(told.text).not.toContain('Baraka');

    // THE VERY FILE THAT WAS STRUCK is not put back as though nothing had been decided; the right paper is, as a new version.
    const again = { entityId: KE, section: 'licences', was: COURIER.number, item: { ...COURIER, expiresAt: '2027-10-01' }, by: 'Wanjiru Kamau', byKey: wanjiru.key };
    await expect(declarations.declare({ ...again, paper: { dataUrl: pdf('the paper said to be the 2027 licence') } }, HEARD + 2)).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(licence().expiresAt).toBe('2026-10-01');
    const right = await declarations.declare({ ...again, paper: { dataUrl: pdf('the genuine 2027 licence') } }, HEARD + 2);
    expect(right.document).toMatchObject({ status: 'declared', version: 3 });
    expect(licence().expiresAt).toBe('2027-10-01');
    // A struck paper is not reported again, nor struck twice.
    await expect(reportIt(paper.documentId, AMINA, HEARD + 3)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(() => documents.strike(KE, paper.documentId, 'Amina Otieno and Baraka Mwangi', 'again')).toThrow(/nothing to strike/);
  });

  it('a struck NEW item is taken off the record again', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    const added = await declarations.declare({ entityId: KE, section: 'bankAccounts', item: { bankName: 'KCB', accountName: 'SeeBuyGet Kenya Ltd', accountNumber: '1100223344', currency: 'KES' }, paper: { dataUrl: pdf('bank letter') }, by: 'Wanjiru Kamau', byKey: wanjiru.key }, NOW);
    const { caseId } = await reports.report({ entityId: KE, documentId: added.document!.documentId, category: 'not_theirs', note: 'That account is in another company’s name.', evidenceDataUrl: shot('statement'), reporter: staffReporter(AMINA) }, NOW);
    reports.proposeStrike(caseId, 'The bank confirms the account is not this company’s.', AMINA, HEARD);
    const struck = await reports.approveStrike(caseId, BARAKA, HEARD + 1);
    expect(entities.recordOf(KE).bankAccounts).toEqual([]);
    expect(struck.decision!.effect).toBe('Taken off the record: KCB account 1100223344 (KES, SeeBuyGet Kenya Ltd).');
    expect(entities.changes(KE, 1)[0].to).toBe('struck — taken off the record');
  });

  it('a paper from BEFORE the company was switched on has nothing to put back: its licence counts as run out from that day; a paper nothing rests on is only struck', async () => {
    anAdmin(KE, 'Wanjiru Kamau');
    // As the company stood when two of us switched it on: the licence entered by staff, its paper verified by a second person.
    entities.updateRecord(KE, { licences: [{ ...COURIER, expiresAt: '2027-12-10' }] }, 'Amina Otieno');
    const old = documents.upload({ entityId: KE, kind: 'licence', title: 'Courier licence', relatesTo: 'CA/CL/0042', dataUrl: pdf('verified licence'), by: 'Amina Otieno' }, NOW - 90 * DAY);
    documents.verify(KE, old.documentId, 'Baraka Mwangi');
    const cert = documents.upload({ entityId: KE, kind: 'certificate_of_incorporation', title: 'Certificate', dataUrl: pdf('certificate'), by: 'Amina Otieno' }, NOW - 90 * DAY);
    documents.verify(KE, cert.documentId, 'Baraka Mwangi');

    const one = await reports.report({ entityId: KE, documentId: old.documentId, category: 'expired', note: 'The Authority withdrew this licence in September.', evidenceDataUrl: shot('gazette'), reporter: staffReporter(AMINA) }, NOW);
    reports.proposeStrike(one.caseId, 'Withdrawn by the Authority, Gazette notice 9912.', AMINA, HEARD);
    const struck = await reports.approveStrike(one.caseId, BARAKA, HEARD + DAY); // 17 Oct
    expect(struck.decision!.effect).toBe('It counts as run out from today: courier licence CA/CL/0042, good until 2027-12-10.');
    expect(licence().expiresAt).toBe('2026-10-16');
    expect(entities.lapsesFor('KE', HEARD + DAY).map((l) => l.capability)).toEqual(['merchantOfRecord']);
    expect(documents.get(KE, old.documentId).status).toBe('struck');

    const two = await reports.report({ entityId: KE, documentId: cert.documentId, category: 'not_genuine', note: 'The registry has no such certificate number.', evidenceDataUrl: shot('registry'), reporter: staffReporter(AMINA) }, NOW);
    reports.proposeStrike(two.caseId, 'The registry confirms it issued no such certificate.', AMINA, HEARD);
    const other = await reports.approveStrike(two.caseId, BARAKA, HEARD + DAY);
    expect(other.decision!.effect).toBe('The paper no longer counts. Nothing else on the record rested on it.');
    expect(documents.get(KE, cert.documentId).status).toBe('struck');
    expect(licence().expiresAt).toBe('2026-10-16');
  });

  it('a paper the company has REPLACED since is not struck — not when it is proposed, and not if it is replaced between the two of them', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    const paper = await renewed(wanjiru);
    const { caseId } = await reportIt(paper.documentId);
    const replace = (label: string, at: number) => declarations.declare({ entityId: KE, section: 'licences', was: COURIER.number, item: { ...COURIER, expiresAt: '2027-10-01' }, paper: { dataUrl: pdf(label) }, by: 'Wanjiru Kamau', byKey: wanjiru.key }, at);

    reports.proposeStrike(caseId, 'The register shows it expired.', AMINA, HEARD);
    // Between the two of them, the company puts the right paper on record.
    await replace('the genuine licence', HEARD + 1);
    await expect(reports.approveStrike(caseId, BARAKA, HEARD + 2)).rejects.toMatchObject({ code: 'INVALID_STATE' });
    expect(licence().expiresAt).toBe('2027-10-01');
    expect(documents.get(KE, paper.documentId).status).toBe('superseded');
    // It is closed by dismissing it, saying so.
    expect((await reports.dismiss(caseId, 'The company replaced the paper on 16 Oct.', BARAKA, HEARD + 3)).state).toBe('dismissed');

    // And one replaced before anybody proposed anything.
    const next = documents.currentOf(KE, 'licence', 'CA/CL/0042')!;
    const second = await reportIt(next.documentId, AMINA, HEARD + 4);
    await replace('a clearer scan of the genuine licence', HEARD + 5);
    expect(() => reports.proposeStrike(second.caseId, 'Still not right.', AMINA, HEARD + 4 + 7 * DAY)).toThrow(/replaced it since/);
  });

  /* ------------------------------------------------------------------ the queue -- */

  it('staff read what waits first — the one whose time runs out soonest — then what was decided, newest first', async () => {
    const wanjiru = anAdmin(KE, 'Wanjiru Kamau');
    const paper = await renewed(wanjiru);
    const bank = await declarations.declare({ entityId: KE, section: 'bankAccounts', item: { bankName: 'KCB', accountName: 'SeeBuyGet Kenya Ltd', accountNumber: '1100223344', currency: 'KES' }, paper: { dataUrl: pdf('bank') }, by: 'Wanjiru Kamau', byKey: wanjiru.key }, NOW);
    const signer = await declarations.declare({ entityId: KE, section: 'representatives', item: { name: 'Otieno Odhiambo', role: 'Director', signing: 'alone' }, paper: { dataUrl: pdf('id') }, by: 'Wanjiru Kamau', byKey: wanjiru.key }, NOW);
    const later = await reportIt(paper.documentId, AMINA, NOW + 2 * DAY);
    const sooner = await reports.report({ entityId: KE, documentId: bank.document!.documentId, category: 'other', note: 'Wrong branch.', evidenceDataUrl: shot('a'), reporter: staffReporter(AMINA) }, NOW + DAY);
    const decided = await reports.report({ entityId: KE, documentId: signer.document!.documentId, category: 'other', note: 'He left in June.', evidenceDataUrl: shot('b'), reporter: staffReporter(AMINA) }, NOW);
    await reports.dismiss(decided.caseId, 'He is still a director: the registry extract of 8 Oct says so.', BARAKA, NOW + 3 * DAY);

    expect(reports.list().map((c) => c.caseId)).toEqual([sooner.caseId, later.caseId, decided.caseId]);
    expect(reports.waiting()).toBe(2);
    expect(reports.forEntity(KE, 'staff').map((c) => c.caseId)).toEqual([later.caseId, sooner.caseId, decided.caseId]);
    expect(reports.forEntity('sbg-et', 'staff')).toEqual([]);
    expect(reports.entityOf(later.caseId)).toBe(KE);
    expect(() => reports.one('pc_nope')).toThrow(/No such report/);
  });
});
