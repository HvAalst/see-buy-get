import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DriverService } from '../src/modules/pudo/driver.service';
import { FleetService } from '../src/modules/pudo/fleet.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { AGREED } from './agreed';
import { declared } from './declared';

/**
 * A PERSON POSTS A LOAD FROM THE SEND APP, over the wire (the owner, 2026-11-13: plan U5, "a person posts a load in the Send
 * app"; part 3a). In Uganda, where SeeBuyGet only matches, a person describes a fridge and posts it: always negotiated, paid to
 * the driver directly, in Uganda's money. A driver names a price; the person accepts it from their own sign-in. In Kenya,
 * where a company of ours takes the money, paying up front is coming — refused until then, never a load nobody is billed for.
 */
describe('a person posts a load, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const kampala = { lat: 0.3476, lng: 32.5825 };
  const entebbe = { lat: 0.0512, lng: 32.4637 };

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

  async function aPerson(): Promise<string> {
    const phone = `+2547${digits()}5`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `mover-${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    return (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token as string;
  }

  const fridge = (over: Record<string, unknown> = {}) => ({
    description: 'A fridge, upright',
    pickupLocation: kampala,
    pickupLabel: 'Ntinda, Kampala',
    destLabel: 'Entebbe',
    destLocation: entebbe,
    weightKg: 60,
    contactPhone: '+256700123456',
    work: { needs: 'one', pickup: { hands: 'one' }, delivery: { hands: 'one' }, marks: ['upright'] },
    ...over,
  });
  const post = (token: string, body: object) => http().post('/v1/sbg/dispatch/freight').set(bearer(token)).send(body);

  let person = '';
  let loadId = '';

  it('1 · in Uganda, where SeeBuyGet only matches: posted, always negotiated, paid to the driver directly, in Uganda’s money', async () => {
    person = await aPerson();
    const load = (await post(person, fridge({ commitMode: 'instant' })).expect(201)).body;
    loadId = load.freightId;
    expect(load).toMatchObject({ commitMode: 'negotiate', settlement: 'between_parties', pickupCountry: 'UG', destCountry: 'UG', postedCurrency: 'UGX' });
    expect(load.work.marks).toEqual(['upright']);
    // On the person's own list.
    const mine = (await http().get('/v1/sbg/dispatch/posted').set(bearer(person)).expect(200)).body.items as Array<{ freightId: string }>;
    expect(mine.map((r) => r.freightId)).toContain(loadId);
  });

  it('2 · refused in words: a number to call missing, a pin far from every town, a contract, and Kenya until paying up front comes', async () => {
    const said = async (body: object) => {
      const r = await post(person, body);
      expect(r.status).toBeGreaterThanOrEqual(400);
      return String(r.body.detail);
    };
    expect(await said(fridge({ contactPhone: '' }))).toMatch(/number the driver can call/);
    expect(await said(fridge({ pickupLocation: { lat: -20, lng: 60 } }))).toMatch(/cannot tell which country the pickup is in/);
    expect(await said(fridge({ contractId: 'ctr_x' }))).toMatch(/for themselves/);
    expect(await said(fridge({ pickupLocation: { lat: -1.2921, lng: 36.8219 }, destLocation: { lat: -1.1, lng: 37.0 } }))).toMatch(/Paying for a load from the Send app is coming in Kenya/);
  });

  it('3 · a driver names a price; the person accepts it from their own sign-in, and nobody else can', async () => {
    const drivers = app.get(DriverService);
    const d = drivers.register({ displayName: 'Okello', fullName: 'Okello Driver', nationalId: `ID-PL-${digits()}`, mobile: `+2567${digits()}1`, licenceClasses: ['van'], licenceNumber: `L-${digits()}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true, jurisdiction: 'UG' } as never);
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const van = app.get(VehicleService).register({ plate: `UBA ${digits().slice(0, 3)}P`, vehicleClass: 'van', capacityKg: 1_000, ownerName: 'Okello', ownerDriverDid: d.did, baseFee: 0.5, pricePerKm: 0.1, registeredIn: 'UG' } as never);
    app.get(FleetService).couple(d.did, van.vehicleId);
    declared(app, 'driver', d.did);
    const driver = (await http().post('/v1/auth/token').send({ role: 'driver', did: d.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    const offered = await http().post(`/v1/sbg/dispatch/freight/${loadId}/proposals`).set(bearer(driver)).send({ from: kampala, price: 90000 });
    if (offered.status !== 201) throw new Error(`propose: ${JSON.stringify(offered.body)}`);
    const offers = (await http().get(`/v1/sbg/dispatch/freight/${loadId}/proposals`).set(bearer(person)).expect(200)).body.items as Array<{ proposalId: string; price: number }>;
    expect(offers[0].price).toBe(90000);
    const someoneElse = await aPerson();
    await http().post(`/v1/sbg/dispatch/proposals/${offers[0].proposalId}/accept`).set(bearer(someoneElse)).expect(403);
    const taken = (await http().post(`/v1/sbg/dispatch/proposals/${offers[0].proposalId}/accept`).set(bearer(person)).expect(201)).body;
    expect(taken.freight).toMatchObject({ status: 'claimed', lockedPrice: 90000, settlement: 'between_parties' });
  });
});
