import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * 2026-11-18 — PARCELS ACROSS A BORDER ON THE CONSOLE, OVER THE WIRE (the plan, step 1). Staff read every route and what it
 * still needs; a route is refused, by name, while anything is missing; an airport is never opened without a licensed
 * customs warehouse; the clearer and the fee are checked; nobody but staff reads or changes any of it.
 */
describe('parcels across a border, on the console', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let staff = '';
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    staff = (await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a route is refused while anything is missing, each thing named', async () => {
    const r = await http().post('/v1/sbg/border-routes/NL/KE/propose').set(bearer(staff)).send({ by: 'Amina Staff' });
    expect(r.status).toBe(400);
    expect(r.body.detail).toMatch(/cannot be switched on yet/);
    expect(r.body.detail).toMatch(/arrival airport in KE is not named/);
    await http().post('/v1/sbg/border-routes/KE/KE/propose').set(bearer(staff)).send({ by: 'Amina Staff' }).expect(400);
    await http().post('/v1/sbg/border-routes/NL/KE/approve').set(bearer(staff)).send({ by: 'Brian Staff' }).expect(400);
  });

  it('an arrival country’s airports: blocked until a licensed customs warehouse is agreed there', async () => {
    const opened = await http().post('/v1/sbg/border-arrivals/KE/airports/NBO').set(bearer(staff)).send({ open: true, by: 'Amina Staff' });
    expect([opened.status, opened.body.detail]).toEqual([400, expect.stringMatching(/customs warehouse agreed there/)]);
    await http().post('/v1/sbg/border-arrivals/KE/airports/AMS').set(bearer(staff)).send({ open: true, by: 'Amina Staff' }).expect(404);
    await http().post('/v1/sbg/border-arrivals/KE/airports/NBO/warehouse').set(bearer(staff)).send({ mdpId: 'no-such-hub', tstLicence: 'TST-1', agreement: 'AGR-1', by: 'Amina Staff' }).expect(404);
    await http().post('/v1/sbg/border-arrivals/KE/airports/NBO/warehouse').set(bearer(staff)).send({ mdpId: 'x', tstLicence: 'T', agreement: 'AGR-1', by: 'Amina Staff' }).expect(400);
    const view = (await http().get('/v1/sbg/border-routes').set(bearer(staff)).expect(200)).body;
    expect(Array.isArray(view.routes)).toBe(true);
    expect(Array.isArray(view.arrivals)).toBe(true);
  });

  it('the clearer and the fee are checked', async () => {
    await http().post('/v1/sbg/border-arrivals/KE/clearer').set(bearer(staff)).send({ kind: 'agent', entityId: 'nobody', by: 'Amina Staff' }).expect(404);
    await http().post('/v1/sbg/border-arrivals/KE/clearer').set(bearer(staff)).send({ kind: 'pigeon', by: 'Amina Staff' }).expect(400);
    await http().post('/v1/sbg/border-arrivals/KE/fee').set(bearer(staff)).send({ amount: 0, by: 'Amina Staff' }).expect(400);
  });

  it('2b — a counter is told where it can send a parcel abroad: nowhere while no route is on; a parcel to another country is refused by name', async () => {
    const hours = { open: '08:00', close: '18:00' };
    const aShop = async (shopName: string, zone: string, country: string, location: { lat: number; lng: number }, n: number) =>
      (
        await http()
          .post('/v1/sbg/agents')
          .set(bearer(staff))
          .send({
            shopName, zone, country, location, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
            openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: null },
            fullName: `${shopName} owner`, nationalId: `ID-ABR-${n}`, mobile: `+25471188${n}`, deviceImei: `IMEI-ABR-${n}`,
            requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
          })
          .expect(201)
      ).body.did as string;
    const shop = await aShop('Nairobi Abroad', 'AbrNairobi', 'KE', { lat: -1.286, lng: 36.817 }, 1);
    const abroad = await aShop('Addis Abroad', 'AbrAddis', 'ET', { lat: 9.03, lng: 38.74 }, 2);
    const own = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did: shop }).expect(201)).body.access_token as string);
    expect((await http().get(`/v1/sbg/agents/${shop}/abroad`).set(own).expect(200)).body).toEqual({ routes: [] });
    // Another shop's is not its to read.
    await http().get(`/v1/sbg/agents/${abroad}/abroad`).set(own).expect(403);
    // Refused at the door, before the parcel or its photo is looked at.
    const r = await http().post('/v1/sbg/parcels/accept').set(bearer(staff)).send({ agentDid: shop, parcelId: 'PUD-ABROAD-E2E', size: 'M', destZone: 'x', destPudoDid: abroad, senderMobile: '+254700111', receiverMobile: '+251900111', dropoffPhotoRef: 'none' });
    expect(r.status).toBe(400);
    expect(r.body.detail).toMatch(/are not sent from .* yet: no route between them is on/);
  });

  it('2a — a route is set up first; where it leaves, who carries it and its prices are checked', async () => {
    const made = (await http().post('/v1/sbg/border-routes/NL/KE').set(bearer(staff)).send({}).expect(201)).body;
    expect(made).toMatchObject({ from: 'NL', to: 'KE', state: 'off', departureAirports: expect.arrayContaining(['AMS']) });
    await http().post('/v1/sbg/border-routes/NL/KE/departure').set(bearer(staff)).send({ airport: 'NBO', mdpId: 'x', by: 'Amina Staff' }).expect(404);
    await http().post('/v1/sbg/border-routes/NL/KE/departure').set(bearer(staff)).send({ airport: 'AMS', mdpId: 'no-such-hub', by: 'Amina Staff' }).expect(404);
    await http().post('/v1/sbg/border-routes/NL/KE/carrier').set(bearer(staff)).send({ entityId: 'nobody', by: 'Amina Staff' }).expect(404);
    expect(made.arrivalAirports).toEqual(expect.arrayContaining(['NBO']));
    await http().post('/v1/sbg/border-routes/NL/KE/arrival').set(bearer(staff)).send({ airport: 'AMS', by: 'Amina Staff' }).expect(404);
    expect((await http().post('/v1/sbg/border-routes/NL/KE/arrival').set(bearer(staff)).send({ airport: 'NBO', by: 'Amina Staff' }).expect(201)).body.arrival).toMatchObject({ airport: 'NBO' });
    await http().post('/v1/sbg/border-routes/NL/KE/prices').set(bearer(staff)).send({ S: 0, M: 1, L: 1, by: 'Amina Staff' }).expect(400);
    const view = (await http().get('/v1/sbg/border-routes').set(bearer(staff)).expect(200)).body;
    expect(view.routes.find((r: { from: string; to: string }) => r.from === 'NL' && r.to === 'KE').conditions.map((c: { key: string }) => c.key)).toEqual(['open-from', 'open-to', 'sells-from', 'sells-to', 'departure', 'carrier', 'price', 'clearer', 'fee', 'airport']);
  });

  it('nobody but staff reads or changes it', async () => {
    await http().get('/v1/sbg/border-routes').expect(401);
    await http().post('/v1/sbg/border-routes/NL/KE/propose').send({}).expect(401);
    await http().post('/v1/sbg/border-arrivals/KE/fee').send({ amount: 100 }).expect(401);
    await http().post('/v1/sbg/border-routes/NL/KE/prices').send({ S: 1, M: 1, L: 1 }).expect(401);
    await http().post('/v1/sbg/border-routes/NL/KE/arrival').send({ airport: 'NBO' }).expect(401);
    await http().get('/v1/sbg/agents/any/abroad').expect(401);
  });
});
