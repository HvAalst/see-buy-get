import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DriverService } from '../src/modules/pudo/driver.service';
import { FleetService } from '../src/modules/pudo/fleet.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { AGREED } from './agreed';
import { declared } from './declared';
import { FundingService } from '../src/foundation/funding/funding.service';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { PersonLoadPayService } from '../src/modules/pudo/person-load-pay.service';
import { requiredUnloadKeys } from '../src/modules/pudo/heavy-cargo';
import { RateLimitGuard } from '../src/foundation/http/rate-limit.guard';
import { OutboxMailSender } from '../src/foundation/mail/outbox-mail.sender';

/**
 * A PERSON POSTS A LOAD FROM THE SEND APP, over the wire (the owner, 2026-11-13: plan U5, "a person posts a load in the Send
 * app"; part 3a). In Uganda, where SeeBuyGet only matches, a person describes a fridge and posts it: always negotiated, paid to
 * the driver directly, in Uganda's money. A driver names a price; the person accepts it from their own sign-in. In Kenya,
 * where a company of ours takes the money, paying up front is coming — refused until then, never a load nobody is billed for.
 */
describe('a person posts a load, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const kampala = { lat: 0.3476, lng: 32.5825 };
  const entebbe = { lat: 0.0512, lng: 32.4637 };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  async function aPerson(phone = `+2547${digits()}5`): Promise<string> {
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `mover-${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    return (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token as string;
  }

  const fridge = (over: Record<string, unknown> = {}) => ({
    description: 'A fridge, upright',
    pickupLocation: kampala,
    pickupLabel: 'Ntinda, Kampala',
    destLabel: 'Entebbe',
    destLocation: entebbe,
    weightKg: 60,
    contactPhone: '+256700123456',
    work: { needs: 'one', pickup: { hands: 'one' }, delivery: { hands: 'one' }, marks: ['upright'] },
    ...over,
  });
  const post = (token: string, body: object) => http().post('/v1/sbg/dispatch/freight').set(bearer(token)).send(body);

  let person = '';
  let loadId = '';

  it('1 · in Uganda, where SeeBuyGet only matches: posted, always negotiated, paid to the driver directly, in Uganda’s money', async () => {
    person = await aPerson();
    const load = (await post(person, fridge({ commitMode: 'instant' })).expect(201)).body;
    loadId = load.freightId;
    expect(load).toMatchObject({ commitMode: 'negotiate', settlement: 'between_parties', pickupCountry: 'UG', destCountry: 'UG', postedCurrency: 'UGX' });
    expect(load.work.marks).toEqual(['upright']);
    // On the person's own list.
    const mine = (await http().get('/v1/sbg/dispatch/posted').set(bearer(person)).expect(200)).body.items as Array<{ freightId: string }>;
    expect(mine.map((r) => r.freightId)).toContain(loadId);
  });

  it('2 · refused in words: a number to call missing, a pin far from every town, a contract', async () => {
    const said = async (body: object) => {
      const r = await post(person, body);
      expect(r.status).toBeGreaterThanOrEqual(400);
      return String(r.body.detail);
    };
    expect(await said(fridge({ contactPhone: '' }))).toMatch(/number the driver can call/);
    expect(await said(fridge({ pickupLocation: { lat: -20, lng: 60 } }))).toMatch(/cannot tell which country the pickup is in/);
    expect(await said(fridge({ contractId: 'ctr_x' }))).toMatch(/for themselves/);
  });

  it('3 · a driver names a price; the person accepts it from their own sign-in, and nobody else can', async () => {
    const drivers = app.get(DriverService);
    const d = drivers.register({ displayName: 'Okello', fullName: 'Okello Driver', nationalId: `ID-PL-${digits()}`, mobile: `+2567${digits()}1`, licenceClasses: ['van'], licenceNumber: `L-${digits()}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true, jurisdiction: 'UG' } as never);
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const van = app.get(VehicleService).register({ plate: `UBA ${digits().slice(0, 3)}P`, vehicleClass: 'van', capacityKg: 1_000, ownerName: 'Okello', ownerDriverDid: d.did, baseFee: 0.5, pricePerKm: 0.1, registeredIn: 'UG' } as never);
    app.get(FleetService).couple(d.did, van.vehicleId);
    declared(app, 'driver', d.did);
    const driver = (await http().post('/v1/auth/token').send({ role: 'driver', did: d.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    const offered = await http().post(`/v1/sbg/dispatch/freight/${loadId}/proposals`).set(bearer(driver)).send({ from: kampala, price: 90000 });
    if (offered.status !== 201) throw new Error(`propose: ${JSON.stringify(offered.body)}`);
    const offers = (await http().get(`/v1/sbg/dispatch/freight/${loadId}/proposals`).set(bearer(person)).expect(200)).body.items as Array<{ proposalId: string; price: number }>;
    expect(offers[0].price).toBe(90000);
    const someoneElse = await aPerson();
    await http().post(`/v1/sbg/dispatch/proposals/${offers[0].proposalId}/accept`).set(bearer(someoneElse)).expect(403);
    const taken = (await http().post(`/v1/sbg/dispatch/proposals/${offers[0].proposalId}/accept`).set(bearer(person)).expect(201)).body;
    expect(taken.freight).toMatchObject({ status: 'claimed', lockedPrice: 90000, settlement: 'between_parties' });
  });
  /* --------------------------- part 3b: in Kenya, paid first and held until delivery (the owner: "escrow") -- */

  const nairobi = { lat: -1.2921, lng: 36.8219 };
  const thika = { lat: -1.0388, lng: 37.0834 };
  let operator = '';
  let kePerson = '';
  let keLoad = '';
  let keDriver = { did: '', token: '' };
  let proposalId = '';
  const photo = async (token: string, kind: string) => {
    const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${digits()}`)]).toString('base64')}`;
    return (await http().post('/v1/sbg/media').set(bearer(token)).send({ kind, dataUrl }).expect(201)).body.mediaId as string;
  };

  it('4 · in Kenya, where a company of ours takes the money: posted to be paid first, in Kenya’s money, billed through it', async () => {
    operator = (await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token as string;
    kePerson = await aPerson();
    const load = (await post(kePerson, fridge({ pickupLocation: nairobi, pickupLabel: 'Kilimani', destLocation: thika, destLabel: 'Thika', contactPhone: '+254700123456' })).expect(201)).body;
    keLoad = load.freightId;
    expect(load).toMatchObject({ commitMode: 'negotiate', escrow: true, pickupCountry: 'KE', postedCurrency: 'KES' });
    expect(load.settlement).toBeUndefined();
    expect(load.sellerEntityId).toEqual(expect.any(String));
  });

  it('5 · a driver names a price; the person accepts it only by paying, all in; nothing else is taken meanwhile', async () => {
    const drivers = app.get(DriverService);
    const d = drivers.register({ displayName: 'Mwangi', fullName: 'Mwangi Driver', nationalId: `ID-KE-${digits()}`, mobile: `+2547${digits()}2`, licenceClasses: ['van'], licenceNumber: `L-${digits()}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true } as never);
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const van = app.get(VehicleService).register({ plate: `KDH ${digits().slice(0, 3)}E`, vehicleClass: 'van', capacityKg: 1_000, ownerName: 'Mwangi', ownerDriverDid: d.did, baseFee: 0.5, pricePerKm: 0.1 } as never);
    app.get(FleetService).couple(d.did, van.vehicleId);
    declared(app, 'driver', d.did);
    keDriver = { did: d.did, token: (await http().post('/v1/auth/token').send({ role: 'driver', did: d.did, type: 'client_credentials' }).expect(201)).body.access_token as string };
    await http().post(`/v1/sbg/dispatch/freight/${keLoad}/proposals`).set(bearer(keDriver.token)).send({ from: nairobi, price: 2003 }).expect(201);
    const offers = (await http().get(`/v1/sbg/dispatch/freight/${keLoad}/proposals`).set(bearer(kePerson)).expect(200)).body.items as Array<{ proposalId: string; price: number; charge: number }>;
    proposalId = offers[0].proposalId;
    expect(offers[0].charge).toBeGreaterThan(2003);
    // A total in cents, so the amount asked is seen rounded up to a whole shilling.
    expect(Number.isInteger(offers[0].charge)).toBe(false);
    // Not by Accept: by paying.
    const plain = await http().post(`/v1/sbg/dispatch/proposals/${proposalId}/accept`).set(bearer(kePerson));
    expect([plain.status, plain.body.detail]).toEqual([400, expect.stringMatching(/Accept it by paying for it/)]);
    // Nobody else pays for it.
    const other = await aPerson();
    await http().post(`/v1/sbg/dispatch/freight/${keLoad}/pay`).set(bearer(other)).send({ proposalId, phone: '+254711000111' }).expect(403);
    const paying = (await http().post(`/v1/sbg/dispatch/freight/${keLoad}/pay`).set(bearer(kePerson)).send({ proposalId, phone: '+254711000111' }).expect(201)).body;
    expect(paying).toMatchObject({ state: 'awaiting', currency: 'KES', price: 2003, amount: Math.ceil(offers[0].charge) });
    expect(Number.isInteger(paying.amount)).toBe(true);
    await http().post(`/v1/sbg/dispatch/freight/${keLoad}/pay`).set(bearer(kePerson)).send({ proposalId, phone: '+254711000111' }).expect(400);
    // The driver sees it accepted and being paid.
    const board = (await http().get('/v1/sbg/dispatch/board').query({ lat: nairobi.lat, lng: nairobi.lng }).set(bearer(keDriver.token)).expect(200)).body.items as Array<{ freightId: string; mine?: { awaitingPayment?: string } }>;
    expect(board.find((r) => r.freightId === keLoad)?.mine?.awaitingPayment).toEqual(expect.any(String));
  });

  it('6 · paid: the load is the driver’s, billed out of what was paid; the person holds the delivery code', async () => {
    const funding = app.get(FundingService).list({ payerDid: (await http().get('/v1/sbg/identity/me').set(bearer(kePerson)).expect(200)).body.personDid, purpose: 'load' })[0];
    const view = (await http().get(`/v1/sbg/dispatch/freight/${keLoad}/payment`).set(bearer(kePerson)).expect(200)).body;
    await http().post(`/v1/rails/funding/${funding.fundingId}/simulate`).set(bearer(operator)).send({ providerRef: `MPX${digits()}`, amount: view.amount }).expect(201);
    const f = app.get(DispatchService).requireFreightPublic(keLoad);
    expect(f).toMatchObject({ status: 'claimed', claimedBy: keDriver.did, lockedPrice: 2003, paidStatus: 'billed' });
    expect((await http().get(`/v1/sbg/dispatch/freight/${keLoad}/payment`).set(bearer(kePerson)).expect(200)).body.state).toBe('paid');
    const mine = (await http().get('/v1/sbg/dispatch/posted').set(bearer(kePerson)).expect(200)).body.items.find((r: { freightId: string }) => r.freightId === keLoad);
    expect(mine.deliveryCode).toMatch(/^\d{6}$/);
    // 2026-11-15 — who has it now: taken by the driver, by the name they ride under and their vehicle; not picked up yet (R1).
    expect(mine.nowWith).toMatchObject({ kind: 'carrier', name: 'Mwangi', vehicle: 'van', pickedUp: false });
  });

  it('7 · delivered only with the code: a wrong one refused; the right one delivers, and the driver is paid on it', async () => {
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    store.set(keLoad, { ...store.get(keLoad), status: 'in_transit', pickedUpAt: new Date().toISOString() });
    const onRoad = (await http().get('/v1/sbg/dispatch/posted').set(bearer(kePerson)).expect(200)).body.items.find((r: { freightId: string }) => r.freightId === keLoad);
    // On the road now: with the same driver, picked up (R1).
    expect(onRoad.nowWith).toMatchObject({ kind: 'carrier', name: 'Mwangi', pickedUp: true });
    const code = onRoad.deliveryCode as string;
    const claim =(await http().get(`/v1/sbg/fleet/drivers/${encodeURIComponent(keDriver.did)}/claims`).set(bearer(keDriver.token)).expect(200)).body.claims.find((c: { ref: string }) => c.ref === keLoad);
    expect(claim.deliveryCodeNeeded).toBe(true);
    const deliver = async (deliveryCode?: string) => http().post(`/v1/sbg/dispatch/freight/${keLoad}/deliver`).set(bearer(keDriver.token)).send({ driverDid: keDriver.did, confirmed: requiredUnloadKeys(), receiverName: 'Wanjiru at the gate', podPhotoId: await photo(keDriver.token, 'pod'), ...(deliveryCode ? { deliveryCode } : {}) });
    const wrong = await deliver(code === '123456' ? '654321' : '123456');
    expect([wrong.status, wrong.body.code]).toEqual([400, 'OTP_INVALID']);
    expect((await deliver()).status).toBe(400);
    const done = await deliver(code);
    expect(done.status).toBe(201);
    // Delivered with the code: the driver's pay is held 24 hours for a problem to be reported (2026-11-15, the hold H1).
    const f = app.get(DispatchService).requireFreightPublic(keLoad);
    expect(f).toMatchObject({ status: 'delivered', deliveredWithCode: true });
    expect(f.driverPaid).toBeFalsy();
    expect(Date.parse(f.heldPay!.until) - Date.now()).toBeGreaterThan(23.9 * 3_600_000);
  });

  it('8 · not paid in time: the driver is let go and the price is open again; the person may pay again', async () => {
    const person = await aPerson();
    const load = (await post(person, fridge({ pickupLocation: nairobi, pickupLabel: 'Westlands', destLocation: thika, destLabel: 'Thika', contactPhone: '+254700123457' })).expect(201)).body;
    await http().post(`/v1/sbg/dispatch/freight/${load.freightId}/proposals`).set(bearer(keDriver.token)).send({ from: nairobi, price: 1800 }).expect(201);
    const id = ((await http().get(`/v1/sbg/dispatch/freight/${load.freightId}/proposals`).set(bearer(person)).expect(200)).body.items as Array<{ proposalId: string }>)[0].proposalId;
    await http().post(`/v1/sbg/dispatch/freight/${load.freightId}/pay`).set(bearer(person)).send({ proposalId: id, phone: '+254711000222' }).expect(201);
    // Within its fifteen minutes it waits; after them, the driver is let go.
    app.get(PersonLoadPayService).sweep(Date.now() + 10 * 60_000);
    expect((await http().get(`/v1/sbg/dispatch/freight/${load.freightId}/payment`).set(bearer(person)).expect(200)).body.state).toBe('awaiting');
    app.get(PersonLoadPayService).sweep(Date.now() + 16 * 60_000);
    expect((await http().get(`/v1/sbg/dispatch/freight/${load.freightId}/payment`).set(bearer(person)).expect(200)).body.state).toBe('lapsed');
    expect(app.get(DispatchService).requireFreightPublic(load.freightId)).toMatchObject({ status: 'available' });
    expect(app.get(DispatchService).requireFreightPublic(load.freightId).payHold).toBeUndefined();
    await http().post(`/v1/sbg/dispatch/freight/${load.freightId}/pay`).set(bearer(person)).send({ proposalId: id, phone: '+254711000222' }).expect(201);
  });

  it('9 · paid, then handed back by the driver: everything the person paid goes back, and the load is open for prices again', async () => {
    const person = await aPerson();
    const load = (await post(person, fridge({ pickupLocation: nairobi, pickupLabel: 'Lavington', destLocation: thika, destLabel: 'Thika', contactPhone: '+254700123458' })).expect(201)).body;
    const at = (path: string) => `/v1/sbg/dispatch/freight/${load.freightId}/${path}`;
    await http().post(at('proposals')).set(bearer(keDriver.token)).send({ from: nairobi, price: 1500 }).expect(201);
    const id = ((await http().get(at('proposals')).set(bearer(person)).expect(200)).body.items as Array<{ proposalId: string }>)[0].proposalId;
    const view = (await http().post(at('pay')).set(bearer(person)).send({ proposalId: id, phone: '+254711000333' }).expect(201)).body;
    const personDid = (await http().get('/v1/sbg/identity/me').set(bearer(person)).expect(200)).body.personDid;
    const funding = app.get(FundingService).list({ payerDid: personDid, purpose: 'load' })[0];
    await http().post(`/v1/rails/funding/${funding.fundingId}/simulate`).set(bearer(operator)).send({ providerRef: `MPX${digits()}`, amount: view.amount }).expect(201);
    expect(app.get(DispatchService).requireFreightPublic(load.freightId).status).toBe('claimed');
    await http().post(at('hand-back')).set(bearer(keDriver.token)).send({ reason: 'My van broke down' }).expect(201);
    const after = (await http().get(at('payment')).set(bearer(person)).expect(200)).body;
    expect(after).toMatchObject({ state: 'refunded', owedBack: view.amount });
    expect(app.get(DispatchService).requireFreightPublic(load.freightId).status).toBe('available');
  });

  /* ---------------- 2026-11-15: the driver's pay held 24 hours after delivery, decided by the protocol (H1–H5) -- */

  const H = 3_600_000;
  type Store = { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } };
  const myRow = async (token: string, freightId: string) =>
    ((await http().get('/v1/sbg/dispatch/posted').set(bearer(token)).expect(200)).body.items as Array<Record<string, unknown>>).find((r) => r.freightId === freightId)!;
  const queue = async () => (await http().get('/v1/sbg/holds').set(bearer(operator)).expect(200)).body.items as Array<Record<string, any>>;

  /** A Kenyan load: paid, picked up (with what the driver noted then), delivered with the code (with what was noted at the door). */
  async function aDeliveredLoad(opts: { pickupNote?: string; atDoor?: 'damaged' | 'short' } = {}) {
    const person = await aPerson();
    const load = (await post(person, fridge({ pickupLocation: nairobi, pickupLabel: 'Kileleshwa', destLocation: thika, destLabel: 'Thika', contactPhone: `+2547${digits()}9` })).expect(201)).body;
    const at = (path: string) => `/v1/sbg/dispatch/freight/${load.freightId}/${path}`;
    await http().post(at('proposals')).set(bearer(keDriver.token)).send({ from: nairobi, price: 1500 }).expect(201);
    const id = ((await http().get(at('proposals')).set(bearer(person)).expect(200)).body.items as Array<{ proposalId: string }>)[0].proposalId;
    // Every call here comes from one address: its count for paying starts again for each load.
    (app.get(RateLimitGuard) as unknown as { hits: Map<string, unknown> }).hits.clear();
    const view = (await http().post(at('pay')).set(bearer(person)).send({ proposalId: id, phone: `+25471${digits()}` }).expect(201)).body;
    const personDid = (await http().get('/v1/sbg/identity/me').set(bearer(person)).expect(200)).body.personDid;
    const funding = app.get(FundingService).list({ payerDid: personDid, purpose: 'load' })[0];
    await http().post(`/v1/rails/funding/${funding.fundingId}/simulate`).set(bearer(operator)).send({ providerRef: `MPX${digits()}`, amount: view.amount }).expect(201);
    const store = (app.get(DispatchService) as unknown as Store).freights;
    store.set(load.freightId, { ...store.get(load.freightId), status: 'in_transit', pickedUpAt: new Date().toISOString(), ...(opts.pickupNote ? { reservations: { note: opts.pickupNote, at: new Date().toISOString() } } : {}) });
    const code = (await myRow(person, load.freightId)).deliveryCode as string;
    const exceptions = opts.atDoor ? [{ kind: opts.atDoor, count: 1, photoRefs: [await photo(keDriver.token, 'pod')] }] : undefined;
    const done = await http().post(at('deliver')).set(bearer(keDriver.token)).send({ driverDid: keDriver.did, confirmed: requiredUnloadKeys(), receiverName: 'Achieng at the door', podPhotoId: await photo(keDriver.token, 'pod'), deliveryCode: code, ...(exceptions ? { exceptions } : {}) });
    if (done.status !== 201) throw new Error(`deliver: ${JSON.stringify(done.body)}`);
    return { person, freightId: load.freightId, at, amount: view.amount as number };
  }
  const report = async (l: { person: string; at: (p: string) => string }, kind: string) =>
    http().post(l.at('claim')).set(bearer(l.person)).send({ kind, description: 'The door of the fridge is dented', photoRef: await photo(l.person, 'dispute') }).expect(201);

  it('10 · delivered: held 24 hours, the person may report; nothing reported, it is released to the driver, not a minute before', async () => {
    const d = app.get(DispatchService);
    expect(await myRow(kePerson, keLoad)).toMatchObject({ heldUntil: expect.any(String), canReport: true });
    // Held with nothing reported: nothing for staff to decide.
    expect((await queue()).some((r) => r.freightId === keLoad)).toBe(false);
    d.releaseDueHolds(Date.now() + 23 * H);
    expect(d.requireFreightPublic(keLoad).driverPaid).toBeFalsy();
    d.releaseDueHolds(Date.now() + 25 * H);
    expect(d.requireFreightPublic(keLoad).driverPaid).toBe(true);
    const after = await myRow(kePerson, keLoad);
    expect([after.heldUntil, after.canReport]).toEqual([undefined, undefined]);
    // Delivered: with nobody of ours any more (R1).
    expect(after.nowWith).toBeUndefined();
  });

  it('11 · damage found after delivery, not noted at the door: reported with a photo; held past the 24 hours; the driver answers once; step 2 pays the driver', async () => {
    const l = await aDeliveredLoad();
    // A problem you can see comes with a photo.
    const bare = await http().post(l.at('claim')).set(bearer(l.person)).send({ kind: 'damaged', description: 'The door of the fridge is dented' });
    expect([bare.status, bare.body.code]).toEqual([400, 'FIELD_REQUIRED']);
    await report(l, 'damaged');
    expect(await myRow(l.person, l.freightId)).toMatchObject({ reported: true });
    const d = app.get(DispatchService);
    d.releaseDueHolds(Date.now() + 25 * H);
    expect(d.requireFreightPublic(l.freightId).driverPaid).toBeFalsy();
    // The driver sees it and answers once; nobody else answers for them.
    const held = (await http().get(`/v1/sbg/fleet/drivers/${encodeURIComponent(keDriver.did)}/held-problems`).set(bearer(keDriver.token)).expect(200)).body.items as Array<Record<string, any>>;
    expect(held.find((h) => h.freightId === l.freightId)).toMatchObject({ answered: false, problem: { kind: 'damaged' } });
    await http().post(l.at('problem-answer')).set(bearer(l.person)).send({ words: 'Not mine to answer' }).expect(403);
    // Another driver does not answer for the one who carried it.
    const drivers = app.get(DriverService);
    const other = drivers.register({ displayName: 'Otieno', fullName: 'Otieno Driver', nationalId: `ID-KE-${digits()}`, mobile: `+2547${digits()}3`, licenceClasses: ['van'], licenceNumber: `L-${digits()}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true } as never);
    drivers.submitKyc(other.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(other.did, true);
    declared(app, 'driver', other.did);
    const otherToken = (await http().post('/v1/auth/token').send({ role: 'driver', did: other.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    await http().post(l.at('problem-answer')).set(bearer(otherToken)).send({ words: 'I was not there at all' }).expect(403);
    await http().post(l.at('problem-answer')).set(bearer(keDriver.token)).send({ words: 'Wrapped and upright the whole way; no dent at the door', photoRefs: [await photo(keDriver.token, 'dispute')] }).expect(201);
    await http().post(l.at('problem-answer')).set(bearer(keDriver.token)).send({ words: 'Once more' }).expect(400);
    // Staff's queue: the record side by side, and what the protocol says.
    const row = (await queue()).find((r) => r.freightId === l.freightId)!;
    expect(row).toMatchObject({ country: 'KE', problem: { kind: 'damaged' }, answer: { words: expect.stringMatching(/Wrapped/) }, doorNotes: [], reading: { step: 'not_noted_at_door', outcome: 'release' } });
    expect(row.problem.photoRef).toEqual(expect.any(String));
    const decided = (await http().post(`/v1/sbg/holds/${l.freightId}/apply`).set(bearer(operator)).send({ by: 'Amina Otieno' }).expect(201)).body;
    expect(decided.decision).toMatchObject({ step: 'not_noted_at_door', outcome: 'release', by: 'Amina Otieno' });
    expect(d.requireFreightPublic(l.freightId).driverPaid).toBe(true);
    expect((await queue()).some((r) => r.freightId === l.freightId)).toBe(false);
    expect((await myRow(l.person, l.freightId)).holdWords).toMatch(/^Step 2/);
    await http().post(`/v1/sbg/holds/${l.freightId}/apply`).set(bearer(operator)).send({ by: 'Amina Otieno' }).expect(400);
  });

  it('12 · noted at the door and not at pickup: step 3 gives the carriage price back, and the driver is not paid', async () => {
    const l = await aDeliveredLoad({ atDoor: 'damaged' });
    await report(l, 'damaged');
    const row = (await queue()).find((r) => r.freightId === l.freightId)!;
    expect(row).toMatchObject({ doorNotes: ['damaged × 1'], reading: { step: 'arose_in_carriage', outcome: 'refund' } });
    await http().post(`/v1/sbg/holds/${l.freightId}/apply`).set(bearer(operator)).send({ by: 'Amina Otieno' }).expect(201);
    expect(app.get(DispatchService).requireFreightPublic(l.freightId).driverPaid).toBeFalsy();
    const paid = (await http().get(l.at('payment')).set(bearer(l.person)).expect(200)).body;
    expect(paid.state).toBe('refunded');
    expect(paid.owedBack).toBeGreaterThan(1500);
    expect((await myRow(l.person, l.freightId)).holdWords).toMatch(/^Step 3: the problem was noted at the door/);
    // Both sides told, with the page that explains the protocol.
    for (const token of [l.person, keDriver.token]) {
      const items = (await http().get('/v1/sbg/notifications/inbox').set(bearer(token)).expect(200)).body.items as Array<{ kind: string; link?: string; title: string }>;
      expect(items.filter((n) => n.kind === 'pay_decided').map((n) => [n.title.split(':')[0], n.link])).toContainEqual([expect.any(String), '/help/when-something-goes-wrong/']);
    }
  });

  it('13 · noted at the door and at pickup: step 3 pays the driver — it was so before', async () => {
    const l = await aDeliveredLoad({ pickupNote: 'Door already dented when I took it', atDoor: 'damaged' });
    await report(l, 'damaged');
    expect((await queue()).find((r) => r.freightId === l.freightId)).toMatchObject({ pickupNote: expect.stringMatching(/dented/), reading: { step: 'noted_at_pickup', outcome: 'release' } });
    await http().post(`/v1/sbg/holds/${l.freightId}/apply`).set(bearer(operator)).send({ by: 'Amina Otieno' }).expect(201);
    expect(app.get(DispatchService).requireFreightPublic(l.freightId).driverPaid).toBe(true);
  });

  it('14 · going against the record takes a reason and a second member of staff; the protocol waits for them', async () => {
    const l = await aDeliveredLoad({ atDoor: 'short' });
    await report(l, 'short');
    const path = (p = '') => `/v1/sbg/holds/${l.freightId}/override${p}`;
    // What the protocol says already is applied, not overridden; a reason is required.
    await http().post(path()).set(bearer(operator)).send({ outcome: 'refund', reason: 'Because', by: 'Amina Otieno' }).expect(400);
    const noReason = await http().post(path()).set(bearer(operator)).send({ outcome: 'release', reason: ' ', by: 'Amina Otieno' });
    expect([noReason.status, noReason.body.code]).toEqual([400, 'REASON_REQUIRED']);
    await http().post(path()).set(bearer(operator)).send({ outcome: 'release', reason: 'The receiver counted before opening the second box', by: 'Amina Otieno' }).expect(201);
    expect((await queue()).find((r) => r.freightId === l.freightId)?.pendingOverride).toMatchObject({ outcome: 'release', by: 'Amina Otieno' });
    await http().post(`/v1/sbg/holds/${l.freightId}/apply`).set(bearer(operator)).send({ by: 'Brian Kamau' }).expect(400);
    await http().post(path('/approve')).set(bearer(operator)).send({ by: 'Amina Otieno' }).expect(403);
    const decided = (await http().post(path('/approve')).set(bearer(operator)).send({ by: 'Brian Kamau' }).expect(201)).body;
    expect(decided.decision).toMatchObject({ step: 'arose_in_carriage', outcome: 'release', overridden: true, by: 'Amina Otieno', secondBy: 'Brian Kamau', reason: expect.stringMatching(/counted/) });
    expect(app.get(DispatchService).requireFreightPublic(l.freightId).driverPaid).toBe(true);
    expect((await myRow(l.person, l.freightId)).holdWords).toMatch(/went against the record: The receiver counted/);
  });

  it('15 · a report after the 24 hours keeps nothing held: the driver was paid; the claim is still recorded', async () => {
    const l = await aDeliveredLoad();
    const d = app.get(DispatchService);
    d.releaseDueHolds(Date.now() + 25 * H);
    expect(d.requireFreightPublic(l.freightId).driverPaid).toBe(true);
    expect((await myRow(l.person, l.freightId)).canReport).toBeUndefined();
    await http().post(l.at('claim')).set(bearer(l.person)).send({ kind: 'not_received', description: 'Nobody here got it' }).expect(201);
    expect((await queue()).some((r) => r.freightId === l.freightId)).toBe(false);
  });

  /* ---------------- 2026-11-15: the load names who receives it — the code reaches them, not by hand (plan R2) -- */

  /** A Kenyan load naming its receiver, a driver's price accepted and paid: the code is made. */
  async function aPaidLoadFor(receiver: { buyerMobile?: string; receiverEmail?: string; receiverName?: string }) {
    const person = await aPerson();
    const load = (await post(person, fridge({ pickupLocation: nairobi, pickupLabel: 'Parklands', destLocation: thika, destLabel: 'Thika', contactPhone: `+2547${digits()}9`, ...receiver })).expect(201)).body;
    const at = (path: string) => `/v1/sbg/dispatch/freight/${load.freightId}/${path}`;
    await http().post(at('proposals')).set(bearer(keDriver.token)).send({ from: nairobi, price: 1500 }).expect(201);
    const id = ((await http().get(at('proposals')).set(bearer(person)).expect(200)).body.items as Array<{ proposalId: string }>)[0].proposalId;
    (app.get(RateLimitGuard) as unknown as { hits: Map<string, unknown> }).hits.clear();
    const view = (await http().post(at('pay')).set(bearer(person)).send({ proposalId: id, phone: `+25471${digits()}` }).expect(201)).body;
    const personDid = (await http().get('/v1/sbg/identity/me').set(bearer(person)).expect(200)).body.personDid;
    const funding = app.get(FundingService).list({ payerDid: personDid, purpose: 'load' })[0];
    await http().post(`/v1/rails/funding/${funding.fundingId}/simulate`).set(bearer(operator)).send({ providerRef: `MPX${digits()}`, amount: view.amount }).expect(201);
    await new Promise((r) => setTimeout(r, 50));
    return { person, freightId: load.freightId as string, at, code: (await myRow(person, load.freightId)).deliveryCode as string };
  }

  it('16 · its receiver has no Send app on that number: the code is emailed with their name, and the driver checks the name', async () => {
    const email = `receiver-${digits()}@example.com`;
    const l = await aPaidLoadFor({ buyerMobile: `+2547${digits()}8`, receiverEmail: email, receiverName: 'Achieng Otieno' });
    const mail = app.get(OutboxMailSender).recent(email).find((m) => m.template === 'load-delivery-code');
    expect(mail?.text).toContain(l.code);
    expect(mail?.text).toContain('Achieng Otieno');
    const store = (app.get(DispatchService) as unknown as Store).freights;
    store.set(l.freightId, { ...store.get(l.freightId), status: 'in_transit', pickedUpAt: new Date().toISOString() });
    const claim = (await http().get(`/v1/sbg/fleet/drivers/${encodeURIComponent(keDriver.did)}/claims`).set(bearer(keDriver.token)).expect(200)).body.claims.find((c: { ref: string }) => c.ref === l.freightId);
    expect(claim).toMatchObject({ deliveryCodeNeeded: true, checkName: 'Achieng Otieno' });
    const deliver = async (more: object) => http().post(l.at('deliver')).set(bearer(keDriver.token)).send({ driverDid: keDriver.did, confirmed: requiredUnloadKeys(), receiverName: 'Achieng Otieno', podPhotoId: await photo(keDriver.token, 'pod'), deliveryCode: l.code, ...more });
    const unchecked = await deliver({});
    expect([unchecked.status, unchecked.body.detail]).toEqual([400, expect.stringMatching(/check the person receiving it is Achieng Otieno/)]);
    // Refused before a try is counted.
    expect(app.get(DispatchService).requireFreightPublic(l.freightId).deliveryCodeTries ?? 0).toBe(0);
    expect((await deliver({ nameChecked: true })).status).toBe(201);
  });

  it('17 · its receiver has the Send app on that number: told on the bell, the load and its code in their My parcels, no email', async () => {
    const phone = `+2547${digits()}7`;
    const receiver = await aPerson(phone);
    const email = `receiver-${digits()}@example.com`;
    const l = await aPaidLoadFor({ buyerMobile: phone, receiverEmail: email, receiverName: 'Baraka K.' });
    const inbox = (await http().get('/v1/sbg/notifications/inbox').set(bearer(receiver)).expect(200)).body.items as Array<{ kind: string; body: string }>;
    const told = inbox.find((n) => n.kind === 'load_code');
    expect(told).toBeDefined();
    // The code itself is not on the bell: it is on the load, in the app.
    expect(told!.body).not.toContain(l.code);
    const mine = (await http().get('/v1/sbg/identity/parcels').set(bearer(receiver)).expect(200)).body.freights as Array<{ freightId: string; deliveryCode?: string; nowWith?: { kind: string } }>;
    expect(mine.find((f) => f.freightId === l.freightId)).toMatchObject({ deliveryCode: l.code, nowWith: { kind: 'carrier' } });
    expect(app.get(OutboxMailSender).recent(email).filter((m) => m.template === 'load-delivery-code')).toHaveLength(0);
    // Nobody checks a name the code never left the app for.
    expect(app.get(DispatchService).requireFreightPublic(l.freightId).codeEmailedAt).toBeUndefined();
  });

  /* ---------------- 2026-11-15: every load naming a receiver who can be reached gets a code (the owner: "yes") -- */

  let ugDriver = { did: '', token: '' };
  async function aUgDriver() {
    if (ugDriver.did) return ugDriver;
    const drivers = app.get(DriverService);
    const d = drivers.register({ displayName: 'Ssali', fullName: 'Ssali Driver', nationalId: `ID-UG-${digits()}`, mobile: `+2567${digits()}2`, licenceClasses: ['van'], licenceNumber: `L-${digits()}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true, jurisdiction: 'UG' } as never);
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const van = app.get(VehicleService).register({ plate: `UBB ${digits().slice(0, 3)}S`, vehicleClass: 'van', capacityKg: 1_000, ownerName: 'Ssali', ownerDriverDid: d.did, baseFee: 0.5, pricePerKm: 0.1, registeredIn: 'UG' } as never);
    app.get(FleetService).couple(d.did, van.vehicleId);
    declared(app, 'driver', d.did);
    ugDriver = { did: d.did, token: (await http().post('/v1/auth/token').send({ role: 'driver', did: d.did, type: 'client_credentials' }).expect(201)).body.access_token as string };
    return ugDriver;
  }
  /** In Uganda, where SeeBuyGet only matches: a person's load naming its receiver, a driver's price accepted. */
  async function anAcceptedUgLoad(receiver: Record<string, string>) {
    const driver = await aUgDriver();
    const person = await aPerson();
    const load = (await post(person, fridge(receiver)).expect(201)).body;
    const at = (path: string) => `/v1/sbg/dispatch/freight/${load.freightId}/${path}`;
    await http().post(at('proposals')).set(bearer(driver.token)).send({ from: kampala, price: 90000 }).expect(201);
    const id = ((await http().get(at('proposals')).set(bearer(person)).expect(200)).body.items as Array<{ proposalId: string }>)[0].proposalId;
    await http().post(`/v1/sbg/dispatch/proposals/${id}/accept`).set(bearer(person)).expect(201);
    await new Promise((r) => setTimeout(r, 50));
    return { person, driver, freightId: load.freightId as string, at };
  }
  const claimOf = async (driver: { did: string; token: string }, freightId: string) =>
    ((await http().get(`/v1/sbg/fleet/drivers/${encodeURIComponent(driver.did)}/claims`).set(bearer(driver.token)).expect(200)).body.claims as Array<Record<string, unknown>>).find((c) => c.ref === freightId)!;

  it('18 · not paid first, naming its receiver by email: a code once a driver has it, emailed; the poster may say it arrived', async () => {
    const email = `receiver-${digits()}@example.com`;
    const l = await anAcceptedUgLoad({ receiverEmail: email, receiverName: 'Nakato S.' });
    const row = await myRow(l.person, l.freightId);
    expect(row.deliveryCode).toMatch(/^\d{6}$/);
    expect(app.get(OutboxMailSender).recent(email).find((m) => m.template === 'load-delivery-code')?.text).toContain(row.deliveryCode as string);
    expect(await claimOf(l.driver, l.freightId)).toMatchObject({ deliveryCodeNeeded: true, checkName: 'Nakato S.' });
    // The code lost: whoever sent it says it arrived — never staff, never somebody else.
    await http().post(l.at('arrived')).set(bearer(operator)).expect(403);
    await http().post(l.at('arrived')).set(bearer(await aPerson())).expect(404);
    await http().post(l.at('arrived')).set(bearer(l.person)).expect(201);
    expect((await myRow(l.person, l.freightId)).arrivedSaid).toBe(true);
    expect((await claimOf(l.driver, l.freightId)).deliveryCodeNeeded).toBeUndefined();
  });

  it('19 · a receiver nobody can reach (a number without the Send app, no email): no code, so no driver is stopped by one', async () => {
    const l = await anAcceptedUgLoad({ buyerMobile: `+2567${digits()}4` });
    expect((await myRow(l.person, l.freightId)).deliveryCode).toBeUndefined();
    expect((await claimOf(l.driver, l.freightId)).deliveryCodeNeeded).toBeUndefined();
    // Nothing to say arrived without a code: it is delivered as it always was.
    await http().post(l.at('arrived')).set(bearer(l.person)).expect(400);
  });

  it('20 · booked at a shop’s counter, where the number on it is the walk-in sender’s: the receiver is reached by email only', async () => {
    const driver = await aUgDriver();
    const senderPhone = `+2567${digits()}6`;
    const walkIn = await aPerson(senderPhone);
    const email = `receiver-${digits()}@example.com`;
    const person = await aPerson();
    const load = (await post(person, fridge({ buyerMobile: senderPhone, receiverEmail: email, receiverName: 'Okot P.' })).expect(201)).body;
    // As a counter's booking stamps it (pudo.controller.ts bookFreight).
    const store = (app.get(DispatchService) as unknown as Store).freights;
    store.set(load.freightId, { ...store.get(load.freightId), codeByEmailOnly: true });
    await http().post(`/v1/sbg/dispatch/freight/${load.freightId}/proposals`).set(bearer(driver.token)).send({ from: kampala, price: 90000 }).expect(201);
    const id = ((await http().get(`/v1/sbg/dispatch/freight/${load.freightId}/proposals`).set(bearer(person)).expect(200)).body.items as Array<{ proposalId: string }>)[0].proposalId;
    await http().post(`/v1/sbg/dispatch/proposals/${id}/accept`).set(bearer(person)).expect(201);
    await new Promise((r) => setTimeout(r, 50));
    expect(app.get(OutboxMailSender).recent(email).filter((m) => m.template === 'load-delivery-code')).toHaveLength(1);
    const inbox = (await http().get('/v1/sbg/notifications/inbox').set(bearer(walkIn)).expect(200)).body.items as Array<{ kind: string }>;
    expect(inbox.some((n) => n.kind === 'load_code')).toBe(false);
  });
});
