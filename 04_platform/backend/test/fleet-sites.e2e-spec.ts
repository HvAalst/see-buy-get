import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';
import { DriverService } from '../src/modules/pudo/driver.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';

/**
 * A FLEET'S SITES — through the booted application, over HTTP. The unit spec proves the sites and the plan from each on
 * the real services; this proves the routes are mounted, that the sites are the fleet's own record (its office changes
 * them, staff read them and change nothing, another fleet sees nothing), and that the roster and the plan over the
 * wire carry them.
 */
describe('a fleet’s sites, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
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

  async function aFleet(name: string): Promise<{ did: string; token: string }> {
    const managers = app.get(FleetManagerService);
    const n = digits();
    const m = managers.register({
      companyName: name, contactPhone: `+2548${n}0`, ownerFullName: 'O O', ownerNationalId: `MGR-SIT-${n}`, location: { lat: -1.2, lng: 36.8 },
      requirements: { businessRegistrationNo: `BRN-SIT-${n}`, transportOperatorLicence: `TOL-SIT-${n}`, taxId: `TAX-SIT-${n}` },
    });
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    const token = (await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    return { did: m.did, token };
  }
  function aDriver(fleetDid: string): string {
    const drivers = app.get(DriverService);
    const n = digits();
    const d = drivers.register({ displayName: `Site ${n}`, fullName: `S ${n}`, nationalId: `ID-SIT-${n}`, mobile: `+2547${n}4`, licenceClasses: ['truck'], licenceNumber: `L-SIT-${n}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true, managerDid: fleetDid });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    return d.did;
  }
  /** A person through the ordinary phone door, who sets up a shipper's business: its token and its id. */
  async function aShipper(name: string): Promise<{ token: string; entityId: string }> {
    const n = digits();
    const phone = `+2547${n}9`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `dock-${n}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token as string;
    const made = await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `${name} ${n}`, country: 'KE', registrationNo: `REG-DOK-${n}`, activities: ['shipper'], yourName: 'Achieng' }).expect(201);
    return { token: made.body.token.access_token, entityId: made.body.business.entityId };
  }
  const tomorrowOf = (fleetDid: string) => new Date(Date.parse(`${app.get(FleetManagerService).todayOf(fleetDid)}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

  it('is the fleet’s own record: its office changes it, staff read it, another fleet sees none of it — and the roster and plan carry it', async () => {
    const kilima = await aFleet('Kilima Sites');
    const pwani = await aFleet('Pwani Sites');
    const truck = app.get(VehicleService).register({ plate: `SIT ${digits().slice(-3)}T`, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 8000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, managerDid: kilima.did } as never);
    const amos = aDriver(kilima.did);
    const sites = `/v1/sbg/fleet/managers/${kilima.did}/sites`;
    // The depot it signed up with is its one site.
    expect((await http().get(sites).set(bearer(kilima.token)).expect(200)).body.sites).toEqual([expect.objectContaining({ siteId: 'depot', main: true, vehicles: 1, drivers: 1 })]);
    // A second site: the office's to add. Staff and another fleet: refused, in words for staff.
    const mombasa = { name: 'Mombasa yard', lat: -4.04, lng: 39.66, loadingBays: 3 };
    const staffAdd = await http().post(sites).set(bearer(operator)).send(mombasa);
    expect(staffAdd.status).toBe(403);
    await http().post(sites).set(bearer(pwani.token)).send(mombasa).expect(403);
    await http().get(sites).set(bearer(pwani.token)).expect(403);
    await http().post(sites).set(bearer(kilima.token)).send({ name: 'No point' }).expect(400);
    const added = await http().post(sites).set(bearer(kilima.token)).send(mombasa).expect(201);
    const msa = added.body.sites.find((s: { name: string }) => s.name === 'Mombasa yard').siteId as string;
    // Staff read it.
    expect((await http().get(sites).set(bearer(operator)).expect(200)).body.sites).toHaveLength(2);
    // How many load there at once: a number from 1, or no longer counted.
    await http().post(`${sites}/${msa}`).set(bearer(kilima.token)).send({ loadingBays: 0 }).expect(400);
    const uncounted = await http().post(`${sites}/${msa}`).set(bearer(kilima.token)).send({ loadingBays: null }).expect(201);
    expect(uncounted.body.sites.find((s: { siteId: string }) => s.siteId === msa)).not.toHaveProperty('loadingBays');
    // Who works from where.
    await http().post(`/v1/sbg/fleet/managers/${kilima.did}/site-homes`).set(bearer(operator)).send({ kind: 'vehicle', id: truck.vehicleId, siteId: msa }).expect(403);
    const homed = await http().post(`/v1/sbg/fleet/managers/${kilima.did}/site-homes`).set(bearer(kilima.token)).send({ kind: 'vehicle', id: truck.vehicleId, siteId: msa }).expect(201);
    expect(homed.body.vehicles).toEqual([{ id: truck.vehicleId, name: truck.plate, siteId: msa }]);
    await http().post(`${sites}/${msa}/close`).set(bearer(operator)).expect(403);
    expect((await http().post(`${sites}/${msa}/close`).set(bearer(kilima.token))).body.message).toBe('Move 1 vehicle to another site before closing Mombasa yard');
    // The roster says where a driver starts that day, and the plan counts the drivers each site has.
    const day = tomorrowOf(kilima.did);
    const set = await http().post(`/v1/sbg/fleet/managers/${kilima.did}/roster`).set(bearer(kilima.token)).send({ day, driverDids: [amos], starts: [{ driverDid: amos, siteId: msa }] }).expect(201);
    expect(set.body.list).toEqual([expect.objectContaining({ driverDid: amos, rostered: true, siteId: msa, homeSiteId: 'depot' })]);
    const plan = await http().post(`/v1/sbg/fleet/managers/${kilima.did}/plan`).set(bearer(kilima.token)).send({ day }).expect(201);
    expect(plan.body.sites).toEqual([
      { siteId: 'depot', name: 'Depot', trucksAvailable: 0, trucksUsed: 0, drivers: 0, loadings: 0, bayWaits: 0, afterClose: 0 },
      { siteId: msa, name: 'Mombasa yard', trucksAvailable: 1, trucksUsed: 0, drivers: 1, loadings: 0, bayWaits: 0, afterClose: 0 },
    ]);
    // How the vehicles were used: the office's and staff's to read, nobody else's.
    const today = app.get(FleetManagerService).todayOf(kilima.did);
    const week = { from: new Date(Date.parse(`${today}T12:00:00Z`) - 6 * 86_400_000).toISOString().slice(0, 10), to: today };
    const used = await http().get(`/v1/sbg/fleet/managers/${kilima.did}/use`).query(week).set(bearer(kilima.token)).expect(200);
    expect(used.body).toMatchObject({ days: 7, totals: { vehicles: 1, daysIdle: 7 }, vehicles: [{ vehicleId: truck.vehicleId, siteId: msa, siteName: 'Mombasa yard' }] });
    await http().get(`/v1/sbg/fleet/managers/${kilima.did}/use`).query(week).set(bearer(operator)).expect(200);
    await http().get(`/v1/sbg/fleet/managers/${kilima.did}/use`).query(week).set(bearer(pwani.token)).expect(403);
    await http().get(`/v1/sbg/fleet/managers/${kilima.did}/use`).query({ from: today, to: 'soon' }).set(bearer(kilima.token)).expect(400);
  });

  it('loads at a shipper’s place within the hours and bays the shipper keeps there — its own word, which nobody else changes', async () => {
    const fleet = await aFleet('Kilima Docks');
    app.get(VehicleService).register({ plate: `DOK ${digits().slice(-3)}T`, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 8000, ownerName: 'X', equipment: ['TLT', 'FLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, managerDid: fleet.did } as never);
    aDriver(fleet.did);
    const jenga = await aShipper('Jenga Bricks');
    const yard = (await http().post(`/v1/sbg/entities/${jenga.entityId}/sites`).set(bearer(jenga.token)).send({ kind: 'delivery', name: 'Jenga yard', location: { lat: -1.33, lng: 36.87 } }).expect(201)).body;
    // Its hours and bays: the shipper's to say. Staff and the fleet are refused; a bay count of none is not a number.
    const loading = `/v1/sbg/entities/${jenga.entityId}/sites/${yard.siteId}/loading`;
    const every = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '08:00', close: '18:00' }]));
    await http().post(loading).set(bearer(operator)).send({ bays: 1 }).expect(403);
    await http().post(loading).set(bearer(fleet.token)).send({ bays: 1 }).expect(403);
    await http().post(loading).set(bearer(jenga.token)).send({ bays: 0 }).expect(400);
    const kept = await http().post(loading).set(bearer(jenga.token)).send({ hours: every, bays: 1 }).expect(201);
    expect(kept.body.loading).toMatchObject({ bays: 1, hours: { mon: { open: '08:00', close: '18:00' } }, setBy: 'Achieng' });
    // The fleet's contract, linked by the shipper, and an order the shipper places on it, collected at its yard.
    const contract = (await http().post(`/v1/sbg/fleet/managers/${fleet.did}/contracts`).set(bearer(fleet.token)).send({ shipperName: 'Jenga' }).expect(201)).body;
    const invite = (await http().post(`/v1/sbg/fleet/managers/${fleet.did}/contracts/${contract.contractId}/invite`).set(bearer(fleet.token)).expect(201)).body;
    await http().post('/v1/sbg/business/me/contracts/link').set(bearer(jenga.token)).send({ code: invite.code }).expect(201);
    const day = tomorrowOf(fleet.did);
    await http()
      .post('/v1/sbg/dispatch/freight')
      .set(bearer(jenga.token))
      .send({ description: 'Bricks, 10 pallets', pickupLocation: { lat: -1.3305, lng: 36.87 }, pickupLabel: 'Jenga yard', destLabel: 'Kitengela site', destLocation: { lat: -1.47, lng: 36.96 }, weightKg: 6000, packaging: 'palletised', contractId: contract.contractId, deliverOn: day, orderRef: 'JB-1' })
      .expect(201);
    const plan = (await http().post(`/v1/sbg/fleet/managers/${fleet.did}/plan`).set(bearer(fleet.token)).send({ day }).expect(201)).body;
    expect(plan.routes[0].trips[0]).toMatchObject({ dockName: 'Jenga yard', start: '08:00' });
    expect(plan.docks).toEqual([expect.objectContaining({ siteId: yard.siteId, name: 'Jenga yard', loadings: 1, bays: 1, hours: '08:00–18:00' })]);
  });
});
