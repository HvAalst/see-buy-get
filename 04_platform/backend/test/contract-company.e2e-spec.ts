import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EntityService } from '../src/foundation/entity/entity.service';
import { AGREED } from './agreed';

/**
 * WHO YOU CONTRACT WITH, AND ITS PAPERS — through the booted application, as a shop, a fleet, a driver, a store.
 *
 * The user, 2026-10-09, on who outside a company may see its licences: "I keep your recommendations. the number is
 * enough and can be verified." So whoever contracts with a company is shown its licences and insurance policies WITH
 * THEIR NUMBERS, and reports one from there; and is shown nothing else of that company's. Three things only real
 * tokens can prove: that each sign-in is shown the company behind ITS OWN record, that nothing but licences and
 * policies comes out, and that a report can be aimed at nothing but what the reporter was shown.
 */
describe('who you contract with, and its papers, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const pdf = (label: string) => `data:application/pdf;base64,${Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`).toString('base64')}`;
  const shot = (label: string) => `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(label)]).toString('base64')}`;
  const inDays = (days: number) => new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
  const HOURS = { open: '08:00', close: '18:00' };
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

  /** A sign-in for one participant, as their app holds it. */
  const tokenFor = async (role: string, did: string, tenant?: string) => (await http().post('/v1/auth/token').send({ role, did, ...(tenant ? { tenant } : {}), type: 'client_credentials' }).expect(201)).body.access_token as string;
  const contractAs = async (token: string) => (await http().get('/v1/sbg/contract/company').set(bearer(token)).expect(200)).body;
  const reportAs = (token: string, body: Record<string, unknown>) => http().post('/v1/sbg/contract/company/papers/report').set(bearer(token)).send(body);

  it('a shop, a fleet, its driver and a store each see the company they contract with and its licences by number — and nothing else of it; a report can only be aimed at what they were shown', async () => {
    const u = digits();
    /* ---- Kenya's company puts its papers on record itself ---- */
    const email = `wanjiru.kamau.${u}@sbg.co.ke`;
    const made = await http().post('/v1/sbg/entities/sbg-ke/admins').set(bearer(operator)).send({ email, name: 'Wanjiru Kamau' }).expect(201);
    const wanjiru = (await http().post('/v1/sbg/entities/admins/login').send({ email, password: made.body.temporaryPassword }).expect(201)).body.token.access_token as string;
    const declare = (body: Record<string, unknown>) => http().post('/v1/sbg/entities/sbg-ke/record/declare').set(bearer(wanjiru)).send(body).expect(201);
    const licenceNo = `CA/CL/${u}`;
    const policyNo = `GIT-${u}`;
    await declare({ section: 'licences', item: { kind: 'courier', number: licenceNo, issuer: 'Communications Authority', expiresAt: inDays(300) }, paperDataUrl: pdf('licence') });
    await declare({ section: 'insurance', item: { kind: 'goods_in_transit', insurer: 'Jubilee', policyNumber: policyNo, expiresAt: inDays(200) }, paperDataUrl: pdf('policy') });
    // One that has run out, and one that was on the record from before the company kept its own, with no paper behind it.
    const lapsedNo = `PL-${u}`;
    const bareNo = `PCK/${u}`;
    await declare({ section: 'insurance', item: { kind: 'public_liability', insurer: 'Britam', policyNumber: lapsedNo, expiresAt: inDays(-3) }, paperDataUrl: pdf('old policy') });
    const entities = app.get(EntityService);
    entities.updateRecord('sbg-ke', { licences: [...entities.recordOf('sbg-ke').licences, { kind: 'postal', number: bareNo, issuer: 'Communications Authority', expiresAt: inDays(90) }] }, 'Amina Otieno');
    await declare({ section: 'bankAccounts', item: { bankName: 'KCB', accountName: 'SeeBuyGet Kenya Ltd', accountNumber: `11${u}`, currency: 'KES' }, paperDataUrl: pdf('bank') });
    await declare({ section: 'representatives', item: { name: 'Otieno Odhiambo', role: 'Director', signing: 'alone' }, paperDataUrl: pdf('id') });

    /* ---- the people who contract with it ---- */
    const shopName = `Mama Njeri ${u}`;
    const shop = (await http().post('/v1/sbg/agents').set(bearer(operator)).send({ shopName, zone: `Zone${u}`, location: { lat: -1.2, lng: 36.8 }, landmark: 'x', shelf: { rows: 3, cols: 3 }, openingHours: { mon: HOURS, tue: HOURS, wed: HOURS, thu: HOURS, fri: HOURS, sat: HOURS, sun: null }, fullName: 'Njeri Wambui', nationalId: `ID-${u}`, mobile: `+2547${u}9`, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } }).expect(201)).body;
    const fleetName = `Kifaru ${u}`;
    const fleet = (await http().post('/v1/sbg/fleet/managers').set(bearer(operator)).send({ companyName: fleetName, tradingName: fleetName, contactPhone: `+2547${u}1`, contactEmail: `ops@kifaru${u}.example`, ownerFullName: 'Owner', ownerNationalId: `MGR-${u}`, depotAddress: '1 Depot Rd', location: { lat: -1.3, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-${u}`, transportOperatorLicence: `TOL-${u}`, taxId: `TAX-${u}`, declaredFleetSize: 3 } }).expect(201)).body;
    // A fleet takes drivers on once it has been checked and has posted its bond.
    // Its papers are pictures the member of staff setting it up uploaded, and somebody else approves them.
    const scan = async (kind: string) => (await http().post('/v1/sbg/media').set(bearer(operator)).send({ kind, dataUrl: shot(`${kind}:${fleet.did}`) }).expect(201)).body.mediaId as string;
    await http()
      .post(`/v1/sbg/fleet/managers/${fleet.did}/submit-kyc`)
      .set(bearer(operator))
      .send({ businessRegCertRef: await scan('kyc_registration'), operatorLicenceRef: await scan('kyc_licence'), ownerIdRef: await scan('kyc_id'), proofOfAddressRef: await scan('kyc_address') })
      .expect(201);
    await http().post(`/v1/sbg/fleet/managers/${fleet.did}/kyc-decision`).set(bearer(operator)).send({ approve: true, by: 'A second member of staff' }).expect(201);
    await http().post(`/v1/sbg/fleet/managers/${fleet.did}/bond`).set(bearer(operator)).expect(201);
    const driver = (await http().post('/v1/sbg/drivers/onboard').set(bearer(operator)).send({ displayName: 'Boda', fullName: 'Boda Rider', nationalId: `DRV-${u}`, mobile: `+2547${u}2`, licenceClasses: ['motorcycle'], managerDid: fleet.did }).expect(201)).body;
    const store = (await http().post('/v1/sbg/vendors').set(bearer(operator)).send({ ...AGREED, name: `Duka ${u}` }).expect(201)).body;
    const asShop = await tokenFor('agent', shop.did);
    const asFleet = await tokenFor('fleet_manager', fleet.did, fleet.did);
    const asDriver = await tokenFor('driver', driver.did, fleet.did);
    const asStore = await tokenFor('genesis', store.did);

    /* ---- what each is shown: the company behind their OWN record, its licence and its policy, by number ---- */
    const seen = await contractAs(asShop);
    expect(seen.company).toEqual({ name: 'SeeBuyGet Kenya', jurisdiction: 'KE' });
    expect(seen.papers).toEqual([
      { source: 'licence', kind: 'courier', issuer: 'Communications Authority', number: licenceNo, expiresAt: inDays(300), lapsed: false, reportable: true },
      // Nothing on record behind it that counts: it is shown, and there is nothing a report could strike.
      { source: 'licence', kind: 'postal', issuer: 'Communications Authority', number: bareNo, expiresAt: inDays(90), lapsed: false, reportable: false },
      { source: 'insurance', kind: 'goods_in_transit', issuer: 'Jubilee', number: policyNo, expiresAt: inDays(200), lapsed: false, reportable: true },
      // Run out, and said as that.
      { source: 'insurance', kind: 'public_liability', issuer: 'Britam', number: lapsedNo, expiresAt: inDays(-3), lapsed: true, reportable: true },
    ]);
    // NOTHING ELSE OF THE COMPANY'S: not its bank account, not who may sign, not a file or the id of one.
    const all = JSON.stringify(seen);
    expect(all).not.toContain(`11${u}`);
    expect(all).not.toMatch(/Otieno|KCB|documentId|doc_|fingerprint|Wanjiru/);
    for (const token of [asFleet, asDriver, asStore]) expect((await contractAs(token)).papers.map((p: { number: string }) => p.number)).toEqual([licenceNo, bareNo, policyNo, lapsedNo]);
    // Nobody signed in as nobody; and the company's own administrator and staff have their own door, not this one.
    await http().get('/v1/sbg/contract/company').expect(401);
    await http().get('/v1/sbg/contract/company').set(bearer(wanjiru)).expect(403);
    expect(await contractAs(operator)).toEqual({ papers: [] });

    /* ---- the shop reports the licence, by its number ---- */
    const said = { source: 'licence', number: licenceNo, category: 'expired', note: 'The Authority’s register lists this number as expired.' };
    expect((await reportAs(asShop, said)).body.code).toBe('FIELD_REQUIRED');
    // It can be aimed at nothing but what they were shown: not a paper they name by id, not the bank account, not another company.
    expect((await reportAs(asShop, { ...said, number: 'CA/CL/NO-SUCH', evidenceDataUrl: shot('x') })).body.code).toBe('NOT_FOUND');
    expect((await reportAs(asShop, { ...said, source: 'insurance', evidenceDataUrl: shot('x') })).body.code).toBe('NOT_FOUND');
    await reportAs(asShop, { ...said, source: 'bankAccounts', number: `11${u}`, evidenceDataUrl: shot('x') }).expect(400);
    expect((await reportAs(operator, { ...said, evidenceDataUrl: shot('x') })).body.code).toBe('NOT_FOUND');
    // And not at a licence with no paper behind it: the button is not offered, and the server says why.
    expect((await reportAs(asShop, { ...said, number: bareNo, evidenceDataUrl: shot('x') })).body.code).toBe('INVALID_STATE');
    expect((await http().get('/v1/sbg/paper-reports').set(bearer(operator)).expect(200)).body.waiting).toBe(0);

    const sent = (await reportAs(asShop, { ...said, entityId: 'sbg-et', documentId: 'doc_other', evidenceDataUrl: shot('register') }).expect(201)).body;
    expect(Object.keys(sent).sort()).toEqual(['answerBy', 'reportId']);
    // Its driver's fleet says the same of the same paper: one question. Nobody reports it twice.
    await reportAs(asFleet, { ...said, evidenceDataUrl: shot('register, seen by the fleet') }).expect(201);
    expect((await reportAs(asShop, { ...said, evidenceDataUrl: shot('again') })).body.code).toBe('CONFLICT');

    // Staff read WHO: the shop and the fleet, by the names on their records. The company reads only what was said.
    const queue = (await http().get('/v1/sbg/paper-reports').set(bearer(operator)).expect(200)).body;
    expect(queue.waiting).toBe(1);
    expect(queue.items[0]).toMatchObject({ entityId: 'sbg-ke', paper: { kind: 'licence', relatesTo: licenceNo } });
    expect(queue.items[0].reports.map((r: { by: string; role: string }) => [r.by, r.role])).toEqual([
      [shopName, 'a shop that contracts with the company'],
      [fleetName, 'a fleet that contracts with the company'],
    ]);
    const theirs = (await http().get('/v1/sbg/entities/sbg-ke/record').set(bearer(wanjiru)).expect(200)).body.reports;
    expect(JSON.stringify(theirs)).not.toMatch(new RegExp(`${shopName}|${fleetName}|a shop|a fleet`));
    // The licence keeps counting for everybody.
    expect((await contractAs(asStore)).papers[0]).toMatchObject({ number: licenceNo, lapsed: false, reportable: true });

    /* ---- and each reads back what became of THEIR OWN report, and nobody else's ---- */
    expect((await contractAs(asShop)).papers[0].yourReport).toMatchObject({ state: 'open' });
    expect((await contractAs(asFleet)).papers[0].yourReport).toMatchObject({ state: 'open' });
    expect((await contractAs(asDriver)).papers[0].yourReport).toBeUndefined();
    expect((await contractAs(asShop)).papers.slice(1).every((p: { yourReport?: unknown }) => p.yourReport === undefined)).toBe(true);
    await http().post(`/v1/sbg/paper-reports/${queue.items[0].caseId}/dismiss`).set(bearer(operator)).send({ by: 'Amina Otieno', reason: 'The register was checked today and lists the licence as current.' }).expect(200);
    expect((await contractAs(asShop)).papers[0].yourReport).toMatchObject({ state: 'dismissed', reason: 'The register was checked today and lists the licence as current.' });
    expect((await contractAs(asStore)).papers[0].yourReport).toBeUndefined();
    // Decided, it can be said again — and what the shop reads is the LATEST thing that became of its report.
    await reportAs(asShop, { ...said, note: 'It is listed as expired again this morning.', evidenceDataUrl: shot('register, a week on') }).expect(201);
    expect((await contractAs(asShop)).papers[0].yourReport).toMatchObject({ state: 'open' });
    expect((await contractAs(asShop)).papers[0].yourReport.reason).toBeUndefined();
  });
});
