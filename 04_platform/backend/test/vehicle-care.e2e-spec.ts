import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';
import { VehicleCareService } from '../src/modules/pudo/vehicle-care.service';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { requiredLoadKeys } from '../src/modules/pudo/heavy-cargo';

/**
 * A VEHICLE'S UPKEEP — through the booted application, over HTTP. The unit spec proves the rules on the real services;
 * this proves what it cannot: that the routes are mounted and refuse whoever does not own the vehicle, and that the
 * odometer is read at the driver's own shift start and end — refused before a shift starts, and never in the way of
 * one ending.
 */
describe('a vehicle’s upkeep, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const PIN = '48261';
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
    const onboarded = await http().post('/v1/sbg/drivers/onboard').set(bearer(operator)).send({ displayName: 'Njeri', fullName: 'Njeri Rider', nationalId: `ID-CARE-${digits()}`, mobile: phone, licenceClasses: ['bike'], jurisdiction: 'KE' }).expect(201);
    const did = onboarded.body.did as string;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `care${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201);
    const session = await http().post('/v1/sbg/drivers/session').send({ phone, pin: PIN, device: enrolled.body.device }).expect(201);
    const bike = app.get(VehicleService).register({ plate: `CARE-${digits()}`, vehicleClass: 'bike', capacityKg: 30, ownerName: 'Njeri Rider', ownerDriverDid: did } as never);
    return { did, token: session.body.token.access_token as string, vehicleId: bike.vehicleId };
  }
  async function aFleetOffice(): Promise<string> {
    const managers = app.get(FleetManagerService);
    const n = digits();
    const m = managers.register({
      companyName: `Care Fleet ${n}`, contactPhone: `+2548${n}0`, ownerFullName: 'O O', ownerNationalId: `MGR-CARE-${n}`, location: { lat: -1.2, lng: 36.8 },
      requirements: { businessRegistrationNo: `BRN-CARE-${n}`, transportOperatorLicence: `TOL-CARE-${n}`, taxId: `TAX-CARE-${n}` },
    });
    return (await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
  }

  it('is the owner’s to read and change: the owner-driver yes, another driver and another fleet no', async () => {
    const njeri = await aCourier();
    const other = await aCourier();
    const office = await aFleetOffice();
    await http().get(`/v1/sbg/vehicles/${njeri.vehicleId}/care`).set(bearer(njeri.token)).expect(200);
    await http().get(`/v1/sbg/vehicles/${njeri.vehicleId}/care`).set(bearer(other.token)).expect(403);
    await http().get(`/v1/sbg/vehicles/${njeri.vehicleId}/care`).set(bearer(office)).expect(403);
    await http().get(`/v1/sbg/vehicles/${njeri.vehicleId}/care`).expect(401);
    await http().post(`/v1/sbg/vehicles/${njeri.vehicleId}/off-road`).set(bearer(other.token)).send({ reason: 'repair' }).expect(403);
    // Her own bike, in the workshop: her next shift does not start, and says why.
    const off = await http().post(`/v1/sbg/vehicles/${njeri.vehicleId}/off-road`).set(bearer(njeri.token)).send({ reason: 'repair', note: 'chain' }).expect(201);
    expect(off.body).toMatchObject({ usable: false, offRoad: ['In the workshop: chain'] });
    const refused = await http().post(`/v1/sbg/fleet/drivers/${njeri.did}/start-session`).set(bearer(njeri.token)).send({ vehicleId: njeri.vehicleId, pin: PIN });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect(refused.body.message).toMatch(/off the road: In the workshop: chain/);
    await http().post(`/v1/sbg/vehicles/${njeri.vehicleId}/back-on-road`).set(bearer(njeri.token)).expect(201);
  });

  it('reads the odometer as a shift starts — refusing a low one before the shift starts — and as it ends, never in the way', async () => {
    const njeri = await aCourier();
    const start = (km: number) => http().post(`/v1/sbg/fleet/drivers/${njeri.did}/start-session`).set(bearer(njeri.token)).send({ vehicleId: njeri.vehicleId, pin: PIN, odometerKm: km });
    await start(4_200).expect(201);
    const ended = await http().post(`/v1/sbg/fleet/drivers/${njeri.did}/end-session`).set(bearer(njeri.token)).send({ odometerKm: 4_260 }).expect(201);
    expect(ended.body.odometer).toEqual({ kept: true });
    // Lower than the last: refused, and no shift was started.
    const low = await start(4_100);
    expect(low.status).toBe(400);
    expect(low.body.message).toMatch(/last reading was 4,260 km: a reading cannot go back/);
    const care = await http().get(`/v1/sbg/vehicles/${njeri.vehicleId}/care`).set(bearer(njeri.token)).expect(200);
    expect(care.body).toMatchObject({ inUse: false, odometer: { km: 4_260, source: 'shift_end' } });
    // A slip at the end of a shift: the shift ends all the same, and the reading is not kept.
    await start(4_300).expect(201);
    const slip = await http().post(`/v1/sbg/fleet/drivers/${njeri.did}/end-session`).set(bearer(njeri.token)).send({ odometerKm: 430 }).expect(201);
    expect(slip.body.odometer).toMatchObject({ kept: false, why: expect.stringMatching(/last reading was 4,300 km/) });
    expect((await http().get(`/v1/sbg/vehicles/${njeri.vehicleId}/care`).set(bearer(njeri.token))).body).toMatchObject({ inUse: false, odometer: { km: 4_300 } });
    // With no reading at all, nothing changes for anybody.
    await http().post(`/v1/sbg/fleet/drivers/${njeri.did}/start-session`).set(bearer(njeri.token)).send({ vehicleId: njeri.vehicleId, pin: PIN }).expect(201);
    expect((await http().post(`/v1/sbg/fleet/drivers/${njeri.did}/end-session`).set(bearer(njeri.token)).expect(201)).body).not.toHaveProperty('odometer');
  });

  /** A fleet's office, one of its drivers signed in to the driver app, and one of its trucks. */
  async function aFleetDriver(): Promise<{ fleetDid: string; office: string; did: string; token: string; truckId: string; plate: string }> {
    const managers = app.get(FleetManagerService);
    const n = digits();
    const m = managers.register({
      companyName: `Check Fleet ${n}`, contactPhone: `+2548${n}1`, ownerFullName: 'O O', ownerNationalId: `MGR-CHK-${n}`, location: { lat: -1.2, lng: 36.8 },
      requirements: { businessRegistrationNo: `BRN-CHK-${n}`, transportOperatorLicence: `TOL-CHK-${n}`, taxId: `TAX-CHK-${n}` },
    });
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    const office = (await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    const phone = `+2547${digits()}2`;
    const onboarded = await http().post('/v1/sbg/drivers/onboard').set(bearer(operator)).send({ displayName: 'Baraka', fullName: 'Baraka Driver', nationalId: `ID-CHK-${n}`, mobile: phone, licenceClasses: ['truck'], licenceNumber: `L-CHK-${n}`, licenceExpiresAt: new Date(Date.now() + 400 * 86_400_000).toISOString(), criminalRecordClear: true, managerDid: m.did }).expect(201);
    const did = onboarded.body.did as string;
    await http().post(`/v1/sbg/fleet/drivers/${did}/submit-kyc`).set(bearer(operator)).send({ idCopyRef: 'id.jpg', licenceCopyRef: 'licence.jpg' }).expect(201);
    await http().post(`/v1/sbg/fleet/drivers/${did}/kyc-decision`).set(bearer(operator)).send({ approve: true, by: 'Test' }).expect(201);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `chk${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201);
    const session = await http().post('/v1/sbg/drivers/session').send({ phone, pin: PIN, device: enrolled.body.device }).expect(201);
    const plate = `CHK ${n.slice(-3)}T`;
    const truck = app.get(VehicleService).register({ plate, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 8000, ownerName: 'Check Fleet', equipment: ['TLT', 'FLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, managerDid: m.did } as never);
    return { fleetDid: m.did, office, did, token: session.body.token.access_token as string, truckId: truck.vehicleId, plate };
  }

  /** Another driver of a fleet, signed in to the driver app, with a truck of that fleet's to be out in. */
  async function aDriverIn(fleetDid: string): Promise<{ did: string; token: string; truckId: string; plate: string }> {
    const n = digits();
    const phone = `+2547${digits()}3`;
    const onboarded = await http().post('/v1/sbg/drivers/onboard').set(bearer(operator)).send({ displayName: 'Wanjiru', fullName: 'Wanjiru Driver', nationalId: `ID-RSC-${n}`, mobile: phone, licenceClasses: ['truck'], licenceNumber: `L-RSC-${n}`, licenceExpiresAt: new Date(Date.now() + 400 * 86_400_000).toISOString(), criminalRecordClear: true, managerDid: fleetDid }).expect(201);
    const did = onboarded.body.did as string;
    await http().post(`/v1/sbg/fleet/drivers/${did}/submit-kyc`).set(bearer(operator)).send({ idCopyRef: 'id.jpg', licenceCopyRef: 'licence.jpg' }).expect(201);
    await http().post(`/v1/sbg/fleet/drivers/${did}/kyc-decision`).set(bearer(operator)).send({ approve: true, by: 'Test' }).expect(201);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `rsc${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201);
    const session = await http().post('/v1/sbg/drivers/session').send({ phone, pin: PIN, device: enrolled.body.device }).expect(201);
    const plate = `RSC ${n.slice(-3)}T`;
    const truck = app.get(VehicleService).register({ plate, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 8000, ownerName: 'Check Fleet', equipment: ['TLT', 'FLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, managerDid: fleetDid } as never);
    return { did, token: session.body.token.access_token as string, truckId: truck.vehicleId, plate };
  }

  it('asks for the daily check where the fleet does, takes the vehicle off the road for an unsafe defect, and tells the office and then the driver', async () => {
    const x = await aFleetDriver();
    const other = await aFleetDriver();
    const start = () => http().post(`/v1/sbg/fleet/drivers/${x.did}/start-session`).set(bearer(x.token)).send({ vehicleId: x.truckId, pin: PIN });
    // The fleet asks for a check: a shift without one is refused with its own code, and nothing starts.
    await http().post(`/v1/sbg/fleet/managers/${x.fleetDid}/care-settings`).set(bearer(other.office)).send({ requireDailyCheck: true }).expect(403);
    await http().post(`/v1/sbg/fleet/managers/${x.fleetDid}/care-settings`).set(bearer(x.office)).send({ requireDailyCheck: true }).expect(201);
    const unchecked = await start();
    expect(unchecked.status).toBe(409);
    expect(unchecked.body.code).toBe('VEHICLE_CHECK_NEEDED');
    expect(unchecked.body.message).toMatch(new RegExp(`^Check ${x.plate} first: Check Fleet \\d+ asks for a daily check before a shift$`));
    // The check: another fleet's driver may not; this one answers every item.
    const sheet = await http().get(`/v1/sbg/fleet/drivers/${x.did}/vehicle-check`).query({ vehicleId: x.truckId }).set(bearer(x.token)).expect(200);
    expect(sheet.body).toMatchObject({ plate: x.plate, required: true });
    await http().get(`/v1/sbg/fleet/drivers/${other.did}/vehicle-check`).query({ vehicleId: x.truckId }).set(bearer(other.token)).expect(403);
    await http().get(`/v1/sbg/fleet/drivers/${x.did}/vehicle-check`).query({ vehicleId: x.truckId }).set(bearer(other.token)).expect(403);
    const answers = (sheet.body.items as Array<{ item: string }>).map((i) => ({ item: i.item, ok: true }));
    expect((await http().post(`/v1/sbg/fleet/drivers/${x.did}/vehicle-check`).set(bearer(x.token)).send({ vehicleId: x.truckId, answers }).expect(201)).body).toMatchObject({ clean: true, usable: true });
    await start().expect(201);
    // On the road, the brakes go: reported not safe, on the vehicle they are out in.
    const defect = await http().post(`/v1/sbg/fleet/drivers/${x.did}/defects`).set(bearer(x.token)).send({ item: 'brakes', note: 'pedal goes soft', safe: false }).expect(201);
    expect(defect.body).toMatchObject({ item: 'brakes', safety: true, status: 'open' });
    const officeInbox = (await http().get('/v1/sbg/notifications/inbox').set(bearer(x.office)).expect(200)).body;
    expect((officeInbox.items ?? officeInbox).find((n: { kind: string }) => n.kind === 'vehicle_defect')).toMatchObject({ title: `${x.plate} is off the road: brakes reported unsafe` });
    // Another fleet's office sees none of it.
    await http().get(`/v1/sbg/vehicles/${x.truckId}/care`).set(bearer(other.office)).expect(403);
    await http().post(`/v1/sbg/vehicles/${x.truckId}/defects/${defect.body.defectId}/decide`).set(bearer(other.office)).send({ decision: 'fixed', note: 'no' }).expect(403);
    // The office's word: fixed. The driver hears it.
    const after = await http().post(`/v1/sbg/vehicles/${x.truckId}/defects/${defect.body.defectId}/decide`).set(bearer(x.office)).send({ decision: 'fixed', note: 'Brake fluid topped up, line replaced' }).expect(201);
    expect(after.body).toMatchObject({ defects: [], decided: [{ status: 'fixed', decisionNote: 'Brake fluid topped up, line replaced' }] });
    const driverInbox = (await http().get('/v1/sbg/notifications/inbox').set(bearer(x.token)).expect(200)).body;
    expect((driverInbox.items ?? driverInbox).find((n: { kind: string }) => n.kind === 'vehicle_defect')).toMatchObject({ title: `${x.plate}: brakes — fixed` });
  });

  it('keeps a vehicle’s services and job cards for its office alone — never a price — and tells the office when the next comes due', async () => {
    const x = await aFleetDriver();
    const other = await aFleetDriver();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    // The schedule: the office's own, refused to anybody else and to nonsense.
    const planned = await http().post(`/v1/sbg/vehicles/${x.truckId}/service-plan`).set(bearer(x.office)).send({ everyKm: 10_000, everyMonths: 3 }).expect(201);
    expect(planned.body.service.plan).toEqual({ everyKm: 10_000, everyMonths: 3, source: 'office' });
    await http().post(`/v1/sbg/vehicles/${x.truckId}/service-plan`).set(bearer(other.office)).send({ everyMonths: 3 }).expect(403);
    await http().post(`/v1/sbg/vehicles/${x.truckId}/service-plan`).set(bearer(x.token)).send({ everyMonths: 3 }).expect(403);
    await http().post(`/v1/sbg/vehicles/${x.truckId}/service-plan`).set(bearer(x.office)).send({ everyKm: 10 }).expect(400);
    // A service, with the workshop's job card. Whatever is said about money is not kept: there is nowhere for it.
    const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
    const card = await http().post('/v1/sbg/media').set(bearer(x.office)).send({ kind: 'job_card', dataUrl: png }).expect(201);
    const service = { day: yesterday, what: 'service', km: 88_000, workshop: 'Mombasa Road Motors', photoRef: card.body.mediaId, cost: 25_000 };
    await http().post(`/v1/sbg/vehicles/${x.truckId}/services`).set(bearer(other.office)).send(service).expect(403);
    const kept = await http().post(`/v1/sbg/vehicles/${x.truckId}/services`).set(bearer(x.office)).send(service).expect(201);
    expect(kept.body.services[0]).toMatchObject({ day: yesterday, what: 'service', km: 88_000, workshop: 'Mombasa Road Motors', hasPhoto: true });
    expect(kept.body.services[0]).not.toHaveProperty('cost');
    expect(kept.body.services[0]).not.toHaveProperty('photoRef');
    expect(kept.body.service).toMatchObject({ from: 'service', dueKm: 98_000, state: 'ok' });
    const recordId = kept.body.services[0].recordId as string;
    const photo = await http().get(`/v1/sbg/vehicles/${x.truckId}/services/${recordId}/photo`).set(bearer(x.office)).expect(200);
    expect(photo.headers['content-type']).toMatch(/^image\/png/);
    await http().get(`/v1/sbg/vehicles/${x.truckId}/services/${recordId}/photo`).set(bearer(other.office)).expect(403);
    // Overdue keeps it off the road only where the fleet says so — its own rule, and nobody else's.
    await http().post(`/v1/sbg/fleet/managers/${x.fleetDid}/care-settings`).set(bearer(x.office)).send({ serviceOverdue: 'never' }).expect(400);
    await http().post(`/v1/sbg/fleet/managers/${x.fleetDid}/care-settings`).set(bearer(other.office)).send({ serviceOverdue: 'off_road' }).expect(403);
    expect((await http().post(`/v1/sbg/fleet/managers/${x.fleetDid}/care-settings`).set(bearer(x.office)).send({ serviceOverdue: 'off_road' }).expect(201)).body).toEqual({ requireDailyCheck: false, serviceOverdue: 'off_road' });
    // Ten days before it is due, the hourly look tells the office — and nobody else.
    const dueDay = kept.body.service.dueDay as string;
    app.get(VehicleCareService).sweepServiceDue(Date.parse(`${dueDay}T09:00:00Z`) - 10 * 86_400_000);
    await new Promise((r) => setTimeout(r, 50));
    const inbox = (await http().get('/v1/sbg/notifications/inbox').set(bearer(x.office)).expect(200)).body;
    expect((inbox.items ?? inbox).find((n: { kind: string }) => n.kind === 'vehicle_service')).toMatchObject({ title: `${x.plate}: service due soon` });
    const driverInbox = (await http().get('/v1/sbg/notifications/inbox').set(bearer(x.token)).expect(200)).body;
    expect((driverInbox.items ?? driverInbox).some((n: { kind: string }) => n.kind === 'vehicle_service')).toBe(false);
    const otherInbox = (await http().get('/v1/sbg/notifications/inbox').set(bearer(other.office)).expect(200)).body;
    expect((otherInbox.items ?? otherInbox).some((n: { kind: string; title: string }) => n.kind === 'vehicle_service' && n.title.startsWith(x.plate))).toBe(false);
  });

  it('takes a breakdown from the driver out in the vehicle, tells the office and the shipper at once, and the driver how it ended', async () => {
    const x = await aFleetDriver();
    const other = await aFleetDriver();
    const report = (did: string, token: string, body: Record<string, unknown>) => http().post(`/v1/sbg/fleet/drivers/${did}/breakdown`).set(bearer(token)).send(body);
    // Not out in a vehicle: nothing to report from.
    expect((await report(x.did, x.token, { cause: 'engine', note: 'Steam' })).body.message).toMatch(/^You are not on a shift/);
    await http().post(`/v1/sbg/fleet/drivers/${x.did}/start-session`).set(bearer(x.token)).send({ vehicleId: x.truckId, pin: PIN }).expect(201);
    // A load aboard, placed by somebody else under this fleet's contract: the other office stands in for that shipper.
    const dispatch = app.get(DispatchService);
    const load = dispatch.registerFreight({
      description: 'Cement, 40 bags', pickupLocation: { lat: -1.3, lng: 36.85 }, pickupLabel: 'Bamburi depot', destLabel: 'Site 7', destLocation: { lat: -1.25, lng: 36.9 },
      weightKg: 2000, packaging: 'palletised', postedByDid: other.fleetDid, postedByName: 'Wanjiku',
      contract: { contractId: 'ctr_brk', fleetDid: x.fleetDid, fleetName: 'Check Fleet', shipperName: 'Wanjiku Builders' }, deliverOn: new Date().toISOString().slice(0, 10), orderRef: `BRK-${digits()}`,
    } as never);
    dispatch.assign(load.freightId, x.did, { managerDid: x.fleetDid, name: 'Office' });
    dispatch.pickupFreight(load.freightId, x.did, { confirmed: requiredLoadKeys(dispatch.requireFreightPublic(load.freightId)), securementPhotoId: 'med_test' });
    // Somebody else's driver may not report for this one; a position is both halves or neither.
    expect((await report(x.did, other.token, { cause: 'engine', note: 'Steam' })).status).toBe(403);
    expect((await report(x.did, x.token, { cause: 'engine', note: 'Steam', lat: 200, lng: 36.8 })).status).toBe(400);
    const broke = await report(x.did, x.token, { cause: 'engine', note: 'Steam from the bonnet', lat: -1.31, lng: 36.84 }).expect(201);
    expect(broke.body).toMatchObject({ plate: x.plate, status: 'open', locationFrom: 'phone', location: { lat: -1.31, lng: 36.84 }, aboard: [{ kind: 'freight', label: load.code, state: 'aboard', shipperTold: true }] });
    expect((await report(x.did, x.token, { cause: 'engine', note: 'Again' })).body).toMatchObject({ code: 'INVALID_STATE', message: expect.stringMatching(new RegExp(`^${x.plate} is already reported broken down`)) });
    await new Promise((r) => setTimeout(r, 50));
    const inboxOf = async (token: string) => {
      const body = (await http().get('/v1/sbg/notifications/inbox').set(bearer(token)).expect(200)).body;
      return (body.items ?? body) as Array<{ kind: string; title: string; body: string }>;
    };
    // The office, at once, with where.
    const officeNotice = (await inboxOf(x.office)).find((n) => n.kind === 'vehicle_breakdown');
    expect(officeNotice).toMatchObject({ title: `${x.plate} has broken down — Baraka` });
    expect(officeNotice!.body).toMatch(/^Engine: “Steam from the bonnet”\. Where the phone was: -1\.31000, 36\.84000\. One load aboard or to collect: their shippers have been told\./);
    // The shipper: by its load, never by the plate.
    const shipperNotice = (await inboxOf(other.office)).find((n) => n.kind === 'freight_problem' && n.title.startsWith(`Load ${load.code}`));
    expect(shipperNotice).toMatchObject({ title: `Load ${load.code}: the vehicle carrying it broke down` });
    expect(shipperNotice!.body).not.toContain(x.plate);
    // The office's list, and nobody else's.
    expect((await http().get(`/v1/sbg/fleet/managers/${x.fleetDid}/breakdowns`).set(bearer(x.office)).expect(200)).body.map((b: { plate: string }) => b.plate)).toEqual([x.plate]);
    await http().get(`/v1/sbg/fleet/managers/${x.fleetDid}/breakdowns`).set(bearer(other.office)).expect(403);
    // How it ended: the office's to say, with what was done. The driver hears, and so does the shipper.
    const id = broke.body.breakdownId as string;
    await http().post(`/v1/sbg/vehicles/${x.truckId}/breakdowns/${id}/resolve`).set(bearer(other.office)).send({ outcome: 'back_on_road', note: 'no' }).expect(403);
    await http().post(`/v1/sbg/vehicles/${x.truckId}/breakdowns/${id}/resolve`).set(bearer(x.token)).send({ outcome: 'back_on_road', note: 'no' }).expect(403);
    const resolved = await http().post(`/v1/sbg/vehicles/${x.truckId}/breakdowns/${id}/resolve`).set(bearer(x.office)).send({ outcome: 'back_on_road', note: 'Fan belt replaced at the roadside' }).expect(201);
    expect(resolved.body).toMatchObject({ usable: true, breakdowns: [{ breakdownId: id, status: 'resolved', outcome: 'back_on_road' }] });
    await new Promise((r) => setTimeout(r, 50));
    expect((await inboxOf(x.token)).find((n) => n.kind === 'vehicle_breakdown')).toMatchObject({ title: `${x.plate} is back on the road` });
    expect((await inboxOf(other.office)).some((n) => n.title === `Load ${load.code}: the vehicle is back on the road`)).toBe(true);
    // The office records one it heard of by telephone.
    const phoned = await http().post(`/v1/sbg/vehicles/${x.truckId}/breakdowns`).set(bearer(x.office)).send({ cause: 'tyre', note: 'Baraka rang: a blow-out near Mlolongo' }).expect(201);
    expect(phoned.body).toMatchObject({ usable: false, breakdowns: [{ status: 'open', cause: 'tyre', reportedBy: expect.any(String) }, { status: 'resolved' }] });
    await http().post(`/v1/sbg/vehicles/${x.truckId}/breakdowns`).set(bearer(other.office)).send({ cause: 'tyre', note: 'x' }).expect(403);
  });

  it('moves a broken-down truck’s loads to another of the fleet’s trucks over the wire: by the other driver’s code, or by the office', async () => {
    const x = await aFleetDriver();
    const other = await aFleetDriver();
    await http().post(`/v1/sbg/fleet/drivers/${x.did}/start-session`).set(bearer(x.token)).send({ vehicleId: x.truckId, pin: PIN }).expect(201);
    const dispatch = app.get(DispatchService);
    const load = dispatch.registerFreight({
      description: 'Cement, 40 bags', pickupLocation: { lat: -1.3, lng: 36.85 }, pickupLabel: 'Bamburi depot', destLabel: 'Site 9', destLocation: { lat: -1.25, lng: 36.9 },
      weightKg: 2000, packaging: 'palletised', postedByDid: other.fleetDid, postedByName: 'Wanjiku',
      contract: { contractId: 'ctr_tko', fleetDid: x.fleetDid, fleetName: 'Check Fleet', shipperName: 'Wanjiku Builders' }, deliverOn: new Date().toISOString().slice(0, 10), orderRef: `TKO-${digits()}`,
    } as never);
    dispatch.assign(load.freightId, x.did, { managerDid: x.fleetDid, name: 'Office' });
    dispatch.pickupFreight(load.freightId, x.did, { confirmed: requiredLoadKeys(dispatch.requireFreightPublic(load.freightId)), securementPhotoId: 'med_test' });
    const broke = await http().post(`/v1/sbg/fleet/drivers/${x.did}/breakdown`).set(bearer(x.token)).send({ cause: 'engine', note: 'Head gasket' }).expect(201);
    const id = broke.body.breakdownId as string;
    // A second driver of the same fleet, out in a second truck.
    const rescuer = await aDriverIn(x.fleetDid);
    await http().post(`/v1/sbg/fleet/drivers/${rescuer.did}/start-session`).set(bearer(rescuer.token)).send({ vehicleId: rescuer.truckId, pin: PIN }).expect(201);
    const list = await http().get(`/v1/sbg/fleet/drivers/${rescuer.did}/breakdowns`).set(bearer(rescuer.token)).expect(200);
    expect(list.body).toEqual([expect.objectContaining({ breakdownId: id, plate: x.plate, driverName: 'Baraka', totalKg: 2000 })]);
    await http().get(`/v1/sbg/fleet/drivers/${rescuer.did}/breakdowns`).set(bearer(x.token)).expect(403);
    // The office's view of who could take them; nobody else's.
    const takers = await http().get(`/v1/sbg/vehicles/${x.truckId}/breakdowns/${id}/takers`).set(bearer(x.office)).expect(200);
    expect(takers.body).toEqual([expect.objectContaining({ driverDid: rescuer.did, plate: rescuer.plate, roomKg: 8000 })]);
    await http().get(`/v1/sbg/vehicles/${x.truckId}/breakdowns/${id}/takers`).set(bearer(other.office)).expect(403);
    await http().get(`/v1/sbg/vehicles/${x.truckId}/breakdowns/${id}/takers`).set(bearer(rescuer.token)).expect(403);
    // The code on the broken-down driver's phone: only their own sign-in gets it.
    const pass = (await http().get(`/v1/sbg/fleet/drivers/${x.did}/session`).set(bearer(x.token)).expect(200)).body.handoverPass as string;
    const code = pass.split('-').pop()!;
    const takeOver = (body: Record<string, unknown>) => http().post(`/v1/sbg/fleet/drivers/${rescuer.did}/take-over`).set(bearer(rescuer.token)).send({ breakdownId: id, ...body });
    expect((await takeOver({ pass: code === '000000' ? '111111' : '000000' })).body.code).toBe('DRIVER_PASS_WRONG');
    await http().post(`/v1/sbg/fleet/drivers/${rescuer.did}/take-over`).set(bearer(x.token)).send({ breakdownId: id, pass: code }).expect(403);
    const taken = await takeOver({ pass: code, lat: -1.33, lng: 36.87 }).expect(201);
    expect(taken.body).toEqual({ breakdownId: id, fromPlate: x.plate, toPlate: rescuer.plate, moved: [load.code] });
    await new Promise((r) => setTimeout(r, 50));
    const inboxOf = async (token: string) => {
      const body = (await http().get('/v1/sbg/notifications/inbox').set(bearer(token)).expect(200)).body;
      return (body.items ?? body) as Array<{ kind: string; title: string; body: string }>;
    };
    expect((await inboxOf(x.office)).find((n) => n.title === `${x.plate}'s loads are on ${rescuer.plate} now`)).toBeDefined();
    const moving = (await inboxOf(other.office)).find((n) => n.title === `Load ${load.code} is moving again`);
    expect(moving).toBeDefined();
    expect(moving!.body).not.toContain(x.plate);
    expect(moving!.body).not.toContain(rescuer.plate);
    // The shipper's own view says who carries it now.
    expect(dispatch.requireFreightPublic(load.freightId)).toMatchObject({ claimedBy: rescuer.did, movedTo: { plate: rescuer.plate } });
    // Nothing left for the office to move.
    const again = await http().post(`/v1/sbg/vehicles/${x.truckId}/breakdowns/${id}/hand-over`).set(bearer(x.office)).send({ toDriverDid: rescuer.did });
    expect(again.status).toBe(400);
    expect(again.body.message).toBe(`Nothing of ${x.plate}'s is left to hand over`);
    await http().post(`/v1/sbg/vehicles/${x.truckId}/breakdowns/${id}/hand-over`).set(bearer(other.office)).send({ toDriverDid: rescuer.did }).expect(403);
  });
});
