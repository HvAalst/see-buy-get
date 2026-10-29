import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { ImportService } from '../src/modules/pudo/import.service';
import { AGREED } from './agreed';

/**
 * DANGEROUS GOODS COME WITH THEIR UN NUMBER FROM EVERY DOOR (the gaps check, 2026-10-29, before air): the CMR note's box 9
 * prints the UN number, proper shipping name and class, and the driver's papers need them. A business posting a load or
 * its system through the API, an export's load to the terminal, an import's road leg — each carries them or is refused
 * before anything is posted. (The shop counter's own test is in pudo.service.spec.ts.)
 */
describe('dangerous goods, from every door', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const H = 3_600_000;
  const LPG = { unNumber: 'UN1075', properShippingName: 'Petroleum gases, liquefied', hazardClass: '2.1' };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  async function aBusiness(activities: string[], called: string) {
    const phone = `+2547${digits()}5`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `dg-${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    const made = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `${called} ${digits()}`, country: 'KE', registrationNo: `DG-${digits()}`, activities, yourName: 'Wanjiku' }).expect(201)).body;
    const token = made.token.access_token as string;
    const entityId = made.business.entityId as string;
    const site = async (kind: string, name: string, location: { lat: number; lng: number }) => (await http().post(`/v1/sbg/entities/${entityId}/sites`).set(bearer(token)).send({ kind, name, location }).expect(201)).body.siteId as string;
    return { token, entityId, site };
  }

  it('a business’s load, posted on screen or by its system: refused without the UN number, carried with it', async () => {
    const biz = await aBusiness(['shipper'], 'Gas Distributors');
    const load = { description: 'LPG cylinders, 40', pickupLocation: { lat: -1.29, lng: 36.82 }, pickupLabel: 'Industrial Area', destLabel: 'Thika', destLocation: { lat: -1.03, lng: 37.07 }, weightKg: 1200, natureCode: 'HAZ-FLAM', packaging: 'piece' };
    expect((await http().post('/v1/sbg/dispatch/freight').set(bearer(biz.token)).send(load).expect(400)).body.detail).toMatch(/declared dangerous: give their UN number/);
    const posted = (await http().post('/v1/sbg/dispatch/freight').set(bearer(biz.token)).send({ ...load, dangerousGoods: LPG }).expect(201)).body;
    expect(app.get(DispatchService).requireFreightPublic(posted.freightId).dangerousGoods).toMatchObject({ unNumber: 'UN1075', hazardClass: '2.1' });
  });

  it('an export’s load to the terminal: the UN number asked when it is posted, kept on the export, printed on the note', async () => {
    const x = await aBusiness(['shipper'], 'Kenya Chemicals');
    const loading = await x.site('loading', 'Athi River plant', { lat: -1.45, lng: 36.98 });
    const terminal = await x.site('port', 'Kipevu container terminal', { lat: -4.05, lng: 39.65 });
    const made = (await http().post('/v1/sbg/exports').set(bearer(x.token)).send({ goodsDescription: 'Paint, 200 drums', originCountry: 'KE', destCountry: 'UG', loadingPort: 'Mombasa', containerType: '22G1', natureCode: 'HAZ-FLAM', booking: { reference: `MBA${digits()}`, bookedWith: 'forwarder', partyName: 'Pwani Forwarders', gateCutoffAt: new Date(Date.now() + 96 * H).toISOString() }, loadingSiteId: loading, terminalSiteId: terminal }).expect(201)).body;
    const path = `/v1/sbg/exports/${made.exportId}`;
    await http().post(`${path}/container`).set(bearer(x.token)).send({ containerNo: 'MSCU1234566' }).expect(201);
    expect((await http().post(`${path}/laden-leg`).set(bearer(x.token)).send({ weightKg: 18000 }).expect(400)).body.detail).toMatch(/declared dangerous/);
    const paint = { unNumber: '1263', properShippingName: 'Paint', hazardClass: '3', packingGroup: 'III' };
    const posted = (await http().post(`${path}/laden-leg`).set(bearer(x.token)).send({ weightKg: 18000, dangerousGoods: paint }).expect(201)).body;
    expect(posted.consignment.dangerousGoods).toMatchObject({ unNumber: 'UN1263', properShippingName: 'Paint', packingGroup: 'III' });
    expect(app.get(DispatchService).requireFreightPublic(posted.consignment.ladenFreightId).dangerousGoods).toMatchObject({ unNumber: 'UN1263', hazardClass: '3' });
  });

  it('an import’s road leg: the importer’s own declaration reaches the note — and its proper shipping name is asked for', async () => {
    const imp = await aBusiness(['importer'], 'Nakuru Agro');
    const made = (await http().post('/v1/sbg/imports').set(bearer(imp.token)).send({ goodsDescription: 'Pesticide, 400 cartons', originCountry: 'IN', destCountry: 'KE', destPort: 'Mombasa', containerType: '22G1' }).expect(201)).body;
    const path = `/v1/sbg/imports/${made.importId}`;
    await http().post(`${path}/cargo`).set(bearer(imp.token)).send({ natureCode: 'HAZ-CHEM', dangerous: { unNumber: 'UN2588', imdgClass: '6.1' } }).expect(201);
    const service = app.get(ImportService);
    expect(() => service.mintRoadLeg(made.importId, imp.entityId, { pickupLocation: { lat: -4.05, lng: 39.65 }, destLabel: 'Nakuru store', weightKg: 12000 }, 'Wanjiku')).toThrow(/proper shipping name is missing/);
    await http().post(`${path}/cargo`).set(bearer(imp.token)).send({ natureCode: 'HAZ-CHEM', dangerous: { unNumber: 'UN2588', imdgClass: '6.1', properShippingName: 'Pesticide, solid, toxic, n.o.s.' } }).expect(201);
    const leg = service.mintRoadLeg(made.importId, imp.entityId, { pickupLocation: { lat: -4.05, lng: 39.65 }, destLabel: 'Nakuru store', weightKg: 12000 }, 'Wanjiku');
    expect(app.get(DispatchService).requireFreightPublic(leg.roadFreightId!).dangerousGoods).toMatchObject({ unNumber: 'UN2588', properShippingName: 'Pesticide, solid, toxic, n.o.s.', hazardClass: '6.1' });
  });
});
