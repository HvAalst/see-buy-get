import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { shopPhotoOver } from './content-photo';
import { declared } from './declared';
import { FlagCaseService } from '../src/modules/pudo/flag-case.service';
import { ParcelService } from '../src/modules/pudo/parcel.service';

/**
 * LOST, DECLARED BY STAFF AFTER A SEARCH, over the wire (the user, 2026-10-18: "staff declare it"). A parcel in the
 * network's hands with no scan for a week opens a search case; staff declare it lost from it with where they looked —
 * never sooner, never a shop; the sender is told in the app and holds the damage claim report; it can be found again
 * and carries on from where it was. Who declared it is staff's record, never on the parcel.
 */
describe('a lost parcel, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const PIN = '48261';
  const WEEK_AGO = () => new Date(Date.now() - 8 * 24 * 3_600_000).toISOString();
  let operator: Record<string, string> = {};

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

  /** A working shop and its own sign-in. */
  async function aShop(): Promise<{ did: string; owner: Record<string, string> }> {
    const u = digits();
    const day = { open: '08:00', close: '18:00' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({ shopName: `Duka ${u}`, zone: `ZL${u}`, location: { lat: -1.2, lng: 36.8 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 }, openingHours: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: null }, fullName: `Duka ${u} owner`, nationalId: `ID-${u}`, mobile: `+2547${u}1`, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } })
      .expect(201);
    const did = reg.body.did as string;
    const owner = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const photo = async (kind: string) => (await http().post('/v1/sbg/media').set(owner).send({ kind, dataUrl: `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${did}`)]).toString('base64')}` }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(owner).send({ idCopyRef: await photo('kyc_id'), tradingLicenceRef: await photo('kyc_licence'), shopPhotoRefs: [await photo('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(operator).send({ approve: true }).expect(201);
    declared(app, 'shop', did);
    const asked = await http().post(`/v1/sbg/agents/${did}/top-up`).set(owner).send({ amount: 50 }).expect(201);
    await http().post(`/v1/rails/funding/${asked.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 50 }).expect(201);
    return { did, owner };
  }

  /** A person with their own phone and PIN, signed in as themselves. */
  async function aPerson(phone: string): Promise<Record<string, string>> {
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `duka${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201);
    return bearer(enrolled.body.token.access_token as string);
  }

  async function aParcelTakenIn(shop: { did: string; owner: Record<string, string> }, senderMobile: string): Promise<string> {
    const parcelId = `DUKA-${digits()}`;
    await http().post('/v1/sbg/parcels/accept').set(shop.owner).send({ agentDid: shop.did, parcelId, size: 'S', destZone: 'FarTown', senderMobile, receiverMobile: `+2547${digits()}9`, dropoffPhotoRef: await shopPhotoOver(app.getHttpServer(), shop.did) }).expect(201);
    return parcelId;
  }

  /** Its last scan a week and a day ago — the network has not seen it since. */
  function quietForAWeek(parcelId: string): void {
    const p = app.get(ParcelService).get(parcelId);
    const old = WEEK_AGO();
    for (const s of p.scans) s.at = old;
    p.acceptedAt = old;
  }

  const inbox = async (who: Record<string, string>) => ((await http().get('/v1/sbg/notifications/inbox').set(who).expect(200)).body.items ?? []) as Array<{ kind: string; title: string; body: string }>;

  it('is searched for after a week, declared lost by name from its case, told to the sender with the report — and found again', async () => {
    const shop = await aShop();
    const senderPhone = `+2547${digits()}5`;
    const sender = await aPerson(senderPhone);
    const parcelId = await aParcelTakenIn(shop, senderPhone);
    const LOOKED = 'Looked on the shop’s shelf and in the back room, and asked the bus crew: not there.';

    // Not before a week without a scan: until then it is late, not lost. And never a shop's to declare.
    const early = await http().post(`/v1/sbg/parcels/${parcelId}/lost`).set(operator).send({ reason: LOOKED, by: 'Achieng' });
    expect([early.status, early.body.detail]).toEqual([expect.any(Number), expect.stringMatching(/only after 7 days without a scan/)]);
    expect(early.status).toBeGreaterThanOrEqual(400);
    await http().post(`/v1/sbg/parcels/${parcelId}/lost`).set(shop.owner).send({ reason: LOOKED }).expect(403);

    // Seen today: nothing to search for.
    app.get(FlagCaseService).sync();
    const fresh = (await http().get('/v1/sbg/flag-cases?kind=Not_Seen').set(operator).expect(200)).body.items as Array<{ subject: string }>;
    expect(fresh.map((c) => c.subject)).not.toContain(parcelId);

    // A week without a scan: the search case opens.
    quietForAWeek(parcelId);
    app.get(FlagCaseService).sync();
    const live = (await http().get('/v1/sbg/flag-cases?kind=Not_Seen').set(operator).expect(200)).body.items as Array<{ subject: string; severity: string; detail: string }>;
    expect(live.find((c) => c.subject === parcelId)).toMatchObject({ severity: 'high', detail: expect.stringMatching(/no scan for 8 days/) });

    // Declared with where they looked — a word or two is not enough, the sender reads it.
    expect((await http().post(`/v1/sbg/parcels/${parcelId}/lost`).set(operator).send({ reason: 'gone', by: 'Achieng' }).expect(400)).body.detail).toMatch(/where you looked/);
    const declared = (await http().post(`/v1/sbg/parcels/${parcelId}/lost`).set(operator).send({ reason: LOOKED, by: 'Achieng' }).expect(201)).body;
    expect(declared).toMatchObject({ status: 'Lost', reason: LOOKED, acts: [expect.objectContaining({ act: 'declared', by: 'Achieng' })] });
    expect((await http().post(`/v1/sbg/parcels/${parcelId}/lost`).set(operator).send({ reason: LOOKED, by: 'Achieng' }).expect(400)).body.detail).toMatch(/already declared lost/);

    // Its case closed by the same act, under the same name and words.
    const closed = (await http().get('/v1/sbg/flag-cases?which=closed&kind=Not_Seen').set(operator).expect(200)).body.items as Array<{ subject: string; history: Array<{ act: string; by: string; text?: string }> }>;
    expect(closed.find((c) => c.subject === parcelId)?.history.at(-1)).toMatchObject({ act: 'done', by: 'Achieng', text: `Declared lost: ${LOOKED}` });

    // Staff's record, never the parcel's: shops and stores read the parcel.
    const parcel = (await http().get(`/v1/sbg/parcels/${parcelId}`).set(operator).expect(200)).body;
    expect(parcel.status).toBe('Lost');
    expect(JSON.stringify(parcel)).not.toContain('Achieng');

    // The sender is told in the app, and the damage claim report is theirs: the network's own words, the chain.
    expect(await inbox(sender)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'parcel_lost', title: `A parcel you sent ${parcelId} could not be found`, body: expect.stringContaining('damage claim report is yours') })]));
    const report = (await http().get(`/v1/sbg/parcels/${parcelId}/damage-report`).set(sender).expect(200)).body;
    expect(report.body.problem).toMatchObject({ origin: 'lost', reason: LOOKED, parcelWas: expect.stringMatching(/^not found: at the shop it was handed in at when it was last scanned/) });
    expect(report.body.events.at(-1)).toMatchObject({ status: 'Lost' });

    // Found again: it carries on from where it was lost, and the sender is told.
    await http().post(`/v1/sbg/parcels/${parcelId}/found`).set(shop.owner).send({ note: 'x' }).expect(403);
    const found = (await http().post(`/v1/sbg/parcels/${parcelId}/found`).set(operator).send({ note: 'Behind the counter, under a box of phone cases.', by: 'Baraka' }).expect(201)).body;
    expect(found).toMatchObject({ status: 'At_PUDO', foundNote: 'Behind the counter, under a box of phone cases.', acts: [expect.objectContaining({ act: 'declared', by: 'Achieng' }), expect.objectContaining({ act: 'found', by: 'Baraka' })] });
    expect((await inbox(sender)).map((n) => n.kind)).toEqual(expect.arrayContaining(['parcel_lost', 'parcel_found']));
    expect(((await http().get('/v1/sbg/lost-parcels').set(operator).expect(200)).body as Array<{ parcelId: string }>).map((p) => p.parcelId)).toContain(parcelId);
  });

  it('is never declared lost once it has left the network’s hands', async () => {
    const shop = await aShop();
    const parcelId = await aParcelTakenIn(shop, `+2547${digits()}7`);
    app.get(ParcelService).get(parcelId).status = 'Delivered';
    quietForAWeek(parcelId);
    const refused = await http().post(`/v1/sbg/parcels/${parcelId}/lost`).set(operator).send({ reason: 'Looked everywhere a parcel can be.', by: 'Achieng' }).expect(400);
    expect(refused.body.detail).toMatch(/not in the network’s hands/);
  });

  it('is not handed out or shelved at a counter while lost, and is found by a bag scan that has it', async () => {
    const shop = await aShop();
    const parcels = app.get(ParcelService);
    const parcelId = await aParcelTakenIn(shop, `+2547${digits()}6`);
    // On a bus when it went quiet.
    parcels.get(parcelId).status = 'On_Bus';
    quietForAWeek(parcelId);
    await http().post(`/v1/sbg/parcels/${parcelId}/lost`).set(operator).send({ reason: 'The bus crew and both hubs on the road have looked: not there.', by: 'Achieng' }).expect(201);

    // The shop scanning it is told what it is, not "wrong state".
    const arrived = await http().post(`/v1/sbg/parcels/${parcelId}/arrive`).set(shop.owner).send({ agentDid: shop.did });
    expect([arrived.status, arrived.body.code]).toEqual([409, 'PARCEL_LOST']);
    expect(arrived.body.detail).toMatch(/Keep it safe and tell SeeBuyGet you have it/);

    // A bag holding it, scanned at a hub: in somebody's hands, so found — and the bag is not stopped.
    parcels.setTransit(parcelId, 'At_MDP', 'Hub One', 'bag dropped');
    const after = parcels.get(parcelId);
    expect([after.status, after.lost?.foundNote]).toEqual(['At_MDP', 'scanned in a bag (at a hub)']);
  });
});
