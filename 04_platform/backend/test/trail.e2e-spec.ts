import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { NoteArchiveService } from '../src/modules/pudo/note-archive.service';
import { TamperService } from '../src/modules/pudo/tamper.service';
import { LoadSealService } from '../src/modules/pudo/load-seal.service';
import { AGREED } from './agreed';

/**
 * THE TRAIL, over the wire (the ISO 28000 check: "anchor custody, loads, seals and the documents' fingerprints"). A load
 * taken over, reported cut on the road, released, delivered: each step anchored as it is kept, and staff read every step
 * intact. A record changed afterwards — the receiver's name, a word of a frozen note, an exception's note — reads altered.
 */
describe('the trail, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const tag = digits();
  let seq = 0;

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

  const photo = async (who: { authorization: string }, kind: string) => {
    seq += 1;
    const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${tag}:${seq}`)]).toString('base64')}`;
    return (await http().post('/v1/sbg/media').set(who).send({ kind, dataUrl }).expect(201)).body.mediaId as string;
  };

  async function aBusiness(): Promise<{ authorization: string }> {
    seq += 1;
    const phone = `+2547${digits()}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `trail-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const owner = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token as string;
    const created = await http().post('/v1/sbg/business').set(bearer(owner)).send({ name: `Trail Traders ${tag}`, country: 'KE', registrationNo: `TRL-${tag}`, activities: ['shipper'], yourName: 'Achieng Owner' }).expect(201);
    return bearer(created.body.token.access_token);
  }

  it('anchors each step as it is kept, and reads a record changed afterwards as altered', async () => {
    const biz = await aBusiness();
    // Its own GS1 prefix: every package of the load gets an SSCC, and the seal is bound to them as it is written.
    await http().post('/v1/sbg/business/me/gs1').set(biz).send({ companyPrefix: `61${String(Math.floor(Math.random() * 90_000) + 10_000)}`, extensionDigit: 4 }).expect(201);
    const posted = await http()
      .post('/v1/sbg/dispatch/freight')
      .set(biz)
      .send({ description: 'Cement, 40 bags', pickupLocation: { lat: -1.33, lng: 36.87 }, pickupLabel: 'Athi River works', destLabel: 'Machakos store', destLocation: { lat: -1.52, lng: 37.26 }, weightKg: 2000, packaging: 'bagged', packages: 40, pickupCountry: 'KE', destCountry: 'KE' })
      .expect(201);
    const freightId = posted.body.freightId as string;
    // Its seal, written by the shipper with its three photographs.
    const shot = async () => ({ loadedOpen: await photo(biz, 'seal'), closedWithSeal: await photo(biz, 'seal'), sealCloseUp: await photo(biz, 'seal') });
    const seal = (await http().post(`/v1/sbg/dispatch/freight/${freightId}/seals`).set(biz).send({ number: 'KE 7777-001', sealClass: 'H', appliedBy: 'sender', photos: await shot() }).expect(201)).body;
    const d = await http().post('/v1/sbg/drivers/onboard').set(operator).send({ displayName: 'Mutua', fullName: 'Mutua Truck', nationalId: `DRV-TR-${tag}`, mobile: `+2547${digits().slice(-6)}9`, licenceClasses: ['truck'], licenceNumber: `DL-TR-${tag}`, licenceExpiresAt: '2030-01-01' }).expect(201);
    const driver = bearer((await http().post('/v1/auth/token').send({ role: 'driver', did: d.body.did, type: 'client_credentials' }).expect(201)).body.access_token);
    const dispatch = app.get(DispatchService);
    const store = (dispatch as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    store.set(freightId, { ...store.get(freightId), status: 'claimed', claimedBy: d.body.did, claimedAt: new Date(Date.now() - 3_600_000).toISOString() });
    const code = store.get(freightId).code as string;
    const claim = (await http().get(`/v1/sbg/fleet/drivers/${d.body.did}/claims`).set(driver).expect(200)).body.claims.find((c: { ref: string }) => c.ref === freightId);

    await http().post(`/v1/sbg/dispatch/freight/${freightId}/pickup`).set(driver).send({ confirmed: claim.loadChecklist.map((x: { key: string }) => x.key), securementPhotoId: await photo(driver, 'securement'), seals: [{ sealId: seal.sealId, number: 'KE 7777-001', photoRef: await photo(driver, 'seal') }] }).expect(201);
    await http().post(`/v1/sbg/dispatch/freight/${freightId}/tamper`).set(driver).send({ finding: 'wrap_cut', photoRefs: [await photo(driver, 'tamper')], note: 'Two bags slit' }).expect(201);
    await http().post(`/v1/sbg/ops/tamper/${code}/release`).set(operator).send({ reason: 'Shipper counted the bags by phone with the driver', by: 'Halima at operations' }).expect(201);
    await http().post(`/v1/sbg/dispatch/freight/${freightId}/deliver`).set(driver).send({ confirmed: claim.unloadChecklist.map((x: { key: string }) => x.key), receiverName: 'Wambui at the store', podPhotoId: await photo(driver, 'pod'), sealsAtDelivery: 'as_on_the_note' }).expect(201);

    // Staff read the trail by the load's code: taken over, the exception (released since — the release is not part of
    // what was found), the note's copies, delivered — each intact, and the chain whole.
    const trail = async () => (await http().get(`/v1/sbg/ops/trail/${code}`).set(operator).expect(200)).body as { kind: string; steps: Array<{ kind: string; state: string; detail?: string; txId?: string }>; chain: { whole: boolean } };
    const first = await trail();
    expect(first.kind).toBe('load');
    expect(first.chain.whole).toBe(true);
    expect(first.steps.map((s) => s.kind)).toEqual(expect.arrayContaining(['seal_written', 'picked_up', 'seal_read', 'exception', 'note', 'delivered']));
    expect(first.steps.filter((s) => s.kind === 'seal_read').map((s) => s.detail)).toEqual(['pickup · matched', 'delivery · as_on_the_note']);
    expect(first.steps.filter((s) => s.kind === 'note').length).toBeGreaterThanOrEqual(2);
    expect(first.steps.every((s) => s.state === 'intact' && /^[0-9a-f]{64}$/.test(s.txId ?? ''))).toBe(true);
    // Only staff.
    await http().get(`/v1/sbg/ops/trail/${code}`).set(driver).expect(403);
    await http().get('/v1/sbg/ops/trail/FRT-NOPE').set(operator).expect(404);
    // The seal says what it closes — the load's forty package codes — and any of them, as a GS1-128 scan reads it, opens
    // the load's trail (the ISO 28000 check: "seals bound to the SSCCs").
    const sealsRead = (await http().get(`/v1/sbg/dispatch/freight/${freightId}/seals`).set(biz).expect(200)).body.seals as Array<{ sealId: string; ssccs?: string[] }>;
    const bound = sealsRead.find((s) => s.sealId === seal.sealId)!.ssccs ?? [];
    expect(bound).toHaveLength(40);
    const byPackage = (await http().get(`/v1/sbg/ops/trail/${encodeURIComponent(`(00)${bound[17]}`)}`).set(operator).expect(200)).body;
    expect([byPackage.kind, byPackage.ref]).toEqual(['load', code]);

    // CHANGED AFTERWARDS, each in the store as somebody with the database might: the receiver's name; a word of the note's
    // copy as it was taken over; the exception's note. Each reads altered; the rest stay intact.
    store.set(freightId, { ...store.get(freightId), proofOfDelivery: { ...(store.get(freightId).proofOfDelivery as Record<string, unknown>), receiverName: 'Somebody else' } });
    const docs = (app.get(NoteArchiveService) as unknown as { docs: { get(id: string): { versions: Array<{ stage: string; note: { goods: { description: string } } }> }; set(id: string, d: unknown): void } }).docs;
    const docId = `freight~${freightId}`;
    const doc = docs.get(docId);
    doc.versions[0].note.goods.description = 'Cement, 38 bags';
    docs.set(docId, doc);
    const log = (app.get(TamperService) as unknown as { log: { values(): Iterable<{ exceptionId: string; unit: { id: string }; note?: string }>; set(id: string, e: unknown): void } }).log;
    const e = [...log.values()].find((x) => x.unit.id === freightId)!;
    log.set(e.exceptionId, { ...e, note: 'One bag slit' });
    const after = await trail();
    const state = (kind: string, n = 0) => after.steps.filter((s) => s.kind === kind)[n]?.state;
    expect(state('delivered')).toBe('altered');
    expect(state('note', 0)).toBe('altered');
    expect(state('exception')).toBe('altered');
    expect(state('picked_up')).toBe('intact');
    expect(state('note', 1)).toBe('intact');
    expect(state('seal_written')).toBe('intact');
    // A seal's reading at the door changed in the store: altered.
    const seals = (app.get(LoadSealService) as unknown as { seals: { get(id: string): { readings: Array<{ result: string }> }; set(id: string, s: unknown): void } }).seals;
    const kept = seals.get(seal.sealId);
    kept.readings[1].result = 'not_as_on_the_note';
    seals.set(seal.sealId, kept);
    expect((await trail()).steps.filter((s) => s.kind === 'seal_read').map((s) => s.state)).toEqual(['intact', 'altered']);
  });
});
