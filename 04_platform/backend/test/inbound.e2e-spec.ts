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
});

