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
 * UNUSUAL LOADS, over the wire (the owner, 2026-11-13: "rather think of something broader to embrace unusual loads"; plan U1–U4
 * as revised). A business posts a sofa: two people to carry it, nobody to help at the pickup on the third floor without a lift,
 * the receiver unloads. It is negotiated whatever the business chose, because it names extra work. A driver who works alone is
 * told why they cannot offer; once they say a helper works with them, they can. A long item and a short load space, where the
 * length is known. The consignment note says it all in words.
 */
describe('unusual loads: the work on a load, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const from = { lat: -1.31, lng: 36.84 };
  const to = { lat: -1.28, lng: 36.82 };

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

  async function aShipper(): Promise<string> {
    const phone = `+2547${digits()}6`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `movers-${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    return (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `Sofa World ${digits()}`, country: 'KE', registrationNo: `SOF-${digits()}`, activities: ['shipper'], yourName: 'Owner' }).expect(201)).body.token.access_token as string;
  }

  /** A courier with their own van on a shift, vetted and declared — signed in. */
  async function aVanDriver(): Promise<{ did: string; token: string; vehicleId: string }> {
    const drivers = app.get(DriverService);
    const driver = drivers.register({ displayName: 'Juma', fullName: 'Juma Mover', nationalId: `ID-UL-${digits()}`, mobile: `+2547${digits()}8`, licenceClasses: ['van'], licenceNumber: `L-${digits()}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    drivers.submitKyc(driver.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(driver.did, true);
    const van = app.get(VehicleService).register({ plate: `KDG ${digits().slice(0, 3)}U`, vehicleClass: 'van', capacityKg: 1_200, ownerName: 'Juma', ownerDriverDid: driver.did, baseFee: 0.5, pricePerKm: 0.1 } as never);
    app.get(FleetService).couple(driver.did, van.vehicleId);
    declared(app, 'driver', driver.did);
    const token = (await http().post('/v1/auth/token').send({ role: 'driver', did: driver.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    return { did: driver.did, token, vehicleId: van.vehicleId };
  }

  const sofa = {
    description: 'A three-seat sofa',
    pickupLocation: from,
    pickupLabel: 'Kilimani flats',
    destLabel: 'Westlands',
    destLocation: to,
    weightKg: 70,
    commitMode: 'instant',
    work: { needs: 'two', pickup: { hands: 'none', floor: 3, lift: false, carryM: 30 }, delivery: { hands: 'none', theyDoIt: true }, marks: ['upright', 'blankets'] },
  };
  const post = (biz: string, body: object) => http().post('/v1/sbg/dispatch/freight').set(bearer(biz)).send(body);
  const board = async (driver: { did: string; token: string }) =>
    (await http().get(`/v1/sbg/dispatch/board`).query({ lat: from.lat, lng: from.lng }).set(bearer(driver.token)).expect(200)).body.items as Array<{ freightId: string; commitMode: string; work?: { extras: Array<{ end: string; kind: string; n?: number }>; gaps?: { pickup: { helpers: number }; delivery: { helpers: number } }; marks: string[] }; blockers: Array<{ code: string; message: string }> }>;

  let biz = '';
  let sofaId = '';
  let juma = { did: '', token: '', vehicleId: '' };

  it('1 · a business posts a sofa: kept as it said, and negotiated because it names extra work', async () => {
    biz = await aShipper();
    const posted = (await post(biz, sofa).expect(201)).body;
    sofaId = posted.freightId;
    expect(posted.commitMode).toBe('negotiate');
    expect(posted.work).toEqual({ needs: 'two', pickup: { hands: 'none', floor: 3, carryM: 30 }, delivery: { hands: 'none', theyDoIt: true }, marks: ['upright', 'blankets'] });
    // The poster's own list shows what it takes.
    const mine = (await http().get('/v1/sbg/dispatch/posted').set(bearer(biz)).expect(200)).body.items.find((r: { freightId: string }) => r.freightId === sofaId);
    expect(mine.work.extras).toEqual([
      { end: 'pickup', kind: 'helper', n: 1 },
      { end: 'pickup', kind: 'floors', n: 3 },
      { end: 'pickup', kind: 'carry', n: 30 },
    ]);
    // Said wrong, it is refused in words and nothing is posted.
    const wrong = await post(biz, { ...sofa, work: { ...sofa.work, needs: 'many' } });
    expect([wrong.status, wrong.body.detail]).toEqual([400, expect.stringMatching(/one person, two, three or more, or a machine/)]);
    // An ordinary load stays as it chose.
    expect((await post(biz, { ...sofa, work: { needs: 'one', pickup: { hands: 'none' }, delivery: { hands: 'none' } } }).expect(201)).body.commitMode).toBeUndefined();
  });

  it('2 · a driver who works alone sees why, and cannot offer; once a helper works with them, they can', async () => {
    juma = await aVanDriver();
    const row = (await board(juma)).find((r) => r.freightId === sofaId)!;
    expect(row.work?.gaps?.pickup.helpers).toBe(1);
    expect(row.work?.gaps?.delivery.helpers).toBe(0);
    expect(row.work?.marks).toEqual(['upright', 'blankets']);
    expect(row.blockers).toContainEqual(expect.objectContaining({ code: 'WORK_NOT_COVERED', message: expect.stringMatching(/needs a helper with you/) }));
    const offer = () => http().post(`/v1/sbg/dispatch/freight/${sofaId}/proposals`).set(bearer(juma.token)).send({ from, price: 2500 });
    const refused = await offer();
    expect([refused.status, refused.body.code]).toEqual([400, 'VEHICLE_MISSING_CAPABILITY']);
    // Their own word, from their own sign-in; nobody else's.
    const helpers = `/v1/sbg/fleet/drivers/${encodeURIComponent(juma.did)}/helpers`;
    await http().put(helpers).set(bearer(juma.token)).send({ helpers: 3 }).expect(400);
    expect((await http().put(helpers).set(bearer(juma.token)).send({ helpers: 1 }).expect(200)).body).toEqual({ helpers: 1 });
    const someoneElse = await aVanDriver();
    await http().put(helpers).set(bearer(someoneElse.token)).send({ helpers: 0 }).expect(403);
    expect((await http().get(`/v1/sbg/fleet/drivers/${encodeURIComponent(juma.did)}/session`).set(bearer(juma.token)).expect(200)).body.helpers).toBe(1);
    expect((await board(juma)).find((r) => r.freightId === sofaId)!.blockers.map((b) => b.code)).not.toContain('WORK_NOT_COVERED');
    await offer().expect(201);
  });

  it('3 · a long item and a load space too short, where its length is known; unknown, nothing is guessed', async () => {
    const wardrobe = (await post(biz, { ...sofa, description: 'A wardrobe, flat', dimensionsCm: { l: 280, w: 60, h: 20 }, work: { needs: 'two', pickup: { hands: 'one' }, delivery: { hands: 'one' } } }).expect(201)).body;
    expect((await board(juma)).find((r) => r.freightId === wardrobe.freightId)!.work?.marks).toEqual(['long']);
    await http().patch(`/v1/sbg/vehicles/${juma.vehicleId}/load-space`).set(bearer(juma.token)).send({ loadLengthM: 2.5 }).expect(200);
    const row = (await board(juma)).find((r) => r.freightId === wardrobe.freightId)!;
    expect(row.blockers).toContainEqual(expect.objectContaining({ code: 'WORK_NOT_COVERED', message: 'The longest item is 2.8 m and your load space is 2.5 m long' }));
    await http().patch(`/v1/sbg/vehicles/${juma.vehicleId}/load-space`).set(bearer(juma.token)).send({ loadLengthM: null }).expect(200);
    expect((await board(juma)).find((r) => r.freightId === wardrobe.freightId)!.blockers.map((b) => b.code)).not.toContain('WORK_NOT_COVERED');
  });

  it('4 · the consignment note says how it is handled, what each end has, and what the driver brings', async () => {
    const note = (await http().get(`/v1/sbg/dispatch/freight/${sofaId}/consignment-note`).set(bearer(biz)).expect(200)).body as { instructions: string[] };
    expect(note.instructions).toEqual(expect.arrayContaining(['Keep upright', 'Needs blankets or wrapping', 'At pickup: floor 3, no lift; carried 30 m; the driver brings a helper', 'At delivery: the receiver unloads']));
  });
});
