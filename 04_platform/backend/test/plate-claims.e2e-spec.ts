import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { declared } from './declared';
import { DriverService } from '../src/modules/pudo/driver.service';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { FleetService } from '../src/modules/pudo/fleet.service';
import { NotificationService } from '../src/modules/pudo/notification.service';
import { ANSWER_DAYS, PlateClaimService } from '../src/modules/pudo/plate-claim.service';

/**
 * 2026-11-21 — THE OWNER: "add the check and consider that a vehicle may be sold and no longer belongs to a driver as well."
 * A plate names one vehicle in use. Whoever bought a vehicle its seller never took off asks — "I bought it" — and the seller
 * answers with one tap: sold (it comes off their vehicles, the plate is free, the buyer told) or still theirs. Not answered in
 * fourteen days, staff decide with a reason both hear. Nobody learns who owns a plate by asking.
 */
describe('a plate claimed by whoever bought the vehicle, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 1e8)).padStart(8, '0');
  const settle = async () => {
    for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
  };

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

  const aRider = async (name: string) => {
    const d = app.get(DriverService).register({ displayName: name, fullName: name, nationalId: `PC-${name}-${digits()}`, mobile: `+2547${digits()}`, licenceClasses: ['bike'], criminalRecordClear: true } as never);
    declared(app, 'driver', d.did);
    return { did: d.did, name, token: bearer((await http().post('/v1/auth/token').send({ role: 'driver', did: d.did }).expect(201)).body.access_token) };
  };
  const aBike = (ownerDid: string, ownerName: string) => {
    const v = app.get(VehicleService).register({ plate: `KMPC ${digits()}`, vehicleClass: 'bike', energy: 'pedal', ownerName, ownerDriverDid: ownerDid } as never);
    app.get(FleetService).claimOwnVehicle(ownerDid, v.vehicleId);
    return v;
  };
  const inbox = (did: string) => app.get(NotificationService).inboxFor(did).filter((n) => n.kind === 'plate_claim');
  const add = (rider: { did: string; token: { authorization: string } }, plate: string) => http().post(`/v1/sbg/drivers/${rider.did}/own-vehicles`).set(rider.token).send({ vehicleClass: 'bike', energy: 'pedal', plate });

  it('sold: the seller is asked by name, answers with one tap, and the buyer adds it — told at each step', async () => {
    const seller = await aRider('Wanjiru');
    const buyer = await aRider('Otieno');
    const bike = aBike(seller.did, seller.name);
    // The buyer types the plate: refused, with the way on.
    expect((await add(buyer, bike.plate).expect(409)).body).toMatchObject({ code: 'DUPLICATE', params: { field: 'plate' }, detail: `${bike.plate} is on another vehicle in the network already. If you bought it, ask its owner whether they sold it` });

    // "I bought it": nobody else may ask in a driver's name; asking twice is one ask.
    await http().post('/v1/sbg/plate-claims').set(operator).send({ plate: bike.plate }).expect(403);
    const asked = (await http().post('/v1/sbg/plate-claims').set(buyer.token).send({ plate: bike.plate.toLowerCase() }).expect(201)).body;
    expect(asked).toMatchObject({ plate: bike.plate, vehicleClass: 'bike', state: 'asked' });
    expect((await http().post('/v1/sbg/plate-claims').set(buyer.token).send({ plate: bike.plate }).expect(201)).body.claimId).toBe(asked.claimId);
    // Never who owns it: the buyer's view names nobody.
    const buyerView = (await http().get('/v1/sbg/plate-claims').set(buyer.token).expect(200)).body;
    expect(buyerView).toEqual({ forMe: [], asked: [expect.objectContaining({ claimId: asked.claimId, state: 'asked' })] });
    expect(JSON.stringify(buyerView)).not.toContain(seller.name);

    // The seller is told, by the buyer's name, where they answer.
    await settle();
    expect(inbox(seller.did)[0]).toMatchObject({ title: `Did you sell ${bike.plate}?`, link: '/?go=home' });
    expect(inbox(seller.did)[0].body).toContain(`${buyer.name} says they bought it`);
    const sellerView = (await http().get('/v1/sbg/plate-claims').set(seller.token).expect(200)).body;
    expect(sellerView.forMe).toEqual([expect.objectContaining({ claimId: asked.claimId, plate: bike.plate, askedBy: buyer.name })]);

    // Only the seller answers; never mid-shift.
    await http().post(`/v1/sbg/plate-claims/${asked.claimId}/answer`).set(buyer.token).send({ sold: true }).expect(403);
    await http().post(`/v1/sbg/plate-claims/${asked.claimId}/answer`).set(operator).send({ sold: true }).expect(403);
    app.get(FleetService).couple(seller.did, bike.vehicleId);
    expect((await http().post(`/v1/sbg/plate-claims/${asked.claimId}/answer`).set(seller.token).send({ sold: true }).expect(400)).body.detail).toMatch(/A shift is running on .*: end it first/);
    app.get(FleetService).uncouple(seller.did);
    expect((await http().post(`/v1/sbg/plate-claims/${asked.claimId}/answer`).set(seller.token).send({ sold: true }).expect(201)).body.state).toBe('sold');
    expect(app.get(VehicleService).get(bike.vehicleId).status).toBe('RETIRED');
    await http().post(`/v1/sbg/plate-claims/${asked.claimId}/answer`).set(seller.token).send({ sold: false }).expect(400);

    // The buyer is told it is free, and adds it.
    await settle();
    expect(inbox(buyer.did)[0]).toMatchObject({ title: `${bike.plate} is free: add it`, link: '/?go=home' });
    expect((await add(buyer, bike.plate).expect(201)).body.vehicle.plate).toBe(bike.plate);
  });

  it('kept: the seller says it is still theirs, and the buyer is pointed to the help centre with their papers', async () => {
    const owner = await aRider('Achieng');
    const asker = await aRider('Kibet');
    const bike = aBike(owner.did, owner.name);
    const c = (await http().post('/v1/sbg/plate-claims').set(asker.token).send({ plate: bike.plate }).expect(201)).body;
    expect((await http().post(`/v1/sbg/plate-claims/${c.claimId}/answer`).set(owner.token).send({ sold: false }).expect(201)).body.state).toBe('kept');
    expect(app.get(VehicleService).get(bike.vehicleId).status).toBe('ACTIVE');
    await settle();
    expect(inbox(asker.did)[0]).toMatchObject({ title: `${bike.plate} is still its owner’s` });
    expect(inbox(asker.did)[0].body).toMatch(/ask the help centre, with the registration papers in your name/);
    // Their own plate, or one on no vehicle: nothing to ask.
    expect((await http().post('/v1/sbg/plate-claims').set(owner.token).send({ plate: bike.plate }).expect(400)).body.detail).toBe(`${bike.plate} is one of your vehicles already`);
    expect((await http().post('/v1/sbg/plate-claims').set(owner.token).send({ plate: `KMNO ${digits()}` }).expect(400)).body.detail).toMatch(/is on no vehicle in use now: add it/);
  });

  it(`not answered in ${ANSWER_DAYS} days: staff see it with when the vehicle last went out, and decide with a reason both hear`, async () => {
    const owner = await aRider('Mutua');
    const asker = await aRider('Njeri');
    const bike = aBike(owner.did, owner.name);
    const c = (await http().post('/v1/sbg/plate-claims').set(asker.token).send({ plate: bike.plate }).expect(201)).body;
    // Staff cannot decide while it waits for the owner.
    expect((await http().post(`/v1/sbg/vehicles/${bike.vehicleId}/plate-claim-decision`).set(operator).send({ claimId: c.claimId, release: true, reason: 'x' }).expect(400)).body.detail).toMatch(/waiting for its owner's answer/);
    const claims = app.get(PlateClaimService);
    claims.sweep(Date.now() + ANSWER_DAYS * 86_400_000 + 60_000);
    await settle();
    expect(inbox(asker.did)[0]).toMatchObject({ title: `No answer about ${bike.plate} yet` });
    // Too late for the owner to answer; staff have it.
    await http().post(`/v1/sbg/plate-claims/${c.claimId}/answer`).set(owner.token).send({ sold: false }).expect(400);
    const lapsed = (await http().get('/v1/sbg/plate-claims/lapsed').set(operator).expect(200)).body as Array<Record<string, unknown>>;
    expect(lapsed.find((l) => l.claimId === c.claimId)).toMatchObject({ vehicleId: bike.vehicleId, plate: bike.plate, claimant: { kind: 'driver', name: asker.name }, holder: { kind: 'driver', name: owner.name } });
    // A driver never reaches the staff queue or the decision.
    await http().get('/v1/sbg/plate-claims/lapsed').set(asker.token).expect(403);
    await http().post(`/v1/sbg/vehicles/${bike.vehicleId}/plate-claim-decision`).set(asker.token).send({ claimId: c.claimId, release: true, reason: 'x' }).expect(403);
    // A reason is required; then taken off, and both told why.
    await http().post(`/v1/sbg/vehicles/${bike.vehicleId}/plate-claim-decision`).set(operator).send({ claimId: c.claimId, release: true }).expect(400);
    const done = (await http().post(`/v1/sbg/vehicles/${bike.vehicleId}/plate-claim-decision`).set(operator).send({ claimId: c.claimId, release: true, reason: 'The logbook in their name was shown; the bike has not gone out in months.' }).expect(201)).body;
    expect(done).toMatchObject({ state: 'released', reason: 'The logbook in their name was shown; the bike has not gone out in months.' });
    expect(app.get(VehicleService).get(bike.vehicleId).status).toBe('RETIRED');
    await settle();
    expect(inbox(asker.did)[0].title).toBe(`${bike.plate} is free: add it`);
    expect(inbox(asker.did)[0].body).toContain('The logbook in their name was shown');
    expect(inbox(owner.did)[0]).toMatchObject({ title: `${bike.plate} was taken off your vehicles` });
    expect((await http().get('/v1/sbg/plate-claims/lapsed').set(operator).expect(200)).body.map((l: { claimId: string }) => l.claimId)).not.toContain(c.claimId);
  });

  it('a fleet’s vehicle: its office is asked and answers on Vehicles; it takes one off itself as sold, never with a run waiting', async () => {
    const managers = app.get(FleetManagerService);
    const n = digits();
    const m = managers.register({ companyName: `Claim Haulage ${n}`, contactPhone: `+2548${n}`, contactEmail: `pc-${n}@example.com`, ownerFullName: 'O O', ownerNationalId: `MGR-PC-${n}`, location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-PC-${n}`, transportOperatorLicence: `TOL-PC-${n}`, taxId: `TAX-PC-${n}` } } as never);
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    const office = bearer((await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token);
    // The fleet's own registration asks the plate too.
    const plate = `KCPC ${digits()}`;
    const van = (await http().post('/v1/sbg/vehicles').set(office).send({ plate, vehicleClass: 'van', energy: 'diesel', ownerName: 'Claim Haulage' }).expect(201)).body;
    expect((await http().post('/v1/sbg/vehicles').set(office).send({ plate, vehicleClass: 'van', energy: 'diesel', ownerName: 'Claim Haulage' }).expect(409)).body.params).toMatchObject({ field: 'plate' });
    const buyer = await aRider('Chebet');
    const c = (await http().post('/v1/sbg/plate-claims').set(buyer.token).send({ plate }).expect(201)).body;
    await settle();
    expect(app.get(NotificationService).inboxFor(m.did).find((x) => x.kind === 'plate_claim')).toMatchObject({ title: `Did you sell ${plate}?`, link: '/?go=vehicles' });
    expect((await http().get('/v1/sbg/plate-claims').set(office).expect(200)).body.forMe).toEqual([expect.objectContaining({ claimId: c.claimId, askedBy: buyer.name })]);
    expect((await http().post(`/v1/sbg/plate-claims/${c.claimId}/answer`).set(office).send({ sold: true }).expect(201)).body.state).toBe('sold');
    // Sold or scrapped from the console itself: retired, and refused once it is.
    const other = (await http().post('/v1/sbg/vehicles').set(office).send({ plate: `KCPD ${digits()}`, vehicleClass: 'van', energy: 'diesel', ownerName: 'Claim Haulage' }).expect(201)).body;
    expect((await http().post(`/v1/sbg/vehicles/${other.vehicleId}/retire`).set(office).expect(201)).body.status).toBe('RETIRED');
    expect((await http().post(`/v1/sbg/vehicles/${other.vehicleId}/retire`).set(office).expect(400)).body.detail).toMatch(/is off the list already/);
    expect(van.vehicleId).toBeTruthy();
  });

  it('no more than three plates asked about and unanswered at once', async () => {
    const asker = await aRider('Wekesa');
    const owner = await aRider('Moraa');
    const bikes = [0, 1, 2, 3].map(() => aBike(owner.did, owner.name));
    for (const b of bikes.slice(0, 3)) await http().post('/v1/sbg/plate-claims').set(asker.token).send({ plate: b.plate }).expect(201);
    expect((await http().post('/v1/sbg/plate-claims').set(asker.token).send({ plate: bikes[3].plate }).expect(400)).body.detail).toBe('You have asked about 3 plates already: wait for their answers');
  });
});
