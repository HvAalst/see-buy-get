import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { declared } from './declared';
import { DriverService } from '../src/modules/pudo/driver.service';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { FleetService } from '../src/modules/pudo/fleet.service';
import { CorridorService } from '../src/modules/pudo/corridor.service';
import { DepartureService } from '../src/modules/pudo/departure.service';

/**
 * 2026-11-21 — THE OWNER: "can't edit the car details when I made a mistake in the number plate, also I can't add a second car
 * of mine." Over the wire: a courier corrects the plate of a vehicle of their own, adds another, and takes one off their list —
 * from their own sign-in only; a fleet's office corrects its own vehicle's plate, and its runs not left yet say the new one.
 * Staff, another driver and a fleet's driver are refused: the owner keeps its own record.
 */
describe('a vehicle’s plate corrected, and a courier’s own vehicles, by their owner', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

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

  /** A rider on a bicycle, in no fleet unless one is named: a courier the moment they are registered. */
  const aRider = async (name: string, managerDid?: string) => {
    const d = app.get(DriverService).register({ displayName: name, fullName: name, nationalId: `OV-${name}-${digits()}`, mobile: `+2547${digits()}`, licenceClasses: ['bike'], criminalRecordClear: true, ...(managerDid ? { managerDid } : {}) } as never);
    declared(app, 'driver', d.did);
    const token = bearer((await http().post('/v1/auth/token').send({ role: 'driver', did: d.did, ...(managerDid ? { tenant: managerDid } : {}) }).expect(201)).body.access_token);
    return { did: d.did, token };
  };
  const listOf = async (did: string, token: { authorization: string }) => (await http().get(`/v1/sbg/fleet/drivers/${did}/vehicles`).set(token).expect(200)).body.vehicles as Array<{ vehicleId: string; plate: string; own?: boolean }>;

  it('a courier: the plate corrected, a second bicycle added, one taken off — theirs alone', async () => {
    const rider = await aRider('Wanjiku');
    const other = await aRider('Otieno');
    const first = app.get(VehicleService).register({ plate: `KMOV ${digits()}`, vehicleClass: 'bike', energy: 'pedal', ownerName: 'Wanjiku', ownerDriverDid: rider.did } as never);
    app.get(FleetService).claimOwnVehicle(rider.did, first.vehicleId); // as signing up with it does
    const plate = `/v1/sbg/vehicles/${first.vehicleId}/plate`;
    const was = first.plate;

    // Corrected by its owner: the old plate kept, with who; on their list by the new one.
    const fixedPlate = `KMFX ${digits()}`;
    const fixed = (await http().patch(plate).set(rider.token).send({ plate: fixedPlate.toLowerCase() }).expect(200)).body;
    expect(fixed).toMatchObject({ vehicleId: first.vehicleId, plate: fixedPlate, plateHistory: [{ plate: was, role: 'driver' }] });
    expect((await listOf(rider.did, rider.token)).map((v) => v.plate)).toEqual([fixedPlate]);
    // Nobody else: another driver, staff.
    expect((await http().patch(plate).set(other.token).send({ plate: 'KMXX 1' }).expect(403)).body.detail).toMatch(/Only the fleet that owns this vehicle, or the driver who owns it, corrects its plate/);
    await http().patch(plate).set(operator).send({ plate: 'KMXX 1' }).expect(403);
    await http().patch(plate).set(rider.token).send({}).expect(400);

    // A second bicycle of their own, from their own sign-in only.
    const add = `/v1/sbg/drivers/${rider.did}/own-vehicles`;
    const secondPlate = `KMSE ${digits()}`;
    await http().post(add).set(other.token).send({ vehicleClass: 'bike', energy: 'pedal', plate: secondPlate }).expect(403);
    await http().post(add).set(operator).send({ vehicleClass: 'bike', energy: 'pedal', plate: secondPlate }).expect(403);
    const second = (await http().post(add).set(rider.token).send({ vehicleClass: 'bike', energy: 'electric', plate: secondPlate }).expect(201)).body.vehicle;
    expect(second).toMatchObject({ plate: secondPlate, vehicleClass: 'bike' });
    expect((await listOf(rider.did, rider.token)).filter((v) => v.own).map((v) => v.plate).sort()).toEqual([fixedPlate, secondPlate].sort());
    // Never two on one plate.
    const twice = await http().post(add).set(rider.token).send({ vehicleClass: 'bike', energy: 'pedal', plate: fixedPlate });
    expect([twice.status, twice.body.detail]).toEqual([409, `${fixedPlate} is on another vehicle in the network already. If that plate is yours, ask the help centre`]);
    expect((await http().patch(`/v1/sbg/vehicles/${second.vehicleId}/plate`).set(rider.token).send({ plate: fixedPlate })).status).toBe(409);
    // A class their licence does not cover.
    expect((await http().post(add).set(rider.token).send({ vehicleClass: 'van', energy: 'diesel', plate: `KMVA ${digits()}` }).expect(400)).body.detail).toMatch(/not licence-cleared for a van/);

    // One taken off: theirs alone; off their list after.
    const retire = `/v1/sbg/drivers/${rider.did}/own-vehicles/${second.vehicleId}/retire`;
    await http().post(`/v1/sbg/drivers/${other.did}/own-vehicles/${second.vehicleId}/retire`).set(rider.token).expect(403);
    await http().post(retire).set(operator).expect(403);
    expect((await http().post(retire).set(rider.token).expect(201)).body).toEqual({ vehicleId: second.vehicleId, plate: secondPlate, retired: true });
    expect((await listOf(rider.did, rider.token)).map((v) => v.vehicleId)).toEqual([first.vehicleId]);
  });

  it('a fleet: its office corrects its truck’s plate and its run not left yet says the new one; its driver, another fleet and staff may not', async () => {
    const managers = app.get(FleetManagerService);
    const aFleet = async () => {
      const n = digits();
      const m = managers.register({ companyName: `Plate Haulage ${n}`, contactPhone: `+2548${n}`, contactEmail: `pl-${n}@example.com`, ownerFullName: 'O O', ownerNationalId: `MGR-PL-${n}`, location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-PL-${n}`, transportOperatorLicence: `TOL-PL-${n}`, taxId: `TAX-PL-${n}` } } as never);
      managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
      managers.decideKyc(m.did, true);
      managers.recordBond(m.did);
      return { did: m.did, token: bearer((await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token) };
    };
    const fleet = await aFleet();
    const elsewhere = await aFleet();
    const driver = await aRider('Kamau', fleet.did);
    const van = app.get(VehicleService).register({ plate: `KCV ${digits()}`, vehicleClass: 'truck', truckSubtype: 'flatbed', energy: 'diesel', ownerName: 'Plate Haulage', managerDid: fleet.did } as never);
    const line = app.get(CorridorService).publish(app.get(CorridorService).proposeLine({ managerDid: fleet.did, company: 'Plate Haulage', name: `Nairobi – Nakuru ${digits()}`, originZone: 'Nairobi', destZone: 'Nakuru', vehicleType: 'truck' }).corridorId, 'did:glos:staff');
    const run = app.get(DepartureService).declare({ managerDid: fleet.did, corridorId: line.corridorId, vehicleId: van.vehicleId, leavesAt: new Date(Date.now() + 86_400_000).toISOString(), capacityKg: 500, basis: 'per_trip', amount: 80 });
    const plate = `/v1/sbg/vehicles/${van.vehicleId}/plate`;

    await http().patch(plate).set(driver.token).send({ plate: 'KCV 1' }).expect(403);
    await http().patch(plate).set(elsewhere.token).send({ plate: 'KCV 1' }).expect(403);
    await http().patch(plate).set(operator).send({ plate: 'KCV 1' }).expect(403);
    // A fleet's driver adds no vehicle of their own: the office registers its vehicles.
    expect((await http().post(`/v1/sbg/drivers/${driver.did}/own-vehicles`).set(driver.token).send({ vehicleClass: 'bike', energy: 'pedal', plate: `KMFD ${digits()}` }).expect(403)).body.detail).toMatch(/its office registers its vehicles/);

    const fixedPlate = `KCF ${digits()}`;
    expect((await http().patch(plate).set(fleet.token).send({ plate: fixedPlate }).expect(200)).body).toMatchObject({ plate: fixedPlate, plateHistory: [{ role: 'fleet' }] });
    expect(app.get(DepartureService).require(run.departureId).plate).toBe(fixedPlate);
  });
});
