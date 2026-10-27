import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BooksService } from '../src/foundation/books/books.service';
import { EntityService } from '../src/foundation/entity/entity.service';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';
import { AGREED } from './agreed';

/**
 * A MATCHED LOAD, PAID (the user, 2026-10-27: "Driver ticks 'paid'"). A load settled between the parties is paid by its shipper
 * to its carrier directly, at the price agreed here. The driver it is on — or the office of the fleet that carries it — says it
 * was paid, and when; the shipper sees it on its load and is told. No money moves through SeeBuyGet, nobody else may say it,
 * and it is said once.
 */
describe('a matched load, paid: the carrier says so', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator = '';
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

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

  async function aShipper(): Promise<string> {
    const phone = `+2547${digits()}6`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `paid-${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    return (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `Mawe Quarry ${digits()}`, country: 'KE', registrationNo: `PAID-${digits()}`, activities: ['shipper'], yourName: 'Owner' }).expect(201)).body.token.access_token as string;
  }

  async function aFleet(): Promise<{ did: string; office: string }> {
    const managers = app.get(FleetManagerService);
    const n = digits();
    const m = managers.register({
      companyName: `Tumaini Haulage ${n}`, contactPhone: `+2548${n}4`, contactEmail: `tumaini-${n}@example.com`, ownerFullName: 'O O', ownerNationalId: `MGR-PD-${n}`, location: { lat: -1.2, lng: 36.8 },
      requirements: { businessRegistrationNo: `BRN-PD-${n}`, transportOperatorLicence: `TOL-PD-${n}`, taxId: `TAX-PD-${n}` },
    });
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    const office = (await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    return { did: m.did, office };
  }

  async function aDriverOf(fleetDid?: string): Promise<{ did: string; token: string }> {
    const n = digits();
    const r = await http().post('/v1/sbg/drivers/onboard').set(bearer(operator)).send({ displayName: 'Wanjiru', fullName: 'Wanjiru Kamau', nationalId: `DRV-PD-${n}`, mobile: `+2547${n}3`, licenceClasses: ['truck'], licenceNumber: `DL-PD-${n}`, licenceExpiresAt: '2030-01-01', ...(fleetDid ? { managerDid: fleetDid } : {}) }).expect(201);
    const token = (await http().post('/v1/auth/token').send({ role: 'driver', did: r.body.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    return { did: r.body.did as string, token };
  }

  type Stored = { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void };
  const stored = () => (app.get(DispatchService) as unknown as { freights: Stored }).freights;

  /** Cut stone posted by the business, taken by this driver at 4,200 shillings, on the road. */
  async function aMatchedLoad(biz: string, driverDid: string, carrierDid?: string): Promise<{ freightId: string; code: string }> {
    const posted = (await http().post('/v1/sbg/dispatch/freight').set(bearer(biz)).send({ description: 'Cut stone, wrapped', pickupLocation: { lat: -1.31, lng: 36.84 }, pickupLabel: 'Mawe quarry', destLabel: 'Athi River site', destLocation: { lat: -1.45, lng: 36.98 }, weightKg: 800, packaging: 'piece', packages: 1 }).expect(201)).body;
    expect(posted.settlement).toBe('between_parties');
    stored().set(posted.freightId, { ...stored().get(posted.freightId), status: 'in_transit', claimedBy: driverDid, ...(carrierDid ? { carrierDid } : {}), claimedAt: new Date().toISOString(), pickedUpAt: new Date().toISOString(), lockedPrice: 4200, lockedCurrency: 'KES' });
    return { freightId: posted.freightId, code: posted.code };
  }

  const tick = (freightId: string, token: string) => http().post(`/v1/sbg/dispatch/freight/${freightId}/paid-direct`).set(bearer(token));
  const inbox = async (token: string) => ((await http().get('/v1/sbg/notifications/inbox').set(bearer(token)).expect(200)).body.items ?? []) as Array<{ kind: string; title: string; body: string }>;
  const posted = async (biz: string, freightId: string) => (await http().get('/v1/sbg/dispatch/posted').set(bearer(biz)).expect(200)).body.items.find((r: { freightId: string }) => r.freightId === freightId);

  it('the driver it is on says they were paid: on the shipper’s load, in its bell, and in the driver’s register — once, nothing on our books', async () => {
    const biz = await aShipper();
    const driver = await aDriverOf();
    const { freightId, code } = await aMatchedLoad(biz, driver.did);
    const entityId = app.get(EntityService).requireForJurisdiction('KE').entityId;
    const booksBefore = JSON.stringify(app.get(BooksService).trialBalance(entityId));

    // Before: the shipper is told it pays the driver directly; nothing is said paid.
    expect(await posted(biz, freightId)).toMatchObject({ paysDriverDirect: true, agreedPrice: 4200 });
    expect((await posted(biz, freightId)).paidDirect).toBeUndefined();

    // Nobody else says it: another driver, or a member of staff.
    const other = await aDriverOf();
    const notYours = await tick(freightId, other.token);
    expect([notYours.status, notYours.body.detail]).toEqual([403, 'This load is not on you']);
    const staff = await tick(freightId, operator);
    expect([staff.status, staff.body.detail]).toEqual([403, 'Only the driver it is on, or their fleet’s office, says they were paid']);

    // The driver says so: the price agreed, when, and by whom.
    const said = (await tick(freightId, driver.token).expect(201)).body;
    expect(said).toMatchObject({ freightId, code, paidDirect: { amount: 4200, currency: 'KES', by: 'driver' } });
    expect(Date.parse(said.paidDirect.at)).toBeGreaterThan(Date.now() - 60_000);
    // Said once: a second tick answers with the first.
    expect((await tick(freightId, driver.token).expect(201)).body.paidDirect).toEqual(said.paidDirect);

    // The shipper sees it on its load, and is told.
    expect((await posted(biz, freightId)).paidDirect).toEqual(said.paidDirect);
    await new Promise((r) => setTimeout(r, 50));
    expect(await inbox(biz)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'freight_paid_direct', title: `Load ${code}: the driver says they were paid` })]));
    // The driver's own load and register carry it.
    const claims = (await http().get(`/v1/sbg/fleet/drivers/${encodeURIComponent(driver.did)}/claims`).set(bearer(driver.token)).expect(200)).body.claims;
    expect(claims.find((c: { ref: string }) => c.ref === freightId)).toMatchObject({ paidByShipper: true, paidDirect: said.paidDirect });
    const jobs = (await http().get(`/v1/sbg/fleet/drivers/${encodeURIComponent(driver.did)}/jobs`).set(bearer(driver.token)).expect(200)).body.items;
    expect(jobs.find((j: { freightId: string }) => j.freightId === freightId)).toMatchObject({ direct: true, paidDirectAt: said.paidDirect.at });

    // No money moved through us: our books did not change.
    expect(JSON.stringify(app.get(BooksService).trialBalance(entityId))).toBe(booksBefore);
  });

  it('the office of the fleet that carries it may say so too — no other fleet', async () => {
    const biz = await aShipper();
    const fleet = await aFleet();
    const driver = await aDriverOf(fleet.did);
    const { freightId } = await aMatchedLoad(biz, driver.did, fleet.did);
    const another = await aFleet();
    const notYours = await tick(freightId, another.office);
    expect([notYours.status, notYours.body.detail]).toEqual([403, 'This load is not on you']);
    expect((await tick(freightId, fleet.office).expect(201)).body.paidDirect).toMatchObject({ amount: 4200, by: 'office' });
    expect((await inbox(biz)).find((n) => n.kind === 'freight_paid_direct')?.body).toContain('Wanjiru’s fleet says you paid KES 4,200');
  });

  it('a load SeeBuyGet pays the driver for, or one no driver has taken, has nothing to confirm', async () => {
    const biz = await aShipper();
    const driver = await aDriverOf();
    const { freightId } = await aMatchedLoad(biz, driver.did);
    // Paid through us: refused, and nothing written.
    const billed = { ...stored().get(freightId) };
    delete billed.settlement;
    stored().set(freightId, billed);
    const refused = await tick(freightId, driver.token);
    expect([refused.status, refused.body.code]).toEqual([400, 'INVALID_STATE']);
    expect(stored().get(freightId).paidDirect).toBeUndefined();
    // Not taken yet: no price agreed, nothing to say paid.
    stored().set(freightId, { ...billed, settlement: 'between_parties', status: 'available', lockedPrice: undefined });
    expect(() => app.get(DispatchService).confirmPaidDirect(freightId, 'driver')).toThrow(/a payment is confirmed on a load a driver has taken/);
  });

  it('delivered three days ago and nothing said: the driver is asked once; "not paid yet" is told to the shipper; paid later is what stands', async () => {
    const biz = await aShipper();
    const driver = await aDriverOf();
    const { freightId, code } = await aMatchedLoad(biz, driver.did);
    const dispatch = app.get(DispatchService);
    const notPaid = (token: string) => http().post(`/v1/sbg/dispatch/freight/${freightId}/not-paid-direct`).set(bearer(token));
    // On the road, "not paid" is not said yet.
    const early = await notPaid(driver.token);
    expect([early.status, early.body.code]).toEqual([400, 'INVALID_STATE']);
    const deliveredAt = Date.now() - 73 * 3_600_000;
    stored().set(freightId, { ...stored().get(freightId), status: 'delivered', deliveredAt: new Date(deliveredAt).toISOString() });
    // Under three days: not asked. Three days: asked, once.
    expect(dispatch.sweepUnconfirmedPay(deliveredAt + 71 * 3_600_000)).not.toContain(freightId);
    expect(dispatch.sweepUnconfirmedPay()).toContain(freightId);
    expect(dispatch.sweepUnconfirmedPay()).not.toContain(freightId);
    await new Promise((r) => setTimeout(r, 50));
    expect(await inbox(driver.token)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'freight_paid_direct', title: `Were you paid for load ${code}?` })]));

    // Not paid yet: staff cannot say it; the driver does — the shipper sees it on its load and is told.
    expect((await notPaid(operator)).status).toBe(403);
    const said = (await notPaid(driver.token).expect(201)).body;
    expect(said.notPaidDirect).toMatchObject({ by: 'driver', at: expect.any(String) });
    expect((await posted(biz, freightId)).notPaidDirect).toEqual(said.notPaidDirect);
    await new Promise((r) => setTimeout(r, 50));
    expect(await inbox(biz)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'freight_paid_direct', title: `Load ${code}: the driver says they were not paid` })]));
    const jobs = (await http().get(`/v1/sbg/fleet/drivers/${encodeURIComponent(driver.did)}/jobs`).set(bearer(driver.token)).expect(200)).body.items;
    expect(jobs.find((j: { freightId: string }) => j.freightId === freightId)).toMatchObject({ direct: true, notPaidDirectAt: said.notPaidDirect.at });

    // Paid after all: paid is what stands, and "not paid" can no longer be said.
    await tick(freightId, driver.token).expect(201);
    const row = await posted(biz, freightId);
    expect(row.paidDirect).toMatchObject({ amount: 4200, by: 'driver' });
    expect(row.notPaidDirect).toBeUndefined();
    expect((await notPaid(driver.token)).status).toBe(400);
  });

  it('before a driver takes a shipper’s next matched load: how many of its loads drivers said were not paid, still unpaid a week on', async () => {
    const biz = await aShipper();
    const other = await aShipper();
    const driver = await aDriverOf();
    const dispatch = app.get(DispatchService);
    const from = { lat: -1.31, lng: 36.84 };
    const fresh = async (shipper: string) => (await http().post('/v1/sbg/dispatch/freight').set(bearer(shipper)).send({ description: 'Cut stone, wrapped', pickupLocation: from, pickupLabel: 'Mawe quarry', destLabel: 'Athi River site', destLocation: { lat: -1.45, lng: 36.98 }, weightKg: 800, packaging: 'piece', packages: 1 }).expect(201)).body.freightId as string;
    const onBoard = (freightId: string, now = Date.now()) => dispatch.board({ from, radiusKm: 50 }, now).find((r) => r.freightId === freightId);

    // A load delivered, and its driver says it was not paid.
    const { freightId: unpaidId } = await aMatchedLoad(biz, driver.did);
    stored().set(unpaidId, { ...stored().get(unpaidId), status: 'delivered', deliveredAt: new Date().toISOString() });
    await http().post(`/v1/sbg/dispatch/freight/${unpaidId}/not-paid-direct`).set(bearer(driver.token)).expect(201);
    const next = await fresh(biz);
    const elsewhere = await fresh(other);

    // Within the week the shipper has to pay: nothing is shown.
    expect(onBoard(next)).toMatchObject({ paidByShipper: true });
    expect(onBoard(next)?.shipperUnpaid).toBeUndefined();
    // A week on, still not said paid: shown on that shipper's next load — on the board and on the load a driver holds — and on nobody else's.
    expect(onBoard(next, Date.now() + 8 * 86_400_000)?.shipperUnpaid).toBe(1);
    expect(onBoard(elsewhere, Date.now() + 8 * 86_400_000)?.shipperUnpaid).toBeUndefined();
    stored().set(unpaidId, { ...stored().get(unpaidId), notPaidDirect: { at: new Date(Date.now() - 8 * 86_400_000).toISOString(), by: 'driver' } });
    (dispatch as unknown as { unpaid?: unknown }).unpaid = undefined;
    const taker = await aDriverOf();
    stored().set(next, { ...stored().get(next), status: 'claimed', claimedBy: taker.did, claimedAt: new Date().toISOString(), lockedPrice: 3900, lockedCurrency: 'KES' });
    const claims = (await http().get(`/v1/sbg/fleet/drivers/${encodeURIComponent(taker.did)}/claims`).set(bearer(taker.token)).expect(200)).body.claims;
    expect(claims.find((c: { ref: string }) => c.ref === next)).toMatchObject({ paidByShipper: true, shipperUnpaid: 1 });

    // Paid after all: no longer counted.
    await tick(unpaidId, driver.token).expect(201);
    expect(onBoard(elsewhere)?.shipperUnpaid).toBeUndefined();
    const again = await fresh(biz);
    // At once — not a minute later — and for good.
    expect(onBoard(again)?.shipperUnpaid).toBeUndefined();
    expect(onBoard(again, Date.now() + 8 * 86_400_000)?.shipperUnpaid).toBeUndefined();
  });

  it('both sides heard: the shipper answers a driver’s “not paid” with a reference — the driver is told, and drivers see it as disputed, not unpaid', async () => {
    const biz = await aShipper();
    const stranger = await aShipper();
    const driver = await aDriverOf();
    const dispatch = app.get(DispatchService);
    const { freightId, code } = await aMatchedLoad(biz, driver.did);
    const answer = (token: string, reference: string) => http().post(`/v1/sbg/dispatch/freight/${freightId}/not-paid-direct/answer`).set(bearer(token)).send({ reference });
    // Nothing to answer before a driver says it was not paid.
    expect((await answer(biz, 'QJK4TR21XY')).status).toBe(400);
    stored().set(freightId, { ...stored().get(freightId), status: 'delivered', deliveredAt: new Date().toISOString() });
    await http().post(`/v1/sbg/dispatch/freight/${freightId}/not-paid-direct`).set(bearer(driver.token)).expect(201);
    expect(await posted(biz, freightId)).toMatchObject({ canAnswerNotPaid: true });

    // Only the shipper, as itself: another business is told there is no such load, staff answer nothing in its name, a blank reference is no answer.
    expect((await answer(stranger, 'QJK4TR21XY')).status).toBe(404);
    const staff = await answer(operator, 'QJK4TR21XY');
    expect([staff.status, staff.body.detail]).toEqual([403, 'Whether a load was paid is the shipper’s to answer, signed in as the shipper. Staff answer nothing in its name']);
    expect((await answer(biz, '  ')).status).toBe(400);

    // The shipper answers: on its load, to the driver, in the driver's register.
    const said = (await answer(biz, '  QJK4TR21XY   paid at the gate ').expect(201)).body;
    expect(said.paidDirectAnswer).toMatchObject({ reference: 'QJK4TR21XY paid at the gate', at: expect.any(String) });
    const row = await posted(biz, freightId);
    expect(row).toMatchObject({ notPaidDirect: expect.any(Object), paidDirectAnswer: said.paidDirectAnswer });
    expect(row.canAnswerNotPaid).toBeUndefined();
    await new Promise((r) => setTimeout(r, 50));
    expect(await inbox(driver.token)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'freight_paid_direct', title: `Load ${code}: the shipper says it paid` })]));
    const jobs = (await http().get(`/v1/sbg/fleet/drivers/${encodeURIComponent(driver.did)}/jobs`).set(bearer(driver.token)).expect(200)).body.items;
    expect(jobs.find((j: { freightId: string }) => j.freightId === freightId)).toMatchObject({ notPaidDirectAt: expect.any(String), shipperAnswer: { reference: 'QJK4TR21XY paid at the gate' } });
    // One answer, as there is one "not paid".
    expect((await answer(biz, 'ANOTHER123')).status).toBe(400);

    // A week on: drivers see the load as disputed, never as unpaid.
    const next = (await http().post('/v1/sbg/dispatch/freight').set(bearer(biz)).send({ description: 'Cut stone, wrapped', pickupLocation: { lat: -1.31, lng: 36.84 }, pickupLabel: 'Mawe quarry', destLabel: 'Athi River site', destLocation: { lat: -1.45, lng: 36.98 }, weightKg: 800, packaging: 'piece', packages: 1 }).expect(201)).body.freightId as string;
    const seen = dispatch.board({ from: { lat: -1.31, lng: 36.84 }, radiusKm: 50 }, Date.now() + 8 * 86_400_000).find((r) => r.freightId === next)!;
    expect(seen.shipperUnpaid).toBeUndefined();
    expect(seen.shipperDisputed).toBe(1);

    // The driver says it was paid after all: nothing stands against the shipper.
    await tick(freightId, driver.token).expect(201);
    const after = dispatch.board({ from: { lat: -1.31, lng: 36.84 }, radiusKm: 50 }, Date.now() + 8 * 86_400_000).find((r) => r.freightId === next)!;
    expect(after.shipperDisputed).toBeUndefined();
    expect((await posted(biz, freightId)).paidDirectAnswer).toBeUndefined();
  });
});
