import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OutboxMailSender } from '../src/foundation/mail/outbox-mail.sender';

/**
 * WHO MAY REPORT A COMPANY'S PAPER, WHO ANSWERS, AND WHO DECIDES — through the booted application, as each of them.
 *
 * The unit spec proves what a report, an answer and a strike DO, on services that have no idea who is asking. The
 * user's decisions are about who: signed-in people connected to the company report; the company answers for itself;
 * one member of staff dismisses and two strike. Those live in the routes, and only real tokens can prove them.
 */
describe('a company’s paper is reported and decided, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const pdf = (label: string) => `data:application/pdf;base64,${Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`).toString('base64')}`;
  const shot = (label: string) => `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(label)]).toString('base64')}`;
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  let operator = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    operator = (await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function anAdmin(entityId: string, name: string): Promise<{ email: string; token: string }> {
    const email = `${name.toLowerCase().replace(/\W+/g, '.')}.${digits()}@sbg.co.ke`;
    const made = await http().post(`/v1/sbg/entities/${entityId}/admins`).set(bearer(operator)).send({ email, name }).expect(201);
    const signedIn = await http().post('/v1/sbg/entities/admins/login').send({ email, password: made.body.temporaryPassword }).expect(201);
    return { email, token: signedIn.body.token.access_token as string };
  }
  const recordAs = async (token: string, entityId: string) => (await http().get(`/v1/sbg/entities/${entityId}/record`).set(bearer(token)).expect(200)).body;
  const mailed = (address: string, template: string) => app.get(OutboxMailSender).recent(address).filter((m) => m.template === template);
  const said = { category: 'expired', note: 'The Communications Authority’s public register shows this licence as expired.' };

  it('connected people report; the company answers for itself; one of staff dismisses and two strike — and the strike puts the previous date back', async () => {
    const wanjiru = await anAdmin('sbg-ke', 'Wanjiru Kamau');
    const hans = await anAdmin('sbg', 'Hans van Aalst'); // the company above Kenya's
    const selam = await anAdmin('sbg-et', 'Selam Tesfaye'); // another country's company: not connected
    const ref = `CA/CL/${digits()}`;
    const licence = { kind: 'courier', number: ref, issuer: 'Communications Authority', expiresAt: inDays(5) };
    const declare = (body: Record<string, unknown>) => http().post('/v1/sbg/entities/sbg-ke/record/declare').set(bearer(wanjiru.token)).send(body).expect(201);
    await declare({ section: 'licences', item: licence, paperDataUrl: pdf('this year’s licence') });
    const renewed = (await declare({ section: 'licences', was: ref, item: { ...licence, expiresAt: inDays(400) }, paperDataUrl: pdf('said to be next year’s') })).body.document;
    const reportUrl = `/v1/sbg/entities/sbg-ke/documents/${renewed.documentId}/report`;

    /* ---- who may report ---- */
    await http().post(reportUrl).send({ ...said, evidenceDataUrl: shot('nobody') }).expect(401);
    // Another company's administrator is told there is no such company — not that there is one they may not report.
    await http().post(reportUrl).set(bearer(selam.token)).send({ ...said, evidenceDataUrl: shot('selam') }).expect(404);
    // Words, and what shows them.
    expect((await http().post(reportUrl).set(bearer(hans.token)).send(said)).body.code).toBe('FIELD_REQUIRED');
    expect((await recordAs(operator, 'sbg-ke')).reports).toEqual([]);

    const first = (await http().post(reportUrl).set(bearer(hans.token)).send({ ...said, evidenceDataUrl: shot('seen by hans') }).expect(201)).body;
    expect(Object.keys(first).sort()).toEqual(['answerBy', 'caseId', 'reportId']);
    // A member of staff, and one of the company's own administrators, say the same of the same paper: one question.
    const second = (await http().post(reportUrl).set(bearer(operator)).send({ ...said, by: 'Amina Otieno', evidenceDataUrl: shot('seen by amina') }).expect(201)).body;
    const third = (await http().post(reportUrl).set(bearer(wanjiru.token)).send({ category: 'wrong_details', note: 'The date on record is not the date on the paper.', evidenceDataUrl: shot('seen by wanjiru') }).expect(201)).body;
    expect([second.caseId, third.caseId]).toEqual([first.caseId, first.caseId]);
    expect((await http().post(reportUrl).set(bearer(hans.token)).send({ ...said, evidenceDataUrl: shot('again') })).body.code).toBe('CONFLICT');

    /* ---- THE PAPER KEEPS COUNTING, and each reads their own half ---- */
    const theirs = await recordAs(wanjiru.token, 'sbg-ke');
    expect(theirs.record.licences[0].expiresAt).toBe(inDays(400));
    expect(theirs.documents.find((d: { documentId: string }) => d.documentId === renewed.documentId).status).toBe('declared');
    expect(theirs.reports).toHaveLength(1);
    expect(theirs.reports[0].reports).toHaveLength(3);
    // The company reads what was said — never by whom, and never what they attached. Nor does the company above it.
    for (const view of [theirs, await recordAs(hans.token, 'sbg-ke')]) {
      expect(view.reports[0].reports.every((r: Record<string, unknown>) => r.by === undefined && r.evidenceId === undefined)).toBe(true);
      expect(JSON.stringify(view.reports)).not.toMatch(/Hans|Amina|SeeBuyGet staff/);
    }
    const staffs = await recordAs(operator, 'sbg-ke');
    expect(staffs.reports[0].reports.map((r: { by: string; role: string }) => [r.by, r.role])).toEqual([
      ['Hans van Aalst', 'an administrator of the company above it'],
      ['Amina Otieno', 'SeeBuyGet staff'],
      ['Wanjiru Kamau', 'an administrator of the company'],
    ]);
    // The queue and what was attached are staff's.
    await http().get('/v1/sbg/paper-reports').set(bearer(wanjiru.token)).expect(403);
    const queue = (await http().get('/v1/sbg/paper-reports').set(bearer(operator)).expect(200)).body;
    expect(queue.waiting).toBe(1);
    expect(queue.items[0]).toMatchObject({ caseId: first.caseId, company: 'SeeBuyGet Kenya', state: 'open', claimed: { by: 'Wanjiru Kamau' } });
    const evidenceUrl = `/v1/sbg/paper-reports/${first.caseId}/evidence/${queue.items[0].reports[0].evidenceId}`;
    await http().get(evidenceUrl).set(bearer(wanjiru.token)).expect(403);
    const evidence = await http().get(evidenceUrl).set(bearer(operator)).expect(200);
    expect(evidence.headers['content-type']).toContain('image/png');
    expect(evidence.headers['x-fingerprint-intact']).toBe('true');
    // Told once, however many reported: the company and the company above it.
    expect(mailed(wanjiru.email, 'company-paper-reported')).toHaveLength(1);
    expect(mailed(hans.email, 'company-paper-reported')).toHaveLength(1);
    expect(mailed(selam.email, 'company-paper-reported')).toEqual([]);

    /* ---- the company answers for itself: not staff in its place, not a stranger ---- */
    const answerUrl = `/v1/sbg/paper-reports/${first.caseId}/answer`;
    await http().post(answerUrl).set(bearer(operator)).send({ note: 'Answered by staff.' }).expect(404);
    await http().post(answerUrl).set(bearer(selam.token)).send({ note: 'Answered by a stranger.' }).expect(404);
    const answered = (await http().post(answerUrl).set(bearer(wanjiru.token)).send({ note: 'It was renewed; the receipt is attached.', evidenceDataUrl: shot('receipt') }).expect(200)).body;
    expect(answered.answer).toMatchObject({ by: 'Wanjiru Kamau', note: 'It was renewed; the receipt is attached.' });

    /* ---- the decision: staff's, and a strike takes two of them ---- */
    for (const act of ['dismiss', 'strike/propose', 'strike/approve']) {
      await http().post(`/v1/sbg/paper-reports/${first.caseId}/${act}`).set(bearer(wanjiru.token)).send({ reason: 'Decided by the company itself.' }).expect(403);
    }
    const strike = (step: string, body: Record<string, unknown>) => http().post(`/v1/sbg/paper-reports/${first.caseId}/strike/${step}`).set(bearer(operator)).send(body);
    expect((await strike('approve', { by: 'Baraka Mwangi' })).body.code).toBe('INVALID_STATE');
    const proposed = (await strike('propose', { by: 'Amina Otieno', reason: 'The register shows it expired, and the receipt is for a different licence.' }).expect(200)).body;
    expect(proposed).toMatchObject({ state: 'open', proposal: { by: 'Amina Otieno' } });
    expect((await recordAs(operator, 'sbg-ke')).record.licences[0].expiresAt).toBe(inDays(400));
    // Not by the one who proposed it.
    expect((await strike('approve', { by: 'Amina Otieno' })).body.code).toBe('CONFLICT');
    expect((await recordAs(operator, 'sbg-ke')).record.licences[0].expiresAt).toBe(inDays(400));
    const struck = (await strike('approve', { by: 'Baraka Mwangi' }).expect(200)).body;
    expect(struck).toMatchObject({ state: 'struck', decision: { outcome: 'struck', by: 'Amina Otieno and Baraka Mwangi' } });

    // THE PREVIOUS DATE IS BACK, the struck paper is kept as struck, and the list of what is running out has it again.
    const after = await recordAs(wanjiru.token, 'sbg-ke');
    expect(after.record.licences[0].expiresAt).toBe(inDays(5));
    expect(after.documents.find((d: { documentId: string }) => d.documentId === renewed.documentId)).toMatchObject({ status: 'struck', struckBy: 'Amina Otieno and Baraka Mwangi' });
    expect(after.reports[0]).toMatchObject({ state: 'struck', decision: { outcome: 'struck', effect: `The record is back as it was: courier licence ${ref}, good until ${inDays(5)}.` } });
    expect(after.reports[0].decision.by).toBeUndefined();
    const running = (await http().get('/v1/sbg/companies/expiring').set(bearer(wanjiru.token)).expect(200)).body.items;
    expect(running.map((p: { reference: string }) => p.reference)).toContain(ref);
    expect(mailed(wanjiru.email, 'company-paper-decided').map((m) => m.subject)).toEqual(['A paper was struck from SeeBuyGet Kenya’s record']);
    expect(mailed(hans.email, 'company-paper-decided')).toHaveLength(1);
    // A struck paper is not reported again.
    expect((await http().post(reportUrl).set(bearer(hans.token)).send({ ...said, evidenceDataUrl: shot('once more') })).body.code).toBe('INVALID_STATE');
  });

  it('one member of staff dismisses a report, with the reason: nothing on the record changes', async () => {
    const abebe = await anAdmin('sbg-et', 'Abebe Bekele');
    const made = (await http().post('/v1/sbg/entities/sbg-et/record/declare').set(bearer(abebe.token)).send({ section: 'insurance', item: { kind: 'goods_in_transit', insurer: 'NICO', policyNumber: `GIT-${digits()}`, expiresAt: inDays(300) }, paperDataUrl: pdf('policy') }).expect(201)).body;
    const reported = (await http().post(`/v1/sbg/entities/sbg-et/documents/${made.document.documentId}/report`).set(bearer(operator)).send({ category: 'not_genuine', note: 'The insurer says it has no such policy.', by: 'Amina Otieno', evidenceDataUrl: shot('email from the insurer') }).expect(201)).body;

    expect((await http().post(`/v1/sbg/paper-reports/${reported.caseId}/dismiss`).set(bearer(operator)).send({ by: 'Baraka Mwangi' })).body.code).toBe('FIELD_REQUIRED');
    // A strike waits for the company to be heard; a dismissal does not.
    expect((await http().post(`/v1/sbg/paper-reports/${reported.caseId}/strike/propose`).set(bearer(operator)).send({ by: 'Baraka Mwangi', reason: 'No such policy.' })).body.code).toBe('INVALID_STATE');
    const done = (await http().post(`/v1/sbg/paper-reports/${reported.caseId}/dismiss`).set(bearer(operator)).send({ by: 'Baraka Mwangi', reason: 'The insurer confirmed the policy by telephone on the number on its own website.' }).expect(200)).body;
    expect(done).toMatchObject({ state: 'dismissed', decision: { outcome: 'dismissed', by: 'Baraka Mwangi' } });

    const view = await recordAs(abebe.token, 'sbg-et');
    expect(view.documents.find((d: { documentId: string }) => d.documentId === made.document.documentId).status).toBe('declared');
    expect(view.record.insurance.map((p: { expiresAt: string }) => p.expiresAt)).toContain(inDays(300));
    expect(view.reports[0]).toMatchObject({ state: 'dismissed', decision: { outcome: 'dismissed', reason: expect.stringContaining('confirmed the policy') } });
    expect(mailed(abebe.email, 'company-paper-decided').map((m) => m.subject)).toEqual(['The report on SeeBuyGet Ethiopia’s paper was dismissed']);
  });
});
