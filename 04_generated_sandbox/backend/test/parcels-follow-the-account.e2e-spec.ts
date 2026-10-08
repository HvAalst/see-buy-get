import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AccountRecoveryService } from '../src/modules/pudo/account-recovery.service';
import { OtpService } from '../src/modules/pudo/otp.service';
import { ParcelService } from '../src/modules/pudo/parcel.service';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { NUMBER_UNDO_MS } from '../src/modules/pudo/person.service';

/**
 * A PARCEL IS KEPT BY THE ACCOUNT, NOT BY THE NUMBER — through the booted application, over HTTP.
 *
 * The unit spec proves the rule on the real services. This proves what a unit spec cannot: that the application as it
 * is wired gives the parcel service the accounts to ask (it is an optional dependency, and one left out fails nothing
 * — parcels would simply go on following the number), and that the routes a phone calls hand over the ACCOUNT that is
 * signed in, not the number it signs in with.
 */
describe('a parcel is kept by the account, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: Record<string, string>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const PIN = '4826';

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

  /** A shop that can take a parcel in: registered, checked, and with money in its float the way money gets in. */
  async function aShop(shopName: string, zone: string): Promise<string> {
    const u = digits();
    const hours = { open: '08:00', close: '18:00' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({
        shopName, zone, location: { lat: -1.2, lng: 36.8 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: null },
        fullName: `${shopName} owner`, nationalId: `ID-PFA-${u}`, mobile: `+2547${u}9`, deviceImei: `IMEI-PFA-${u}`,
        requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
      })
      .expect(201);
    const did = reg.body.did as string;
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(operator).send({ idCopyRef: 'id.jpg', tradingLicenceRef: 'lic.pdf', shopPhotoRefs: ['shop.jpg'] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(operator).send({ approve: true }).expect(201);
    const asked = await http().post(`/v1/sbg/agents/${did}/top-up`).set(operator).send({ amount: 50 }).expect(201);
    await http().post(`/v1/rails/funding/${asked.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${u}`, amount: 50 }).expect(201);
    return did;
  }

  /** A number confirmed by its code, as the app does before anything else. */
  async function confirm(phone: string): Promise<void> {
    // One number asks for a code more than once in this test; the minute between two is not what is being proved.
    (app.get(OtpService) as unknown as { rates: Map<string, unknown> }).rates.clear();
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
  }

  /** The account's own id, as its own sign-in reads it. */
  const idOf = async (token: string) => (await http().get('/v1/sbg/identity/me').set(bearer(token)).expect(200)).body.personId as string;

  /** Somebody signs up on a number: a code to it, a PIN, a confirmed recovery email. Returns their sign-in. */
  async function signUp(phone: string): Promise<string> {
    await confirm(phone);
    const email = `pfa${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201);
    return enrolled.body.token.access_token as string;
  }

  const myParcels = async (token: string) =>
    (await http().get('/v1/sbg/identity/parcels').set(bearer(token)).expect(200)).body as { sent: Array<{ parcelId: string }>; received: Array<{ parcelId: string }>; freights: Array<{ freightId: string }> };

  it('an account that moves to a new number keeps its parcel and its collection code; whoever signs up with the old number sees neither', async () => {
    const OLD = `+2547${digits()}1`;
    const NEW = `+2541${digits()}2`;
    const origin = await aShop('North PFA', 'NorthTown');
    const dest = await aShop('South PFA', 'SouthTown');
    let token = await signUp(OLD);

    // A parcel taken in at a counter, for the number this person signs in with.
    const parcelId = `PFA-${digits()}`;
    const taken = await http().post('/v1/sbg/parcels/accept').set(operator).send({ agentDid: origin, parcelId, size: 'M', destZone: 'SouthTown', destPudoDid: dest, senderMobile: `+2547${digits()}3`, receiverMobile: OLD, dropoffPhotoRef: 'drop.jpg' }).expect(201);
    expect((await myParcels(token)).received.map((p) => p.parcelId)).toEqual([parcelId]);
    // What the counter is handed back says nothing about whether the receiver's number has an account.
    const personId = await idOf(token);
    expect(personId).toMatch(/^did:/);
    expect(JSON.stringify(taken.body)).not.toContain(personId);
    // And an order of theirs that was too big for a parcel and went as freight: the same home, the same rule.
    const order = app.get(DispatchService).registerFreight({ description: 'A wardrobe', pickupLocation: { lat: -1.2, lng: 36.8 }, pickupLabel: 'The store', destLabel: 'Home', destLocation: { lat: -1.15, lng: 36.8 }, weightKg: 400, packaging: 'palletised', dimensionsCm: [120, 100, 80], buyerMobile: OLD, externalOrderId: `SO-${digits()}` });
    expect((await myParcels(token)).freights.map((x) => x.freightId)).toEqual([order.freightId]);
    const code = (await http().get(`/v1/sbg/identity/parcels/${parcelId}`).set(bearer(token)).expect(200)).body.collectToken.code as string;
    expect(code).toBeTruthy();

    // They move the account to a new number, with their PIN and a code to the new one.
    await confirm(NEW);
    await http().post('/v1/sbg/account/phone/change').set(bearer(token)).send({ pin: PIN, newPhone: NEW }).expect(201);
    await http().get('/v1/sbg/identity/parcels').set(bearer(token)).expect(401); // signed out everywhere
    token = (await http().post('/v1/sbg/identity/login').send({ phone: NEW, pin: PIN }).expect(201)).body.token.access_token;

    // The parcel is still theirs, and so is the code a shop will ask for. The order too.
    expect((await myParcels(token)).received.map((p) => p.parcelId)).toEqual([parcelId]);
    expect((await myParcels(token)).freights.map((x) => x.freightId)).toEqual([order.freightId]);
    expect((await http().get(`/v1/sbg/identity/parcels/${parcelId}`).set(bearer(token)).expect(200)).body.collectToken.code).toBe(code);

    const mine = (path: string) => http().post(`/v1/sbg/identity/parcels/${parcelId}/${path}`).set(bearer(token));
    const stored = app.get(ParcelService).get(parcelId);
    const was = { status: stored.status, vendorId: stored.vendorId };
    const me = async () => (await http().get('/v1/sbg/account/me').set(bearer(token)).expect(200)).body as { oldNumber?: { until: string; canBlock: boolean } };
    const block = (pin: string) => http().post('/v1/sbg/account/phone/old/block').set(bearer(token)).send({ pin });

    // THE DAY IN WHICH THE MOVE CAN BE UNDONE. The old number is still theirs, and not theirs to block yet; and the two
    // things that could not be put right by an undo — naming somebody else to collect, giving the parcel up — wait.
    expect(await me()).toMatchObject({ oldNumber: { canBlock: false } });
    expect((await block('0000').expect(403)).body.code).toBe('PIN_WRONG');
    expect((await block(PIN)).body).toMatchObject({ code: 'INVALID_STATE', message: expect.stringContaining('can still be undone') });
    stored.status = 'Ready_For_Pickup';
    for (const refused of [await mine('nominate-collector').send({ name: 'A neighbour' }), await mine('collection-response').send({ choice: 'relinquish' })]) {
      expect(refused.body).toMatchObject({ code: 'INVALID_STATE', message: expect.stringContaining('changed less than a day ago') });
    }
    expect(stored.collectProxy).toBeUndefined();
    expect(stored.relinquishedAt).toBeUndefined();
    // Only what cannot be taken back waits. Saying "I am coming" is theirs to say on any day.
    expect((await mine('collection-response').send({ choice: 'coming' }).expect(201)).body.parcel.parcelId).toBe(parcelId);
    Object.assign(stored, was);

    // The day passes. Nothing is let go: the old number is theirs for the rest of its week, and now theirs to block.
    expect(app.get(AccountRecoveryService).settle(Date.now() + NUMBER_UNDO_MS + 1000)).toBe(0);
    expect(await me()).toMatchObject({ oldNumber: { canBlock: true } });

    // And everything a receiver may DO about a parcel is theirs to do — each of these routes has to hand over the
    // account that is signed in. A refusal for the parcel's state is an answer about THEIR parcel; a 404 is not.
    // Still at the first shop: a dispute is refused because nothing was delivered — not because it is not theirs.
    expect((await mine('dispute').send({ reason: 'It is broken', photoRef: 'x.jpg' })).body.code).toBe('INVALID_STATE');
    // On the shelf at the collection shop: they may name somebody to collect it, and answer for it.
    stored.status = 'Ready_For_Pickup';
    expect((await mine('nominate-collector').send({ name: 'A neighbour' }).expect(201)).body.code).toMatch(/^COL-/);
    const answered = await mine('collection-response').send({ choice: 'coming' }).expect(201);
    expect(answered.body.parcel.parcelId).toBe(parcelId);
    // Delivered, and from a store: the two acts that come after the goods are in their hands.
    const store = (await http().post('/v1/sbg/vendors').set(operator).send({ name: `PFA Store ${digits()}` }).expect(201)).body.vendorId as string;
    Object.assign(stored, { status: 'Delivered', vendorId: store });
    expect((await mine('pod').send({ photoRef: 'pod.jpg' }).expect(201)).body.podPhotoRef).toBe('pod.jpg');
    expect((await mine('rate-store').send({ stars: 5 }).expect(201)).body.rating.stars).toBe(5);
    Object.assign(stored, was);

    // STILL IN ITS WEEK: a parcel sent to the old number reaches the account and says where it was sent; and nobody
    // else can open an account on that number.
    const late = `PFA-${digits()}`;
    await http().post('/v1/sbg/parcels/accept').set(operator).send({ agentDid: origin, parcelId: late, size: 'M', destZone: 'SouthTown', destPudoDid: dest, senderMobile: `+2547${digits()}5`, receiverMobile: OLD, dropoffPhotoRef: 'drop.jpg' }).expect(201);
    expect((await myParcels(token)).received.map((p) => p.parcelId).sort()).toEqual([parcelId, late].sort());
    expect((await http().get(`/v1/sbg/identity/parcels/${late}`).set(bearer(token)).expect(200)).body.sentToOldNumber).toBe(true);
    await confirm(OLD);
    const tryEmail = `pfa${digits()}@example.com`;
    const tryCode = (await http().post('/v1/sbg/identity/email/request').send({ email: tryEmail }).expect(201)).body.code as string;
    const refusedSignUp = await http().post('/v1/sbg/identity/enroll').send({ phone: OLD, pin: PIN, email: tryEmail, emailCode: tryCode });
    expect(refusedSignUp.body).toMatchObject({ code: 'INVALID_STATE', message: expect.stringContaining('less than 7 days ago') });

    // THE HOLDER BLOCKS THEIR OLD NUMBER: it is free at once, and somebody else signs up with it.
    expect((await block(PIN).expect(201)).body.oldNumber).toBeUndefined();
    expect((await me()).oldNumber).toBeUndefined();
    expect((await block(PIN)).body.code).toBe('INVALID_STATE');
    const newcomer = await signUp(OLD);
    expect(await myParcels(newcomer)).toMatchObject({ sent: [], received: [], freights: [] });
    // Not by its id either, and not told that it exists.
    await http().get(`/v1/sbg/identity/parcels/${parcelId}`).set(bearer(newcomer)).expect(404);
    await http().get(`/v1/sbg/identity/parcels/${late}`).set(bearer(newcomer)).expect(404);
    await http().post(`/v1/sbg/identity/parcels/${parcelId}/nominate-collector`).set(bearer(newcomer)).send({ name: 'A friend' }).expect(404);
    await http().post(`/v1/sbg/identity/parcels/${parcelId}/dispute`).set(bearer(newcomer)).send({ reason: 'It is broken', photoRef: 'x.jpg' }).expect(404);

    // What is sent to that number from now on is the newcomer's, and not the account's that left it.
    const next = `PFA-${digits()}`;
    await http().post('/v1/sbg/parcels/accept').set(operator).send({ agentDid: origin, parcelId: next, size: 'M', destZone: 'SouthTown', destPudoDid: dest, senderMobile: `+2547${digits()}4`, receiverMobile: OLD, dropoffPhotoRef: 'drop.jpg' }).expect(201);
    expect((await myParcels(newcomer)).received.map((p) => p.parcelId)).toEqual([next]);
    expect((await myParcels(token)).received.map((p) => p.parcelId).sort()).toEqual([parcelId, late].sort());
  });

  it('an account moved without its PIN reads its parcel with no code on it, and is told from when it shows', async () => {
    const OLD = `+2547${digits()}6`;
    const NEW = `+2541${digits()}7`;
    const origin = await aShop('North PFB', 'NorthTown');
    const dest = await aShop('South PFB', 'SouthTown');
    let token = await signUp(OLD);
    const parcelId = `PFB-${digits()}`;
    await http().post('/v1/sbg/parcels/accept').set(operator).send({ agentDid: origin, parcelId, size: 'M', destZone: 'SouthTown', destPudoDid: dest, senderMobile: `+2547${digits()}8`, receiverMobile: OLD, dropoffPhotoRef: 'drop.jpg' }).expect(201);
    const code = (await http().get(`/v1/sbg/identity/parcels/${parcelId}`).set(bearer(token)).expect(200)).body.collectToken.code as string;

    // Two members of staff move it (their checking is another suite's to prove; the move is the one they end in).
    const moved = app.get(AccountRecoveryService).moveByStaff(await idOf(token), NEW);
    token = (await http().post('/v1/sbg/identity/login').send({ phone: NEW, pin: PIN }).expect(201)).body.token.access_token;

    const seen = (await http().get(`/v1/sbg/identity/parcels/${parcelId}`).set(bearer(token)).expect(200)).body as { parcelId: string; collectToken?: unknown; codeHeldUntil?: string };
    expect(seen.parcelId).toBe(parcelId);
    expect(seen.collectToken).toBeUndefined();
    expect(seen.codeHeldUntil).toBe(moved.phoneChange!.undoUntil);
    // Neither the code it had — which opens nothing now — nor the one that replaced it is anywhere in what they are sent.
    const everything = JSON.stringify([seen, await myParcels(token)]);
    expect(everything).not.toContain(code);
    const now = app.get(ParcelService).get(parcelId).otp as string;
    expect(now).not.toBe(code);
    expect(everything).not.toContain(`"${now}"`);
  });
});
