import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { DriverService } from '../src/modules/pudo/driver.service';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';
import { FleetService } from '../src/modules/pudo/fleet.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { AGREED } from './agreed';
import { declared } from './declared';

/**
 * 2026-11-03 — TWO COLD LOADS ON ONE TRUCK, over the wire. A refrigerated body is kept at one temperature, so a cold load
 * goes on beside a cold one already on the truck — taken and not yet collected, or riding — only where their ranges meet
 * (the goods table's rule in cargo.types.ts, which waited for a load to carry a range of its own). Otherwise it is not
 * offered, the board marks it in the take's own words, and every door refuses it in them: a claim, a price named, a
 * price accepted, the office's assignment, a breakdown's handover. A range that overlaps rides together; goods not
 * carried cold ride with anything; once the load aboard is delivered, the other can go on.
 */
describe('two cold loads on one truck', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let biz = '';
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const iso = (ms: number) => new Date(ms).toISOString();
  const from = { lat: -1.31, lng: 36.84 };
  const to = { lat: -0.3, lng: 36.08 };
  const CLASH = 'This truck already carries a load kept at -25 to -18 °C; this one must be kept at 2 to 8 °C.';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    const phone = `+2547${digits()}6`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `twocold-${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    biz = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `Kudu Cold Foods ${digits()}`, country: 'KE', registrationNo: `TWC-${digits()}`, activities: ['shipper'], yourName: 'Owner' }).expect(201)).body.token.access_token as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  /** A truck driver in a refrigerated body — their own, or one of a fleet's — vetted, declared and signed in. */
  async function aReeferDriver(managerDid?: string): Promise<{ did: string; token: string; plate: string }> {
    const drivers = app.get(DriverService);
    const driver = drivers.register({ displayName: 'Baridi', fullName: 'Baridi Driver', nationalId: `ID-TC-${digits()}`, mobile: `+2547${digits()}7`, licenceClasses: ['truck'], licenceNumber: `L-${digits()}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true, ...(managerDid ? { managerDid } : {}) });
    drivers.submitKyc(driver.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(driver.did, true);
    const plate = `KDC ${digits().slice(0, 3)}C`;
    app.get(FleetService).couple(driver.did, app.get(VehicleService).register({ plate, vehicleClass: 'truck', truckSubtype: 'refrigerated', capacityKg: 9_000, ownerName: 'X', equipment: ['TLT'], baseFee: 0.5, pricePerKm: 0.1, ...(managerDid ? { managerDid } : {}) } as never).vehicleId);
    declared(app, 'driver', driver.did);
    if (managerDid) declared(app, 'fleet', managerDid);
    const token = (await http().post('/v1/auth/token').send({ role: 'driver', did: driver.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    return { did: driver.did, token, plate };
  }

  /** A fleet, checked and running, and its office signed in. */
  async function aFleet(): Promise<{ did: string; office: string }> {
    const managers = app.get(FleetManagerService);
    const n = digits();
    const m = managers.register({
      companyName: `Baridi Haulage ${n}`, contactPhone: `+2548${n}4`, contactEmail: `baridi-${n}@example.com`, ownerFullName: 'O O', ownerNationalId: `MGR-TC-${n}`, location: from,
      requirements: { businessRegistrationNo: `BRN-TC-${n}`, transportOperatorLicence: `TOL-TC-${n}`, taxId: `TAX-TC-${n}` },
    });
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    const office = (await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    return { did: m.did, office };
  }

  const post = async (description: string, over: Record<string, unknown>) =>
    (await http().post('/v1/sbg/dispatch/freight').set(bearer(biz)).send({ description, pickupLocation: from, pickupLabel: 'Kudu cold store', destLabel: 'Nakuru cold store', destLocation: to, weightKg: 900, packaging: 'palletised', natureCode: 'FOP', commitMode: 'instant', ...over }).expect(201)).body as { freightId: string; code: string };
  const offers = async (d: { did: string; token: string }) => (await http().post(`/v1/sbg/fleet/drivers/${encodeURIComponent(d.did)}/suggest-work`).set(bearer(d.token)).send({ from, to }).expect(201)).body.offers as Array<{ offerId: string; ref: string }>;
  const offerOf = async (d: { did: string; token: string }, freightId: string) => (await offers(d)).find((o) => o.ref === freightId);
  const claim = (d: { token: string }, offerId: string) => http().post(`/v1/sbg/dispatch/offers/${offerId}/claim`).set(bearer(d.token));
  const board = async (d: { token: string }) => (await http().get('/v1/sbg/dispatch/board').query(from).set(bearer(d.token)).expect(200)).body.items as Array<{ ref?: string; freightId?: string; blockers: Array<{ kind: string; code: string; message: string }> }>;
  const rowOf = (rows: Awaited<ReturnType<typeof board>>, freightId: string) => rows.find((r) => (r.ref ?? r.freightId) === freightId);
  const store = () => (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
  const setStatus = (freightId: string, status: string) => store().set(freightId, { ...store().get(freightId), status, ...(status === 'in_transit' ? { pickedUpAt: iso(Date.now() - 3_600_000) } : {}), ...(status === 'delivered' ? { deliveredAt: iso(Date.now()) } : {}) });
  const refused = (r: { status: number; body: { code?: string; detail?: string } }) => {
    expect(r.status).toBe(400);
    expect(r.body.code).toBe('CARGO_INCOMPATIBLE');
    return String(r.body.detail);
  };

  it('offers, takes and refuses by the range aboard: never a chilled load beside a frozen one — an overlapping one, and dry goods, ride along', async () => {
    const driver = await aReeferDriver();
    const frozen = await post('Frozen tilapia', { tempRange: { minC: -25, maxC: -18 } });
    const chilled = await post('Fresh milk', { tempRange: { minC: 2, maxC: 8 } });
    const alsoFrozen = await post('Frozen peas', { tempRange: { minC: -22, maxC: -15 } });
    const dry = await post('Maize flour', { natureCode: 'FOD' });

    // Nothing aboard: both offered. The chilled one's offer is kept, to be tried once the frozen load is taken.
    const chilledOffer = await offerOf(driver, chilled.freightId);
    expect(chilledOffer).toBeDefined();
    await claim(driver, (await offerOf(driver, frozen.freightId))!.offerId).expect(201);

    // Taken, not yet collected: the chilled load is offered no more, and the offer made before is refused, in words.
    expect(await offerOf(driver, chilled.freightId)).toBeUndefined();
    expect(refused(await claim(driver, chilledOffer!.offerId))).toContain(CLASH);
    // The board marks it, in the same words — something to resolve, not a truck to buy.
    expect(rowOf(await board(driver), chilled.freightId)?.blockers).toContainEqual({ kind: 'resolvable', code: 'COLD_RANGE_ABOARD', message: expect.stringContaining(CLASH) });
    expect(rowOf(await board(driver), alsoFrozen.freightId)?.blockers.map((b) => b.code)).not.toContain('COLD_RANGE_ABOARD');

    // Riding: still refused. A range that overlaps rides together; goods not carried cold ride with anything.
    setStatus(frozen.freightId, 'in_transit');
    expect(await offerOf(driver, chilled.freightId)).toBeUndefined();
    await claim(driver, (await offerOf(driver, alsoFrozen.freightId))!.offerId).expect(201);
    await claim(driver, (await offerOf(driver, dry.freightId))!.offerId).expect(201);

    // The breakdown's handover asks it too: a driver carrying frozen goods cannot take the chilled load over.
    expect(() => app.get(DispatchService).assertCanTakeLoads([chilled.freightId], driver.did)).toThrow(`${driver.plate} cannot take ${chilled.code}: ${CLASH}`);

    // Delivered, both frozen loads: the chilled one goes on.
    setStatus(frozen.freightId, 'delivered');
    setStatus(alsoFrozen.freightId, 'delivered');
    await claim(driver, (await offerOf(driver, chilled.freightId))!.offerId).expect(201);
  });

  it('refuses a price named, and a price accepted, beside a frozen load aboard', async () => {
    const driver = await aReeferDriver();
    const frozen = await post('Frozen prawns', { tempRange: { minC: -25, maxC: -18 } });
    const early = await post('Yoghurt, named a price on before', { commitMode: 'negotiate' });
    const late = await post('Cheese, named a price on after', { commitMode: 'negotiate', tempRange: { minC: 2, maxC: 8 } });
    const propose = (freightId: string) => http().post(`/v1/sbg/dispatch/freight/${freightId}/proposals`).set(bearer(driver.token)).send({ from, price: 9000 });
    const proposal = (await propose(early.freightId).expect(201)).body as { proposalId: string };
    await claim(driver, (await offerOf(driver, frozen.freightId))!.offerId).expect(201);

    // Naming a price is refused while the frozen load is aboard: its accept never could be.
    expect(refused(await propose(late.freightId))).toContain(CLASH);
    // …and a price named before is refused when the business accepts it: yoghurt with no range of its own is kept at 2–8 °C.
    expect(refused(await http().post(`/v1/sbg/dispatch/proposals/${proposal.proposalId}/accept`).set(bearer(biz)))).toContain(CLASH);
  });

  it('refuses the fleet office putting a chilled load on its driver carrying a frozen one', async () => {
    const fleet = await aFleet();
    const driver = await aReeferDriver(fleet.did);
    const frozen = await post('Frozen beef', { tempRange: { minC: -25, maxC: -18 } });
    const chilled = await post('Fresh fish', { tempRange: { minC: 0, maxC: 4 } });
    const assign = (freightId: string) => http().post(`/v1/sbg/fleet/managers/${encodeURIComponent(fleet.did)}/dispatch`).set(bearer(fleet.office)).send({ freightId, driverDid: driver.did });
    await assign(frozen.freightId).expect(201);
    expect(refused(await assign(chilled.freightId))).toContain('This truck already carries a load kept at -25 to -18 °C; this one must be kept at 0 to 4 °C.');
  });
});
