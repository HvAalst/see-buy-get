import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';
import { DriverService } from '../src/modules/pudo/driver.service';

/**
 * WHO DRIVES ON WHICH DAY — through the booted application, over HTTP.
 *
 * The unit spec proves the roster on the real services. This proves what it cannot: that the routes are mounted, that
 * a fleet's day is its own office's (and the network's) to read and set, that a driver reads their own days and no one
 * else's, and that the plan the office asks for over the wire counts the roster.
 */
describe('a fleet’s roster, over the wire', () => {
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
      companyName: name, contactPhone: `+2548${n}0`, ownerFullName: 'O O', ownerNationalId: `MGR-ROS-${n}`, location: { lat: -1.2, lng: 36.8 },
      requirements: { businessRegistrationNo: `BRN-ROS-${n}`, transportOperatorLicence: `TOL-ROS-${n}`, taxId: `TAX-ROS-${n}` },
    });
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    const token = (await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    return { did: m.did, token };
  }
  async function aDriver(fleetDid: string): Promise<{ did: string; token: string }> {
    const drivers = app.get(DriverService);
    const n = digits();
    const d = drivers.register({ displayName: `Roster ${n}`, fullName: `R ${n}`, nationalId: `ID-ROS-${n}`, mobile: `+2547${n}2`, licenceClasses: ['truck'], licenceNumber: `L-ROS-${n}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true, managerDid: fleetDid });
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const token = (await http().post('/v1/auth/token').send({ role: 'driver', did: d.did, tenant: fleetDid, type: 'client_credentials' }).expect(201)).body.access_token as string;
    return { did: d.did, token };
  }
  const tomorrowOf = (fleetDid: string) => new Date(Date.parse(`${app.get(FleetManagerService).todayOf(fleetDid)}T12:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

  it('is the office’s to set and read, a driver reads their own days only, and the plan over the wire counts it', async () => {
    const kilima = await aFleet('Kilima Roster');
    const pwani = await aFleet('Pwani Roster');
    const amos = await aDriver(kilima.did);
    const grace = await aDriver(kilima.did);
    const theirs = await aDriver(pwani.did);
    const day = tomorrowOf(kilima.did);

    // Nobody has said: everybody counts.
    expect((await http().get(`/v1/sbg/fleet/managers/${kilima.did}/roster`).query({ day }).set(bearer(kilima.token)).expect(200)).body).toMatchObject({ source: 'everyone', drivers: 2 });
    // The office says Amos drives.
    const set = await http().post(`/v1/sbg/fleet/managers/${kilima.did}/roster`).set(bearer(kilima.token)).send({ day, driverDids: [amos.did] }).expect(201);
    expect(set.body).toMatchObject({ source: 'roster', drivers: 1 });
    // Another fleet's office can neither read nor set it; a driver cannot set it; nobody signed in gets nothing.
    await http().get(`/v1/sbg/fleet/managers/${kilima.did}/roster`).query({ day }).set(bearer(pwani.token)).expect(403);
    await http().post(`/v1/sbg/fleet/managers/${kilima.did}/roster`).set(bearer(pwani.token)).send({ day, driverDids: [] }).expect(403);
    await http().post(`/v1/sbg/fleet/managers/${kilima.did}/roster`).set(bearer(amos.token)).send({ day, driverDids: [amos.did, grace.did] }).expect(403);
    await http().get(`/v1/sbg/fleet/managers/${kilima.did}/roster`).query({ day }).expect(401);
    // A driver of another fleet is refused in words, and nothing changes.
    const stranger = await http().post(`/v1/sbg/fleet/managers/${kilima.did}/roster`).set(bearer(kilima.token)).send({ day, driverDids: [amos.did, theirs.did] }).expect(400);
    expect(stranger.body.message).toMatch(/not in this fleet/);
    expect((await http().get(`/v1/sbg/fleet/managers/${kilima.did}/roster`).query({ day }).set(bearer(operator)).expect(200)).body).toMatchObject({ drivers: 1 });

    // Each driver reads their own days; not each other's; their office reads them; another office does not.
    expect((await http().get(`/v1/sbg/fleet/drivers/${amos.did}/roster`).set(bearer(amos.token)).expect(200)).body).toEqual({ fleetName: 'Kilima Roster', days: [{ day, rostered: true }] });
    expect((await http().get(`/v1/sbg/fleet/drivers/${grace.did}/roster`).set(bearer(grace.token)).expect(200)).body.days).toEqual([{ day, rostered: false }]);
    await http().get(`/v1/sbg/fleet/drivers/${amos.did}/roster`).set(bearer(grace.token)).expect(403);
    await http().get(`/v1/sbg/fleet/drivers/${amos.did}/roster`).set(bearer(kilima.token)).expect(200);
    await http().get(`/v1/sbg/fleet/drivers/${amos.did}/roster`).set(bearer(pwani.token)).expect(403);

    // The plan the office asks for says whom it counted.
    const plan = await http().post(`/v1/sbg/fleet/managers/${kilima.did}/plan`).set(bearer(kilima.token)).send({ day }).expect(201);
    expect(plan.body.roster).toEqual({ source: 'roster', names: [expect.stringMatching(/^Roster /)] });
    expect(plan.body.totals.drivers).toBe(1);
  });
});
