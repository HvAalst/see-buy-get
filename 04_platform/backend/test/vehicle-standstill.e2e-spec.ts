import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { FleetHookService } from '../src/modules/pudo/fleet-hooks.service';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';
import { VehicleStandstillService } from '../src/modules/pudo/vehicle-standstill.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';

/**
 * A VEHICLE STANDING STILL, over the wire (the user, round 16: "A watch on stopped vehicles"; "The fleet's managers";
 * "Each fleet sets it; 45 min to start"). A Kilima truck on a shift reports where it is through the driver app's own
 * door; time is moved on in the running app's watch (the minutes cannot be waited for); from there it is the booted app:
 * the case its office reads, the bell, its own system told, the answer, the setting — and the driver told.
 */
describe('a vehicle standing still, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator = '';
  const tag = Math.random().toString(36).slice(2, 8);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const PIN = '48261';
  let receiver: Server;
  let origin = '';
  const landed: Array<{ event: string; raw: string }> = [];

  beforeAll(async () => {
    receiver = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        landed.push({ event: String(req.headers['x-sbg-event']), raw: Buffer.concat(chunks).toString() });
        res.writeHead(200);
        res.end();
      });
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    const a = receiver.address();
    origin = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
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
    await new Promise<void>((r) => receiver.close(() => r()));
  });

  /** An active fleet, and its office signed in. */
  async function aFleet(name: string): Promise<{ did: string; office: string; name: string }> {
    const managers = app.get(FleetManagerService);
    const n = digits();
    const m = managers.register({
      companyName: `${name} ${n}`, contactPhone: `+2548${n}4`, contactEmail: `still-${tag}-${n}@example.com`, ownerFullName: 'O O', ownerNationalId: `MGR-STL-${n}`, location: { lat: -1.2, lng: 36.8 },
      requirements: { businessRegistrationNo: `BRN-STL-${n}`, transportOperatorLicence: `TOL-STL-${n}`, taxId: `TAX-STL-${n}` },
    });
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    const office = (await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    return { did: m.did, office, name: m.companyName };
  }

  /** One of a fleet's drivers, signed in to the driver app, out on a shift in one of its trucks. */
  async function onShiftIn(fleetDid: string, fleetName: string): Promise<{ did: string; token: string; plate: string }> {
    const n = digits();
    const phone = `+2547${digits()}5`;
    const onboarded = await http().post('/v1/sbg/drivers/onboard').set(bearer(operator)).send({ displayName: 'Otieno', fullName: 'Otieno Driver', nationalId: `ID-STL-${n}`, mobile: phone, licenceClasses: ['truck'], licenceNumber: `L-STL-${n}`, licenceExpiresAt: new Date(Date.now() + 400 * 86_400_000).toISOString(), criminalRecordClear: true, managerDid: fleetDid }).expect(201);
    const did = onboarded.body.did as string;
    await http().post(`/v1/sbg/fleet/drivers/${did}/submit-kyc`).set(bearer(operator)).send({ idCopyRef: 'id.jpg', licenceCopyRef: 'licence.jpg' }).expect(201);
    await http().post(`/v1/sbg/fleet/drivers/${did}/kyc-decision`).set(bearer(operator)).send({ approve: true, by: 'Test' }).expect(201);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `stldrv${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201);
    const session = await http().post('/v1/sbg/drivers/session').send({ phone, pin: PIN, device: enrolled.body.device }).expect(201);
    const token = session.body.token.access_token as string;
    const plate = `STL ${n.slice(-3)}T`;
    const truck = app.get(VehicleService).register({ plate, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 8000, ownerName: fleetName, equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, managerDid: fleetDid } as never);
    await http().post(`/v1/sbg/fleet/drivers/${did}/start-session`).set(bearer(token)).send({ vehicleId: truck.vehicleId, pin: PIN }).expect(201);
    return { did, token, plate };
  }

  it('a truck standing away from any stop opens a case for its office: told, answered, set — and the driver knows', async () => {
    const fleet = await aFleet('Kilima Logistics');
    const rival = await aFleet('Rival Hauliers');
    const own = `/v1/sbg/fleet/managers/${encodeURIComponent(fleet.did)}`;
    await http().put(`${own}/system`).set(bearer(fleet.office)).send({ url: `${origin}/a` }).expect(200);
    const driver = await onShiftIn(fleet.did, fleet.name);

    // Every fleet starts with the watch on at 45 minutes; the driver's app is told.
    expect((await http().get(`${own}/standstill`).set(bearer(fleet.office)).expect(200)).body).toEqual({ settings: { on: true, afterMin: 45, asStarted: true, silent: { on: true, afterMin: 60, asStarted: true } }, cases: [] });
    expect((await http().get(`/v1/sbg/fleet/drivers/${driver.did}/session`).set(bearer(driver.token)).expect(200)).body.standstillWatchMin).toBe(45);

    // The phone says where it is, through the driver app's own door — out on the Nakuru road, nowhere it has reason to be.
    const road = { lat: -0.3031, lng: 36.08 };
    await http().post(`/v1/sbg/fleet/drivers/${driver.did}/locate`).set(bearer(driver.token)).send(road).expect(201);
    const watch = app.get(VehicleStandstillService);
    const t0 = Date.now();
    for (let m = 4; m <= 44; m += 4) watch.track(driver.did, { lat: road.lat + 0.0005, lng: road.lng }, t0 + m * 60_000);
    expect(watch.sweep(t0 + 44 * 60_000)).toEqual([]);
    const [opened] = watch.sweep(t0 + 46 * 60_000);
    expect(opened).toMatchObject({ plate: driver.plate, driverName: 'Otieno' });

    // Its office reads the case; its bell rings; its own system is told — and nobody else's.
    const read = (await http().get(`${own}/standstill`).set(bearer(fleet.office)).expect(200)).body;
    expect(read.cases).toEqual([expect.objectContaining({ caseId: opened.caseId, plate: driver.plate, state: 'open', afterMin: 45, location: road })]);
    expect(JSON.stringify((await http().get('/v1/sbg/notifications/inbox').set(bearer(fleet.office)).expect(200)).body)).toContain(`${driver.plate} has stood still`);
    await app.get(FleetHookService).drain();
    expect(landed.map((l) => l.event)).toContain('vehicle.standing_still');
    expect(JSON.parse(landed.find((l) => l.event === 'vehicle.standing_still')!.raw).data.case).toMatchObject({ caseId: opened.caseId, plate: driver.plate });
    await http().get(`/v1/sbg/fleet/managers/${encodeURIComponent(rival.did)}/standstill`).set(bearer(rival.office)).expect(200).expect((r) => expect(r.body.cases).toEqual([]));
    await http().get(`${own}/standstill`).set(bearer(rival.office)).expect(403);

    // Staff read and change none of it.
    await http().get(`${own}/standstill`).set(bearer(operator)).expect(200);
    expect((await http().post(`${own}/standstill/${opened.caseId}/answer`).set(bearer(operator)).send({ outcome: 'all_well' }).expect(403)).body.detail).toMatch(/change none of it/);
    await http().put(`${own}/standstill/settings`).set(bearer(operator)).send({ on: false, afterMin: 45 }).expect(403);

    // The office called the driver: something wrong is said in words.
    expect((await http().post(`${own}/standstill/${opened.caseId}/answer`).set(bearer(fleet.office)).send({ outcome: 'problem' }).expect(400)).body.detail).toMatch(/Say what is wrong/);
    expect((await http().post(`${own}/standstill/${opened.caseId}/answer`).set(bearer(fleet.office)).send({ outcome: 'all_well', note: 'Queue at the weighbridge' }).expect(201)).body).toMatchObject({ state: 'answered', answer: { outcome: 'all_well', note: 'Queue at the weighbridge', by: fleet.name } });
    await http().post(`/v1/sbg/fleet/managers/${encodeURIComponent(rival.did)}/standstill/${opened.caseId}/answer`).set(bearer(rival.office)).send({ outcome: 'all_well' }).expect(404);

    // It moves on: the case is over.
    watch.track(driver.did, { lat: road.lat + 0.02, lng: road.lng }, t0 + 60 * 60_000);
    expect((await http().get(`${own}/standstill`).set(bearer(fleet.office)).expect(200)).body.cases[0]).toMatchObject({ state: 'over', over: { why: 'moved' } });

    // The fleet sets its own: half an hour, or off — and the driver's app says what it is.
    await http().put(`${own}/standstill/settings`).set(bearer(fleet.office)).send({ on: true, afterMin: 10 }).expect(400);
    expect((await http().put(`${own}/standstill/settings`).set(bearer(fleet.office)).send({ on: true, afterMin: 30 }).expect(200)).body).toMatchObject({ on: true, afterMin: 30, asStarted: false, setBy: fleet.name });
    expect((await http().get(`/v1/sbg/fleet/drivers/${driver.did}/session`).set(bearer(driver.token)).expect(200)).body.standstillWatchMin).toBe(30);
    await http().put(`${own}/standstill/settings`).set(bearer(fleet.office)).send({ on: false, afterMin: 30 }).expect(200);
    expect((await http().get(`/v1/sbg/fleet/drivers/${driver.did}/session`).set(bearer(driver.token)).expect(200)).body.standstillWatchMin).toBeUndefined();
  });

  it('a truck with a reason to stand opens nothing: waiting at its load’s pickup, or at the border post its driver said it is at', async () => {
    const fleet = await aFleet('Kilima Logistics');
    const own = `/v1/sbg/fleet/managers/${encodeURIComponent(fleet.did)}`;
    const driver = await onShiftIn(fleet.did, fleet.name);
    const watch = app.get(VehicleStandstillService);
    // A shipper's load, Nairobi into Kampala, claimed by this driver.
    const phone = `+2547${digits()}6`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `stlbiz${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const person = (await http().post('/v1/sbg/identity/enroll').send({ phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201)).body.token.access_token as string;
    const biz = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `Jenga Bricks ${tag}`, country: 'KE', registrationNo: `STL-${tag}`, activities: ['shipper'], yourName: 'Wanjiku Owner' }).expect(201)).body.token.access_token as string;
    await http().post('/v1/sbg/border-rules').set(bearer(operator)).send({ from: 'KE', to: 'UG', crossings: [{ name: 'Malaba', hours: '24 hours' }], cabotage: 'allowed' }).expect(201);
    const pickup = { lat: -1.33, lng: 36.87 };
    const freightId = (
      await http()
        .post('/v1/sbg/dispatch/freight')
        .set(bearer(biz))
        .send({ description: 'Clay bricks, 3 pallets', pickupLocation: pickup, pickupLabel: 'Jenga yard', destLabel: 'Kampala depot', destLocation: { lat: 0.31, lng: 32.58 }, weightKg: 1200, packaging: 'palletised', packages: 3, pickupCountry: 'KE', destCountry: 'UG' })
        .expect(201)
    ).body.freightId as string;
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    store.set(freightId, { ...store.get(freightId), status: 'claimed', claimedBy: driver.did, claimedAt: new Date().toISOString() });

    // Waiting at the yard for the load: its pickup is its next stop.
    const t0 = Date.now();
    for (let m = 0; m <= 52; m += 4) watch.track(driver.did, { lat: pickup.lat + 0.001, lng: pickup.lng }, t0 + m * 60_000);
    const mine = (cases: Array<{ plate: string }>) => cases.filter((c) => c.plate === driver.plate);
    expect(mine(watch.sweep(t0 + 52 * 60_000))).toEqual([]);

    // Picked up hours ago and now at Malaba, said so by its driver: a queue at a border post is a reason to stand.
    const pickedUpAt = new Date(t0 - 10 * 3_600_000).toISOString();
    store.set(freightId, { ...store.get(freightId), status: 'in_transit', pickedUpAt, carriage: { vehicleId: 'veh_s', plate: driver.plate, vehicleClass: 'truck', driverDid: driver.did, at: pickedUpAt } });
    await http().post(`/v1/sbg/dispatch/freight/${freightId}/passages`).set(bearer(driver.token)).send({ kind: 'at_border', post: 'Malaba' }).expect(201);
    const malaba = { lat: 0.635, lng: 34.28 };
    for (let m = 60; m <= 120; m += 4) watch.track(driver.did, malaba, t0 + m * 60_000);
    expect(mine(watch.sweep(t0 + 120 * 60_000))).toEqual([]);
    expect((await http().get(`${own}/standstill`).set(bearer(fleet.office)).expect(200)).body.cases).toEqual([]);
  });
  it('a phone that goes silent on a shift opens a case for its office with where it was last heard: told, answered, set — over when heard again', async () => {
    const fleet = await aFleet('Kilima Logistics');
    const rival = await aFleet('Rival Hauliers');
    const own = `/v1/sbg/fleet/managers/${encodeURIComponent(fleet.did)}`;
    await http().put(`${own}/system`).set(bearer(fleet.office)).send({ url: `${origin}/s` }).expect(200);
    const driver = await onShiftIn(fleet.did, fleet.name);
    expect((await http().get(`/v1/sbg/fleet/drivers/${driver.did}/session`).set(bearer(driver.token)).expect(200)).body.silentWatchMin).toBe(60);

    // Heard on the Kisumu road, then nothing.
    const road = { lat: -0.1022, lng: 34.7617 };
    await http().post(`/v1/sbg/fleet/drivers/${driver.did}/locate`).set(bearer(driver.token)).send(road).expect(201);
    const watch = app.get(VehicleStandstillService);
    const t0 = Date.now();
    // The app is shared: earlier tests' drivers, still on a shift, are silent too — this test reads its own truck.
    const mine = (cases: Array<{ plate: string; kind?: string }>) => cases.filter((c) => c.plate === driver.plate && c.kind === 'silent');
    expect(mine(watch.sweep(t0 + 59 * 60_000))).toEqual([]);
    const [silent] = mine(watch.sweep(t0 + 61 * 60_000)) as unknown as Array<{ caseId: string }>;
    expect(silent).toMatchObject({ plate: driver.plate, location: road });

    // Its office reads it, its bell rings, its own system is told — and nobody else.
    expect((await http().get(`${own}/standstill`).set(bearer(fleet.office)).expect(200)).body.cases).toEqual([expect.objectContaining({ caseId: silent.caseId, kind: 'silent', state: 'open', afterMin: 60, location: road })]);
    expect(JSON.stringify((await http().get('/v1/sbg/notifications/inbox').set(bearer(fleet.office)).expect(200)).body)).toContain(`${driver.plate}: its phone has said nothing`);
    await app.get(FleetHookService).drain();
    const told = landed.filter((l) => l.event === 'vehicle.gone_silent').map((l) => JSON.parse(l.raw).data.case as { plate: string }).find((c) => c.plate === driver.plate);
    expect(told).toMatchObject({ caseId: silent.caseId, kind: 'silent', plate: driver.plate });
    await http().get(`${own}/standstill`).set(bearer(rival.office)).expect(403);

    // The office called: no answer.
    expect((await http().post(`${own}/standstill/${silent.caseId}/answer`).set(bearer(fleet.office)).send({ outcome: 'no_answer' }).expect(201)).body).toMatchObject({ state: 'answered', answer: { outcome: 'no_answer' } });

    // Heard again, further on: over, and where.
    const on = { lat: -0.0917, lng: 34.768 };
    watch.track(driver.did, on, t0 + 80 * 60_000);
    expect((await http().get(`${own}/standstill`).set(bearer(fleet.office)).expect(200)).body.cases[0]).toMatchObject({ kind: 'silent', state: 'over', over: { why: 'heard', location: on } });

    // Its own minutes: the office sets them; staff change none of it; the standing minutes stay as they were.
    expect((await http().put(`${own}/standstill/silence`).set(bearer(operator)).send({ on: true, afterMin: 30 }).expect(403)).body.detail).toMatch(/change none of it/);
    await http().put(`${own}/standstill/silence`).set(bearer(rival.office)).send({ on: true, afterMin: 30 }).expect(403);
    await http().put(`${own}/standstill/silence`).set(bearer(fleet.office)).send({ on: true, afterMin: 300 }).expect(400);
    expect((await http().put(`${own}/standstill/silence`).set(bearer(fleet.office)).send({ on: true, afterMin: 120 }).expect(200)).body).toMatchObject({ on: true, afterMin: 45, asStarted: true, silent: { on: true, afterMin: 120, asStarted: false, setBy: fleet.name } });
    expect((await http().get(`/v1/sbg/fleet/drivers/${driver.did}/session`).set(bearer(driver.token)).expect(200)).body).toMatchObject({ standstillWatchMin: 45, silentWatchMin: 120 });
    await http().put(`${own}/standstill/silence`).set(bearer(fleet.office)).send({ on: false, afterMin: 120 }).expect(200);
    expect((await http().get(`/v1/sbg/fleet/drivers/${driver.did}/session`).set(bearer(driver.token)).expect(200)).body.silentWatchMin).toBeUndefined();
  });
});
