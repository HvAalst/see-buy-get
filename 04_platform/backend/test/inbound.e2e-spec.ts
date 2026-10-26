import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AGREED } from './agreed';
import { createServer, IncomingMessage, Server, ServerResponse } from 'http';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { BusinessHookService } from '../src/modules/pudo/business-hooks.service';
import { EventBus } from '../src/foundation/events/event-bus.service';
import { GlosEvent } from '../src/foundation/events/glos-events';
import { requiredUnloadKeys } from '../src/modules/pudo/heavy-cargo';

/**
 * INBOUND SUPPLY, READING A, over the wire (assessment.html D1–D14; the user, 2026-10-25: "Yes, A then B"). A business
 * receiving at its own sites opens a receiving point on a place of its own and gives the code to a supplier; the supplier
 * writes it as "deliver to" when posting a load; the receiver sees it coming in — the logistics half, never the price —
 * and its bell says so. The code names the place and opens nothing; a new one retires the old; staff read loads where
 * they always have and none of this.
 */
describe('inbound, reading A: what is coming in to a business’s own sites', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let setupKey = '';
  const tag = Math.random().toString(36).slice(2, 8);
  let seq = 0;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  async function aPerson(): Promise<{ phone: string; token: string }> {
    seq += 1;
    const phone = `+2547${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `inb-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201);
    return { phone, token: enrolled.body.token.access_token };
  }

  async function aBusiness(name: string, activities: string[]): Promise<{ token: string; entityId: string; join: (role: 'booker' | 'viewer') => Promise<string> }> {
    const owner = await aPerson();
    const created = await http().post('/v1/sbg/business').set(bearer(owner.token)).send({ name: `${name} ${tag}`, country: 'KE', registrationNo: `INB-${tag}-${seq}`, activities, yourName: `${name} Owner` }).expect(201);
    const token = created.body.token.access_token as string;
    const entityId = created.body.business.entityId as string;
    const join = async (role: 'booker' | 'viewer') => {
      const who = await aPerson();
      await http().post('/v1/sbg/business/me/members').set(bearer(token)).send({ phone: who.phone, name: `${name} ${role}`, role }).expect(201);
      const invite = (await http().get('/v1/sbg/business/mine').set(bearer(who.token)).expect(200)).body.items.find((i: { entityId: string }) => i.entityId === entityId);
      await http().post(`/v1/sbg/business/invitations/${invite.memberId}/accept`).set(bearer(who.token)).expect(201);
      return (await http().post(`/v1/sbg/business/${entityId}/session`).set(bearer(who.token)).expect(201)).body.token.access_token as string;
    };
    return { token, entityId, join };
  }

  async function aDriver(name: string): Promise<{ did: string; token: string }> {
    seq += 1;
    const u = `${tag}${seq}`;
    const r = await http().post('/v1/sbg/drivers/onboard').set(bearer(setupKey)).send({ displayName: name, fullName: `${name} Truck`, nationalId: `DRV-I-${u}`, mobile: `+2547${String(Date.now()).slice(-6)}${seq}`, licenceClasses: ['truck'], licenceNumber: `DL-${u}`, licenceExpiresAt: '2030-01-01' }).expect(201);
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
  });

  it('a receiving point’s code takes a supplier’s load to it, and the receiver sees it coming — never its price', async () => {
    const yard = await aBusiness('Jenga Builders', ['receiver']);
    const viewer = await yard.join('viewer');
    const supplier = await aBusiness('Mlima Cement', ['shipper']);

    // A place of its own, receiving: a code to give suppliers. A viewer reads and changes nothing; staff are refused.
    const site = (await http().post(`/v1/sbg/entities/${yard.entityId}/sites`).set(bearer(yard.token)).send({ kind: 'delivery', name: 'Mombasa Road yard', location: { lat: -1.33, lng: 36.88 } }).expect(201)).body;
    await http().post(`/v1/sbg/business/me/receiving/${site.siteId}`).set(bearer(viewer)).expect(403);
    await http().post(`/v1/sbg/business/me/receiving/${site.siteId}`).set(bearer(setupKey)).expect(403);
    const point = (await http().post(`/v1/sbg/business/me/receiving/${site.siteId}`).set(bearer(yard.token)).expect(201)).body;
    expect(point).toMatchObject({ siteId: site.siteId, name: 'Mombasa Road yard', code: expect.stringMatching(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/) });
    expect((await http().get('/v1/sbg/business/me/receiving').set(bearer(viewer)).expect(200)).body).toEqual([point]);

    // The supplier looks the code up — written any way — and learns the place, nothing more.
    const named = (await http().get(`/v1/sbg/receiving/${point.code.toLowerCase().replace('-', ' ')}`).set(bearer(supplier.token)).expect(200)).body;
    expect(named).toEqual({ name: `Jenga Builders ${tag}`, siteName: 'Mombasa Road yard', location: { lat: -1.33, lng: 36.88 } });
    await http().get('/v1/sbg/receiving/ZZZZ-ZZZZ').set(bearer(supplier.token)).expect(404);

    // A code nobody gave is refused before anything is posted; the right one sends the load there.
    await http()
      .post('/v1/sbg/dispatch/freight')
      .set(bearer(supplier.token))
      .send({ description: 'Cement, 400 bags', pickupLocation: { lat: -1.42, lng: 36.95 }, pickupLabel: 'Athi River works', destLabel: 'wherever', weightKg: 20000, packaging: 'bagged', packages: 400, pickupCountry: 'KE', destCountry: 'KE', receivingPoint: 'ZZZZ-ZZZZ' })
      .expect(400)
      .expect((r) => expect(r.body.message).toMatch(/No receiving point has the code “ZZZZ-ZZZZ”/));
    const posted = (
      await http()
        .post('/v1/sbg/dispatch/freight')
        .set(bearer(supplier.token))
        .send({ description: 'Cement, 400 bags', pickupLocation: { lat: -1.42, lng: 36.95 }, pickupLabel: 'Athi River works', destLabel: 'wherever', weightKg: 20000, packaging: 'bagged', packages: 400, pickupCountry: 'KE', destCountry: 'KE', receivingPoint: point.code, receiverRef: 'PO-7781', maxSpend: 45000 })
        .expect(201)
    ).body;
    expect(posted).toMatchObject({ destLabel: `Jenga Builders ${tag} — Mombasa Road yard`, destLocation: { lat: -1.33, lng: 36.88 } });
    // A budget, and a price agreed with a carrier: neither is the receiver's to read.
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    store.set(posted.freightId, { ...store.get(posted.freightId), maxSpend: 45000, lockedPrice: 41000 });

    // Coming in: its own number, who from, how much — the tracking link's view, and no price anywhere in it.
    const coming = (await http().get('/v1/sbg/business/me/inbound').set(bearer(viewer)).expect(200)).body;
    expect(coming.points).toEqual([point]);
    expect(coming.items).toHaveLength(1);
    const row = coming.items[0];
    expect(row).toMatchObject({ freightId: posted.freightId, reference: 'PO-7781', from: `Mlima Cement ${tag}`, site: { siteId: site.siteId, name: 'Mombasa Road yard' }, packages: 400, packaging: 'bagged', weightKg: 20000, status: 'available' });
    expect(row.trackingKey).toMatch(/^T-/);
    expect(JSON.stringify(row)).not.toMatch(/45000|41000|maxSpend|lockedPrice|agreedPrice|price/i);
    // Nobody else's: the supplier has no such list; staff are refused it by name.
    expect((await http().get('/v1/sbg/business/me/inbound').set(bearer(supplier.token)).expect(200)).body.items).toEqual([]);
    const staffRefused = await http().get('/v1/sbg/business/me/inbound').set(bearer(setupKey)).expect(403);
    expect(staffRefused.body.message).toMatch(/A business keeps its own receiving points/);

    // The receiver's bell: coming in, by its own number.
    const bell = (await http().get('/v1/sbg/notifications/inbox').set(bearer(yard.token)).expect(200)).body;
    const items = (bell.items ?? bell) as Array<{ kind: string; title: string }>;
    expect(items.some((n) => n.kind === 'inbound' && n.title === `Coming in: Order PO-7781 from Mlima Cement ${tag}`)).toBe(true);

    // A new code retires the old one; closing receiving names nothing, and what was sent stays coming.
    const renewed = (await http().post(`/v1/sbg/business/me/receiving/${site.siteId}/code`).set(bearer(yard.token)).expect(201)).body;
    expect(renewed.code).not.toBe(point.code);
    await http().get(`/v1/sbg/receiving/${point.code}`).set(bearer(supplier.token)).expect(404);
    await http().get(`/v1/sbg/receiving/${renewed.code}`).set(bearer(supplier.token)).expect(200);
    expect((await http().delete(`/v1/sbg/business/me/receiving/${site.siteId}`).set(bearer(yard.token)).expect(200)).body).toEqual([]);
    await http().get(`/v1/sbg/receiving/${renewed.code}`).set(bearer(supplier.token)).expect(404);
    expect((await http().get('/v1/sbg/business/me/inbound').set(bearer(yard.token)).expect(200)).body.items.map((i: { freightId: string }) => i.freightId)).toEqual([posted.freightId]);
  });

  it('receives only at a place of its own, not at a port', async () => {
    const yard = await aBusiness('Pwani Importers', ['receiver', 'importer']);
    const port = (await http().post(`/v1/sbg/entities/${yard.entityId}/sites`).set(bearer(yard.token)).send({ kind: 'port', name: 'Mombasa port', location: { lat: -4.04, lng: 39.66 } }).expect(201)).body;
    const refused = await http().post(`/v1/sbg/business/me/receiving/${port.siteId}`).set(bearer(yard.token)).expect(400);
    expect(refused.body.message).toMatch(/place of your own/);
  });

  it('tells the receiver’s own system each step of a load coming in, as its Coming in reads it — never the price', async () => {
    const landed: Array<{ event: string; raw: string }> = [];
    const system: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        landed.push({ event: String(req.headers['x-sbg-event']), raw: Buffer.concat(chunks).toString() });
        res.writeHead(200);
        res.end();
      });
    });
    await new Promise<void>((r) => system.listen(0, '127.0.0.1', r));
    try {
      const a = system.address();
      const origin = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
      const yard = await aBusiness('Kilele Hardware', ['receiver']);
      const supplier = await aBusiness('Rift Steel', ['shipper']);
      await http().put('/v1/sbg/business/me/system').set(bearer(yard.token)).send({ url: `${origin}/hooks` }).expect(200);
      const site = (await http().post(`/v1/sbg/entities/${yard.entityId}/sites`).set(bearer(yard.token)).send({ kind: 'delivery', name: 'Thika store', location: { lat: -1.03, lng: 37.07 } }).expect(201)).body;
      const point = (await http().post(`/v1/sbg/business/me/receiving/${site.siteId}`).set(bearer(yard.token)).expect(201)).body;
      const posted = (
        await http()
          .post('/v1/sbg/dispatch/freight')
          .set(bearer(supplier.token))
          .send({ description: 'Steel bars, 6 bundles', pickupLocation: { lat: -0.3, lng: 36.07 }, pickupLabel: 'Nakuru mill', destLabel: 'x', weightKg: 3000, packaging: 'piece', packages: 6, pickupCountry: 'KE', destCountry: 'KE', receivingPoint: point.code, receiverRef: 'KH-112', maxSpend: 38000 })
          .expect(201)
      ).body;
      const hooks = app.get(BusinessHookService);
      const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
      const say = async (topic: string, patch: Record<string, unknown>) => {
        store.set(posted.freightId, { ...store.get(posted.freightId), ...patch });
        await app.get(EventBus).publish(topic, { freightId: posted.freightId, code: posted.code }, { source: 'test' });
        await hooks.drain();
      };
      await hooks.drain();
      await say(GlosEvent.Pudo.FreightPickedUp, { status: 'in_transit', pickedUpAt: new Date().toISOString() });
      const at = new Date().toISOString();
      await say(GlosEvent.Pudo.FreightDelivered, { status: 'delivered', deliveredAt: at, proofOfDelivery: { receiverName: 'Wairimu at the store', photoRef: 'med_pod', confirmed: [], at } });
      expect(landed.map((l) => l.event)).toEqual(['inbound.addressed', 'inbound.picked_up', 'inbound.delivered']);
      const delivered = JSON.parse(landed[2].raw) as { data: { inbound: Record<string, unknown> } };
      expect(delivered.data.inbound).toMatchObject({ freightId: posted.freightId, reference: 'KH-112', status: 'delivered', receiverName: 'Wairimu at the store', site: { name: 'Thika store' } });
      for (const l of landed) expect(l.raw).not.toMatch(/38000|maxSpend|lockedPrice|agreedPrice/);
      // The supplier's own system, had it one, hears its load as load.*: the receiver's never hears the supplier's view.
      expect(landed.some((l) => l.event.startsWith('load.'))).toBe(false);
    } finally {
      await new Promise<void>((r) => system.close(() => r()));
    }
  });

  it('the receiving moment (D9): what the receiver found goes on the note, and what did not come stays expected until one of its people closes it', async () => {
    const landed: Array<{ event: string; raw: string }> = [];
    const system: Server = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        landed.push({ event: String(req.headers['x-sbg-event']), raw: Buffer.concat(chunks).toString() });
        res.writeHead(200);
        res.end();
      });
    });
    await new Promise<void>((r) => system.listen(0, '127.0.0.1', r));
    try {
      const a = system.address();
      const origin = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
      const yard = await aBusiness('Bidii Stores', ['receiver']);
      const viewer = await yard.join('viewer');
      const supplier = await aBusiness('Simba Cement', ['shipper']);
      await http().put('/v1/sbg/business/me/system').set(bearer(yard.token)).send({ url: `${origin}/hooks` }).expect(200);
      const site = (await http().post(`/v1/sbg/entities/${yard.entityId}/sites`).set(bearer(yard.token)).send({ kind: 'delivery', name: 'Ruiru yard', location: { lat: -1.15, lng: 36.96 } }).expect(201)).body;
      const point = (await http().post(`/v1/sbg/business/me/receiving/${site.siteId}`).set(bearer(yard.token)).expect(201)).body;
      const posted = (
        await http()
          .post('/v1/sbg/dispatch/freight')
          .set(bearer(supplier.token))
          .send({ description: 'Cement, 40 bags', pickupLocation: { lat: -1.42, lng: 36.95 }, pickupLabel: 'Athi River works', destLabel: 'x', weightKg: 2000, packaging: 'bagged', packages: 40, pickupCountry: 'KE', destCountry: 'KE', receivingPoint: point.code, receiverRef: 'BS-9' })
          .expect(201)
      ).body;

      // On the road with a driver of ours (the haul to here is pinned elsewhere): the driver's load says what the note counts.
      const driver = await aDriver('Kamau');
      const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
      store.set(posted.freightId, { ...store.get(posted.freightId), status: 'in_transit', claimedBy: driver.did, claimedAt: new Date().toISOString(), pickedUpAt: new Date().toISOString() });
      const claim = (await http().get(`/v1/sbg/fleet/drivers/${driver.did}/claims`).set(bearer(driver.token)).expect(200)).body.claims.find((c: { ref: string }) => c.ref === posted.freightId);
      expect(claim).toMatchObject({ packages: 40, packaging: 'bagged' });

      // At the door, with the receiver. The wire refuses what cannot be a count or a kind; the service, what the note cannot hold.
      const deliver = async (exceptions: unknown, status: number) => {
        const podPhotoId = await photo(driver.token, 'pod');
        return (await http().post(`/v1/sbg/dispatch/freight/${posted.freightId}/deliver`).set(bearer(driver.token)).send({ driverDid: driver.did, confirmed: requiredUnloadKeys(), receiverName: 'Grace at the yard', podPhotoId, remarks: 'Two bags split at the seam', exceptions }).expect(status)).body;
      };
      await deliver([{ kind: 'short', count: 0 }], 400);
      await deliver([{ kind: 'lost', count: 1 }], 400);
      expect((await deliver([{ kind: 'short', count: 40 }], 400)).message).toMatch(/none of them came/);
      expect((await deliver([{ kind: 'damaged', count: 2 }], 400)).message).toMatch(/photo of what is damaged/);
      const broken = await photo(driver.token, 'pod');
      await deliver([{ kind: 'short', count: 3 }, { kind: 'damaged', count: 2, photoRefs: [broken] }], 201);
      await app.get(BusinessHookService).drain();

      // The note: box 24 beside the receiver's name, the photograph in box 5 — as frozen at the signature.
      const note = (await http().get(`/v1/sbg/dispatch/freight/${posted.freightId}/consignment-note`).set(bearer(supplier.token)).expect(200)).body;
      expect(note.confirmations.consignee).toMatchObject({ by: 'Grace at the yard', reservations: 'Received with reservations: 3 packages short, 2 packages damaged' });
      expect(note.documents).toEqual(expect.arrayContaining([`Photo of the goods found damaged at delivery (${broken})`]));
      expect(note.consignee).toMatchObject({ name: `Bidii Stores ${tag}`, address: 'Ruiru yard, by its receiving code — their order BS-9' });
      // The sender's own Loads row says it, the photographs counted.
      const mine = (await http().get('/v1/sbg/dispatch/posted').set(bearer(supplier.token)).expect(200)).body;
      const row = (mine.items ?? mine).find((r: { freightId: string }) => r.freightId === posted.freightId);
      expect(row.exceptions).toEqual([{ kind: 'short', count: 3, photos: 0 }, { kind: 'damaged', count: 2, photos: 1 }]);

      // Coming in: delivered, and 3 still expected — among what is coming, until closed.
      const coming = (await http().get('/v1/sbg/business/me/inbound').set(bearer(viewer)).expect(200)).body.items[0];
      expect(coming).toMatchObject({ freightId: posted.freightId, status: 'delivered', receiverName: 'Grace at the yard', exceptions: [{ kind: 'short', count: 3, photos: 0 }, { kind: 'damaged', count: 2, photos: 1 }], stillExpected: 3 });
      expect(JSON.stringify(coming)).not.toContain(broken);
      // The bell said so; the receiver's system heard it with the delivery.
      const bell = (await http().get('/v1/sbg/notifications/inbox').set(bearer(yard.token)).expect(200)).body;
      const told = ((bell.items ?? bell) as Array<{ kind: string; title: string; body: string }>).find((n) => n.kind === 'inbound' && /delivered/.test(n.title));
      expect(told).toMatchObject({ title: 'Order BS-9 was delivered, not all as the note says', body: expect.stringContaining('3 packages stay expected until you close them under Coming in') });
      const deliveredHook = landed.find((l) => l.event === 'inbound.delivered');
      expect(JSON.parse(deliveredHook!.raw).data.inbound).toMatchObject({ stillExpected: 3, exceptions: [{ kind: 'short', count: 3 }, { kind: 'damaged', count: 2 }] });

      // Closing it: one of its people — not a viewer, not staff, not the supplier.
      const close = (token: string, body: Record<string, unknown>) => http().post(`/v1/sbg/business/me/inbound/${posted.freightId}/close`).set(bearer(token)).send(body);
      await close(viewer, { how: 'came' }).expect(403);
      expect((await close(setupKey, { how: 'came' }).expect(403)).body.message).toMatch(/A business keeps its own receiving points/);
      await close(supplier.token, { how: 'came' }).expect(404);
      await close(yard.token, { how: 'lost' }).expect(400);
      const closed = (await close(yard.token, { how: 'came', note: 'On the Tuesday truck' }).expect(201)).body;
      expect(closed).toMatchObject({ stillExpected: 0, closed: { how: 'came', note: 'On the Tuesday truck', by: 'Bidii Stores Owner' } });
      await close(yard.token, { how: 'not_coming' }).expect(400);
      await app.get(BusinessHookService).drain();
      expect(landed.map((l) => l.event)).toEqual(['inbound.addressed', 'inbound.delivered', 'inbound.closed']);
      expect(JSON.parse(landed[2].raw).data.inbound).toMatchObject({ stillExpected: 0, closed: { how: 'came' } });
    } finally {
      await new Promise<void>((r) => system.close(() => r()));
    }
  });

  it('its copy of the note (the user, 2026-10-26: “Its copy, no carriage price”): the receiver reads its own copy only, and claims where the term puts the loss on it', async () => {
    const yard = await aBusiness('Imara Hardware', ['receiver']);
    const viewer = await yard.join('viewer');
    const supplier = await aBusiness('Tausi Steel', ['shipper']);
    const stranger = await aBusiness('Nyota Traders', ['receiver']);
    const site = (await http().post(`/v1/sbg/entities/${yard.entityId}/sites`).set(bearer(yard.token)).send({ kind: 'delivery', name: 'Kisumu store', location: { lat: -0.1, lng: 34.75 } }).expect(201)).body;
    const point = (await http().post(`/v1/sbg/business/me/receiving/${site.siteId}`).set(bearer(yard.token)).expect(201)).body;
    const posted = (
      await http()
        .post('/v1/sbg/dispatch/freight')
        .set(bearer(supplier.token))
        .send({ description: 'Steel bars, 6 bundles', pickupLocation: { lat: -0.3, lng: 36.07 }, pickupLabel: 'Nakuru mill', destLabel: 'x', weightKg: 3000, packaging: 'piece', packages: 6, pickupCountry: 'KE', destCountry: 'KE', receivingPoint: point.code, receiverRef: 'IH-40' })
        .expect(201)
    ).body;
    // Priced with its carrier, agreed CPT (switched on per country by two staff, pinned elsewhere), on the road with a driver.
    const driver = await aDriver('Odhiambo');
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    store.set(posted.freightId, { ...store.get(posted.freightId), lockedPrice: 41000, incoterm: 'CPT', namedPlace: 'Kisumu', status: 'in_transit', claimedBy: driver.did, claimedAt: new Date().toISOString(), pickedUpAt: new Date().toISOString() });
    await http().post(`/v1/sbg/dispatch/freight/${posted.freightId}/deliver`).set(bearer(driver.token)).send({ driverDid: driver.did, confirmed: requiredUnloadKeys(), receiverName: 'Achieng at the store', podPhotoId: await photo(driver.token, 'pod') }).expect(201);

    // The receiver reads its copy: no price. The sender reads the whole note. A business it was not sent to reads nothing.
    const copy = (await http().get(`/v1/sbg/dispatch/freight/${posted.freightId}/consignment-note`).set(bearer(yard.token)).expect(200)).body;
    expect(copy).toMatchObject({ copy: 'consignee', consignee: { name: `Imara Hardware ${tag}` } });
    expect(copy.carriage.amount).toBeUndefined();
    expect(JSON.stringify(copy)).not.toContain('41000');
    expect((await http().get(`/v1/sbg/dispatch/freight/${posted.freightId}/consignment-note.html`).set(bearer(viewer)).expect(200)).text).not.toContain('41000');
    expect((await http().get(`/v1/sbg/dispatch/freight/${posted.freightId}/consignment-note`).set(bearer(supplier.token)).expect(200)).body.carriage.amount).toBe(41000);
    await http().get(`/v1/sbg/dispatch/freight/${posted.freightId}/consignment-note`).set(bearer(stranger.token)).expect(404);

    // In the archive: its own document, read by it alone; the full one is not its to read.
    const row = (await http().get('/v1/sbg/business/me/inbound').set(bearer(yard.token)).expect(200)).body.items.find((i: { freightId: string }) => i.freightId === posted.freightId);
    expect(row).toMatchObject({ noteId: `freight~${posted.freightId}~consignee`, incoterm: 'CPT', claimant: 'receiver', canClaim: true });
    await http().get(`/v1/sbg/consignment-notes/${encodeURIComponent(row.noteId)}`).set(bearer(yard.token)).expect(200);
    await http().get(`/v1/sbg/consignment-notes/${encodeURIComponent(row.noteId)}`).set(bearer(supplier.token)).expect(404);
    await http().get(`/v1/sbg/consignment-notes/${encodeURIComponent(`freight~${posted.freightId}`)}`).set(bearer(yard.token)).expect(404);

    // CPT passed the risk at the origin: the receiver claims — not a viewer, not the supplier.
    await http().post(`/v1/sbg/dispatch/freight/${posted.freightId}/claim`).set(bearer(viewer)).send({ kind: 'damaged', description: 'Two bundles bent' }).expect(403);
    expect((await http().post(`/v1/sbg/dispatch/freight/${posted.freightId}/claim`).set(bearer(supplier.token)).send({ kind: 'damaged', description: 'Two bundles bent' }).expect(403)).body.code).toBe('NOT_THE_CLAIMANT');
    await http().post(`/v1/sbg/dispatch/freight/${posted.freightId}/claim`).set(bearer(yard.token)).send({ kind: 'damaged', description: 'Two bundles bent at the ends' }).expect(201);
    const after = (await http().get('/v1/sbg/business/me/inbound').set(bearer(yard.token)).expect(200)).body.items.find((i: { freightId: string }) => i.freightId === posted.freightId);
    expect(after).toMatchObject({ canClaim: false, claim: { kind: 'damaged', by: 'receiver', state: 'resolved', decision: 'report_only' } });
    // Its copy, frozen with the claim on it, is the report — said as the receiver's claim.
    const report = (await http().get(`/v1/sbg/dispatch/freight/${posted.freightId}/consignment-note`).set(bearer(yard.token)).expect(200)).body;
    expect(report.claim.line).toMatch(/^Claim by the receiver /);
    expect(report.claim.decision).toMatch(/This note, frozen with the claim on it, is the report/);
    const bell = (await http().get('/v1/sbg/notifications/inbox').set(bearer(yard.token)).expect(200)).body;
    expect(((bell.items ?? bell) as Array<{ kind: string; title: string }>).some((n) => n.kind === 'claim_decided' && n.title === `A damage claim report was made for ${posted.code}`)).toBe(true);
    // The supplier's Loads say whose claim it is: the receiver's.
    const theirs = (await http().get('/v1/sbg/dispatch/posted').set(bearer(supplier.token)).expect(200)).body;
    expect(((theirs.items ?? theirs) as Array<{ freightId: string; claim?: { by?: string } }>).find((r) => r.freightId === posted.freightId)?.claim?.by).toBe('receiver');
  });
});

