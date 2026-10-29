import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AGREED } from './agreed';

/**
 * THE FORWARDER'S BILL, HELD AND EXPLAINED — never issued (the user, 2026-10-28: "if we optimize for FBL, we must know and
 * report for our users"; 2026-10-29: the holder records FIATA's check with the result attached; the limits in SDR "plus
 * about-US$"). The bill a forwarder issued is kept on an export or an import with what is printed on it, checked against
 * the 1992 form, matched against our own papers — and never called valid.
 */
describe('a forwarder’s FIATA bill, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator = '';
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const H = 3_600_000;
  const pdf = (tag: string) => `data:application/pdf;base64,${Buffer.from(`%PDF-1.4\n% ${tag}\n%%EOF\n`).toString('base64')}`;

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

  async function aBusiness(activities: string[], called: string) {
    const phone = `+2547${digits()}5`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `fbl-${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    const made = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `${called} ${digits()}`, country: 'KE', registrationNo: `FB-${digits()}`, activities, yourName: 'Wanjiku' }).expect(201)).body;
    const token = made.token.access_token as string;
    const entityId = made.business.entityId as string;
    const site = async (kind: string, name: string, location: { lat: number; lng: number }) => (await http().post(`/v1/sbg/entities/${entityId}/sites`).set(bearer(token)).send({ kind, name, location }).expect(201)).body.siteId as string;
    const paper = async (title: string, kind = 'bill_of_lading') => (await http().post(`/v1/sbg/entities/${entityId}/documents`).set(bearer(token)).send({ kind, title, dataUrl: pdf(title) }).expect(201)).body.documentId as string;
    return { token, entityId, site, paper };
  }
  const today = new Date().toISOString().slice(0, 10);
  const ALL = ['consignor', 'consignedTo', 'notify', 'placeOfReceipt', 'vessel', 'portOfLoading', 'portOfDischarge', 'placeOfDelivery', 'marks', 'packages', 'description', 'grossWeight', 'measurement', 'freightPayableAt', 'originals', 'placeDateOfIssue', 'signature', 'deliveryAgent'];

  it('on an export: held as printed, checked against the form, matched to our papers, its meaning said — and replaced, never overwritten', async () => {
    const x = await aBusiness(['shipper'], 'Thika Avocados');
    const agent = await aBusiness(['clearing_agent'], 'Pwani Clearing');
    const loading = await x.site('loading', 'Thika packhouse', { lat: -1.03, lng: 37.07 });
    const terminal = await x.site('port', 'Kipevu container terminal', { lat: -4.05, lng: 39.65 });
    const made = (await http().post('/v1/sbg/exports').set(bearer(x.token)).send({ goodsDescription: 'Fresh avocados, 800 cartons', originCountry: 'KE', destCountry: 'NL', loadingPort: 'Mombasa', containerType: '45R1', booking: { reference: `MBA${digits()}`, bookedWith: 'forwarder', partyName: 'Pwani Forwarders', gateCutoffAt: new Date(Date.now() + 96 * H).toISOString() }, loadingSiteId: loading, terminalSiteId: terminal }).expect(201)).body;
    const path = `/v1/sbg/exports/${made.exportId}`;
    await http().post(`${path}/container`).set(bearer(x.token)).send({ containerNo: 'MSCU1234566' }).expect(201);
    await http().post(`${path}/packing-list`).set(bearer(x.token)).send({ text: ['Description\tCtns\tG.W. (kg)', 'Fresh avocados, Hass\t800\t3600'].join('\n') }).expect(201);
    const copy = await x.paper('FBL KE-114 copy');
    const bill = { form: 'fbl', number: 'KE-114', issuer: { name: 'Pwani Forwarders Ltd', country: 'KE' }, issuedOn: today, electronic: false, seaLeg: true, printed: ALL.filter((b) => b !== 'signature'), documentId: copy, containerNo: 'MSCU1234566', packages: 800, grossWeightKg: 3610, portOfLoading: 'Mombasa, Kenya', originals: 3 };

    // Staff keep nothing in its name; a stranger is told there is no such export; a paper bill is held as its copy.
    expect((await http().post(`${path}/fbl`).set(bearer(operator)).send(bill)).status).toBe(403);
    expect((await http().post(`${path}/fbl`).set(bearer(agent.token)).send(bill)).status).toBe(404);
    expect((await http().post(`${path}/fbl`).set(bearer(x.token)).send({ ...bill, documentId: undefined })).body.detail).toMatch(/Attach a copy of the bill/);
    expect((await http().post(`${path}/fbl`).set(bearer(x.token)).send({ ...bill, issuedOn: '2099-01-01' })).status).toBe(400);
    expect((await http().post(`${path}/fbl`).set(bearer(x.token)).send({ ...bill, form: 'fwb' })).body.detail).toMatch(/A waybill has no originals/);

    const held = (await http().post(`${path}/fbl`).set(bearer(x.token)).send(bill).expect(201)).body.fbl;
    // Not signed: not complete, under the bank's own rule.
    expect(held.check.complete).toBe(false);
    expect(held.check.findings).toEqual([{ key: 'signature', rule: expect.stringMatching(/UCP 600 Art\. 19\(a\)\(i\)/), kind: 'missing' }]);
    // Agrees with our papers: the box, the packages and their weight (within a percent), the port.
    expect(held.matches).toEqual([
      { field: 'containerNo', printed: 'MSCU1234566', ours: 'MSCU1234566', agrees: true },
      { field: 'packages', printed: '800', ours: '800', agrees: true },
      { field: 'grossWeight', printed: '3610 kg', ours: '3600 kg', agrees: true },
      { field: 'port', printed: 'Mombasa, Kenya', ours: 'Mombasa', agrees: true },
    ]);
    // What it means: negotiable, a copy is not an original, the limits with about-dollars, Kenya's own law.
    expect(held.check.meaning.join(' ')).toMatch(/what SeeBuyGet keeps is not one/);
    expect(held.check.limits[0]).toMatch(/666\.67 SDR a package \(about US\$901\)/);
    expect(held.check.country.map((c: { country: string }) => c.country)).toEqual(['KE']);
    expect(held.verified).toBe('paper');
    // A paper bill has no record on FIATA's page.
    expect((await http().post(`${path}/fbl/verified`).set(bearer(x.token)).send({ registered: true, proofDocumentId: copy })).status).toBe(400);

    // Appointed, the agent gives the electronic bill by its number; the paper one is kept as it was.
    await http().post(`${path}/agent`).set(bearer(x.token)).send({ agentEntityId: agent.entityId }).expect(201);
    expect((await http().post(`${path}/fbl`).set(bearer(agent.token)).send({ ...bill, documentId: copy })).status).toBe(400);
    const electronic = (await http().post(`${path}/fbl`).set(bearer(agent.token)).send({ ...bill, documentId: undefined, electronic: true, printed: ALL, containerNo: 'MSCU 123456-6', packages: 790, grossWeightKg: 3900 }).expect(201)).body;
    expect(electronic.fbl).toMatchObject({ replaced: 1, verified: 'not_checked', check: { complete: true, genuine: { where: 'https://fiata.org/document-verification/' } } });
    expect(electronic.consignment.formerFbl[0].documentTitle).toBe('FBL KE-114 copy');
    // A count that does not agree with the packing list is said, beside ours.
    expect(electronic.fbl.matches.find((m: { field: string }) => m.field === 'packages')).toEqual({ field: 'packages', printed: '790', ours: '800', agrees: false });
    // …and a weight beyond a percent of the packing list's.
    expect(electronic.fbl.matches.find((m: { field: string }) => m.field === 'grossWeight')).toEqual({ field: 'grossWeight', printed: '3900 kg', ours: '3600 kg', agrees: false });

    // What FIATA's page showed is the exporter's word, attached from its papers — the agent attaches nothing of its own here.
    const shot = await x.paper('FIATA verification result', 'other');
    expect((await http().post(`${path}/fbl/verified`).set(bearer(agent.token)).send({ registered: true, proofDocumentId: shot })).status).toBe(404);
    expect((await http().post(`${path}/fbl/verified`).set(bearer(operator)).send({ registered: true, proofDocumentId: shot })).status).toBe(403);
    const verified = (await http().post(`${path}/fbl/verified`).set(bearer(x.token)).send({ registered: true, fiataId: 'FBL-KE-000114', issuerShown: 'Pwani Forwarders Ltd', proofDocumentId: shot }).expect(201)).body.fbl;
    expect(verified).toMatchObject({ verified: 'registered', verification: { fiataId: 'FBL-KE-000114', proofTitle: 'FIATA verification result' } });
  });

  it('on an import: the importer holds the bill the goods came under, its agent records what FIATA’s page showed', async () => {
    const imp = await aBusiness(['importer'], 'Addis Motors');
    const agent = await aBusiness(['clearing_agent'], 'Modjo Clearing');
    const made = (await http().post('/v1/sbg/imports').set(bearer(imp.token)).send({ goodsDescription: 'Coffee roaster', originCountry: 'NL', destCountry: 'ET', destPort: 'Modjo dry port', dischargePort: 'Djibouti', containerType: '22G1', containerNo: 'MSCU1234566' }).expect(201)).body;
    const path = `/v1/sbg/imports/${made.importId}`;
    await http().post(`${path}/appoint`).set(bearer(imp.token)).send({ agentEntityId: agent.entityId }).expect(201);
    const bill = { form: 'fbl', number: 'NL-RTM-88', issuer: { name: 'Rotterdam Forwarding BV', country: 'NL' }, issuedOn: today, electronic: true, seaLeg: true, printed: ALL, containerNo: 'MSCU1234566', portOfDischarge: 'Djibouti' };
    expect((await http().post(`${path}/fbl`).set(bearer(operator)).send(bill)).status).toBe(403);
    const held = (await http().post(`${path}/fbl`).set(bearer(imp.token)).send(bill).expect(201)).body.fbl;
    expect(held.matches).toEqual([
      { field: 'containerNo', printed: 'MSCU1234566', ours: 'MSCU1234566', agrees: true },
      { field: 'port', printed: 'Djibouti', ours: 'Djibouti', agrees: true },
    ]);
    // Ethiopia's own law changes what the limits mean: it is said.
    expect(held.check.country.map((c: { country: string }) => c.country)).toEqual(['ET']);
    const shot = await agent.paper('FIATA result for NL-RTM-88', 'other');
    const checked = (await http().post(`${path}/fbl/verified`).set(bearer(agent.token)).send({ registered: false, proofDocumentId: shot }).expect(201)).body.fbl;
    expect(checked).toMatchObject({ verified: 'not_registered', verification: { registered: false } });
  });
});
