import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { DriverService } from '../src/modules/pudo/driver.service';
import { FleetService } from '../src/modules/pudo/fleet.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { AGREED } from './agreed';
import { declared } from './declared';

/**
 * 2026-11-03 — A BUSINESS SAYS THE TEMPERATURE ITS OWN GOODS ARE KEPT AT, over the wire. A load already carried a range —
 * the road leg of an air import set one — and the road for it was built everywhere but the door a business posts through:
 * offered only to a body that keeps goods cold, its readings judged against the range, the cold chain broken told. Now
 * the business gives it when it posts its fresh or frozen food, and the consignment note and the labels print the range
 * it gave, not the network's 2–8 °C. A load posted without one is posted exactly as before.
 */
describe('a business posts a load kept cold, at the temperature it says', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const H = 3_600_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const from = { lat: -1.31, lng: 36.84 };
  const to = { lat: -0.3, lng: 36.08 };

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

  /** A business that ships its own goods, signed in. */
  async function aShipper(): Promise<string> {
    const phone = `+2547${digits()}6`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `frozen-${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    return (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `Kudu Frozen Foods ${digits()}`, country: 'KE', registrationNo: `FRZ-${digits()}`, activities: ['shipper'], yourName: 'Owner' }).expect(201)).body.token.access_token as string;
  }

  /** A truck driver, vetted and declared, in a body of the kind given — signed in. */
  async function aDriverIn(truckSubtype: 'box' | 'refrigerated'): Promise<{ did: string; token: string }> {
    const drivers = app.get(DriverService);
    const driver = drivers.register({ displayName: 'Baridi', fullName: 'Baridi Driver', nationalId: `ID-FZ-${digits()}`, mobile: `+2547${digits()}7`, licenceClasses: ['truck'], licenceNumber: `L-${digits()}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(driver.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(driver.did, true);
    app.get(FleetService).couple(driver.did, app.get(VehicleService).register({ plate: `KDF ${digits().slice(0, 3)}F`, vehicleClass: 'truck', truckSubtype, capacityKg: 9_000, ownerName: 'X', equipment: ['TLT'], baseFee: 0.5, pricePerKm: 0.1 } as never).vehicleId);
    declared(app, 'driver', driver.did);
    const token = (await http().post('/v1/auth/token').send({ role: 'driver', did: driver.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    return { did: driver.did, token };
  }

  const load = (over: Record<string, unknown> = {}) => ({ description: 'Frozen tilapia fillets, 40 cartons', pickupLocation: from, pickupLabel: 'Kudu cold store, Mombasa Road', destLabel: 'Nakuru cold store', destLocation: to, weightKg: 900, packaging: 'palletised', packages: 40, natureCode: 'FOP', ...over });
  const post = (biz: string, body: object) => http().post('/v1/sbg/dispatch/freight').set(bearer(biz)).send(body);
  const offersTo = async (driver: { did: string; token: string }) =>
    (await http().post(`/v1/sbg/fleet/drivers/${encodeURIComponent(driver.did)}/suggest-work`).set(bearer(driver.token)).send({ from, to }).expect(201)).body.offers as Array<{ offerId: string; ref: string }>;
  const posted = async (biz: string) => (await http().get('/v1/sbg/dispatch/posted').set(bearer(biz)).expect(200)).body.items as Array<{ freightId: string; coldChainBroken?: { celsius: number; minC: number; maxC: number }; keptBetween?: { minC: number; maxC: number; own: boolean } }>;
  const note = async (biz: string, freightId: string) => (await http().get(`/v1/sbg/dispatch/freight/${freightId}/consignment-note`).set(bearer(biz)).expect(200)).body as { instructions: string[]; goods: { temperatureBand?: string } };
  const labels = async (biz: string, freightId: string) => (await http().get(`/v1/sbg/dispatch/freight/${freightId}/package-labels.html`).set(bearer(biz)).expect(200)).text;
  /** On the road with this driver since three hours ago, as the cold-chain tests put it there. */
  const onTheRoad = (freightId: string) => {
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    store.set(freightId, { ...store.get(freightId), status: 'in_transit', pickedUpAt: iso(Date.now() - 3 * H) });
  };

  it('keeps a frozen load between the degrees the business gave: offered only to a body that keeps it cold, its note and labels printing them, its readings judged by them', async () => {
    const biz = await aShipper();
    const reefer = await aDriverIn('refrigerated');
    const box = await aDriverIn('box');

    const frozen = (await post(biz, load({ tempRange: { minC: -25, maxC: -18 }, commitMode: 'instant' })).expect(201)).body;
    expect(frozen).toMatchObject({ natureCode: 'FOP', tempRange: { minC: -25, maxC: -18 } });
    expect(frozen.requiredCapabilities).toContain('coldChain');
    // 2026-11-03 — the business's own load says the range it is kept in, and that it is the one the business gave.
    expect((await posted(biz)).find((r) => r.freightId === frozen.freightId)?.keptBetween).toEqual({ minC: -25, maxC: -18, own: true });

    // Offered to the refrigerated body; never to the box body.
    const offer = (await offersTo(reefer)).find((o) => o.ref === frozen.freightId);
    expect(offer).toBeDefined();
    expect((await offersTo(box)).some((o) => o.ref === frozen.freightId)).toBe(false);

    // The consignment note and the labels say the business's range — not the network's 2–8 °C.
    const papers = await note(biz, frozen.freightId);
    expect(papers.instructions).toContain('Keep between -25 °C and -18 °C');
    expect(papers.instructions).not.toContain('Keep between 2 °C and 8 °C');
    expect(papers.goods.temperatureBand).toBe('-25 °C to -18 °C');
    const printed = await labels(biz, frozen.freightId);
    expect(printed).toContain('Keep -25 °C to -18 °C');
    expect(printed).not.toContain('Keep 2 °C to 8 °C');

    // Taken by the refrigerated truck and on the road: its readings are judged against the business's range.
    await http().post(`/v1/sbg/dispatch/offers/${offer!.offerId}/claim`).set(bearer(reefer.token)).expect(201);
    onTheRoad(frozen.freightId);
    // The driver's card says the range to keep, where the temperature is logged (the driver's TempSheet reads it).
    const card = (await http().get(`/v1/sbg/fleet/drivers/${encodeURIComponent(reefer.did)}/claims`).set(bearer(reefer.token)).expect(200)).body.claims.find((c: { ref: string }) => c.ref === frozen.freightId);
    expect(card.tempBand).toEqual({ minC: -25, maxC: -18 });
    const read = (celsius: number) => http().post(`/v1/sbg/dispatch/freight/${frozen.freightId}/temperature`).set(bearer(reefer.token)).send({ driverDid: reefer.did, celsius }).expect(201);
    // -20 °C is frozen and in its range; 4 °C — fine for chilled milk — has thawed it.
    expect((await read(-20)).body.tempBreached).toBeFalsy();
    expect((await posted(biz)).find((r) => r.freightId === frozen.freightId)?.coldChainBroken).toBeUndefined();
    expect((await read(4)).body.tempBreached).toBe(true);
    expect((await posted(biz)).find((r) => r.freightId === frozen.freightId)?.coldChainBroken).toMatchObject({ celsius: 4, minC: -25, maxC: -18 });
  });

  it('refuses a price from a driver whose body cannot keep it cold, and takes one from a driver whose body can', async () => {
    const biz = await aShipper();
    const reefer = await aDriverIn('refrigerated');
    const box = await aDriverIn('box');
    const chilled = (await post(biz, load({ description: 'Fresh milk, chilled', tempRange: { minC: 1, maxC: 4 }, commitMode: 'negotiate' })).expect(201)).body;
    const propose = (driver: { did: string; token: string }) => http().post(`/v1/sbg/dispatch/freight/${chilled.freightId}/proposals`).set(bearer(driver.token)).send({ from, price: 9000 });
    const refused = await propose(box);
    expect(refused.status).toBe(400);
    expect(refused.body.code).toBe('VEHICLE_MISSING_CAPABILITY');
    await propose(reefer).expect(201);
  });

  it('refuses, in words and before anything is posted, a range on goods nobody carries cold, a lowest not below the highest, and degrees past -30 or 30', async () => {
    const biz = await aShipper();
    const before = (await posted(biz)).length;
    const said = async (body: object) => {
      const r = await post(biz, body);
      expect(r.status).toBe(400);
      return String(r.body.detail);
    };
    expect(await said(load({ natureCode: 'GEN', tempRange: { minC: 2, maxC: 8 } }))).toBe('A temperature range is for goods carried cold: say the goods are fresh or frozen food, or leave the range out.');
    expect(await said(load({ natureCode: undefined, tempRange: { minC: 2, maxC: 8 } }))).toMatch(/for goods carried cold/);
    expect(await said(load({ tempRange: { minC: 8, maxC: 2 } }))).toBe('The lowest temperature must be below the highest');
    expect(await said(load({ tempRange: { minC: 4, maxC: 4 } }))).toBe('The lowest temperature must be below the highest');
    expect(await said(load({ tempRange: { minC: -40, maxC: -18 } }))).toContain('A temperature is between -30 °C and 30 °C');
    expect(await said(load({ tempRange: { minC: 2 } }))).toMatch(/maxC/);
    expect((await posted(biz)).length).toBe(before);
  });

  it('posts a load without a range exactly as before: fresh food kept at 2–8 °C, and other goods with no temperature at all', async () => {
    const biz = await aShipper();
    const box = await aDriverIn('box');
    const fresh = (await post(biz, load({ description: 'Avocados', commitMode: 'instant' })).expect(201)).body;
    expect(fresh.tempRange).toBeUndefined();
    expect(fresh.requiredCapabilities).toContain('coldChain');
    const papers = await note(biz, fresh.freightId);
    expect(papers.instructions).toContain('Keep between 2 °C and 8 °C');
    expect(papers.goods.temperatureBand).toBe('2 °C to 8 °C');
    expect(await labels(biz, fresh.freightId)).toContain('Keep 2 °C to 8 °C');
    expect((await posted(biz)).find((r) => r.freightId === fresh.freightId)?.keptBetween).toEqual({ minC: 2, maxC: 8, own: false });

    const dry = (await post(biz, load({ description: 'Maize flour', natureCode: 'FOD', commitMode: 'instant' })).expect(201)).body;
    expect(dry.tempRange).toBeUndefined();
    expect(dry.requiredCapabilities).not.toContain('coldChain');
    expect((await note(biz, dry.freightId)).goods.temperatureBand).toBeUndefined();
    expect((await posted(biz)).find((r) => r.freightId === dry.freightId)?.keptBetween).toBeUndefined();
    expect((await offersTo(box)).some((o) => o.ref === dry.freightId)).toBe(true);
  });
});
