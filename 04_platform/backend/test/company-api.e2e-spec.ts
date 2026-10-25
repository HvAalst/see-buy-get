import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { declared } from './declared';
import { AGREED } from './agreed';

/**
 * THE API FOR A COMPANY'S OWN SYSTEMS, over the wire (the user, round 12: "An API for businesses and fleets"; "Post, send
 * in, take at its price"; "Same as the system"). A business's owners make its keys and any manager a fleet's; a key does
 * what the company's people would do the same way, through the same doors and checks; a test key keeps nothing.
 */
describe('a company’s own system, with its key, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator = '';
  const tag = Math.random().toString(36).slice(2, 8);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const keyed = (key: string) => ({ 'x-sbg-key': key });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const PIN = '48261';
  let seq = 0;
  const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const yesterday = () => new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);

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

  async function aPerson(): Promise<{ phone: string; token: string }> {
    seq += 1;
    const phone = `+2547${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `api-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201);
    return { phone, token: enrolled.body.token.access_token };
  }

  const aLoad = (over: Record<string, unknown> = {}) => ({ description: 'Tea, 40 cartons', pickupLocation: { lat: -0.37, lng: 35.28 }, pickupLabel: 'Kericho factory', destLabel: 'Mombasa port', destLocation: { lat: -4.05, lng: 39.66 }, weightKg: 1200, packaging: 'palletised', pickupCountry: 'KE', destCountry: 'KE', ...over });

  it('a business’s key reads its loads, posts one and withdraws one nobody has taken — the app’s own checks; a test key keeps nothing', async () => {
    const owner = await aPerson();
    const created = await http().post('/v1/sbg/business').set(bearer(owner.token)).send({ name: `Api Traders ${tag}`, country: 'KE', registrationNo: `API-${tag}`, activities: ['shipper'], yourName: 'Wanjiku Owner' }).expect(201);
    const ownerBiz = created.body.token.access_token as string;
    const entityId = created.body.business.entityId as string;
    const booker = await aPerson();
    await http().post('/v1/sbg/business/me/members').set(bearer(ownerBiz)).send({ phone: booker.phone, name: 'Otieno Booker', role: 'booker' }).expect(201);
    const invite = (await http().get('/v1/sbg/business/mine').set(bearer(booker.token)).expect(200)).body.items.find((i: { entityId: string }) => i.entityId === entityId);
    await http().post(`/v1/sbg/business/invitations/${invite.memberId}/accept`).set(bearer(booker.token)).expect(201);
    const bookerBiz = (await http().post(`/v1/sbg/business/${entityId}/session`).set(bearer(booker.token)).expect(201)).body.token.access_token as string;

    // Its keys: an owner's to make and take away, under their name; anybody in it reads them; staff and bookers make none.
    expect((await http().get('/v1/sbg/business/me/keys').set(bearer(bookerBiz)).expect(200)).body.items).toEqual([]);
    await http().post('/v1/sbg/business/me/keys').set(bearer(bookerBiz)).send({ mode: 'live' }).expect(403);
    await http().post('/v1/sbg/business/me/keys').set(bearer(operator)).send({ mode: 'live' }).expect(403);
    await http().post('/v1/sbg/business/me/keys').set(bearer(ownerBiz)).send({ mode: 'gold' }).expect(400);
    const live = (await http().post('/v1/sbg/business/me/keys').set(bearer(ownerBiz)).send({ mode: 'live', label: 'ERP' }).expect(201)).body;
    expect(live.secret).toMatch(/^bk_live_[0-9a-f]{48}$/);
    expect(live.key).toMatchObject({ mode: 'live', label: 'ERP', hint: live.secret.slice(-4), createdBy: 'Wanjiku Owner' });
    const test = (await http().post('/v1/sbg/business/me/keys').set(bearer(ownerBiz)).send({ mode: 'test', label: 'ERP sandbox' }).expect(201)).body.secret as string;
    expect(test).toMatch(/^bk_test_/);
    const listed = (await http().get('/v1/sbg/business/me/keys').set(bearer(bookerBiz)).expect(200)).body.items;
    expect(listed).toHaveLength(2);
    expect(JSON.stringify(listed)).not.toContain(live.secret);

    // Each answer says which version of the API gave it.
    expect((await http().get('/v1/sbg/api/business/loads').set(keyed(live.secret)).expect(200)).headers['x-sbg-api-version']).toBe('1');
    // No key, or not one of ours: refused.
    await http().get('/v1/sbg/api/business/loads').expect(401);
    await http().get('/v1/sbg/api/business/loads').set(keyed('bk_live_0000')).expect(401);

    // A live key posts a load — the app's own row comes back, the key named as who posted it.
    const posted = (await http().post('/v1/sbg/api/business/loads').set(keyed(live.secret)).send(aLoad()).expect(201)).body;
    expect(posted).toMatchObject({ test: false, replayed: false, load: { description: 'Tea, 40 cartons', status: 'available' } });
    const freightId = posted.load.freightId as string;
    expect(app.get(DispatchService).requireFreightPublic(freightId)).toMatchObject({ postedByName: `ERP (…${live.secret.slice(-4)})`, settlement: 'between_parties' });
    const appRow = (await http().get('/v1/sbg/dispatch/posted').set(bearer(bookerBiz)).expect(200)).body.items.find((r: { freightId: string }) => r.freightId === freightId);
    expect(posted.load).toEqual(appRow);
    expect((await http().get(`/v1/sbg/api/business/loads/${freightId}`).set(keyed(live.secret)).expect(200)).body).toEqual(appRow);
    const count = async () => (await http().get('/v1/sbg/api/business/loads').set(keyed(live.secret)).expect(200)).body.total as number;
    expect(await count()).toBe(1);

    // Sent twice under one name: answered once.
    const once = await http().post('/v1/sbg/api/business/loads').set(keyed(live.secret)).set('idempotency-key', `idem-${tag}`).send(aLoad({ description: 'Coffee, 20 bags' })).expect(201);
    const twice = await http().post('/v1/sbg/api/business/loads').set(keyed(live.secret)).set('idempotency-key', `idem-${tag}`).send(aLoad({ description: 'Coffee, 20 bags' })).expect(201);
    expect(twice.body).toMatchObject({ replayed: true, load: { freightId: once.body.load.freightId } });
    expect(await count()).toBe(2);

    // A test key runs every check and posts nothing; a refusal is the app's, in the app's words.
    const tried = (await http().post('/v1/sbg/api/business/loads').set(keyed(test)).send(aLoad({ weightKg: 18000, packaging: 'bagged' })).expect(201)).body;
    expect(tried).toMatchObject({ test: true, load: { code: 'FRT-TEST', weightKg: 18000, status: 'available' } });
    expect(await count()).toBe(2);
    const termApp = await http().post('/v1/sbg/dispatch/freight').set(bearer(bookerBiz)).send(aLoad({ incoterm: 'DDP', namedPlace: 'Mombasa', destCountry: 'XX' }));
    const termKey = await http().post('/v1/sbg/api/business/loads').set(keyed(test)).send(aLoad({ incoterm: 'DDP', namedPlace: 'Mombasa', destCountry: 'XX' }));
    expect(termKey.status).toBe(termApp.status);
    expect(termKey.body.code).toBe('TERM_NOT_ACTIVE');
    expect(termKey.body.detail).toBe(termApp.body.detail);

    // Withdraw: a test key changes nothing; a live key withdraws one nobody has taken; one a carrier has is the app's.
    expect((await http().post(`/v1/sbg/api/business/loads/${freightId}/withdraw`).set(keyed(test)).send({ reason: 'Trying it out' }).expect(201)).body).toMatchObject({ test: true, withdrawn: false });
    expect((await http().get(`/v1/sbg/api/business/loads/${freightId}`).set(keyed(live.secret)).expect(200)).body.status).toBe('available');
    expect((await http().post(`/v1/sbg/api/business/loads/${freightId}/withdraw`).set(keyed(live.secret)).send({ reason: 'The buyer cancelled' }).expect(201)).body).toMatchObject({ test: false, withdrawn: true, status: 'cancelled' });
    expect((await http().post(`/v1/sbg/api/business/loads/${freightId}/withdraw`).set(keyed(live.secret)).send({ reason: 'Again' }).expect(400)).body.detail).toMatch(/already withdrawn/);
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    const coffee = once.body.load.freightId as string;
    store.set(coffee, { ...store.get(coffee), status: 'claimed', claimedBy: 'did:glos:driver-x' });
    expect((await http().post(`/v1/sbg/api/business/loads/${coffee}/withdraw`).set(keyed(live.secret)).send({ reason: 'Too late' }).expect(400)).body.detail).toMatch(/A carrier has this load/);

    // Another business's key reads none of it; taken away, a key stops at once.
    const rival = await aPerson();
    const rivalBiz = (await http().post('/v1/sbg/business').set(bearer(rival.token)).send({ name: `Rival ${tag}`, country: 'KE', registrationNo: `RIVAL-${tag}`, activities: ['shipper'], yourName: 'Rival Owner' }).expect(201)).body.token.access_token;
    const rivalKey = (await http().post('/v1/sbg/business/me/keys').set(bearer(rivalBiz)).send({ mode: 'live' }).expect(201)).body.secret;
    await http().get(`/v1/sbg/api/business/loads/${coffee}`).set(keyed(rivalKey)).expect(404);
    // The same retry name from another company's system is its own: never the first company's answer.
    const theirs = (await http().post('/v1/sbg/api/business/loads').set(keyed(rivalKey)).set('idempotency-key', `idem-${tag}`).send(aLoad({ description: 'Coffee, 20 bags' })).expect(201)).body;
    expect(theirs.replayed).toBe(false);
    expect(theirs.load.freightId).not.toBe(once.body.load.freightId);
    await http().post(`/v1/sbg/business/me/keys/${live.key.keyId}/revoke`).set(bearer(rivalBiz)).expect(404);
    await http().post(`/v1/sbg/business/me/keys/${live.key.keyId}/revoke`).set(bearer(bookerBiz)).expect(403);
    expect((await http().post(`/v1/sbg/business/me/keys/${live.key.keyId}/revoke`).set(bearer(ownerBiz)).expect(201)).body).toMatchObject({ revokedBy: 'Wanjiku Owner' });
    expect((await http().get('/v1/sbg/api/business/loads').set(keyed(live.secret)).expect(401)).body.detail).toMatch(/taken away/);
    // A business's key is no fleet's.
    await http().get('/v1/sbg/api/fleet/orders').set(keyed(test)).expect(403);
    // Staff read how many keys work, and do nothing with them.
    expect((await http().get(`/v1/sbg/businesses/${entityId}`).set(bearer(operator)).expect(200)).body.system).toMatchObject({ keys: { live: 0, test: 1 } });
  });

  /** An active fleet, its office signed in, and one of its drivers out on a shift in one of its trucks. */
  async function aFleetWithADriver(): Promise<{ did: string; name: string; office: string; driverDid: string; driverToken: string }> {
    const managers = app.get(FleetManagerService);
    const n = digits();
    const m = managers.register({
      companyName: `Api Fleet ${n}`, contactPhone: `+2548${n}6`, ownerFullName: 'O O', ownerNationalId: `MGR-API-${n}`, location: { lat: -1.2, lng: 36.8 },
      requirements: { businessRegistrationNo: `BRN-API-${n}`, transportOperatorLicence: `TOL-API-${n}`, taxId: `TAX-API-${n}` },
    });
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    declared(app, 'fleet', m.did);
    const office = (await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    const phone = `+2547${digits()}7`;
    const onboarded = await http().post('/v1/sbg/drivers/onboard').set(bearer(operator)).send({ displayName: 'Achieng', fullName: 'Achieng Driver', nationalId: `ID-API-${n}`, mobile: phone, licenceClasses: ['truck'], licenceNumber: `L-API-${n}`, licenceExpiresAt: new Date(Date.now() + 400 * 86_400_000).toISOString(), criminalRecordClear: true, managerDid: m.did }).expect(201);
    const driverDid = onboarded.body.did as string;
    await http().post(`/v1/sbg/fleet/drivers/${driverDid}/submit-kyc`).set(bearer(operator)).send({ idCopyRef: 'id.jpg', licenceCopyRef: 'licence.jpg' }).expect(201);
    await http().post(`/v1/sbg/fleet/drivers/${driverDid}/kyc-decision`).set(bearer(operator)).send({ approve: true, by: 'Test' }).expect(201);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `apidrv${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201);
    const session = await http().post('/v1/sbg/drivers/session').send({ phone, pin: PIN, device: enrolled.body.device }).expect(201);
    const driverToken = session.body.token.access_token as string;
    const truck = app.get(VehicleService).register({ plate: `API ${n.slice(-3)}T`, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 8000, ownerName: m.companyName, equipment: ['TLT', 'FLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, managerDid: m.did } as never);
    await http().post(`/v1/sbg/fleet/drivers/${driverDid}/start-session`).set(bearer(driverToken)).send({ vehicleId: truck.vehicleId, pin: PIN }).expect(201);
    return { did: m.did, name: m.companyName, office, driverDid, driverToken };
  }

  it('a fleet’s key sends orders in as a sheet is checked, reads its orders, plan and board, and takes a board load at its price', async () => {
    const fleet = await aFleetWithADriver();
    const other = await aFleetWithADriver();
    const own = `/v1/sbg/fleet/managers/${encodeURIComponent(fleet.did)}`;

    // Any manager makes its keys, under their name; staff make none.
    await http().post(`${own}/keys`).set(bearer(operator)).send({ mode: 'live' }).expect(403);
    await http().post(`${own}/keys`).set(bearer(other.office)).send({ mode: 'live' }).expect(403);
    const live = (await http().post(`${own}/keys`).set(bearer(fleet.office)).send({ mode: 'live', label: 'TMS' }).expect(201)).body;
    expect(live.secret).toMatch(/^fk_live_/);
    expect(live.key).toMatchObject({ createdBy: fleet.name, label: 'TMS' });
    const test = (await http().post(`${own}/keys`).set(bearer(fleet.office)).send({ mode: 'test' }).expect(201)).body.secret as string;
    const tms = `TMS (…${live.secret.slice(-4)})`;

    // Orders in, read exactly as a line of a sheet: each judged on its own, a refusal in words.
    const contractId = (await http().post(`${own}/contracts`).set(bearer(fleet.office)).send({ shipperName: 'Mjengo Hardware' }).expect(201)).body.contractId as string;
    const orders = (ref: string, deliverOn: string) => ({ contractId, pickupLabel: 'Industrial Area yard', pickupLat: -1.31, pickupLng: 36.85, orders: [{ reference: ref, goods: 'Cement, 20 bags', weightKg: 1000, deliverTo: 'Plot 4, Ruiru', lat: -1.146, lng: 36.96, deliverOn, window: '8-12', packaging: 'bagged' }] });
    const checked = (await http().post('/v1/sbg/api/fleet/orders').set(keyed(test)).send(orders(`T-${tag}`, tomorrow())).expect(201)).body;
    expect(checked).toMatchObject({ test: true, imported: false, ok: 1 });
    const sent = (await http().post('/v1/sbg/api/fleet/orders').set(keyed(live.secret)).send(orders(`L-${tag}`, tomorrow())).expect(201)).body;
    expect(sent).toMatchObject({ test: false, imported: true, ok: 1, problems: 0 });
    const late = (await http().post('/v1/sbg/api/fleet/orders').set(keyed(live.secret)).send(orders(`OLD-${tag}`, yesterday())).expect(201)).body;
    expect(late).toMatchObject({ ok: 0, problems: 1 });
    expect(late.rows[0].problems.join(' ')).toMatch(/\w/);
    // The same order as an uploaded sheet is judged the same way.
    const sheet = `Order number,Goods,Weight (kg),Deliver to,Lat,Lng,Delivery date,Window,Contact,Phone,Packaging,Instructions\r\nOLD2-${tag},"Cement, 20 bags",1000,"Plot 4, Ruiru",-1.146,36.96,${yesterday()},8-12,,,bagged,`;
    const viaSheet = (await http().post(`${own}/contracts/${contractId}/orders/import`).set(bearer(fleet.office)).send({ text: sheet, pickupLabel: 'Industrial Area yard', pickupLat: -1.31, pickupLng: 36.85 }).expect(201)).body;
    expect(viaSheet.rows[0].problems).toEqual(late.rows[0].problems);

    // What its key reads is what its screens read.
    const viaKey = (await http().get('/v1/sbg/api/fleet/orders').set(keyed(live.secret)).expect(200)).body.items;
    const viaApp = (await http().get(`${own}/orders`).set(bearer(fleet.office)).expect(200)).body.items;
    expect(viaKey).toEqual(viaApp);
    expect(viaKey.map((o: { orderRef?: string }) => o.orderRef)).toContain(`L-${tag}`);
    expect(viaKey.map((o: { orderRef?: string }) => o.orderRef)).not.toContain(`T-${tag}`);
    expect((await http().get('/v1/sbg/api/fleet/plan').query({ day: tomorrow() }).set(keyed(live.secret)).expect(200)).body).toEqual((await http().get(`${own}/plan`).query({ day: tomorrow() }).set(bearer(fleet.office)).expect(200)).body);

    // The board for its driver; where the driver is only once the fleet sends that to its own system.
    const dispatch = app.get(DispatchService);
    const board = dispatch.registerFreight({ description: 'Steel bars, 2 t', pickupLocation: { lat: -1.3, lng: 36.84 }, pickupLabel: 'Athi River yard', destLabel: 'Thika', destLocation: { lat: -1.03, lng: 37.07 }, weightKg: 2000 });
    const negotiable = dispatch.registerFreight({ description: 'Timber', pickupLocation: { lat: -1.3, lng: 36.84 }, pickupLabel: 'Athi River yard', destLabel: 'Juja', destLocation: { lat: -1.1, lng: 37.01 }, weightKg: 1500, commitMode: 'negotiate' });
    await http().post(`/v1/sbg/fleet/drivers/${fleet.driverDid}/locate`).set(bearer(fleet.driverToken)).send({ lat: -1.29, lng: 36.82 }).expect(201);
    const read = (await http().get('/v1/sbg/api/fleet/board').query({ driverDid: fleet.driverDid }).set(keyed(live.secret)).expect(200)).body;
    expect(read.drivers).toEqual([expect.objectContaining({ did: fleet.driverDid, name: 'Achieng' })]);
    expect(read.drivers[0]).not.toHaveProperty('location');
    expect(read.items.find((r: { freightId: string }) => r.freightId === board.freightId)).toMatchObject({ canTake: true });
    await http().put(`${own}/system`).set(bearer(fleet.office)).send({ url: 'https://tms.example.com/hooks' }).expect(200);
    await http().put(`${own}/system/positions`).set(bearer(fleet.office)).send({ everyMin: 5 }).expect(200);
    expect((await http().get('/v1/sbg/api/fleet/board').set(keyed(live.secret)).expect(200)).body.drivers[0].location).toEqual({ lat: -1.29, lng: 36.82 });
    await http().get('/v1/sbg/api/fleet/board').query({ driverDid: other.driverDid }).set(keyed(live.secret)).expect(404);

    // Take it: a test key says whether, why not, and what it would pay — and takes nothing.
    const would = (await http().post(`/v1/sbg/api/fleet/loads/${board.freightId}/take`).set(keyed(test)).send({ driverDid: fleet.driverDid }).expect(201)).body;
    expect(would).toMatchObject({ test: true, taken: false, canTake: true, blockers: [] });
    expect(would.price.total).toBeGreaterThan(0);
    expect(dispatch.requireFreightPublic(board.freightId).status).toBe('available');
    // Never another fleet's driver, never a load whose price is to be agreed, never an order under a contract.
    await http().post(`/v1/sbg/api/fleet/loads/${board.freightId}/take`).set(keyed(live.secret)).send({ driverDid: other.driverDid }).expect(404);
    expect((await http().post(`/v1/sbg/api/fleet/loads/${negotiable.freightId}/take`).set(keyed(live.secret)).send({ driverDid: fleet.driverDid })).body.code).toBe('NEGOTIATION_REQUIRED');
    const myOrder = viaKey.find((o: { orderRef?: string }) => o.orderRef === `L-${tag}`);
    await http().post(`/v1/sbg/api/fleet/loads/${myOrder.freightId}/take`).set(keyed(live.secret)).send({ driverDid: fleet.driverDid }).expect(403);
    // A live key takes it, at its price, under the key's name — as the office would.
    const taken = (await http().post(`/v1/sbg/api/fleet/loads/${board.freightId}/take`).set(keyed(live.secret)).send({ driverDid: fleet.driverDid }).expect(201)).body;
    expect(taken).toMatchObject({ test: false, taken: true, load: { freightId: board.freightId, status: 'claimed', driverName: 'Achieng', paid: false } });
    expect(taken.load.earning).toBe(would.price.total);
    expect(dispatch.requireFreightPublic(board.freightId).assignedBy).toMatchObject({ managerDid: fleet.did, name: tms });
    const earnings = (await http().get(`${own}/earnings`).set(bearer(fleet.office)).expect(200)).body.items.find((r: { freightId: string }) => r.freightId === board.freightId);
    expect(earnings.earning).toBe(taken.load.earning);

    // A fleet's key is no business's; another fleet's key reads none of this one's.
    await http().get('/v1/sbg/api/business/loads').set(keyed(live.secret)).expect(403);
    const otherKey = (await http().post(`/v1/sbg/fleet/managers/${encodeURIComponent(other.did)}/keys`).set(bearer(other.office)).send({ mode: 'live' }).expect(201)).body.secret;
    expect((await http().get('/v1/sbg/api/fleet/orders').set(keyed(otherKey)).expect(200)).body.items.map((o: { orderRef?: string }) => o.orderRef)).not.toContain(`L-${tag}`);
    // Its own limit per minute.
    let limited = 0;
    for (let i = 0; i < 125 && !limited; i++) if ((await http().get('/v1/sbg/api/fleet/orders').set(keyed(otherKey))).status === 429) limited = i;
    expect(limited).toBeGreaterThanOrEqual(119);
    await http().get('/v1/sbg/api/fleet/orders').set(keyed(live.secret)).expect(200);
    // Staff read the counts.
    const rows = (await http().get('/v1/sbg/fleet/managers').set(bearer(operator)).expect(200)).body as Array<{ did: string; system?: { keys?: unknown } }>;
    expect(rows.find((r) => r.did === fleet.did)?.system?.keys).toEqual({ live: 1, test: 1 });
  });
});
