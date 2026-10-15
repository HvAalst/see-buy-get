import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';

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
});
