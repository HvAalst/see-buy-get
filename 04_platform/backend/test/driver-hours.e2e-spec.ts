import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FleetService, MIN_REST_HOURS } from '../src/modules/pudo/fleet.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { NotificationDispatcher } from '../src/modules/pudo/notification-dispatcher.service';
import { AGREED } from './agreed';

/**
 * A DRIVER IS TOLD ABOUT THEIR HOURS — through the booted application, over HTTP.
 *
 * The unit spec proves the clock on the real services. This proves what it cannot: that the driver's own session
 * carries until when they rest; that "tell me when I can start" is the DRIVER's to ask and nobody else's; and that
 * what the sweep says arrives in the inbox their app reads.
 */
describe('a driver’s hours, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const PIN = '48261';
  const H = 3_600_000;
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

  /** A courier who rides for themselves, signed in to the driver app, with a bike of their own. */
  async function aCourier(): Promise<{ did: string; token: string; vehicleId: string }> {
    const phone = `+2547${digits()}1`;
    const onboarded = await http().post('/v1/sbg/drivers/onboard').set(bearer(operator)).send({ displayName: 'Njeri', fullName: 'Njeri Rider', nationalId: `ID-HRS-${digits()}`, mobile: phone, licenceClasses: ['bike'], jurisdiction: 'KE' }).expect(201);
    const did = onboarded.body.did as string;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `hrs${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201);
    const session = await http().post('/v1/sbg/drivers/session').send({ phone, pin: PIN, device: enrolled.body.device }).expect(201);
    const bike = app.get(VehicleService).register({ plate: `HRS-${digits()}`, vehicleClass: 'bike', capacityKg: 30, ownerName: 'Njeri Rider', ownerDriverDid: did } as never);
    return { did, token: session.body.token.access_token as string, vehicleId: bike.vehicleId };
  }
  /** A working day done: a ten-hour shift that ended that long ago. (No shift lasts ten hours inside a test.) */
  function aDayDone(c: { did: string; vehicleId: string }, endedHoursAgo: number): number {
    const fleet = app.get(FleetService);
    fleet.couple(c.did, c.vehicleId);
    const shift = fleet.activeForDriver(c.did)!;
    fleet.uncouple(c.did);
    const ended = Date.now() - endedHoursAgo * H;
    shift.startedAt = new Date(ended - 10 * H).toISOString();
    shift.endedAt = new Date(ended).toISOString();
    return ended;
  }
  const hoursOf = async (c: { did: string; token: string }) => (await http().get(`/v1/sbg/fleet/drivers/${c.did}/session`).set(bearer(c.token)).expect(200)).body.hours as { restUntil?: string; tellWhenRested?: boolean; restHours: number };
  const inboxOf = async (c: { token: string }) => {
    const res = await http().get('/v1/sbg/notifications/inbox').set(bearer(c.token)).expect(200);
    return ((res.body.items ?? res.body) as Array<{ kind: string; title: string }>).filter((n) => n.kind === 'shift_hours');
  };

  it('the driver’s own session says until when they rest; only they may ask to be told; and what the clock says reaches their inbox', async () => {
    const njeri = await aCourier();
    const other = await aCourier();

    // Nothing to wait for yet: no rest is shown, and asking is refused for that reason.
    expect((await hoursOf(njeri)).restUntil).toBeUndefined();
    expect((await http().post(`/v1/sbg/fleet/drivers/${njeri.did}/rest/tell-me`).set(bearer(njeri.token))).body).toMatchObject({ code: 'INVALID_STATE', message: 'You are not resting: you can start a shift now' });

    // A working day that ended two hours ago: the session says when they can start again, without their trying.
    const ended = aDayDone(njeri, 2);
    const until = new Date(ended + MIN_REST_HOURS * H).toISOString();
    expect(await hoursOf(njeri)).toMatchObject({ restHours: 9, restUntil: until });
    expect((await hoursOf(njeri)).tellWhenRested).toBeUndefined();

    // "Tell me when I can start" is the driver's own to ask: not another driver's, not an anonymous caller's.
    await http().post(`/v1/sbg/fleet/drivers/${njeri.did}/rest/tell-me`).set(bearer(other.token)).expect(403);
    await http().post(`/v1/sbg/fleet/drivers/${njeri.did}/rest/tell-me`).expect(401);
    expect((await hoursOf(njeri)).tellWhenRested).toBeUndefined();
    const asked = await http().post(`/v1/sbg/fleet/drivers/${njeri.did}/rest/tell-me`).set(bearer(njeri.token)).expect(201);
    expect(asked.body).toMatchObject({ restUntil: until, tellWhenRested: true });
    expect(await hoursOf(njeri)).toMatchObject({ restUntil: until, tellWhenRested: true });

    // Somebody who simply tries to start, and is turned away for rest, has asked by trying — and is told they will hear.
    aDayDone(other, 1); // an hour ago: their rest ends after Njeri's, so the sweep below is not yet theirs
    const refused = await http().post(`/v1/sbg/fleet/drivers/${other.did}/start-session`).set(bearer(other.token)).send({ vehicleId: other.vehicleId, pin: PIN });
    expect(refused.body).toMatchObject({ code: 'HOURS_EXCEEDED', message: expect.stringContaining('We will tell you when you can start.') });
    expect((await hoursOf(other)).tellWhenRested).toBe(true);

    // The clock comes round a minute after the rest is over: it is in the inbox their app reads, and nobody else's.
    expect(await inboxOf(njeri)).toEqual([]);
    expect(await app.get(NotificationDispatcher).sweepHours(ended + MIN_REST_HOURS * H + 60_000)).toBe(1);
    expect((await inboxOf(njeri)).map((n) => n.title)).toEqual(['Your rest is over']);
    expect(await inboxOf(other)).toEqual([]);
    expect(await app.get(NotificationDispatcher).sweepHours(ended + MIN_REST_HOURS * H + 120_000)).toBe(0);
  });

  it('on shift past the limit: the session says so, and the driver has been told', async () => {
    const amos = await aCourier();
    const fleet = app.get(FleetService);
    fleet.couple(amos.did, amos.vehicleId);
    fleet.activeForDriver(amos.did)!.startedAt = new Date(Date.now() - 13.5 * H).toISOString();
    expect(await app.get(NotificationDispatcher).sweepHours()).toBeGreaterThanOrEqual(1);
    const session = (await http().get(`/v1/sbg/fleet/drivers/${amos.did}/session`).set(bearer(amos.token)).expect(200)).body;
    expect(session.hours).toMatchObject({ limit: 13, over: true });
    expect(session.hours.restUntil).toBeUndefined();
    expect((await inboxOf(amos)).map((n) => n.title)).toEqual(['You have reached the shift limit']);
    // Nothing of the bookkeeping rides on the shift itself.
    expect(JSON.stringify(session.assignment)).not.toMatch(/told|hoursNear|hoursOver/i);
    fleet.uncouple(amos.did);
  });
});
