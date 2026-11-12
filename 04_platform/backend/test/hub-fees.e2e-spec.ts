import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { declared } from './declared';

/**
 * A HUB'S FEES AND ITS COUNTRY'S CEILING, over the wire (the owner's D3 on the plan "Hubs on the Road", 2026-11-12: "A hub sets
 * its own sort and pass-on fees, up to a multiple of its country's list figure (starting at 1.5 times); above that needs staff
 * approval"). Within the ceiling a fee is the hub's at once; above it, it waits on staff's list, its fee as it was; staff
 * approve it, or refuse it with why, and the hub is told by its bell. The country's staff set the multiple, logged.
 */
describe('a hub’s fees up to its country’s ceiling', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

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

  it('within the ceiling at once; above it, staff approve or refuse with why, and the hub is told; the country sets its multiple', async () => {
    const tag = digits();
    const hub = (await http().post('/v1/sbg/mdps').set(operator).send({ name: `Fee Hub ${tag}`, zones: [`FH${tag}`], location: { lat: -1.31, lng: 36.87 } }).expect(201)).body;
    const asHub = bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: hub.did }).expect(201)).body.access_token);
    declared(app, 'hub', hub.did);
    const mine = async () => ((await http().get('/v1/sbg/mdps').set(asHub).expect(200)).body as Array<Record<string, any>>).find((m) => m.mdpId === hub.mdpId)!;

    // The hub reads its ceiling: the list figures times its country's multiple.
    const { feeCeiling } = await mine();
    expect(feeCeiling).toMatchObject({ multiple: 1.5 });
    expect(feeCeiling.sort).toBeCloseTo(feeCeiling.listSort * 1.5, 2);
    const pricing = `/v1/sbg/mdps/${hub.mdpId}/pricing`;

    // Within it: its own at once.
    expect((await http().patch(pricing).set(asHub).send({ price: feeCeiling.sort }).expect(200)).body).toMatchObject({ pricePerParcel: feeCeiling.sort });
    // Above it: asked, its fee as it was, on staff's list.
    const asked = Math.round((feeCeiling.sort + 1) * 100) / 100;
    const r = (await http().patch(pricing).set(asHub).send({ price: asked }).expect(200)).body;
    expect(r).toMatchObject({ pricePerParcel: feeCeiling.sort, feeAsked: { pricePerParcel: asked } });
    await http().get('/v1/sbg/hub-fees').set(asHub).expect(403);
    const waiting = ((await http().get('/v1/sbg/hub-fees').set(operator).expect(200)).body as Array<Record<string, any>>).find((x) => x.mdpId === hub.mdpId);
    expect(waiting).toMatchObject({ name: `Fee Hub ${tag}`, pricePerParcel: feeCeiling.sort, asked: { pricePerParcel: asked }, ceiling: { multiple: 1.5 } });

    // Staff decide — the hub cannot decide its own; refused only with why.
    const decide = `/v1/sbg/mdps/${hub.mdpId}/fee-decision`;
    await http().post(decide).set(asHub).send({ approve: true }).expect(403);
    expect((await http().post(decide).set(operator).send({ approve: false }).expect(400)).body.detail).toMatch(/Say why/);
    await http().post(decide).set(operator).send({ approve: false, reason: 'Above every hub on this road' }).expect(201);
    expect(await mine()).toMatchObject({ pricePerParcel: feeCeiling.sort, feeRefused: { reason: 'Above every hub on this road' } });
    expect((await mine()).feeAsked).toBeUndefined();
    const inbox = async () => ((await http().get('/v1/sbg/notifications/inbox').set(asHub).expect(200)).body.items as Array<{ kind: string; title: string; body: string }>).filter((n) => n.kind === 'hub_fees');
    expect((await inbox()).find((n) => /not approved/.test(n.title))?.body).toMatch(/Above every hub on this road/);
    await http().post(decide).set(operator).send({ approve: true }).expect(400);

    // Asked again, approved: its fee from now, and the hub is told.
    await http().patch(pricing).set(asHub).send({ price: asked }).expect(200);
    await http().post(decide).set(operator).send({ approve: true }).expect(201);
    expect(await mine()).toMatchObject({ pricePerParcel: asked });
    expect((await inbox()).some((n) => /are approved/.test(n.title))).toBe(true);

    // The country's staff set the multiple; it is logged and read on its rates.
    const entityId = (await mine()).entityId ?? 'sbg-ke';
    await http().post(`/v1/sbg/entities/${entityId}/hub-fee-ceiling`).set(asHub).send({ multiple: 2 }).expect(403);
    await http().post(`/v1/sbg/entities/${entityId}/hub-fee-ceiling`).set(operator).send({ multiple: 0.5 }).expect(400);
    expect((await http().post(`/v1/sbg/entities/${entityId}/hub-fee-ceiling`).set(operator).send({ multiple: 2 }).expect(201)).body).toEqual({ entityId, multiple: 2 });
    try {
      expect((await http().get(`/v1/sbg/entities/${entityId}/pricing`).set(operator).expect(200)).body.hubFeeCeiling).toBe(2);
      expect((await mine()).feeCeiling.multiple).toBe(2);
    } finally {
      await http().post(`/v1/sbg/entities/${entityId}/hub-fee-ceiling`).set(operator).send({ multiple: 1.5 }).expect(201);
    }
  });

  /** 2026-11-12 — the owner's D3: how parcels are priced in a country — a fixed card (where every country starts) or by factors. */
  it('a country prices by a fixed card from the start; staff switch it to factors and back; a fixed card starts with no zones', async () => {
    const mode = '/v1/sbg/entities/sbg-et/pricing-mode';
    expect((await http().get('/v1/sbg/entities/sbg-et/price-cards').set(operator).expect(200)).body.mode).toBe('fixed');
    await http().post(mode).set(operator).send({ mode: 'zones' }).expect(400);
    const hub = (await http().post('/v1/sbg/mdps').set(operator).send({ name: 'Mode Hub', zones: ['MODE-1'], location: { lat: -1.32, lng: 36.86 } }).expect(201)).body;
    const asHub = bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: hub.did }).expect(201)).body.access_token);
    declared(app, 'hub', hub.did);
    await http().post(mode).set(asHub).send({ mode: 'factors' }).expect(403);
    expect((await http().post(mode).set(operator).send({ mode: 'factors' }).expect(201)).body.mode).toBe('factors');
    try {
      expect((await http().get('/v1/sbg/entities/sbg-et/price-cards').set(operator).expect(200)).body.mode).toBe('factors');
    } finally {
      expect((await http().post(mode).set(operator).send({ mode: 'fixed' }).expect(201)).body.mode).toBe('fixed');
    }
    // A fixed card starts with no zone map: one band, a weight for each size.
    const started = (await http().post('/v1/sbg/entities/sbg-et/price-cards/draft').set(operator).send({ kind: 'fixed' }).expect(201)).body;
    expect(started.pending[0]).toMatchObject({ kind: 'fixed', zoneMapVersion: 0, bands: [{ key: 'all' }] });
    await http().delete('/v1/sbg/entities/sbg-et/price-cards/draft').set(operator).expect(200);
  });

  /** 2026-11-12 — the owner's D3: "Large senders negotiate" — a sender's own rate, over the wire. */
  it('the country’s senders’ rates are staff’s to read and propose; a rate is for one of the country’s own senders, within its limits', async () => {
    const rates = '/v1/sbg/entities/sbg-ke/business-rates';
    const view = (await http().get(rates).set(operator).expect(200)).body;
    expect(view).toMatchObject({ entityId: 'sbg-ke', mode: 'fixed', steps: [1, 5, 15, 30] });
    expect(Array.isArray(view.senders)).toBe(true);
    const hub = (await http().post('/v1/sbg/mdps').set(operator).send({ name: 'Rate Hub', zones: ['RATE-1'], location: { lat: -1.33, lng: 36.87 } }).expect(201)).body;
    const asHub = bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: hub.did }).expect(201)).body.access_token);
    declared(app, 'hub', hub.did);
    await http().get(rates).set(asHub).expect(403);
    await http().post(rates).set(asHub).send({ vendorId: 'v-anyone', kind: 'discount', discountPct: 0.1 }).expect(403);
    // At most half off; and only one of the country's own senders.
    await http().post(rates).set(operator).send({ vendorId: 'v-anyone', kind: 'discount', discountPct: 0.9 }).expect(400);
    expect((await http().post(rates).set(operator).send({ vendorId: 'v-nobody-here', kind: 'discount', discountPct: 0.1 }).expect(404)).body.detail).toMatch(/not one of this country’s sender accounts/);
    expect((await http().post(`${rates}/v-nobody-here/approve`).set(operator).expect(400)).body.detail).toMatch(/No rate is waiting/);
  });
});
