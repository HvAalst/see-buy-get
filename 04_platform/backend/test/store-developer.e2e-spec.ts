import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OutboxMailSender } from '../src/foundation/mail/outbox-mail.sender';
import { RateLimitGuard } from '../src/foundation/http/rate-limit.guard';
import { AGREED } from './agreed';

/**
 * 2026-11-15 — A STORE'S DEVELOPER WITH A SIGN-IN OF THEIR OWN (the owner: "as recommended" — "a developer still needs the
 * owner beside them to make each key"). The owner invites them by name and email; a one-time link signs them in as the
 * store, through the developer's doors only — the store's record, its keys, where its updates go and their messages —
 * and every other door refuses them. A link asked for later goes to the invited address alone; taking them out ends it.
 */
describe('a store’s developer, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  let owner = '';
  let vendorId = '';
  const devEmail = `dev-${digits()}@studio.example`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    const phone = `+2547${digits()}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const made = (await http().post('/v1/sbg/vendors').send({ ...AGREED, name: `Duka ${digits()}`, email: `owner-${digits()}@duka.example`, password: 'maziwa-lala-2026', ownerPhone: phone }).expect(201)).body;
    owner = made.token.access_token as string;
    vendorId = made.vendorId as string;
  });

  afterAll(async () => {
    await app?.close();
  });

  /** The one-time code in the newest link emailed to this address. */
  const codeIn = (email: string) => {
    const mails = app.get(OutboxMailSender).recent(email).filter((m) => m.template === 'store-developer-link');
    return decodeURIComponent(/\?dev=([A-Za-z0-9_%-]+)/.exec(mails[0]?.text ?? '')?.[1] ?? '');
  };
  let devToken = '';
  let devId = '';

  it('the owner invites a developer; the emailed link signs them in once, as the store', async () => {
    const invited = (await http().post(`/v1/sbg/vendors/${vendorId}/developers`).set(bearer(owner)).send({ name: 'Brian Studio', email: devEmail }).expect(201)).body;
    devId = invited.devId;
    expect(invited).toMatchObject({ name: 'Brian Studio', email: devEmail });
    // Once only: the same address is refused while invited.
    await http().post(`/v1/sbg/vendors/${vendorId}/developers`).set(bearer(owner)).send({ name: 'Again', email: devEmail }).expect(409);
    const code = codeIn(devEmail);
    expect(code.length).toBeGreaterThan(16);
    const session = (await http().post('/v1/sbg/store-developers/session').send({ code }).expect(201)).body;
    expect(session).toMatchObject({ vendorId, name: 'Brian Studio', developer: true });
    devToken = session.token.access_token;
    // 2026-11-16 — a working day (the owner: "an 8 hour link"): the sign-in lasts a shift, so a developer is not sent back
    // to their email for a new link while they work. Take out still ends it at once.
    expect(session.token.expires_in).toBeGreaterThanOrEqual(8 * 60 * 60);
    // The same link a second time: refused.
    await http().post('/v1/sbg/store-developers/session').send({ code }).expect(403);
  });

  it('through the developer’s doors: the store’s record, keys, where updates go — and refused at every other', async () => {
    const dev = bearer(devToken);
    await http().get(`/v1/sbg/vendors/${vendorId}`).set(dev).expect(200);
    const key = (await http().post(`/v1/sbg/vendors/${vendorId}/api-keys`).set(dev).send({ kind: 'secret', mode: 'test', label: 'Checkout' }).expect(201)).body;
    expect(key.secret).toEqual(expect.any(String));
    await http().get(`/v1/sbg/vendors/${vendorId}/api-keys`).set(dev).expect(200);
    await http().patch(`/v1/sbg/vendors/${vendorId}`).set(dev).send({ callbackUrl: 'https://studio.example/hooks/sbg' }).expect(200);
    await http().get(`/v1/sbg/vendors/${vendorId}/callbacks`).set(dev).expect(200);
    // The store's money, orders, policy, secret and developers stay the owner's.
    await http().get(`/v1/sbg/vendors/${vendorId}/orders/stats`).set(dev).expect(403);
    const policy = await http().patch(`/v1/sbg/vendors/${vendorId}`).set(dev).send({ shippingPolicy: { mode: 'full' } });
    expect([policy.status, policy.body.detail]).toEqual([403, expect.stringMatching(/The owner changes the rest/)]);
    await http().post(`/v1/sbg/vendors/${vendorId}/secret/rotate`).set(dev).send({ password: 'x' }).expect(403);
    await http().post(`/v1/sbg/vendors/${vendorId}/developers`).set(dev).send({ name: 'Another', email: `x-${digits()}@studio.example` }).expect(403);
    // 2026-11-15 — the history: who made the key and set the address, by name; the owner's invitation; never a key's value.
    const hist = (await http().get(`/v1/sbg/vendors/${vendorId}/activity`).set(dev).expect(200)).body.items as Array<Record<string, unknown>>;
    expect(hist).toEqual(expect.arrayContaining([
      expect.objectContaining({ act: 'key_made', developer: 'Brian Studio', kind: 'secret', mode: 'test', label: 'Checkout', hint: expect.any(String) }),
      expect.objectContaining({ act: 'address_set', developer: 'Brian Studio', url: 'https://studio.example/hooks/sbg' }),
      expect.objectContaining({ act: 'developer_invited', name: 'Brian Studio' }),
    ]));
    expect(hist.find((e) => e.act === 'developer_invited')?.developer).toBeUndefined();
    expect(JSON.stringify(hist)).not.toContain(key.secret);
    // The owner revokes it: written down as the owner's.
    await http().delete(`/v1/sbg/vendors/${vendorId}/api-keys/${key.keyId}`).set(bearer(owner)).expect(200);
    const after = (await http().get(`/v1/sbg/vendors/${vendorId}/activity`).set(bearer(owner)).expect(200)).body.items as Array<Record<string, unknown>>;
    expect(after[0]).toMatchObject({ act: 'key_revoked', label: 'Checkout' });
    expect(after[0].developer).toBeUndefined();
    // 2026-11-15 — the owner's bell: told of the developer's new update address and a live key, not of the test key; and
    // the developer's sign-in, on the store's own DID, cannot open that bell.
    await http().post(`/v1/sbg/vendors/${vendorId}/api-keys`).set(dev).send({ kind: 'secret', mode: 'live', label: 'Live shop' }).expect(201);
    await new Promise((r) => setImmediate(r));
    const bell = (await http().get('/v1/sbg/notifications/inbox').set(bearer(owner)).expect(200)).body.items as Array<{ kind: string; title: string; link?: string }>;
    expect(bell.filter((n) => n.kind === 'store_connection').map((n) => n.title).sort()).toEqual(['Brian Studio changed where order updates go', 'Brian Studio made a live key']);
    expect(bell.find((n) => n.kind === 'store_connection')?.link).toBe('/?go=connect');
    await http().get('/v1/sbg/notifications/inbox').set(dev).expect(403);
    // Another store reads none of it.
    (app.get(RateLimitGuard) as unknown as { hits: Map<string, unknown> }).hits.clear();
    const phone2 = `+2547${digits()}`.slice(0, 13);
    const asked2 = await http().post('/v1/sbg/auth/phone/request').send({ phone: phone2 }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone: phone2, code: asked2.body.code }).expect(201);
    const other = (await http().post('/v1/sbg/vendors').send({ ...AGREED, name: `Duka ${digits()}`, email: `other-${digits()}@duka.example`, password: 'maziwa-lala-2026', ownerPhone: phone2 }).expect(201)).body.token.access_token as string;
    await http().get(`/v1/sbg/vendors/${vendorId}/activity`).set(bearer(other)).expect(403);
    // The owner sees when they last signed in.
    const list = (await http().get(`/v1/sbg/vendors/${vendorId}/developers`).set(bearer(owner)).expect(200)).body.items;
    expect(list[0]).toMatchObject({ devId, lastSignInAt: expect.any(String) });
  });

  it('a new link goes only to an invited address, the same answer either way; taken out, every sign-in ends', async () => {
    (app.get(RateLimitGuard) as unknown as { hits: Map<string, unknown> }).hits.clear();
    const before = app.get(OutboxMailSender).recent(devEmail).length;
    expect((await http().post('/v1/sbg/store-developers/link').send({ email: devEmail }).expect(201)).body).toEqual({ sent: true });
    expect(app.get(OutboxMailSender).recent(devEmail).length).toBe(before + 1);
    const stranger = `nobody-${digits()}@studio.example`;
    expect((await http().post('/v1/sbg/store-developers/link').send({ email: stranger }).expect(201)).body).toEqual({ sent: true });
    expect(app.get(OutboxMailSender).recent(stranger)).toHaveLength(0);
    // …and a stranger's request emails nobody, the real developer included.
    expect(app.get(OutboxMailSender).recent(devEmail).length).toBe(before + 1);
    const fresh = codeIn(devEmail);
    // Taken out: the session in hand stops, and the fresh link opens nothing.
    await http().post(`/v1/sbg/vendors/${vendorId}/developers/${devId}/remove`).set(bearer(owner)).expect(201);
    await http().get(`/v1/sbg/vendors/${vendorId}`).set(bearer(devToken)).expect(401);
    await http().post('/v1/sbg/store-developers/session').send({ code: fresh }).expect(403);
  });
});
