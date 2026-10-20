import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CONTENTS_PNG } from './content-photo';

/**
 * A BUSINESS'S KEY WRITES THE SEALS ON ITS LOADS, over the wire (round 33, the user: "A business's key writes seals").
 * Its own system does what a person does in the Business app, through the same door and in the same words: on its own
 * load, before the goods are taken over, with the three photographs — each one the business sent first, and used for
 * nothing else. A test key runs every check and keeps nothing.
 */
describe('a business’s key writes the seals on its loads, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const tag = Math.random().toString(36).slice(2, 8);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const keyed = (key: string) => ({ 'x-sbg-key': key });
  let seq = 0;

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

  /** A business with its owner signed in, and a live and a test key its owner made. */
  async function aBusiness(name: string): Promise<{ token: string; live: string; test: string }> {
    seq += 1;
    const phone = `+2547${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `seal-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token as string;
    const token = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `${name} ${tag}`, country: 'KE', registrationNo: `SEAL-${tag}-${seq}`, activities: ['shipper'], yourName: 'Wanjiku Owner' }).expect(201)).body.token.access_token as string;
    const live = (await http().post('/v1/sbg/business/me/keys').set(bearer(token)).send({ mode: 'live', label: 'ERP' }).expect(201)).body.secret as string;
    const test = (await http().post('/v1/sbg/business/me/keys').set(bearer(token)).send({ mode: 'test', label: 'ERP sandbox' }).expect(201)).body.secret as string;
    return { token, live, test };
  }
  const aLoad = { description: 'Tea, 40 cartons', pickupLocation: { lat: -0.37, lng: 35.28 }, pickupLabel: 'Kericho factory', destLabel: 'Mombasa port', destLocation: { lat: -4.05, lng: 39.66 }, weightKg: 1200, packaging: 'palletised', pickupCountry: 'KE', destCountry: 'KE' };
  const photo = async (key: string) => (await http().post('/v1/sbg/api/business/photos').set(keyed(key)).send({ dataUrl: CONTENTS_PNG }).expect(201)).body.photoId as string;
  const three = async (key: string) => ({ loadedOpen: await photo(key), closedWithSeal: await photo(key), sealCloseUp: await photo(key) });

  it('writes a seal on its own load with the photographs it sent, reads it as the app does — and a test key keeps nothing', async () => {
    const biz = await aBusiness('Kericho Tea');
    const freightId = (await http().post('/v1/sbg/api/business/loads').set(keyed(biz.live)).send(aLoad).expect(201)).body.load.freightId as string;
    const seals = `/v1/sbg/api/business/loads/${freightId}/seals`;
    const inApp = async () => (await http().get(`/v1/sbg/dispatch/freight/${freightId}/seals`).set(bearer(biz.token)).expect(200)).body;

    // Its photographs, sent first: each kept as the business's own until a seal names it.
    const sent = (await http().post('/v1/sbg/api/business/photos').set(keyed(biz.live)).send({ dataUrl: CONTENTS_PNG }).expect(201)).body;
    expect(sent).toEqual({ photoId: expect.stringMatching(/^med_/), keptUnusedUntil: expect.any(String) });

    // A test key: every check, nothing kept — the seal is answered as it would read, the load carries none.
    const tried = (await http().post(seals).set(keyed(biz.test)).send({ number: 'ke 004471', sealClass: 'H', appliedBy: 'sender', photos: await three(biz.test) }).expect(201)).body;
    expect(tried).toMatchObject({ test: true, replayed: false, seal: { sealId: expect.stringMatching(/^test_seal_/), number: 'ke 004471', sealClass: 'H', state: 'on' } });
    expect((await inApp()).seals).toEqual([]);

    // A live key writes it — the same seal the Business app reads, and reads back here.
    const photos = await three(biz.live);
    const written = (await http().post(seals).set(keyed(biz.live)).set('idempotency-key', `seal-${tag}`).send({ number: 'KE 004471', sealClass: 'H', maker: 'TydenBrooks', appliedBy: 'sender', photos }).expect(201)).body;
    expect(written).toMatchObject({ test: false, replayed: false, seal: { number: 'KE 004471', sealClass: 'H', maker: 'TydenBrooks', appliedBy: 'sender', state: 'on' } }); // as printed
    expect((await inApp()).seals).toEqual([written.seal]);
    expect((await http().get(seals).set(keyed(biz.live)).expect(200)).body).toEqual({ freightId, seals: [written.seal], editable: true });
    // Sent again under the same name: answered once, one seal.
    expect((await http().post(seals).set(keyed(biz.live)).set('idempotency-key', `seal-${tag}`).send({ number: 'KE 004471', sealClass: 'H', maker: 'TydenBrooks', appliedBy: 'sender', photos }).expect(201)).body).toMatchObject({ replayed: true, seal: { sealId: written.seal.sealId } });
    expect((await inApp()).seals).toHaveLength(1);

    // Refused in the app's own words: the same number again; a photograph already another seal's; one it never sent.
    const again = await http().post(seals).set(keyed(biz.live)).send({ number: 'KE004471', sealClass: 'H', appliedBy: 'sender', photos: await three(biz.live) }).expect(400);
    expect(again.body.detail).toBe('Seal KE004471 is on this load already');
    const reused = await http().post(seals).set(keyed(biz.live)).send({ number: 'KE004472', sealClass: 'H', appliedBy: 'sender', photos: { ...(await three(biz.live)), sealCloseUp: photos.sealCloseUp } });
    const named = await http().post(seals).set(keyed(biz.live)).send({ number: 'KE004473', sealClass: 'H', appliedBy: 'sender', photos: { ...(await three(biz.live)), loadedOpen: 'door-open.jpg' } });
    const viaApp = await http().post(`/v1/sbg/dispatch/freight/${freightId}/seals`).set(bearer(biz.token)).send({ number: 'KE004473', sealClass: 'H', appliedBy: 'sender', photos: { ...(await three(biz.live)), loadedOpen: 'door-open.jpg' } });
    expect(named.status).toBe(viaApp.status);
    expect(named.body.detail).toBe(viaApp.body.detail);
    expect(named.body.detail).toMatch(/not one of yours/);
    expect(reused.status).toBe(400);
    expect(reused.body.detail).toMatch(/that photograph is another seal’s/); // round 33 — found by this test: it used to be taken
    expect((await inApp()).seals).toHaveLength(1);

    // Taken off: a test key checks and keeps it; a live key takes it off.
    expect((await http().delete(`${seals}/${written.seal.sealId}`).set(keyed(biz.test)).expect(200)).body).toEqual({ test: true, removed: false });
    expect((await inApp()).seals).toHaveLength(1);
    expect((await http().delete(`${seals}/${written.seal.sealId}`).set(keyed(biz.live)).expect(200)).body).toEqual({ test: false, removed: true });
    expect((await inApp()).seals).toEqual([]);
  });

  it('touches no other business’s load, and no photograph another business sent', async () => {
    const mine = await aBusiness('Nyeri Coffee');
    const theirs = await aBusiness('Thika Pineapple');
    const theirLoad = (await http().post('/v1/sbg/api/business/loads').set(keyed(theirs.live)).send(aLoad).expect(201)).body.load.freightId as string;
    const myLoad = (await http().post('/v1/sbg/api/business/loads').set(keyed(mine.live)).send(aLoad).expect(201)).body.load.freightId as string;
    // Another business's load reads exactly as no load at all.
    const other = await http().get(`/v1/sbg/api/business/loads/${theirLoad}/seals`).set(keyed(mine.live)).expect(404);
    const none = await http().get('/v1/sbg/api/business/loads/frt_missing/seals').set(keyed(mine.live)).expect(404);
    expect(other.body.detail).toBe(none.body.detail);
    await http().post(`/v1/sbg/api/business/loads/${theirLoad}/seals`).set(keyed(mine.live)).send({ number: 'KE1', sealClass: 'I', appliedBy: 'sender', photos: await three(mine.live) }).expect(404);
    // Photographs another business sent are not this one's to name.
    const refused = await http().post(`/v1/sbg/api/business/loads/${myLoad}/seals`).set(keyed(mine.live)).send({ number: 'KE2', sealClass: 'I', appliedBy: 'sender', photos: await three(theirs.live) }).expect(400);
    expect(refused.body.detail).toMatch(/not one of yours/);
    // No key, or a store's: refused.
    await http().post('/v1/sbg/api/business/photos').send({ dataUrl: CONTENTS_PNG }).expect(401);
  });
});
