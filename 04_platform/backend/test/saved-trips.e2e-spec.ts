import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { declared } from './declared';
import { DriverService } from '../src/modules/pudo/driver.service';

/**
 * SAVED TRIPS, OVER THE WIRE (the owner, 2026-11-12: "much like an alarm driving route a to b monday to saturday from 5:30
 * AM and from b to a monday to saturday from 16:00 PM"). A driver saves, reads, changes, skips, pauses and deletes their own;
 * another driver may not touch them; a fleet's driver is told their fleet sets their trips.
 */
describe('a driver’s saved trips', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

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

  it('saves A → B Mon–Sat 05:30 and B → A 16:00, changes, skips, pauses and deletes them; others may not', async () => {
    const drivers = app.get(DriverService);
    const own = drivers.register({ displayName: 'Trip', fullName: 'Trip Driver', nationalId: `TRIP-${digits()}`, mobile: `+2547${digits()}`, licenceClasses: ['bike'] });
    const other = drivers.register({ displayName: 'Other', fullName: 'Other Driver', nationalId: `TRIP-${digits()}`, mobile: `+2547${digits()}`, licenceClasses: ['bike'] });
    const asOwn = bearer((await http().post('/v1/auth/token').send({ role: 'driver', did: own.did }).expect(201)).body.access_token);
    const asOther = bearer((await http().post('/v1/auth/token').send({ role: 'driver', did: other.did }).expect(201)).body.access_token);
    declared(app, 'driver', own.did, other.did);
    const trips = `/v1/sbg/fleet/drivers/${own.did}/trips`;
    const there = { fromLabel: 'Nairobi', fromLat: -1.286, fromLng: 36.817, toLabel: 'Nakuru', toLat: -0.303, toLng: 36.08, days: [1, 2, 3, 4, 5, 6], startTime: '05:30', zone: 'Africa/Nairobi' };

    const a = (await http().post(trips).set(asOwn).send(there).expect(201)).body;
    expect(a).toMatchObject({ setBy: 'driver', mine: true, startTime: '05:30', days: [1, 2, 3, 4, 5, 6], zone: 'Africa/Nairobi', from: { label: 'Nairobi' }, to: { label: 'Nakuru' } });
    expect(a.next).toMatchObject({ clock: '05:30' });
    await http().post(trips).set(asOwn).send({ ...there, fromLabel: 'Nakuru', fromLat: -0.303, fromLng: 36.08, toLabel: 'Nairobi', toLat: -1.286, toLng: 36.817, startTime: '16:00' }).expect(201);
    expect((await http().get(trips).set(asOwn).expect(200)).body).toHaveLength(2);
    // Refused at the door: a time that is not one, a day that is not one, no day at all.
    await http().post(trips).set(asOwn).send({ ...there, startTime: '5:30pm' }).expect(400);
    await http().post(trips).set(asOwn).send({ ...there, days: [7] }).expect(400);
    await http().post(trips).set(asOwn).send({ ...there, days: [] }).expect(400);

    // Changed, a day skipped and driven after all, paused and resumed.
    expect((await http().patch(`${trips}/${a.tripId}`).set(asOwn).send({ ...there, startTime: '06:00' }).expect(200)).body.startTime).toBe('06:00');
    const day = a.next.day as string;
    expect((await http().post(`${trips}/${a.tripId}/skip`).set(asOwn).send({ day }).expect(201)).body.skips).toEqual([day]);
    expect((await http().post(`${trips}/${a.tripId}/skip`).set(asOwn).send({ day, skip: false }).expect(201)).body.skips).toEqual([]);
    expect((await http().post(`${trips}/${a.tripId}/pause`).set(asOwn).send({ paused: true }).expect(201)).body).toMatchObject({ paused: true });
    expect((await http().post(`${trips}/${a.tripId}/pause`).set(asOwn).send({ paused: false }).expect(201)).body).toMatchObject({ paused: false });

    // Another driver may not read or touch them.
    await http().get(trips).set(asOther).expect(403);
    await http().delete(`${trips}/${a.tripId}`).set(asOther).expect(403);
    await http().patch(`/v1/sbg/fleet/drivers/${other.did}/trips/${a.tripId}`).set(asOther).send(there).expect(404);

    await http().delete(`${trips}/${a.tripId}`).set(asOwn).expect(200);
    expect((await http().get(trips).set(asOwn).expect(200)).body).toHaveLength(1);
  });
});
