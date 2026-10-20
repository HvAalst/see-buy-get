import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { HANDOVER_BUFFER_H, VEHICLE_SPEED_KMH } from '../src/modules/pudo/pudo.config';
import { HeuristicRouter } from '../src/modules/pudo/router';

/**
 * A LOAD IN ONE COUNTRY IS PROMISED A TIME, over the wire (round 26, the user: "A promise for a load in one country"; "The
 * standard pace, said as standard"). A business's loads Nairobi to Nakuru: on the road with four finished trucks behind
 * it, it is expected at the standard pace with the half hour at the door, and says so; a fifth trip and the lane's own
 * pace — door to door, nothing added. From a hub its driver said, from there. The carrier's own planned hour is said
 * instead, nothing after a door nobody answered, and a load that crosses a border keeps its crossing's promise.
 */
describe('a load in one country is promised a time, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator = '';
  const tag = Math.random().toString(36).slice(2, 8);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const NAIROBI = { lat: -1.2864, lng: 36.8172 };
  const NAKURU = { lat: -0.3031, lng: 36.08 };
  const NAIVASHA = { lat: -0.7167, lng: 36.431 };
  const KAMPALA = { lat: 0.347, lng: 32.582 };
  const H = 3_600_000;
  const iso = (ms: number) => new Date(ms).toISOString();

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

  it('promises the standard pace with the door until five trips are measured, then the lane’s own — from the last hub its driver said', async () => {
    const phone = `+2547${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}8`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `arrival-${tag}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    const biz = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `Rift Millers ${tag}`, country: 'KE', registrationNo: `ARR-${tag}`, activities: ['shipper'], yourName: 'Owner' }).expect(201)).body.token.access_token as string;
    const onboarded = await http().post('/v1/sbg/drivers/onboard').set(bearer(operator)).send({ displayName: 'Mwangi', fullName: 'Mwangi Truck', nationalId: `DRV-ARR-${tag}`, mobile: `+2547${String(Date.now()).slice(-6)}4`, licenceClasses: ['truck'], licenceNumber: `DL-ARR-${tag}`, licenceExpiresAt: '2030-01-01' }).expect(201);
    const driver = { did: onboarded.body.did as string, token: (await http().post('/v1/auth/token').send({ role: 'driver', did: onboarded.body.did, type: 'client_credentials' }).expect(201)).body.access_token as string };
    const post = async (to = NAKURU, extra: Record<string, unknown> = {}) =>
      (await http().post('/v1/sbg/dispatch/freight').set(bearer(biz)).send({ description: 'Maize flour, bagged', pickupLocation: NAIROBI, pickupLabel: 'Nairobi mill', destLabel: 'Nakuru depot', destLocation: to, weightKg: 900, packaging: 'bagged', packages: 10, ...extra }).expect(201)).body as { freightId: string; trackingKey: string };
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    const carriage = { vehicleId: 'veh_a', plate: 'KDA 260A', vehicleClass: 'truck', driverDid: driver.did, at: iso(Date.now()) };
    const roadKm = new HeuristicRouter().roadKm(NAIROBI, NAKURU);
    /** A load that went Nairobi to Nakuru at `kmh` door to door, delivered `daysAgo` days ago. */
    const finished = async (kmh: number, daysAgo: number) => {
      const { freightId } = await post();
      const deliveredAt = Date.now() - daysAgo * 24 * H;
      store.set(freightId, { ...store.get(freightId), status: 'delivered', claimedBy: driver.did, carriage, pickedUpAt: iso(deliveredAt - (roadKm / kmh) * H), deliveredAt: iso(deliveredAt) });
    };
    const onTheRoad = async (load: { freightId: string }, pickedUpAt: number, over: Record<string, unknown> = {}) =>
      store.set(load.freightId, { ...store.get(load.freightId), status: 'in_transit', claimedBy: driver.did, carriage, pickedUpAt: iso(pickedUpAt), ...over });
    const row = async (freightId: string) => ((await http().get('/v1/sbg/dispatch/posted').set(bearer(biz)).expect(200)).body.items as Array<Record<string, any>>).find((r) => r.freightId === freightId)!;

    for (const [kmh, ago] of [[30, 1], [26, 2], [34, 3], [38, 4]] as const) await finished(kmh, ago);
    const load = await post();
    const pickedUpAt = Date.now() - 2 * H;
    await onTheRoad(load, pickedUpAt);

    // Four that count: the standard pace, said as such, with the half hour at the door.
    const before = await row(load.freightId);
    expect(before.crossing).toBeUndefined();
    expect(before.arrival.drive).toEqual({ kmh: VEHICLE_SPEED_KMH.truck, basis: 'standard' });
    expect(before.arrival.doorMin).toBe(HANDOVER_BUFFER_H * 60);
    expect(Date.parse(before.arrival.expectedAt)).toBeCloseTo(pickedUpAt + (roadKm / VEHICLE_SPEED_KMH.truck + HANDOVER_BUFFER_H) * H, -4);

    // A fifth that counts: the middle of the five on Nairobi → Nakuru, door to door — nothing added.
    await finished(32, 6);
    const after = await row(load.freightId);
    expect(after.arrival.drive).toEqual({ kmh: 32, basis: 'measured', trips: 5, lane: 'Nairobi → Nakuru', level: 'towns' });
    expect(after.arrival.doorMin).toBeUndefined();
    expect(Date.parse(after.arrival.expectedAt)).toBeCloseTo(pickedUpAt + (roadKm / 32) * H, -4);
    // The tracking page says the same.
    expect((await http().get(`/v1/sbg/track/${load.trackingKey}`).expect(200)).body.arrival).toMatchObject({ expectedAt: after.arrival.expectedAt, drive: { basis: 'measured', trips: 5 } });

    // Its driver says it is at the Naivasha hub, half an hour ago: from there, from that place.
    const atHub = Date.now() - 30 * 60_000;
    await http().post(`/v1/sbg/dispatch/freight/${load.freightId}/passages`).set(bearer(driver.token)).send({ kind: 'at_hub', hub: 'Naivasha depot', location: NAIVASHA, observedAt: iso(atHub) }).expect(201);
    const fromHub = await row(load.freightId);
    expect(Date.parse(fromHub.arrival.expectedAt)).toBeCloseTo(atHub + (new HeuristicRouter().roadKm(NAIVASHA, NAKURU) / 32) * H, -4);
  });

  it('says the carrier’s planned hour instead, nothing after a door nobody answered, and a crossing’s own promise across a border', async () => {
    const phone = `+2547${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}7`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `arrival2-${tag}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    const biz = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `Lake Millers ${tag}`, country: 'KE', registrationNo: `ARR2-${tag}`, activities: ['shipper'], yourName: 'Owner' }).expect(201)).body.token.access_token as string;
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    const carriage = { vehicleId: 'veh_b', plate: 'KDB 261B', vehicleClass: 'truck', driverDid: 'did:glos:arr-driver', at: iso(Date.now()) };
    const post = async (to: { lat: number; lng: number }, extra: Record<string, unknown> = {}) =>
      (await http().post('/v1/sbg/dispatch/freight').set(bearer(biz)).send({ description: 'Sugar, bagged', pickupLocation: NAIROBI, pickupLabel: 'Nairobi', destLabel: 'There', destLocation: to, weightKg: 500, packaging: 'bagged', packages: 5, ...extra }).expect(201)).body as { freightId: string };
    const onTheRoad = (freightId: string, over: Record<string, unknown> = {}) =>
      store.set(freightId, { ...store.get(freightId), status: 'in_transit', claimedBy: 'did:glos:arr-driver', carriage, pickedUpAt: iso(Date.now() - H), ...over });
    const rows = async () => (await http().get('/v1/sbg/dispatch/posted').set(bearer(biz)).expect(200)).body.items as Array<Record<string, any>>;

    const day = new Date(Date.now() + 24 * H).toISOString().slice(0, 10);
    const planned = await post(NAKURU);
    onTheRoad(planned.freightId, { deliverOn: day, planned: { day, vehicleId: 'veh_b', plate: 'KDB 261B', tripNo: 1, seq: 1, arrive: '14:30', at: iso(Date.now()) } });
    const knocked = await post(NAKURU);
    onTheRoad(knocked.freightId, { deliveryAttempts: [{ at: iso(Date.now() - 10 * 60_000), outcome: 'nobody_there' }] });
    const across = await post(KAMPALA, { pickupCountry: 'KE', destCountry: 'UG' });
    onTheRoad(across.freightId);
    const all = await rows();
    const of = (id: string) => all.find((r) => r.freightId === id)!;
    expect(of(planned.freightId).arrival).toBeUndefined();
    expect(of(knocked.freightId).arrival).toBeUndefined();
    expect(of(across.freightId).arrival).toBeUndefined();
    expect(of(across.freightId).crossing.expectedAt).toBeDefined();
  });
});
