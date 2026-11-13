import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { declared } from './declared';
import { DriverService } from '../src/modules/pudo/driver.service';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { FleetService } from '../src/modules/pudo/fleet.service';

/**
 * WHAT LOADING EQUIPMENT A VEHICLE CARRIES (the owner, 2026-11-13: "build loading equipment"). Vans carry it too — a tail-lift,
 * a pallet jack, a sack barrow, ramps, straps — and its owner changes it any time: the driver who owns it, or the fleet that
 * does, never a fleet's driver on shift and never another fleet. A piece its kind cannot carry is refused by name; handling
 * by hand, and what its body is built with, stay.
 */
describe('a vehicle’s loading equipment, set by its owner', () => {
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

  const onboard = (name: string, managerDid?: string) => {
    const drivers = app.get(DriverService);
    const d = drivers.register({ displayName: name, fullName: name, nationalId: `EQ-${name}-${digits()}`, mobile: `+2547${digits()}`, licenceClasses: ['van'], licenceNumber: `DL-${digits()}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true, ...(managerDid ? { managerDid } : {}) } as never);
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    return d;
  };

  it('a driver’s own van: a tail-lift and straps, said by its driver and shown on their list; never a forklift; another driver may not', async () => {
    const owner = onboard('Owner');
    const other = onboard('Other');
    const asOwner = bearer((await http().post('/v1/auth/token').send({ role: 'driver', did: owner.did }).expect(201)).body.access_token);
    const asOther = bearer((await http().post('/v1/auth/token').send({ role: 'driver', did: other.did }).expect(201)).body.access_token);
    declared(app, 'driver', owner.did, other.did);
    const van = app.get(VehicleService).register({ plate: `EQ-${digits()}`, vehicleClass: 'van', energy: 'diesel', ownerName: 'Owner', ownerDriverDid: owner.did } as never);
    app.get(FleetService).claimOwnVehicle(owner.did, van.vehicleId); // as signing up with it does
    const equipment = `/v1/sbg/vehicles/${van.vehicleId}/equipment`;

    const set = (await http().patch(equipment).set(asOwner).send({ equipment: ['TLT', 'STR'] }).expect(200)).body;
    expect(set.equipment).toEqual(['MAN', 'TLT', 'STR']);
    expect(set.equipmentSetBy).toMatchObject({ role: 'driver' });
    // A forklift is a truck's: refused by name, and nothing changes.
    expect((await http().patch(equipment).set(asOwner).send({ equipment: ['FLT'] }).expect(400)).body.detail).toMatch(/A van cannot carry a forklift: it carries a sack barrow, a pallet jack, a tail-lift, loading ramps, straps/);
    await http().patch(equipment).set(asOwner).send({ equipment: ['JETPACK'] }).expect(400);
    expect((await http().get(`/v1/sbg/vehicles/${van.vehicleId}`).set(operator).expect(200)).body.equipment).toEqual(['MAN', 'TLT', 'STR']);
    // On their list, without handling by hand.
    const listed = (await http().get(`/v1/sbg/fleet/drivers/${owner.did}/vehicles`).set(asOwner).expect(200)).body.vehicles.find((v: { vehicleId: string }) => v.vehicleId === van.vehicleId);
    expect(listed).toMatchObject({ own: true, equipment: ['TLT', 'STR'] });
    // Another driver may not; the whole list replaces the last — an empty one takes it all off.
    await http().patch(equipment).set(asOther).send({ equipment: [] }).expect(403);
    expect((await http().patch(equipment).set(asOwner).send({ equipment: [] }).expect(200)).body.equipment).toEqual(['MAN']);
  });

  it('a fleet’s van: the fleet sets it, not its driver on shift, not another fleet; staff may; a bike carries none; a crane truck keeps its crane', async () => {
    const managers = app.get(FleetManagerService);
    const aFleet = async () => {
      const n = digits();
      const m = managers.register({ companyName: `Eq Haulage ${n}`, contactPhone: `+2548${n}`, contactEmail: `eq-${n}@example.com`, ownerFullName: 'O O', ownerNationalId: `MGR-EQ-${n}`, location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-EQ-${n}`, transportOperatorLicence: `TOL-EQ-${n}`, taxId: `TAX-EQ-${n}` } } as never);
      managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
      managers.decideKyc(m.did, true);
      managers.recordBond(m.did);
      return { did: m.did, token: bearer((await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token) };
    };
    const fleet = await aFleet();
    const rival = await aFleet();
    const vehicles = app.get(VehicleService);
    const van = vehicles.register({ plate: `EQF-${digits()}`, vehicleClass: 'van', energy: 'diesel', ownerName: 'Eq Haulage', ownerType: 'fleet_owned', managerDid: fleet.did } as never);
    const equipment = `/v1/sbg/vehicles/${van.vehicleId}/equipment`;

    expect((await http().patch(equipment).set(fleet.token).send({ equipment: ['PLT', 'HTR'] }).expect(200)).body).toMatchObject({ equipment: ['MAN', 'PLT', 'HTR'], equipmentSetBy: { role: 'fleet' } });
    await http().patch(equipment).set(rival.token).send({ equipment: [] }).expect(403);
    // Its driver, on shift with it: sees it, does not change it.
    const amos = onboard('Amos', fleet.did);
    const asAmos = bearer((await http().post('/v1/auth/token').send({ role: 'driver', did: amos.did, tenant: fleet.did }).expect(201)).body.access_token);
    declared(app, 'driver', amos.did);
    await http().post(`/v1/sbg/fleet/drivers/${amos.did}/start-session`).set(operator).send({ vehicleId: van.vehicleId }).expect(201);
    expect((await http().get(`/v1/sbg/fleet/drivers/${amos.did}/session`).set(asAmos).expect(200)).body.vehicle.equipment).toEqual(['MAN', 'PLT', 'HTR']);
    expect((await http().patch(equipment).set(asAmos).send({ equipment: ['TLT'] }).expect(403)).body.detail).toMatch(/Only the fleet that owns this vehicle, or the driver who owns it/);
    expect((await http().patch(equipment).set(operator).send({ equipment: ['TLT'] }).expect(200)).body).toMatchObject({ equipment: ['MAN', 'TLT'], equipmentSetBy: { role: 'staff' } });

    // Registered with equipment its kind cannot carry: refused before anything is made.
    expect((await http().post('/v1/sbg/vehicles').set(operator).send({ plate: `EQB-${digits()}`, vehicleClass: 'bike', energy: 'pedal', ownerName: 'X', equipment: ['HTR'] }).expect(400)).body.detail).toMatch(/A bike carries no loading equipment/);
    expect((await http().post('/v1/sbg/vehicles').set(operator).send({ plate: `EQV-${digits()}`, vehicleClass: 'van', energy: 'diesel', ownerName: 'X', equipment: ['TLT'] }).expect(201)).body.equipment).toEqual(['MAN', 'TLT']);
    // A crane truck's crane is its body's: emptying the list leaves it.
    const crane = vehicles.register({ plate: `EQC-${digits()}`, vehicleClass: 'truck', truckSubtype: 'crane', energy: 'diesel', ownerName: 'X', ownerType: 'fleet_owned', managerDid: fleet.did } as never);
    expect((await http().patch(`/v1/sbg/vehicles/${crane.vehicleId}/equipment`).set(fleet.token).send({ equipment: [] }).expect(200)).body.equipment).toEqual(['MAN', 'CRN', 'STR']);
  });
});
