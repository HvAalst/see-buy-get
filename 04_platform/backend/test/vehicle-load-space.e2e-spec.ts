import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { declared } from './declared';
import { DriverService } from '../src/modules/pudo/driver.service';

/**
 * WHAT A VEHICLE TAKES, AS ITS DRIVER SAYS (the owner, 2026-11-12: "I am driving my VAN, it is assumed that it can load 1200
 * Kg. Can I set it up to 600 Kg and 1000 liter volume? In other words, the driver should be able to adjust the weight and
 * volume"). The driver on shift with it sets them — never above what its class may carry — and who did is kept; another
 * driver, or the same one once off shift, may not; staff may.
 */
describe('a vehicle’s weight and load space, set by its driver', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    operator = bearer((await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token);
  });

  afterAll(async () => {
    await app?.close();
  });

  it('a van assumed to load 1,200 kg is set to 600 kg and 1,000 litres by its driver on shift; others may not', async () => {
    const u = Math.random().toString(16).slice(2, 10);
    const van = (await http().post('/v1/sbg/vehicles').set(operator).send({ plate: `LS-${u}`, vehicleClass: 'van', energy: 'diesel', ownerName: 'Load Space' }).expect(201)).body;
    expect(van.capacityKg).toBe(1200);
    // A vetted van driver: papers sent and checked.
    const onboard = async (name: string) => {
      const drivers = app.get(DriverService);
      const d = drivers.register({ displayName: name, fullName: name, nationalId: `LS-${name}-${u}`, mobile: `+2547${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}`, licenceClasses: ['van'], licenceNumber: `DL-${name}-${u}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
      drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
      drivers.decideKyc(d.did, true);
      return d;
    };
    const driver = await onboard('Driver');
    const other = await onboard('Other');
    const asDriver = bearer((await http().post('/v1/auth/token').send({ role: 'driver', did: driver.did }).expect(201)).body.access_token);
    const asOther = bearer((await http().post('/v1/auth/token').send({ role: 'driver', did: other.did }).expect(201)).body.access_token);
    declared(app, 'driver', driver.did, other.did);
    const space = `/v1/sbg/vehicles/${van.vehicleId}/load-space`;

    // Not on shift with it: not theirs to say.
    await http().patch(space).set(asDriver).send({ capacityKg: 600 }).expect(403);
    await http().post(`/v1/sbg/fleet/drivers/${driver.did}/start-session`).set(operator).send({ vehicleId: van.vehicleId }).expect(201);

    // On shift: 600 kg and 1,000 litres (1 m³); who set it is kept.
    const set = (await http().patch(space).set(asDriver).send({ capacityKg: 600, volumeM3: 1 }).expect(200)).body;
    expect(set).toMatchObject({ capacityKg: 600, volumeM3: 1, loadSpaceSetBy: { role: 'driver' } });
    // Its shift reads the new figure.
    expect((await http().get(`/v1/sbg/fleet/drivers/${driver.did}/session`).set(asDriver).expect(200)).body.vehicle).toMatchObject({ capacityKg: 600, volumeM3: 1 });
    // Never above what a van may carry, never nothing, and something to say.
    expect((await http().patch(space).set(asDriver).send({ capacityKg: 2500 }).expect(400)).body.detail).toMatch(/A van carries at most 2000 kg/);
    await http().patch(space).set(asDriver).send({ capacityKg: 0 }).expect(400);
    await http().patch(space).set(asDriver).send({}).expect(400);
    // Another driver may not.
    await http().patch(space).set(asOther).send({ capacityKg: 900 }).expect(403);
    // Off shift, the driver may not either; staff may, and the space can be cleared.
    await http().post(`/v1/sbg/fleet/drivers/${driver.did}/end-session`).set(operator).expect(201);
    await http().patch(space).set(asDriver).send({ capacityKg: 700 }).expect(403);
    expect((await http().patch(space).set(operator).send({ volumeM3: null }).expect(200)).body).toMatchObject({ capacityKg: 600, loadSpaceSetBy: { role: 'staff' } });
    expect((await http().get(`/v1/sbg/vehicles/${van.vehicleId}`).set(operator).expect(200)).body.volumeM3).toBeUndefined();
  });
});
