import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { BORDER_DWELL_H, VEHICLE_SPEED_KMH } from '../src/modules/pudo/pudo.config';
import { HeuristicRouter } from '../src/modules/pudo/router';

/**
 * THE PROMISE LEARNS THE ROAD, over the wire (round 21, the user: "The promise learns lanes"; "Five in 90 days"). A
 * business's loads Nairobi to Kampala: four finished trucks and the promise keeps the standard pace, saying so; a fifth
 * that counts (one with a failed delivery does not) and the next load on the road is expected at the middle of their
 * pace — on its country pair, since the gazetteer names no Kampala — in the business's list and on the tracking page.
 */
describe('the promise learns the road, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const tag = Math.random().toString(36).slice(2, 8);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const NAIROBI = { lat: -1.2864, lng: 36.8172 };
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
  });

  afterAll(async () => {
    await app?.close();
  });

  it('keeps the standard pace on four trips, says so — and learns the lane’s own on the fifth that counts', async () => {
    const phone = `+2547${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}9`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `lane-${tag}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    const biz = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `Lake Traders ${tag}`, country: 'KE', registrationNo: `LANE-${tag}`, activities: ['shipper'], yourName: 'Owner' }).expect(201)).body.token.access_token as string;
    const post = async () =>
      (
        await http()
          .post('/v1/sbg/dispatch/freight')
          .set(bearer(biz))
          .send({ description: 'Tea, bagged', pickupLocation: NAIROBI, pickupLabel: 'Nairobi', destLabel: 'Kampala', destLocation: KAMPALA, weightKg: 900, packaging: 'bagged', packages: 10, pickupCountry: 'KE', destCountry: 'UG' })
          .expect(201)
      ).body as { freightId: string; trackingKey: string };
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    const carriage = { vehicleId: 'veh_l', plate: 'KDL 210L', vehicleClass: 'truck', driverDid: 'did:glos:lane-driver', at: iso(Date.now()) };
    const roadKm = new HeuristicRouter().roadKm(NAIROBI, KAMPALA);
    /** A load that went Nairobi to Kampala at `kmh` door to door, delivered `daysAgo` days ago. */
    const finished = async (kmh: number, daysAgo: number, over: Record<string, unknown> = {}) => {
      const { freightId } = await post();
      const deliveredAt = Date.now() - daysAgo * 24 * H;
      store.set(freightId, { ...store.get(freightId), status: 'delivered', claimedBy: 'did:glos:lane-driver', carriage, pickedUpAt: iso(deliveredAt - (roadKm / kmh) * H), deliveredAt: iso(deliveredAt), ...over });
    };
    for (const [kmh, ago] of [[30, 1], [26, 2], [34, 3], [38, 4]] as const) await finished(kmh, ago);
    await finished(5, 5, { deliveryAttempts: [{ at: iso(Date.now()), outcome: 'nobody_there' }] }); // tried and failed first: not the road's pace

    const onRoad = await post();
    const pickedUpAt = Date.now() - 2 * H;
    store.set(onRoad.freightId, { ...store.get(onRoad.freightId), status: 'in_transit', claimedBy: 'did:glos:lane-driver', carriage, pickedUpAt: iso(pickedUpAt) });
    const row = async () => ((await http().get('/v1/sbg/dispatch/posted').set(bearer(biz)).expect(200)).body.items as Array<{ freightId: string; crossing?: { expectedAt?: string; drive?: Record<string, unknown> } }>).find((r) => r.freightId === onRoad.freightId)!;

    // Four that count: the standard, said as such.
    const before = await row();
    expect(before.crossing!.drive).toEqual({ kmh: VEHICLE_SPEED_KMH.truck, basis: 'standard' });
    expect(Date.parse(before.crossing!.expectedAt!)).toBeCloseTo(pickedUpAt + (roadKm / VEHICLE_SPEED_KMH.truck + BORDER_DWELL_H) * H, -4);

    // A fifth that counts: the middle of the five, on Kenya to Uganda.
    await finished(32, 6);
    const after = await row();
    expect(after.crossing!.drive).toEqual({ kmh: 32, basis: 'measured', trips: 5, lane: 'KE → UG', level: 'countries' });
    expect(Date.parse(after.crossing!.expectedAt!)).toBeCloseTo(pickedUpAt + (roadKm / 32 + BORDER_DWELL_H) * H, -4);
    // The tracking page says the same.
    expect((await http().get(`/v1/sbg/track/${onRoad.trackingKey}`).expect(200)).body.crossing).toMatchObject({ expectedAt: after.crossing!.expectedAt, drive: { basis: 'measured', trips: 5 } });
  });
});
