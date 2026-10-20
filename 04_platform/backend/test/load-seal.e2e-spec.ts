import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BusinessHookService } from '../src/modules/pudo/business-hooks.service';
import { DispatchService } from '../src/modules/pudo/dispatch.service';

/**
 * A SEAL ON A LOAD, over the wire (the user, round 15: "shipper writes driver matches according to iso 17712 including
 * the required photographs etc"; "None required"; the re-seal "With the clearing step"; a broken one "Reported at once;
 * damage report"). A business seals its load to Kampala; its driver reads the seals off the door at pickup, says at Malaba
 * that customs opened it and sealed it again, reports one broken on the road, and looks at the door with the receiver.
 */
describe('a seal on a load, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let setupKey = '';
  const tag = Math.random().toString(36).slice(2, 8);
  let seq = 0;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  let receiver: Server;
  let origin = '';
  let landed: Array<{ event: string; raw: string }> = [];

  async function aPerson(): Promise<{ token: string }> {
    seq += 1;
    const phone = `+2547${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `seal-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201);
    return { token: enrolled.body.token.access_token };
  }

  async function aDriver(name: string): Promise<{ did: string; token: string }> {
    seq += 1;
    const u = `${tag}${seq}`;
    const r = await http().post('/v1/sbg/drivers/onboard').set(bearer(setupKey)).send({ displayName: name, fullName: `${name} Truck`, nationalId: `DRV-S-${u}`, mobile: `+2547${String(Date.now()).slice(-6)}${seq}`, licenceClasses: ['truck'], licenceNumber: `DL-${u}`, licenceExpiresAt: '2030-01-01' }).expect(201);
    const token = (await http().post('/v1/auth/token').send({ role: 'driver', did: r.body.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    return { did: r.body.did as string, token };
  }

  /** A photograph taken by whoever holds `token`. */
  const photo = async (token: string, kind: string) => {
    seq += 1;
    const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${tag}:${seq}`)]).toString('base64')}`;
    return (await http().post('/v1/sbg/media').set(bearer(token)).send({ kind, dataUrl }).expect(201)).body.mediaId as string;
  };

  beforeAll(async () => {
    receiver = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        landed.push({ event: String(req.headers['x-sbg-event']), raw: Buffer.concat(chunks).toString() });
        res.writeHead(200);
        res.end();
      });
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    const a = receiver.address();
    origin = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    setupKey = (await http().post('/v1/auth/token').send({ role: 'operator' })).body.access_token;
  });

  afterAll(async () => {
    await app?.close();
    await new Promise<void>((r) => receiver.close(() => r()));
  });

  it('the shipper writes its seals; the driver reads them off the door, says the re-seal at the post, reports a broken one; the receiver looks', async () => {
    const owner = await aPerson();
    const created = await http().post('/v1/sbg/business').set(bearer(owner.token)).send({ name: `Seal Traders ${tag}`, country: 'KE', registrationNo: `SEAL-${tag}`, activities: ['shipper'], yourName: 'Wanjiku Owner' }).expect(201);
    const biz = created.body.token.access_token as string;
    await http().put('/v1/sbg/business/me/system').set(bearer(biz)).send({ url: `${origin}/hooks` }).expect(200);
    await http().post('/v1/sbg/border-rules').set(bearer(setupKey)).send({ from: 'KE', to: 'UG', crossings: [{ name: 'Malaba' }], cabotage: 'allowed' }).expect(201);
    const posted = await http()
      .post('/v1/sbg/dispatch/freight')
      .set(bearer(biz))
      .send({ description: 'Clay bricks, 3 pallets', pickupLocation: { lat: -1.33, lng: 36.87 }, pickupLabel: 'Jenga yard', destLabel: 'Kampala depot', destLocation: { lat: 0.31, lng: 32.58 }, weightKg: 1200, packaging: 'palletised', packages: 3, pickupCountry: 'KE', destCountry: 'UG' })
      .expect(201);
    const freightId = posted.body.freightId as string;
    await http().post(`/v1/sbg/dispatch/freight/${freightId}/commercial-invoice/own-paper`).set(bearer(biz)).send({ travels: true }).expect(201);
    const driver = await aDriver('Otieno');

    // THE SHIPPER WRITES ITS SEALS, with the three photographs; staff and a driver may not.
    const shot = async () => ({ loadedOpen: await photo(biz, 'seal'), closedWithSeal: await photo(biz, 'seal'), sealCloseUp: await photo(biz, 'seal') });
    const sealA = { number: 'KE 1234-567', sealClass: 'H', maker: 'Leghorn', appliedBy: 'sender', photos: await shot() };
    expect((await http().post(`/v1/sbg/dispatch/freight/${freightId}/seals`).set(bearer(setupKey)).send(sealA).expect(403)).body.detail).toMatch(/business that sealed its load/);
    await http().post(`/v1/sbg/dispatch/freight/${freightId}/seals`).set(bearer(driver.token)).send(sealA).expect(403);
    await http().post(`/v1/sbg/dispatch/freight/${freightId}/seals`).set(bearer(biz)).send({ ...sealA, photos: { ...sealA.photos, sealCloseUp: await photo(driver.token, 'seal') } }).expect(400);
    const a = (await http().post(`/v1/sbg/dispatch/freight/${freightId}/seals`).set(bearer(biz)).send(sealA).expect(201)).body;
    const b = (await http().post(`/v1/sbg/dispatch/freight/${freightId}/seals`).set(bearer(biz)).send({ number: 'KE7654321', sealClass: 'H', maker: 'Leghorn', appliedBy: 'sender', photos: await shot() }).expect(201)).body;
    expect((await http().get(`/v1/sbg/dispatch/freight/${freightId}/seals`).set(bearer(biz)).expect(200)).body).toMatchObject({ editable: true, seals: [{ number: 'KE 1234-567', sealClass: 'H', state: 'on' }, { number: 'KE7654321' }] });

    // The driver is told what to find on the door — never the number.
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    store.set(freightId, { ...store.get(freightId), status: 'claimed', claimedBy: driver.did, claimedAt: new Date().toISOString() });
    const claim = (await http().get(`/v1/sbg/fleet/drivers/${driver.did}/claims`).set(bearer(driver.token)).expect(200)).body.claims.find((c: { ref: string }) => c.ref === freightId);
    expect(claim.seals).toEqual([expect.objectContaining({ sealId: a.sealId, no: 1, sealClass: 'H', maker: 'Leghorn', check: expect.stringMatching(/^[0-9a-f]{64}$/) }), expect.objectContaining({ no: 2 })]);
    expect(JSON.stringify(claim.seals)).not.toContain('1234');
    // Round 35 — nor anywhere else before the goods are taken over: not the seals list, not the note, not the tracking page
    // (whose key is printed on the load's labels). Read off the door, or not at all. The shipper and staff still read them.
    const asCarrier = (await http().get(`/v1/sbg/dispatch/freight/${freightId}/seals`).set(bearer(driver.token)).expect(200)).body.seals;
    expect(asCarrier).toEqual([expect.objectContaining({ sealId: a.sealId, numberWithheld: true }), expect.objectContaining({ sealId: b.sealId, numberWithheld: true })]);
    expect(JSON.stringify(asCarrier)).not.toMatch(/1234|7654321/);
    const carrierNote = (await http().get(`/v1/sbg/dispatch/freight/${freightId}/consignment-note`).set(bearer(driver.token)).expect(200)).body;
    expect(JSON.stringify(carrierNote)).not.toMatch(/1234|7654321/);
    expect(carrierNote.seals).toEqual([expect.stringContaining('Seal 1: its number is read off the door at taking over'), expect.any(String)]);
    expect((await http().get(`/v1/sbg/dispatch/freight/${freightId}/consignment-note.html`).set(bearer(driver.token)).expect(200)).text).not.toMatch(/1234-567|7654321/);
    const earlyRow = (await http().get('/v1/sbg/dispatch/posted').set(bearer(biz)).expect(200)).body.items.find((r: { freightId: string }) => r.freightId === freightId);
    expect((await http().get(`/v1/sbg/track/${earlyRow.trackingKey}`).expect(200)).body.seals).toBeUndefined();
    expect(JSON.stringify((await http().get(`/v1/sbg/dispatch/freight/${freightId}/consignment-note`).set(bearer(biz)).expect(200)).body.seals)).toContain('KE 1234-567');
    expect((await http().get(`/v1/sbg/dispatch/freight/${freightId}/seals`).set(bearer(setupKey)).expect(200)).body.seals[0].number).toBe('KE 1234-567');

    // AT PICKUP: a number that is not the one written and the load does not leave; read as written, it goes.
    const pickup = async (numbers: [string, string]) => ({
      confirmed: claim.loadChecklist.map((x: { key: string }) => x.key),
      securementPhotoId: await photo(driver.token, 'securement'),
      seals: [
        { sealId: a.sealId, number: numbers[0], photoRef: await photo(driver.token, 'seal') },
        { sealId: b.sealId, number: numbers[1], photoRef: await photo(driver.token, 'seal') },
      ],
    });
    const wrong = await http().post(`/v1/sbg/dispatch/freight/${freightId}/pickup`).set(bearer(driver.token)).send(await pickup(['KE1234567', 'KE7654320'])).expect(409);
    expect(wrong.body).toMatchObject({ code: 'SEAL_MISMATCH' });
    expect(wrong.body.detail).toMatch(/Seal 2: .*does not leave/);
    expect(store.get(freightId).status).toBe('claimed');
    await http().post(`/v1/sbg/dispatch/freight/${freightId}/pickup`).set(bearer(driver.token)).send(await pickup(['ke1234567', 'KE 765 4321'])).expect(201);
    // Taken over: the seals stay as they left.
    await http().post(`/v1/sbg/dispatch/freight/${freightId}/seals`).set(bearer(biz)).send({ number: 'LATE1', sealClass: 'I', appliedBy: 'sender', photos: await shot() }).expect(400);

    // AT MALABA: cleared asks what became of the seals; customs replaced one.
    const say = (body: Record<string, unknown>) => http().post(`/v1/sbg/dispatch/freight/${freightId}/passages`).set(bearer(driver.token)).send(body);
    await say({ kind: 'at_border', post: 'Malaba' }).expect(201);
    expect((await say({ kind: 'cleared_border' }).expect(400)).body.detail).toMatch(/as they were/);
    const resealed = { kind: 'cleared_border', seals: { replaced: [{ sealId: a.sealId, newNumber: 'UG 990011', photoRef: await photo(driver.token, 'seal'), officer: 'J. Okello, badge 4471' }] } };
    await app.get(BusinessHookService).drain();
    landed = [];
    const cleared = (await say(resealed).expect(201)).body;
    expect(cleared.passage.seals).toEqual({ resealed: [{ from: 'KE 1234-567', to: 'UG 990011', officer: 'J. Okello, badge 4471' }] });
    // The same tap sent again: the same step — the seal is not replaced twice.
    expect((await say(resealed).expect(201)).body.replayed).toBe(true);
    let seals = (await http().get(`/v1/sbg/dispatch/freight/${freightId}/seals`).set(bearer(biz)).expect(200)).body.seals;
    expect(seals.map((s: { number: string; state: string }) => `${s.number}:${s.state}`)).toEqual(['KE 1234-567:replaced', 'KE7654321:on', 'UG 990011:on']);

    // ON THE ROAD: one found broken — reported by the driver, the shipper and its system told at once.
    const brokenBody = { cause: 'police', note: 'Opened at a roadblock near Bungoma', photoRefs: [await photo(driver.token, 'seal')], paperRef: await photo(driver.token, 'seal') };
    expect((await http().post(`/v1/sbg/dispatch/freight/${freightId}/seals/${b.sealId}/broken`).set(bearer(setupKey)).send(brokenBody).expect(403)).body.detail).toMatch(/driver carrying the load/);
    await http().post(`/v1/sbg/dispatch/freight/${freightId}/seals/${b.sealId}/broken`).set(bearer(driver.token)).send({ ...brokenBody, photoRefs: [] }).expect(400);
    expect((await http().post(`/v1/sbg/dispatch/freight/${freightId}/seals/${b.sealId}/broken`).set(bearer(driver.token)).send(brokenBody).expect(201)).body).toMatchObject({ number: 'KE7654321', state: 'broken', broken: { cause: 'police' } });
    await app.get(BusinessHookService).drain();
    expect(landed.map((l) => l.event)).toEqual(['load.border_cleared', 'load.seal_broken']);
    const told = JSON.parse(landed[1].raw) as { data: { seal: Record<string, unknown>; load: { seals: unknown[] } } };
    expect(told.data.seal).toMatchObject({ number: 'KE7654321', state: 'broken' });
    expect(told.data.load.seals).toHaveLength(3);
    expect(landed.map((l) => l.raw).join('')).not.toContain(driver.did);
    const bell = (await http().get('/v1/sbg/notifications/inbox').set(bearer(biz)).expect(200)).body;
    expect(JSON.stringify(bell)).toMatch(/A seal on load .* was broken/);

    // AT THE DOOR: the receiver looks with the driver.
    const deliver = async (extra: Record<string, unknown>) => ({ confirmed: claim.unloadChecklist.map((x: { key: string }) => x.key), receiverName: 'Mukasa at the depot', podPhotoId: await photo(driver.token, 'pod'), ...extra });
    // Round 35 — the broken seal held the load (the tamper protocol): the receiver does not take it until operations has
    // looked and released it, with a reason.
    expect((await http().post(`/v1/sbg/dispatch/freight/${freightId}/deliver`).set(bearer(driver.token)).send(await deliver({ sealsAtDelivery: 'as_on_the_note' })).expect(409)).body.code).toBe('UNIT_HELD');
    const code = store.get(freightId).code as string;
    await http().post(`/v1/sbg/ops/tamper/${code}/release`).set(bearer(setupKey)).send({ reason: 'Police statement photographed: opened at a roadblock inspection, goods counted', by: 'Halima at operations' }).expect(201);
    expect((await http().post(`/v1/sbg/dispatch/freight/${freightId}/deliver`).set(bearer(driver.token)).send(await deliver({})).expect(400)).body.detail).toMatch(/Look at the seals with the receiver/);
    await http().post(`/v1/sbg/dispatch/freight/${freightId}/deliver`).set(bearer(driver.token)).send(await deliver({ sealsAtDelivery: 'as_on_the_note' })).expect(201);
    seals = (await http().get(`/v1/sbg/dispatch/freight/${freightId}/seals`).set(bearer(biz)).expect(200)).body.seals;
    expect(seals[2]).toMatchObject({ number: 'UG 990011', appliedBy: 'customs', replaces: 'KE 1234-567', atDelivery: { result: 'as_on_the_note' } });

    // THE NOTE: every seal and what became of it; the break observed in box 18.
    const note = (await http().get(`/v1/sbg/dispatch/freight/${freightId}/consignment-note.html`).set(bearer(biz)).expect(200)).text;
    expect(note).toContain('Seals — their numbers and what became of each');
    expect(note).toMatch(/Seal 1: KE 1234-567 · ISO 17712 class H · Leghorn/);
    expect(note).toMatch(/put on by customs in place of KE 1234-567 at Malaba/);
    expect(note).toMatch(/Seal 2 \(KE7654321\) found broken on the road/);

    // THE TRACKING PAGE: the numbers, for the receiver to look at the door, and whether each is on — nothing about who or why.
    const row = (await http().get('/v1/sbg/dispatch/posted').set(bearer(biz)).expect(200)).body.items.find((r: { freightId: string }) => r.freightId === freightId);
    const page = (await http().get(`/v1/sbg/track/${row.trackingKey}`).expect(200)).body;
    expect(page.seals).toEqual([
      { number: 'KE 1234-567', state: 'replaced' },
      { number: 'KE7654321', state: 'broken' },
      { number: 'UG 990011', state: 'on' },
    ]);
    expect(JSON.stringify(page)).not.toMatch(/Okello|roadblock/);
  });
});
