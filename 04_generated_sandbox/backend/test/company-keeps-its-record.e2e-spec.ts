import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OutboxMailSender } from '../src/foundation/mail/outbox-mail.sender';

/**
 * WHO MAY WRITE A COMPANY'S RECORD — through the booted application, as each of the people who might try.
 *
 * The unit spec proves the change-with-its-paper on the real services, which have no idea who is asking. The rule
 * the user decided (2026-10-09) is about WHO: the company once it is switched on, and no longer staff; staff until
 * then, as before. That lives in the routes, and only a request with a real token can prove it.
 */
describe('a company keeps its own record, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const pdf = (label: string) => `data:application/pdf;base64,${Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`).toString('base64')}`;
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
  const told = (address: string) => app.get(OutboxMailSender).recent(address).filter((m) => m.template === 'company-record-changed');

  it('once it is switched on, the company’s administrators write its record and staff do not; the parts that switch something change with their paper', async () => {
    const wanjiru = await anAdmin('sbg-ke', 'Wanjiru Kamau');
    const otieno = await anAdmin('sbg-ke', 'Otieno Odhiambo');
    const selam = await anAdmin('sbg-et', 'Selam Tesfaye');
    const ref = `CA/CL/${digits()}`;
    const licence = { kind: 'courier', number: ref, issuer: 'Communications Authority', expiresAt: '2027-12-10' };

    expect((await recordAs(wanjiru.token, 'sbg-ke')).keeper).toBe('company');

    // The parts that switch nothing: saved by her, as a form is.
    await http().post('/v1/sbg/entities/sbg-ke/record').set(bearer(wanjiru.token)).send({ tradingName: 'SeeBuyGet KE' }).expect(201);
    expect((await recordAs(wanjiru.token, 'sbg-ke')).record.tradingName).toBe('SeeBuyGet KE');
    // STAFF NO LONGER CAN — not the name, and not a licence date, which one of them could otherwise change alone.
    const refused = await http().post('/v1/sbg/entities/sbg-ke/record').set(bearer(operator)).send({ by: 'Amina Otieno', tradingName: 'Typed by staff' }).expect(403);
    expect(refused.body.detail).toContain('keeps its own record');
    await http().post('/v1/sbg/entities/sbg-ke/record').set(bearer(operator)).send({ by: 'Amina Otieno', licences: [licence] }).expect(403);
    expect((await recordAs(operator, 'sbg-ke')).record).toMatchObject({ tradingName: 'SeeBuyGet KE', licences: [] });

    // A licence does not come through the form, even from her: it comes with its paper, or not at all.
    expect((await http().post('/v1/sbg/entities/sbg-ke/record').set(bearer(wanjiru.token)).send({ licences: [licence] })).body.code).toBe('VALIDATION_FAILED');
    expect((await http().post('/v1/sbg/entities/sbg-ke/record/declare').set(bearer(wanjiru.token)).send({ section: 'licences', item: licence })).body.code).toBe('FIELD_REQUIRED');
    expect((await recordAs(wanjiru.token, 'sbg-ke')).record.licences).toEqual([]);

    const made = await http().post('/v1/sbg/entities/sbg-ke/record/declare').set(bearer(wanjiru.token)).send({ section: 'licences', item: licence, paperDataUrl: pdf('licence') }).expect(201);
    expect(made.body.document).toMatchObject({ kind: 'licence', relatesTo: ref, status: 'declared', uploadedBy: 'Wanjiru Kamau' });
    expect(made.body.record.licences).toEqual([{ ...licence, supports: ['merchantOfRecord'] }]);
    const view = await recordAs(operator, 'sbg-ke');
    expect(view.declarations[0]).toMatchObject({ section: 'licences', change: 'added', now: ref, by: 'Wanjiru Kamau', documentId: made.body.document.documentId });
    expect(view.documents.find((d: { documentId: string }) => d.documentId === made.body.document.documentId).status).toBe('declared');
    // Her colleague is told; she is not; another country's company hears nothing.
    expect(told(otieno.email).map((m) => m.subject)).toEqual(['Wanjiru Kamau added a licence on SeeBuyGet Kenya’s record']);
    expect(told(wanjiru.email)).toEqual([]);
    expect(told(selam.email)).toEqual([]);

    // Nobody else makes that change: not staff, and not another company's administrator.
    await http().post('/v1/sbg/entities/sbg-ke/record/declare').set(bearer(operator)).send({ section: 'licences', was: ref, item: { ...licence, expiresAt: '2030-01-01' }, paperDataUrl: pdf('by staff') }).expect(403);
    await http().post('/v1/sbg/entities/sbg-ke/record/declare').set(bearer(selam.token)).send({ section: 'licences', was: ref, item: { ...licence, expiresAt: '2030-01-01' }, paperDataUrl: pdf('by a stranger') }).expect(404);
    await http().post('/v1/sbg/entities/sbg-ke/record').set(bearer(selam.token)).send({ tradingName: 'Not theirs' }).expect(404);
    expect((await recordAs(operator, 'sbg-ke')).record.licences[0].expiresAt).toBe('2027-12-10');
  });

  it('a paper the company puts on record about itself counts at once and is not one person’s to turn down; the papers of a consignment are as they were', async () => {
    const wanjiru = await anAdmin('sbg-ke', 'Wanjiru Kamau');
    // Staff do not put a company's own paper on record for it.
    await http().post('/v1/sbg/entities/sbg-ke/documents').set(bearer(operator)).send({ by: 'Amina Otieno', kind: 'certificate_of_incorporation', title: 'Certificate', dataUrl: pdf('by staff') }).expect(403);
    const put = await http().post('/v1/sbg/entities/sbg-ke/documents').set(bearer(wanjiru.token)).send({ kind: 'certificate_of_incorporation', title: 'Certificate of incorporation', dataUrl: pdf('certificate') }).expect(201);
    expect(put.body).toMatchObject({ status: 'declared', uploadedBy: 'Wanjiru Kamau' });
    expect((await http().post(`/v1/sbg/entities/sbg-ke/documents/${put.body.documentId}/reject`).set(bearer(operator)).send({ by: 'Amina Otieno', reason: 'I doubt it' })).body.code).toBe('INVALID_STATE');
    expect((await http().post(`/v1/sbg/entities/sbg-ke/documents/${put.body.documentId}/verify`).set(bearer(operator)).send({ by: 'Amina Otieno' })).body.code).toBe('INVALID_STATE');

    // THE COMPANY'S PUBLIC PAGE names the papers that count — and one it put on record itself counts.
    const handle = (await recordAs(wanjiru.token, 'sbg-ke')).handle as string;
    expect(handle).toBeTruthy();
    const page = (await http().get(`/v1/sbg/profiles/${handle}`).expect(200)).body as { verified: Array<{ what: string; at: string }> };
    expect(page.verified).toEqual(expect.arrayContaining([{ what: 'certificate of incorporation', at: put.body.uploadedAt }]));

    // A packing list belongs to one container, not to the company: it waits for a second person, as before.
    const packing = await http().post('/v1/sbg/entities/sbg-ke/documents').set(bearer(operator)).send({ by: 'Amina Otieno', kind: 'packing_list', title: 'Packing list', relatesTo: 'MSKU1234567', dataUrl: pdf('packing') }).expect(201);
    expect(packing.body.status).toBe('awaiting_verification');
  });

  it('SWITCHING A COMPANY ON IS UNCHANGED: until then staff enter its record, its own administrator cannot, and its papers wait to be verified', async () => {
    const draft = (await http().post('/v1/sbg/entities').set(bearer(operator)).send({ kind: 'sister', jurisdiction: 'UG', name: 'SeeBuyGet Uganda', by: 'Amina Otieno' }).expect(201)).body;
    expect(draft.status).toBe('draft');
    const nakato = await anAdmin(draft.entityId, 'Nakato Namuli');
    const licence = { kind: 'courier', number: 'UCC/CL/0007', issuer: 'Uganda Communications Commission', expiresAt: '2027-12-10' };

    expect((await recordAs(nakato.token, draft.entityId)).keeper).toBe('staff');
    await http().post(`/v1/sbg/entities/${draft.entityId}/record`).set(bearer(operator)).send({ by: 'Amina Otieno', legalName: 'SeeBuyGet Uganda Ltd', licences: [licence] }).expect(201);
    const no = await http().post(`/v1/sbg/entities/${draft.entityId}/record`).set(bearer(nakato.token)).send({ legalName: 'Typed by the company' }).expect(403);
    expect(no.body.detail).toContain('not switched on yet');
    expect((await http().post(`/v1/sbg/entities/${draft.entityId}/record/declare`).set(bearer(nakato.token)).send({ section: 'licences', was: licence.number, item: { ...licence, expiresAt: '2030-01-01' }, paperDataUrl: pdf('early') })).body.code).toBe('INVALID_STATE');
    expect((await recordAs(operator, draft.entityId)).record).toMatchObject({ legalName: 'SeeBuyGet Uganda Ltd', licences: [{ expiresAt: '2027-12-10' }] });

    // Its papers: put on record by either, waiting for a second person, and the checklist still asks for exactly that.
    const paper = await http().post(`/v1/sbg/entities/${draft.entityId}/documents`).set(bearer(nakato.token)).send({ kind: 'licence', title: 'Courier licence', relatesTo: licence.number, dataUrl: pdf('ug licence') }).expect(201);
    expect(paper.body.status).toBe('awaiting_verification');
    const before = (await recordAs(operator, draft.entityId)).readiness.items.find((i: { key: string }) => i.key === `licence:${licence.number}`);
    expect(before).toMatchObject({ met: false, label: 'Licence UCC/CL/0007: in date, and its paper verified by a second person' });
    await http().post(`/v1/sbg/entities/${draft.entityId}/documents/${paper.body.documentId}/verify`).set(bearer(operator)).send({ by: 'Amina Otieno' }).expect(201);
    expect((await recordAs(operator, draft.entityId)).readiness.items.find((i: { key: string }) => i.key === `licence:${licence.number}`).met).toBe(true);
  });
});
