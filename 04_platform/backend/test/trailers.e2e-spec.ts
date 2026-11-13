import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { declared } from './declared';
import { DriverService } from '../src/modules/pudo/driver.service';
import { FleetService } from '../src/modules/pudo/fleet.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';

type Auth = Record<string, string>;

/**
 * 2026-11-13 — A VAN TOWING A TRAILER, OVER THE WIRE (the owner: "consider a trailer for VANs especially — movers use vans and trailers
 * in cities"; plan D1–D5, "build as recommended"). A Kenyan courier says what their van may tow, keeps a trailer (its Z plate's
 * card shown), hitches it on a shift — what the pair takes is what loads are offered by — unhitches it, hires one for the day; a
 * trailer over 750 kg is refused in Kenya until the law is confirmed; nobody else hitches it.
 */
describe('a van towing a trailer, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let staff: Auth;
  const bearer = (token: string): Auth => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    staff = bearer((await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token);
  });

  afterAll(async () => {
    await app?.close();
  });

  async function aCourier(name: string): Promise<{ did: string; token: Auth; vanId: string }> {
    const drivers = app.get(DriverService);
    const d = drivers.register({ displayName: name, fullName: name, nationalId: `TR-${name}-${digits()}`, mobile: `+2547${digits()}`, licenceClasses: ['van'], licenceNumber: `DL-${digits()}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true, jurisdiction: 'KE' } as never);
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    declared(app, 'driver', d.did);
    const van = app.get(VehicleService).register({ plate: `TRV-${digits()}`, vehicleClass: 'van', energy: 'diesel', ownerName: name, ownerDriverDid: d.did } as never);
    app.get(FleetService).claimOwnVehicle(d.did, van.vehicleId);
    return { did: d.did, token: bearer((await http().post('/v1/auth/token').send({ role: 'driver', did: d.did }).expect(201)).body.access_token), vanId: van.vehicleId };
  }

  const photo = async (who: Auth) => {
    const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`card:${digits()}`)]).toString('base64')}`;
    return (await http().post('/v1/sbg/media').set(who).send({ kind: 'registration', dataUrl }).expect(201)).body.mediaId as string;
  };

  it('keeps a trailer, hitches it on a shift — the pair is what it takes — unhitches it, hires one; Kenya refuses over 750 kg; nobody else hitches it', async () => {
    const me = await aCourier('Mover');
    const other = await aCourier('Other');
    const fleet = app.get(FleetService);
    const vanKg = fleet['vehicles'].get(me.vanId).capacityKg as number;

    // What the van may tow, from its registration.
    await http().patch(`/v1/sbg/vehicles/${me.vanId}/towing`).set(other.token).send({ brakedKg: 1500, unbrakedKg: 750 }).expect(403);
    expect((await http().patch(`/v1/sbg/vehicles/${me.vanId}/towing`).set(me.token).send({ brakedKg: 1500, unbrakedKg: 750 }).expect(200)).body.towLimits).toMatchObject({ brakedKg: 1500, unbrakedKg: 750, setBy: { role: 'driver' } });

    // A trailer of its own: in Kenya its Z plate's card is shown.
    const box = { plate: 'ZE 1234', maxKg: 750, emptyKg: 380, braked: false, closed: true, litres: 5500, ramp: true };
    expect((await http().post('/v1/sbg/trailers').set(me.token).send(box).expect(400)).body).toMatchObject({ code: 'PHOTO_REQUIRED' });
    const kept = (await http().post('/v1/sbg/trailers').set(me.token).send({ ...box, registrationRef: await photo(me.token) }).expect(201)).body;
    expect(kept).toMatchObject({ plate: 'ZE 1234', payloadKg: 370, volumeM3: 5.5, ramp: true, ownerDriverDid: me.did });
    expect((await http().get('/v1/sbg/trailers').set(me.token).expect(200)).body.map((t: { trailerId: string }) => t.trailerId)).toEqual([kept.trailerId]);
    expect((await http().get('/v1/sbg/trailers').set(other.token).expect(200)).body).toEqual([]);

    // Hitched on a shift: the pair is what loads are offered by.
    expect((await http().post(`/v1/sbg/fleet/drivers/${me.did}/hitch`).set(me.token).send({ trailerId: kept.trailerId }).expect(400)).body.detail).toMatch(/Start your shift first/);
    await http().post(`/v1/sbg/fleet/drivers/${me.did}/start-session`).set(staff).send({ vehicleId: me.vanId }).expect(201);
    await http().post(`/v1/sbg/fleet/drivers/${me.did}/hitch`).set(staff).send({ trailerId: kept.trailerId }).expect(403);
    expect((await http().post(`/v1/sbg/fleet/drivers/${me.did}/hitch`).set(me.token).send({ trailerId: kept.trailerId }).expect(201)).body.trailer).toMatchObject({ trailerId: kept.trailerId, payloadKg: 370, ramp: true });
    expect(fleet.vehicleForDriver(me.did)).toMatchObject({ capacityKg: vanKg + 370 });
    expect(fleet.vehicleForDriver(me.did)!.equipment).toContain('RMP');
    expect((await http().get(`/v1/sbg/fleet/drivers/${me.did}/session`).set(me.token).expect(200)).body.assignment.trailer).toMatchObject({ plate: 'ZE 1234' });
    // Its rate while towing, where set.
    await http().patch(`/v1/sbg/vehicles/${me.vanId}/pricing`).set(me.token).send({ price: 40, withTrailer: 55 }).expect(200);
    expect(fleet.vehicleForDriver(me.did)!.pricePerKm).toBe(55);
    // Nobody else hitches it, nor for this driver.
    await http().post(`/v1/sbg/fleet/drivers/${me.did}/hitch`).set(other.token).send({ trailerId: kept.trailerId }).expect(403);
    await http().post(`/v1/sbg/fleet/drivers/${other.did}/start-session`).set(staff).send({ vehicleId: other.vanId }).expect(201);
    expect((await http().post(`/v1/sbg/fleet/drivers/${other.did}/hitch`).set(other.token).send({ trailerId: kept.trailerId }).expect(403)).body.detail).toMatch(/not yours or your fleet's to hitch/);

    // Unhitched: the van alone again.
    await http().post(`/v1/sbg/fleet/drivers/${me.did}/unhitch`).set(me.token).expect(201);
    expect(fleet.vehicleForDriver(me.did)).toMatchObject({ capacityKg: vanKg, pricePerKm: 40 });
    await http().post(`/v1/sbg/fleet/drivers/${me.did}/unhitch`).set(me.token).expect(400);

    // Hired for the day: up to 750 kg on the ordinary licence in Kenya; heavier refused until the law is confirmed, whatever it says.
    await http().patch(`/v1/sbg/fleet/drivers/${me.did}/towing`).set(me.token).send({ kinds: ['BE'] }).expect(200);
    await http().patch(`/v1/sbg/fleet/drivers/${me.did}/towing`).set(me.token).send({ kinds: ['XL'] }).expect(400);
    expect((await http().post(`/v1/sbg/fleet/drivers/${me.did}/hitch`).set(me.token).send({ hire: { plate: 'HIRE 1', maxKg: 1300, emptyKg: 450, braked: true, closed: true } }).expect(400)).body.detail).toMatch(/^In Kenya a car or van tows a trailer up to 750 kg/);
    expect((await http().post(`/v1/sbg/fleet/drivers/${me.did}/hitch`).set(me.token).send({ hire: { plate: 'HIRE 2', maxKg: 700, emptyKg: 250, braked: false, closed: false } }).expect(201)).body.trailer).toMatchObject({ hired: true, plate: 'HIRE 2', payloadKg: 450 });

    // Taken off by whoever keeps it.
    await http().delete(`/v1/sbg/trailers/${kept.trailerId}`).set(other.token).expect(403);
    await http().delete(`/v1/sbg/trailers/${kept.trailerId}`).set(me.token).expect(200);
    expect((await http().get('/v1/sbg/trailers').set(me.token).expect(200)).body).toEqual([]);
  });

  it('a fleet keeps a trailer; its drivers hitch it one shift at a time; its driver keeps none of their own', async () => {
    const managers = app.get(FleetManagerService);
    const n = digits();
    const m = managers.register({ companyName: `Tow Haulage ${n}`, contactPhone: `+2548${n}`, contactEmail: `tow-${n}@example.com`, ownerFullName: 'O O', ownerNationalId: `MGR-TOW-${n}`, location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-TOW-${n}`, transportOperatorLicence: `TOL-TOW-${n}`, taxId: `TAX-TOW-${n}` } } as never);
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    const asFleet = bearer((await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token);
    const drivers = app.get(DriverService);
    const vehicles = app.get(VehicleService);
    const aDriver = async (name: string) => {
      const d = drivers.register({ displayName: name, fullName: name, nationalId: `TRF-${name}-${digits()}`, mobile: `+2547${digits()}`, licenceClasses: ['van'], licenceNumber: `DL-${digits()}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true, managerDid: m.did } as never);
      drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
      drivers.decideKyc(d.did, true);
      declared(app, 'driver', d.did);
      const van = vehicles.register({ plate: `TRF-${digits()}`, vehicleClass: 'van', energy: 'diesel', ownerName: 'Tow Haulage', ownerType: 'fleet_owned', managerDid: m.did } as never);
      await http().patch(`/v1/sbg/vehicles/${van.vehicleId}/towing`).set(asFleet).send({ brakedKg: 1500, unbrakedKg: 750 }).expect(200);
      await http().post(`/v1/sbg/fleet/drivers/${d.did}/start-session`).set(staff).send({ vehicleId: van.vehicleId }).expect(201);
      return { did: d.did, token: bearer((await http().post('/v1/auth/token').send({ role: 'driver', did: d.did, tenant: m.did }).expect(201)).body.access_token) };
    };
    const a = await aDriver('Ana');
    const b = await aDriver('Ben');
    // The fleet keeps it — its manager's photo of the card; its driver keeps none of their own, and sees the fleet's.
    const kept = (await http().post('/v1/sbg/trailers').set(asFleet).send({ plate: 'ZF 4321', maxKg: 700, emptyKg: 250, braked: false, closed: true, registrationRef: await photo(asFleet) }).expect(201)).body;
    expect(kept).toMatchObject({ managerDid: m.did, payloadKg: 450 });
    expect((await http().post('/v1/sbg/trailers').set(a.token).send({ plate: 'MINE 1', maxKg: 700, emptyKg: 250, braked: false, closed: true }).expect(403)).body.detail).toMatch(/Your fleet keeps your trailers/);
    expect((await http().get('/v1/sbg/trailers').set(a.token).expect(200)).body.map((t: { trailerId: string }) => t.trailerId)).toEqual([kept.trailerId]);
    // One shift at a time.
    await http().post(`/v1/sbg/fleet/drivers/${a.did}/hitch`).set(a.token).send({ trailerId: kept.trailerId }).expect(201);
    expect((await http().post(`/v1/sbg/fleet/drivers/${b.did}/hitch`).set(b.token).send({ trailerId: kept.trailerId }).expect(400)).body).toMatchObject({ code: "ALREADY_COUPLED", detail: expect.stringMatching(/hitched on another shift/) });
    await http().post(`/v1/sbg/fleet/drivers/${a.did}/unhitch`).set(a.token).expect(201);
    await http().post(`/v1/sbg/fleet/drivers/${b.did}/hitch`).set(b.token).send({ trailerId: kept.trailerId }).expect(201);
  });
});
