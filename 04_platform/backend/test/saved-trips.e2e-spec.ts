import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { declared } from './declared';
import { DriverService } from '../src/modules/pudo/driver.service';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';

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

  /** Part 2 — a fleet sets its driver's trips; the driver sees them, never changes them; another fleet sees nothing. */
  it('a fleet sets a trip for its own driver — read by the driver, changed only by the fleet; never another fleet’s driver', async () => {
    const managers = app.get(FleetManagerService);
    const aFleet = async () => {
      const n = digits();
      const m = managers.register({ companyName: `Trip Haulage ${n}`, contactPhone: `+2548${n}`, contactEmail: `trip-${n}@example.com`, ownerFullName: 'O O', ownerNationalId: `MGR-TR-${n}`, location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-TR-${n}`, transportOperatorLicence: `TOL-TR-${n}`, taxId: `TAX-TR-${n}` } } as never);
      managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
      managers.decideKyc(m.did, true);
      managers.recordBond(m.did);
      return { did: m.did, token: bearer((await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token) };
    };
    const fleet = await aFleet();
    const rival = await aFleet();
    const drivers = app.get(DriverService);
    const amos = drivers.register({ displayName: 'Amos', fullName: 'Amos Fleet', nationalId: `TRF-${digits()}`, mobile: `+2547${digits()}`, licenceClasses: ['bike'], managerDid: fleet.did } as never);
    const asAmos = bearer((await http().post('/v1/auth/token').send({ role: 'driver', did: amos.did, tenant: fleet.did }).expect(201)).body.access_token);
    declared(app, 'driver', amos.did);
    const trip = { driverDid: amos.did, fromLabel: 'Depot', fromLat: -1.3, fromLng: 36.85, toLabel: 'Market', toLat: -1.25, toLng: 36.8, days: [1, 2, 3, 4, 5], startTime: '06:00' };

    const made = (await http().post('/v1/sbg/fleet/trips').set(fleet.token).send(trip).expect(201)).body;
    expect(made).toMatchObject({ setBy: 'fleet', driverDid: amos.did, driverName: 'Amos', mine: false, startTime: '06:00' });
    expect((await http().get('/v1/sbg/fleet/trips').set(fleet.token).expect(200)).body.map((x: { tripId: string }) => x.tripId)).toEqual([made.tripId]);
    // Another fleet: sees nothing, may not set a trip for this fleet's driver, nor touch this trip.
    expect((await http().get('/v1/sbg/fleet/trips').set(rival.token).expect(200)).body).toEqual([]);
    await http().post('/v1/sbg/fleet/trips').set(rival.token).send(trip).expect(403);
    await http().delete(`/v1/sbg/fleet/trips/${made.tripId}`).set(rival.token).expect(404);
    // The driver reads it; cannot change it, nor save one of their own; cannot reach the fleet's list.
    const theirs = (await http().get(`/v1/sbg/fleet/drivers/${amos.did}/trips`).set(asAmos).expect(200)).body;
    expect(theirs).toEqual([expect.objectContaining({ tripId: made.tripId, setBy: 'fleet', mine: false })]);
    expect((await http().post(`/v1/sbg/fleet/drivers/${amos.did}/trips/${made.tripId}/pause`).set(asAmos).send({ paused: true }).expect(403)).body.detail).toMatch(/Your fleet set this trip/);
    expect((await http().post(`/v1/sbg/fleet/drivers/${amos.did}/trips`).set(asAmos).send({ ...trip, driverDid: undefined }).expect(403)).body.detail).toMatch(/Your fleet sets your trips/);
    await http().get('/v1/sbg/fleet/trips').set(asAmos).expect(403);
    // The fleet pauses, skips a day and deletes it.
    expect((await http().post(`/v1/sbg/fleet/trips/${made.tripId}/pause`).set(fleet.token).send({ paused: true }).expect(201)).body.paused).toBe(true);
    expect((await http().delete(`/v1/sbg/fleet/trips/${made.tripId}`).set(fleet.token).expect(200)).body).toEqual({ removed: true, kept: 0 });
  });
});
