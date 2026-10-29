import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { EntityService } from '../src/foundation/entity/entity.service';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { DriverService } from '../src/modules/pudo/driver.service';
import { ExportService } from '../src/modules/pudo/export.service';
import { FleetService } from '../src/modules/pudo/fleet.service';
import { ImportService } from '../src/modules/pudo/import.service';
import { NotificationService } from '../src/modules/pudo/notification.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { AGREED } from './agreed';
import { declared } from './declared';

/**
 * WHERE ROAD MEETS RAIL (the user, 2026-10-28: "I want to reduce mistakes and delays (south africa is struggling) for road
 * where road and rail comes together" — and, 2026-10-29, "build the clock with the blocker as you said"). An export by
 * rail: our truck is timed to the train's cut-off at the rail terminal. An import by rail: no truck is sent for the box
 * until the railway said it is there — unless the importer says, with a reason, to go anyway. The rail terminal's free
 * days are counted from the arrival, and warned.
 */
describe('where road meets rail, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator = '';
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const H = 3_600_000;

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

  async function aBusiness(activities: string[], called: string) {
    const phone = `+2547${digits()}5`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `rail-${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    const made = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `${called} ${digits()}`, country: 'KE', registrationNo: `RR-${digits()}`, activities, yourName: 'Wanjiku' }).expect(201)).body;
    const token = made.token.access_token as string;
    const entityId = made.business.entityId as string;
    const site = async (kind: string, name: string, location: { lat: number; lng: number }) => (await http().post(`/v1/sbg/entities/${entityId}/sites`).set(bearer(token)).send({ kind, name, location }).expect(201)).body.siteId as string;
    return { token, entityId, site };
  }
  const bell = (entityId: string) => app.get(NotificationService).inboxFor(app.get(EntityService).get(entityId).did);

  it('an export by rail: the truck is timed to the train’s cut-off at the rail terminal, which must fall before the port gate closes', async () => {
    const x = await aBusiness(['shipper'], 'Kericho Tea');
    const loading = await x.site('loading', 'Kericho warehouse', { lat: -0.37, lng: 35.28 });
    const terminal = await x.site('port', 'Kipevu container terminal', { lat: -4.05, lng: 39.65 });
    const icd = await x.site('clearance', 'Naivasha Inland Container Depot', { lat: -0.84, lng: 36.37 });
    const gate = Date.now() + 96 * H;
    const made = (await http().post('/v1/sbg/exports').set(bearer(x.token)).send({ goodsDescription: 'Black tea, 640 sacks', originCountry: 'KE', destCountry: 'NL', loadingPort: 'Mombasa', containerType: '22G1', booking: { reference: `MBA${digits()}`, bookedWith: 'forwarder', partyName: 'Pwani Forwarders', gateCutoffAt: new Date(gate).toISOString() }, loadingSiteId: loading, terminalSiteId: terminal }).expect(201)).body;
    const path = `/v1/sbg/exports/${made.exportId}`;
    const train = gate - 48 * H;

    // A train that leaves after the port gate closes is a mistake caught here, not at the quay; a past one is refused too.
    expect((await http().post(`${path}/by-rail`).set(bearer(x.token)).send({ terminalSiteId: icd, cutoffAt: new Date(gate + H).toISOString() })).body.detail).toMatch(/is not before the port gate closes/);
    expect((await http().post(`${path}/by-rail`).set(bearer(x.token)).send({ terminalSiteId: icd, cutoffAt: new Date(Date.now() - H).toISOString() })).body.detail).toMatch(/That cut-off has passed/);
    expect((await http().post(`${path}/by-rail`).set(bearer(x.token)).send({ terminalSiteId: loading, cutoffAt: new Date(train).toISOString() })).status).toBe(400);
    // Staff write nothing in its name.
    expect((await http().post(`${path}/by-rail`).set(bearer(operator)).send({ terminalSiteId: icd, cutoffAt: new Date(train).toISOString() })).status).toBe(403);

    const set = (await http().post(`${path}/by-rail`).set(bearer(x.token)).send({ terminalSiteId: icd, cutoffAt: new Date(train).toISOString(), reference: 'SGR-FRT-12' }).expect(201)).body;
    expect(set.timing.handover).toEqual({ place: 'Naivasha Inland Container Depot', cutoffAt: new Date(train).toISOString(), byRail: true });
    // The truck's leave-by is worked back from the train's cut-off, not the port gate's.
    expect(Date.parse(set.timing.leaveByAt)).toBeLessThan(train);

    await http().post(`${path}/container`).set(bearer(x.token)).send({ containerNo: 'MSCU1234566' }).expect(201);
    const posted = (await http().post(`${path}/laden-leg`).set(bearer(x.token)).send({ weightKg: 18640 }).expect(201)).body;
    const leg = app.get(DispatchService).requireFreightPublic(posted.consignment.ladenFreightId);
    expect(leg).toMatchObject({ destLabel: 'Naivasha Inland Container Depot' });
    expect(leg.instructions?.deliveryWindow).toMatch(/the train’s cut-off/);
    expect(leg.instructions?.text).toMatch(/by rail from Naivasha Inland Container Depot \(train SGR-FRT-12\) to Kipevu container terminal/);
    // Once a truck is sent, its destination stands.
    expect((await http().post(`${path}/by-rail/clear`).set(bearer(x.token))).status).toBe(409);

    // Told in the bell when the truck must leave — to the rail terminal, before the train.
    app.get(ExportService).sweep(Date.parse(set.timing.leaveByAt) - H);
    expect(bell(x.entityId).find((n) => n.title.startsWith(`${made.code}: the box must leave by`))?.body).toMatch(/To be at Naivasha Inland Container Depot before the train’s cut-off/);

    // The train brought it inside the port gate, as the exporter was told: a moment that has come.
    expect((await http().post(`${path}/by-rail/at-port`).set(bearer(x.token)).send({ at: new Date(Date.now() + 5 * H).toISOString() })).status).toBe(400);
    const atPort = (await http().post(`${path}/by-rail/at-port`).set(bearer(x.token)).send({ at: new Date().toISOString() }).expect(201)).body;
    expect(atPort.consignment.byRail.atPort.by).toBeTruthy();
  });

  it('a load waiting for a train: offered to nobody, marked on the board, refused at the take — and open once the railway said the box is there', async () => {
    const dispatch = app.get(DispatchService);
    const load = dispatch.registerFreight({ description: 'Spare parts, 12 crates', pickupLocation: { lat: -1.32, lng: 36.9 }, pickupLabel: 'Nairobi Inland Container Depot', destLabel: 'Industrial Area', destLocation: { lat: -1.3, lng: 36.85 }, weightKg: 900, packaging: 'palletised' } as never);
    expect(dispatch.setRailGate(load.freightId, { importId: 'imp_x', importCode: 'IMP-X', terminal: 'Nairobi Inland Container Depot' })).toBe(true);
    const driver = app.get(DriverService).register({ displayName: 'Rail', fullName: 'Rail Driver', nationalId: `ID-RR-${digits()}`, mobile: `+2547${digits()}7`, licenceClasses: ['truck'], licenceNumber: `L-${digits()}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    app.get(DriverService).submitKyc(driver.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    app.get(DriverService).decideKyc(driver.did, true);
    app.get(FleetService).couple(driver.did, app.get(VehicleService).register({ plate: `KDR ${digits().slice(0, 3)}R`, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT', 'FLT'], baseFee: 0.5, pricePerKm: 0.1 } as never).vehicleId);
    declared(app, 'driver', driver.did);
    // Every door a load is offered through: along a route, nearby, and the one nearest.
    const offered = () => dispatch.suggest(driver.did, { from: load.pickupLocation, to: load.pickupLocation }).some((o) => o.ref === load.freightId);
    const nearby = () => dispatch.suggestNearby(driver.did, load.pickupLocation, 50).some((o) => o.ref === load.freightId);
    const marked = () => dispatch.board({ driverDid: driver.did, from: load.pickupLocation }).find((r) => r.freightId === load.freightId)?.blockers.find((b) => b.code === 'RAIL_NOT_ARRIVED')?.message;

    expect(offered()).toBe(false);
    expect(nearby()).toBe(false);
    expect(dispatch.offerNear(driver.did, load.pickupLocation)?.ref).not.toBe(load.freightId);
    expect(marked()).toBe('The box is still on its way by rail to Nairobi Inland Container Depot: the railway has not said it is there. This load opens as soon as its arrival is recorded on IMP-X.');
    expect(() => dispatch.assign(load.freightId, driver.did, { managerDid: 'did:office:x' })).toThrow(/still on its way by rail/);

    dispatch.setRailGate(load.freightId, { importId: 'imp_x', importCode: 'IMP-X', terminal: 'Nairobi Inland Container Depot', arrivedAt: new Date().toISOString() });
    expect(marked()).toBeUndefined();
    expect(offered()).toBe(true);
    expect(nearby()).toBe(true);
    // Taken, it is never closed again under its driver: a gate set afterwards is refused.
    dispatch.claim(dispatch.suggest(driver.did, { from: load.pickupLocation, to: load.pickupLocation }).find((o) => o.ref === load.freightId)!.offerId);
    expect(dispatch.setRailGate(load.freightId, { importId: 'imp_y', importCode: 'IMP-Y', terminal: 'Somewhere' })).toBe(false);
    expect(dispatch.requireFreightPublic(load.freightId).waitsForRail?.importCode).toBe('IMP-X');
  });

  it('an import by rail: the road leg waits for the arrival notice, the importer alone may send it anyway, and the free days are counted and warned', async () => {
    const imp = await aBusiness(['importer'], 'Thika Motors');
    const agent = await aBusiness(['clearing_agent'], 'Pwani Clearing');
    const icd = await imp.site('clearance', 'Nairobi Inland Container Depot', { lat: -1.32, lng: 36.9 });
    const made = (await http().post('/v1/sbg/imports').set(bearer(imp.token)).send({ goodsDescription: 'Spare parts', originCountry: 'CN', destCountry: 'KE', destPort: 'Nairobi', containerType: '22G1', containerNo: 'MSCU1234566' }).expect(201)).body;
    const path = `/v1/sbg/imports/${made.importId}`;
    await http().post(`${path}/appoint`).set(bearer(imp.token)).send({ agentEntityId: agent.entityId }).expect(201);

    expect((await http().post(`${path}/by-rail`).set(bearer(operator)).send({ terminalSiteId: icd })).status).toBe(403);
    expect((await http().post(`${path}/by-rail/arrived`).set(bearer(imp.token)).send({ at: new Date().toISOString() })).body.detail).toMatch(/does not come inland by rail/);
    const set = (await http().post(`${path}/by-rail`).set(bearer(imp.token)).send({ terminalSiteId: icd, freeDays: 4, expectedAt: new Date(Date.now() + 24 * H).toISOString() }).expect(201)).body;
    expect(set.byRail).toMatchObject({ terminal: { label: 'Nairobi Inland Container Depot' }, freeDays: 4, clock: { state: 'not_started' } });

    // The road leg is posted — collected where the train brings it — and nobody takes it yet.
    const leg = app.get(ImportService).mintRoadLeg(made.importId, imp.entityId, { pickupLocation: { lat: 0, lng: 0 }, destLabel: 'Thika yard', destLocation: { lat: -1.03, lng: 37.07 }, weightKg: 12000 }, 'Wanjiku');
    const freight = () => app.get(DispatchService).requireFreightPublic(leg.roadFreightId!);
    expect(freight()).toMatchObject({ pickupLabel: 'Nairobi Inland Container Depot', waitsForRail: { importCode: made.code, terminal: 'Nairobi Inland Container Depot' } });
    expect((await http().get(path).set(bearer(imp.token)).expect(200)).body.byRail.roadWaits).toMatch(/still on its way by rail/);

    // Sending it anyway is the importer's decision alone — it pays for the waiting — and asks why.
    expect((await http().post(`${path}/by-rail/collect-anyway`).set(bearer(agent.token)).send({ reason: 'The yard says it is in' })).status).toBe(403);
    expect((await http().post(`${path}/by-rail/collect-anyway`).set(bearer(imp.token)).send({ reason: 'ok' })).status).toBe(400);

    // The agent records the railway's notice: the leg opens, and the free days start.
    expect((await http().post(`${path}/by-rail/arrived`).set(bearer(agent.token)).send({ at: new Date(Date.now() + 2 * H).toISOString() })).status).toBe(400);
    const arrivedAt = Date.now() - 2 * H;
    const arrived = (await http().post(`${path}/by-rail/arrived`).set(bearer(agent.token)).send({ at: new Date(arrivedAt).toISOString(), reference: 'KRC-AN-5521' }).expect(201)).body;
    expect(freight().waitsForRail?.arrivedAt).toBe(new Date(arrivedAt).toISOString());
    expect(arrived.byRail.roadWaits).toBeUndefined();
    expect(arrived.byRail.clock).toMatchObject({ state: 'running', freeDays: 4, freeUntil: new Date(arrivedAt + 4 * 86_400_000).toISOString() });
    // The train left the port with it: the line's clock outside the terminal starts then, not at our truck (the gaps check).
    expect((await http().post(`${path}/by-rail/left-port`).set(bearer(operator)).send({ at: new Date(arrivedAt - 30 * H).toISOString() })).status).toBe(403);
    const left = (await http().post(`${path}/by-rail/left-port`).set(bearer(agent.token)).send({ at: new Date(arrivedAt - 30 * H).toISOString() }).expect(201)).body;
    expect(left.byRail.leftPort.at).toBe(new Date(arrivedAt - 30 * H).toISOString());
    expect(left.box.outGatedAt).toBe(new Date(arrivedAt - 30 * H).toISOString());
    // Once it is there, nothing waits: no word to go anyway is needed.
    expect((await http().post(`${path}/by-rail/collect-anyway`).set(bearer(imp.token)).send({ reason: 'The yard says it is in' })).body.detail).toMatch(/already said the box is there/);

    // On the last free day, and once they ended, the importer and its agent are told — once each.
    const service = app.get(ImportService);
    service.sweepRail(arrivedAt + 3.5 * 86_400_000);
    service.sweepRail(arrivedAt + 3.6 * 86_400_000);
    service.sweepRail(arrivedAt + 5 * 86_400_000);
    const titles = (id: string) => bell(id).map((n) => n.title).filter((t) => t.startsWith(made.code));
    expect(titles(imp.entityId)).toEqual(expect.arrayContaining([`${made.code}: the last free day at Nairobi Inland Container Depot`, `${made.code}: the free days at Nairobi Inland Container Depot ended`]));
    expect(titles(imp.entityId).filter((t) => t.includes('last free day'))).toHaveLength(1);
    expect(titles(agent.entityId)).toContain(`${made.code}: the free days at Nairobi Inland Container Depot ended`);
  });

  it('the importer’s word to go anyway opens the road leg, kept with its reason', async () => {
    const imp = await aBusiness(['importer'], 'Ruiru Foods');
    const icd = await imp.site('clearance', 'Nairobi Inland Container Depot', { lat: -1.32, lng: 36.9 });
    const made = (await http().post('/v1/sbg/imports').set(bearer(imp.token)).send({ goodsDescription: 'Rice, 800 bags', originCountry: 'PK', destCountry: 'KE', destPort: 'Nairobi', containerType: '22G1' }).expect(201)).body;
    const path = `/v1/sbg/imports/${made.importId}`;
    await http().post(`${path}/by-rail`).set(bearer(imp.token)).send({ terminalSiteId: icd }).expect(201);
    // Posted from the screen without a port to choose: by rail, it is collected where the train brings it.
    const store = await imp.site('delivery', 'Ruiru store', { lat: -1.15, lng: 36.96 });
    const leg = (await http().post(`${path}/road-leg`).set(bearer(imp.token)).send({ destSiteId: store, weightKg: 20000 }).expect(201)).body;
    expect(app.get(DispatchService).requireFreightPublic(leg.roadFreightId).pickupLabel).toBe('Nairobi Inland Container Depot');
    const after = (await http().post(`${path}/by-rail/collect-anyway`).set(bearer(imp.token)).send({ reason: 'The depot confirmed by phone that it is off the train' }).expect(201)).body;
    expect(after.byRail.collectAnyway.reason).toBe('The depot confirmed by phone that it is off the train');
    expect(after.byRail.roadWaits).toBeUndefined();
    expect(app.get(DispatchService).requireFreightPublic(leg.roadFreightId!).waitsForRail?.collectAnyway?.reason).toBe('The depot confirmed by phone that it is off the train');
  });
});
