import { Test } from '@nestjs/testing';
import { INestApplication, RequestMethod, ValidationPipe } from '@nestjs/common';
import { ModulesContainer } from '@nestjs/core';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AT_THE_COUNTER_KEY } from '../src/foundation/auth/at-the-counter';
import { COUNTER_ACTS } from '../src/modules/pudo/shop-staff.service';

/**
 * THE PEOPLE AT A SHOP'S COUNTER, over the wire (the user, 2026-10-18: "who is at the counter" → staff sign in with their
 * own phone + PIN). The owner adds a person by number; they accept from their own sign-in and open a session at the
 * counter under their name; they work the counter and are refused the owner's doors; every act is kept under who did it,
 * for the owner, never on the parcel; taking them out ends their session at once.
 */
describe('the people at a shop’s counter, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const PIN = '48261';
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

  /** A working shop — registered, its papers sent, approved, its float paid in — and its owner's sign-in. */
  async function aShop(): Promise<{ did: string; owner: Record<string, string> }> {
    const u = digits();
    const day = { open: '08:00', close: '18:00' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({ shopName: `Kaunta ${u}`, zone: `ZK${u}`, location: { lat: -1.2, lng: 36.8 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 }, openingHours: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: null }, fullName: `Kaunta ${u} owner`, nationalId: `ID-${u}`, mobile: `+2547${u}1`, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } })
      .expect(201);
    const did = reg.body.did as string;
    const owner = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const photo = async (kind: string) => (await http().post('/v1/sbg/media').set(owner).send({ kind, dataUrl: `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${did}`)]).toString('base64')}` }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(owner).send({ idCopyRef: await photo('kyc_id'), tradingLicenceRef: await photo('kyc_licence'), shopPhotoRefs: [await photo('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(operator).send({ approve: true }).expect(201);
    const asked = await http().post(`/v1/sbg/agents/${did}/top-up`).set(owner).send({ amount: 50 }).expect(201);
    await http().post(`/v1/rails/funding/${asked.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 50 }).expect(201);
    return { did, owner };
  }

  /** A person with their own phone and PIN, signed in as themselves. */
  async function aPerson(phone: string): Promise<Record<string, string>> {
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `kaunta${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201);
    return bearer(enrolled.body.token.access_token as string);
  }

  const take = (shop: string, as: Record<string, string>) => {
    const parcelId = `KAUNTA-${digits()}`;
    return http().post('/v1/sbg/parcels/accept').set(as).send({ agentDid: shop, parcelId, size: 'S', destZone: 'FarTown', senderMobile: '+254700', receiverMobile: '+254711', dropoffPhotoRef: 'd.jpg' }).then((r) => ({ r, parcelId }));
  };

  it('is added by the owner, says yes from its own sign-in, works the counter under its own name — and is out at once', async () => {
    const shop = await aShop();
    const phone = `+2547${digits()}2`;

    // The owner adds a person by number. SeeBuyGet's staff see none of a shop's people.
    const added = (await http().post('/v1/sbg/shop/staff').set(shop.owner).send({ phone, name: 'Wanjiru' }).expect(201)).body;
    expect(added).toMatchObject({ name: 'Wanjiru', state: 'invited', phoneEnds: phone.slice(-3) });
    expect((await http().get('/v1/sbg/shop/staff').set(operator).expect(403)).body.detail).toMatch(/the shop’s own/);

    // They say yes from their own phone + PIN sign-in, and open a session at this counter.
    const person = await aPerson(phone);
    const invited = (await http().get('/v1/sbg/shop-invitations').set(person).expect(200)).body;
    expect(invited).toEqual([expect.objectContaining({ shopDid: shop.did, name: 'Wanjiru', state: 'invited' })]);
    await http().post(`/v1/sbg/shops/${shop.did}/staff-session`).set(person).expect(403); // not before saying yes
    await http().post(`/v1/sbg/shop-invitations/${added.memberId}/accept`).set(person).expect(201);
    const session = (await http().post(`/v1/sbg/shops/${shop.did}/staff-session`).set(person).expect(201)).body;
    expect(session).toMatchObject({ shopDid: shop.did, name: 'Wanjiru', memberId: added.memberId });
    const staff = bearer(session.token.access_token as string);

    // The counter is theirs to work — opening the shop in the morning included; the owner's doors are refused by name.
    await http().get(`/v1/sbg/agents/${shop.did}`).set(staff).expect(200);
    const theirs = await take(shop.did, staff);
    expect(theirs.r.status).toBe(201);
    await http().post(`/v1/sbg/agents/${shop.did}/availability`).set(staff).send({ open: true }).expect(201);
    // Every door the shop's sign-in opens and the counter does not use: money, prices, hours, people — and the shop's
    // ACCOUNT, which a staff sign-in reached until the guard let staff through counter doors only. A recovery email set
    // from there is the whole shop.
    for (const [method, path, body] of [
      ['post', `/v1/sbg/agents/${shop.did}/top-up`, { amount: 50 }],
      ['get', `/v1/sbg/agents/${shop.did}/ledger`, undefined],
      ['get', `/v1/sbg/agents/${shop.did}/parcels/export`, undefined],
      ['post', `/v1/sbg/agents/${shop.did}/hours`, { openingHours: {} }],
      ['patch', `/v1/sbg/agents/${shop.did}/pricing`, { pricePerParcel: 1 }],
      ['get', '/v1/sbg/shop/staff', undefined],
      ['post', '/v1/sbg/shop/staff', { phone: '+254700000999', name: 'Someone' }],
      ['post', '/v1/sbg/account/shop-devices', {}],
      ['get', '/v1/sbg/account/me', undefined],
      ['post', '/v1/sbg/account/email', { email: 'taken@example.com', code: '000000', pin: PIN }],
      ['get', '/v1/sbg/payout-number', undefined],
      ['get', '/v1/sbg/consignment-notes/destination/secret', undefined],
      ['post', '/v1/sbg/conversations/any/proposals', { amount: 1 }],
    ] as Array<['get' | 'post' | 'patch', string, Record<string, unknown> | undefined]>) {
      const refused = await http()[method](path).set(staff).send(body ?? {});
      expect([path, refused.status, refused.body.detail]).toEqual([path, 403, expect.stringMatching(/owner/)]);
    }

    // Who did what: the owner's record, under each name — and nothing of it on the parcel, which other shops read.
    const own = await take(shop.did, shop.owner);
    expect(own.r.status).toBe(201);
    const log = (await http().get('/v1/sbg/shop/counter-log').set(shop.owner).expect(200)).body;
    expect(log.slice(0, 3)).toEqual([
      expect.objectContaining({ act: 'took a parcel in', ref: own.parcelId, by: 'the owner', staff: false }),
      expect.objectContaining({ act: 'opened the shop', by: 'Wanjiru', staff: true }),
      expect.objectContaining({ act: 'took a parcel in', ref: theirs.parcelId, by: 'Wanjiru', staff: true }),
    ]);
    const parcel = (await http().get(`/v1/sbg/parcels/${theirs.parcelId}`).set(operator).expect(200)).body;
    expect(JSON.stringify(parcel)).not.toContain('Wanjiru');

    // Taken out: their session ends on its next request, and they cannot open another.
    expect((await http().post(`/v1/sbg/shop/staff/${added.memberId}/remove`).set(shop.owner).expect(201)).body.state).toBe('removed');
    await http().get(`/v1/sbg/agents/${shop.did}`).set(staff).expect(401);
    await http().post(`/v1/sbg/shops/${shop.did}/staff-session`).set(person).expect(403);
  });

  /**
   * THE DOORS A SHOP'S OWN PEOPLE MAY USE, read off the running application. A member of staff signs in as the shop, so
   * the guard lets them through a door marked `@AtTheCounter()` and no other. A door added to this list is a decision
   * — somebody at a shop's counter can now do it under the shop's name — so the list is written out here in full.
   */
  it('lets a shop’s own people through the counter’s doors only — these, by name, and never a whole controller', () => {
    const VERB: Record<number, string> = { [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.DELETE]: 'DELETE', [RequestMethod.PUT]: 'PUT', [RequestMethod.PATCH]: 'PATCH' };
    const marked: string[] = [];
    const handlers = new Set<string>();
    let routes = 0;
    for (const module of app.get(ModulesContainer).values()) {
      for (const controller of module.controllers.values()) {
        const type = controller.metatype as { name: string; prototype: Record<string, unknown> };
        expect([type.name, Reflect.getMetadata(AT_THE_COUNTER_KEY, type)]).toEqual([type.name, undefined]);
        const base = String(Reflect.getMetadata(PATH_METADATA, type) ?? '');
        for (const name of Object.getOwnPropertyNames(type.prototype)) {
          const h = type.prototype[name] as object;
          if (typeof h !== 'function' || Reflect.getMetadata(METHOD_METADATA, h) === undefined) continue;
          routes += 1;
          if (Reflect.getMetadata(AT_THE_COUNTER_KEY, h) !== true) continue;
          marked.push(`${VERB[Reflect.getMetadata(METHOD_METADATA, h) as number]} ${base}/${String(Reflect.getMetadata(PATH_METADATA, h))}`);
          if (type.name === 'SbgController') handlers.add(name);
        }
      }
    }
    expect(routes).toBeGreaterThan(600);
    // Every act the counter's own record keeps is an act the counter may do.
    expect(Object.keys(COUNTER_ACTS).filter((h) => !handlers.has(h))).toEqual([]);
    expect(marked.sort()).toEqual(
      [
        // parcels at the counter
        'POST sbg/parcels/accept', 'POST sbg/parcels/:id/intake', 'GET sbg/parcels/:id/intake-preview', 'POST sbg/parcels/:id/arrive', 'POST sbg/parcels/:id/shelve',
        'POST sbg/parcels/:id/pickup', 'POST sbg/parcels/collect', 'POST sbg/parcels/:id/collect-confirm', 'POST sbg/parcels/:id/void', 'POST sbg/parcels/:id/dispute',
        'POST sbg/parcels/handover', 'POST sbg/parcels/handover/manifest', 'POST sbg/parcels/:id/rate', 'POST sbg/drivers/:did/rate', 'POST sbg/parcels/book-freight',
        'GET sbg/parcels/:id', 'GET sbg/parcels', 'GET sbg/agents/:did/parcels',
        // the shop as the counter sees it, and open or closed now
        'GET sbg/agents/:did', 'GET sbg/agents/:did/shelf', 'GET sbg/agents/:did/bag-plan', 'GET sbg/agents/:did/can-transact', 'GET sbg/agents/:did/take-in-terms',
        'POST sbg/agents/:did/ping', 'POST sbg/agents/:did/availability',
        // bags
        'POST sbg/totes/:code/assign', 'POST sbg/totes/:code/fill', 'POST sbg/totes/:code/load', 'POST sbg/totes/:code/release', 'GET sbg/totes/:code',
        'POST sbg/agents/:did/totes', 'POST sbg/agents/:did/totes/:code/fill', 'POST sbg/agents/:did/totes/:code/seal', 'POST sbg/agents/:did/receive-bag',
        'POST sbg/consignments', 'POST sbg/consignments/:code/deposit', 'GET sbg/consignments',
        // the papers of a load booked at the counter, printed there
        'GET sbg/dispatch/freight/:id/consignment-note', 'GET sbg/dispatch/freight/:id/consignment-note.html',
        'GET sbg/dispatch/freight/:id/commercial-invoice', 'GET sbg/dispatch/freight/:id/commercial-invoice.html',
        'GET sbg/dispatch/freight/:id/package-labels', 'GET sbg/dispatch/freight/:id/package-labels.html',
        // round 19 — a load's package scanned into a counter's box: its load, if the shop may open it
        'GET sbg/dispatch/find-load',
        // photographs, a parcel's damage report, a word with the receiver, the shop's inbox
        'POST sbg/media//', 'GET sbg/media/:id',
        'GET sbg/parcels/:id/damage-report', 'GET sbg/parcels/:id/damage-report/file', 'GET sbg/parcels/:id/damage-report/links', 'POST sbg/parcels/:id/damage-report/links',
        'POST sbg/parcels/:id/damage-report/links/:linkId/cancel', 'POST sbg/parcels/:id/damage-report/notes',
        'GET sbg/conversations//', 'POST sbg/conversations//', 'GET sbg/conversations/:id/messages', 'POST sbg/conversations/:id/messages', 'GET sbg/conversations/:id/voice/:voiceId',
        'POST sbg/conversations/:id/voice', 'POST sbg/conversations/:id/read', 'POST sbg/conversations/:id/messages/:seq/report', 'POST sbg/conversations/:id/dispute-reports',
        'GET sbg/notifications/inbox', 'POST sbg/notifications/inbox/:id/read', 'POST sbg/notifications/inbox/read-all', 'POST sbg/notifications/subscribe', 'DELETE sbg/notifications/subscribe', 'POST sbg/notifications/test',
        // what everybody reads
        'GET sbg/border-rules', 'GET sbg/corridors', 'GET sbg/module-info', 'GET sbg/agents/:did/rating', 'GET sbg/agents', 'GET sbg/mdps', 'GET sbg/presence', 'GET sbg/presence/:jurisdiction',
        'GET sbg/route-constraints', 'GET sbg/route-constraints/route', 'GET sbg/field-observations/notice', 'GET sbg/field-observations', 'POST sbg/field-observations',
      ].sort(),
    );
  });

  it('answers the owner the same whoever holds the number, and lets nobody else answer the invitation', async () => {
    const shop = await aShop();
    const nobodysPhone = `+2547${digits()}3`;
    const somebodysPhone = `+2547${digits()}4`;
    const somebody = await aPerson(somebodysPhone);
    const a = (await http().post('/v1/sbg/shop/staff').set(shop.owner).send({ phone: nobodysPhone, name: 'Baraka' }).expect(201)).body;
    const b = (await http().post('/v1/sbg/shop/staff').set(shop.owner).send({ phone: somebodysPhone, name: 'Atieno' }).expect(201)).body;
    expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
    expect([a.state, b.state]).toEqual(['invited', 'invited']);
    // Added under a number that already had an account: still nobody at the counter until they say yes themselves.
    await http().post(`/v1/sbg/shops/${shop.did}/staff-session`).set(somebody).expect(403);
    // Somebody else's invitation is not theirs to answer.
    await http().post(`/v1/sbg/shop-invitations/${a.memberId}/accept`).set(somebody).expect(404);
  });
});
