import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AGREED } from './agreed';
import { SoftAuthenticator } from './soft-authenticator';

/**
 * UNLOCK WITH FINGERPRINT OR FACE IN PLACE OF A SHOP'S, A HUB'S OR A STORE'S OWN PASSWORD — over the wire (the owner,
 * 2026-11-02: "ok go ahead with the fingerprint").
 *
 * The account's password turns it on, on one of the account's own phones; the phone (in software, soft-authenticator.ts)
 * signs a challenge asked for by the account's address and that phone's key; the ticket that comes back opens the
 * account's own door in the password's place, once. The password's lock counts a bad signature, and the right unlock
 * starts the count again. A phone forgotten, the passkey turned off, the password changed or reset: offered nowhere,
 * opens nothing. And the people at a shop's counter open their session with their PIN, never with a fingerprint.
 */
describe('unlock with fingerprint or face, for a shop, a hub and a store, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const PIN = '48261';
  let operator = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    operator = (await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token;
  });

  afterAll(async () => {
    await app?.close();
  });

  const verified = async (phone: string) => {
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    return phone;
  };
  const said = async (r: PromiseLike<{ status: number; body: { code?: string } }>) => {
    const answer = await r;
    return `${answer.status} ${answer.body.code ?? 'in'}`;
  };
  /** A shop, signed up on this phone: its first. */
  const aShop = async () => {
    const u = digits();
    const phone = await verified(`+2547${u}3`);
    const HOURS = { open: '08:00', close: '18:00' };
    const email = `kona.${u}@shop.example`;
    const password = 'duka-la-kona-2026';
    const made = (
      await http()
        .post('/v1/sbg/auth/signup')
        .send({ ...AGREED, role: 'pudo', email, password, phone, profile: { agent: { shopName: `Kona ${u}`, zone: `Z${u}`, location: { lat: -1.2, lng: 36.8 }, landmark: 'x', shelf: { rows: 3, cols: 3 }, openingHours: { mon: HOURS, tue: HOURS, wed: HOURS, thu: HOURS, fri: HOURS, sat: HOURS, sun: null }, fullName: 'Kona Shop', nationalId: `ID-${u}`, mobile: phone, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } } } })
        .expect(201)
    ).body as { did: string; device: string; token: { access_token: string } };
    return { email, password, phone, did: made.did, device: made.device, token: made.token.access_token };
  };
  /** Settings: the password again, then the phone's answer. */
  const turnOn = async (token: string, device: string, password: string, phoneApp = new SoftAuthenticator()) => {
    const asked = await http().post('/v1/sbg/account/shop-passkey/options').set(bearer(token)).send({ device, password }).expect(201);
    const on = await http().post('/v1/sbg/account/shop-passkey/on').set(bearer(token)).send({ device, response: phoneApp.register(asked.body.options) }).expect(201);
    expect(on.body).toMatchObject({ on: true, which: 0, id: phoneApp.id });
    return phoneApp;
  };
  const options = (email: string, device?: string) => http().post('/v1/sbg/auth/unlock/options').send({ email, ...(device ? { device } : {}) }).expect(201).then((r) => r.body as { challenge: string; allowCredentials: Array<{ id: string }> });
  const unlock = async (email: string, device: string, phoneApp: SoftAuthenticator, opts: Parameters<SoftAuthenticator['assert']>[1] = {}) => {
    const asked = await options(email, device);
    return http().post('/v1/sbg/auth/unlock').send({ email, device, response: phoneApp.assert(asked.challenge, opts) });
  };
  const ticket = async (email: string, device: string, phoneApp: SoftAuthenticator) => {
    const r = await unlock(email, device, phoneApp);
    expect(r.status).toBe(201);
    expect(r.body.expiresIn).toBe(120);
    return r.body.unlock as string;
  };
  const login = (body: Record<string, unknown>) => http().post('/v1/sbg/auth/login').send(body);

  it('a shop: turned on with its password on its own phone; the ticket opens its door in the password’s place — once', async () => {
    const shop = await aShop();
    expect((await http().post('/v1/sbg/account/shop-passkey').set(bearer(shop.token)).send({ device: shop.device }).expect(201)).body).toEqual({ on: false, which: 0 });
    // Not on a phone that is not the shop's, and not without the right password — a wrong one is not a sign-out.
    expect(await said(http().post('/v1/sbg/account/shop-passkey/options').set(bearer(shop.token)).send({ device: 'dvc_made-up', password: shop.password }))).toBe('403 DEVICE_NOT_KNOWN');
    expect(await said(http().post('/v1/sbg/account/shop-passkey/options').set(bearer(shop.token)).send({ device: shop.device, password: 'not-the-password' }))).toBe('403 PASSWORD_WRONG');
    const phoneApp = await turnOn(shop.token, shop.device, shop.password);
    expect((await http().post('/v1/sbg/account/shop-passkey').set(bearer(shop.token)).send({ device: shop.device }).expect(201)).body).toMatchObject({ on: true, which: 0, id: phoneApp.id });

    const t = await ticket(shop.email, shop.device, phoneApp);
    const opened = await login({ email: shop.email, unlock: t, device: shop.device }).expect(201);
    expect(opened.body).toMatchObject({ did: shop.did, role: 'pudo' });
    expect(await said(login({ email: shop.email, unlock: t, device: shop.device }))).toBe('401 UNLOCK_FAILED');
    // On another phone, or for another address, a ticket opens nothing.
    const other = await aShop();
    expect(await said(login({ email: shop.email, unlock: await ticket(shop.email, shop.device, phoneApp), device: other.device }))).toBe('401 UNLOCK_FAILED');
    expect(await said(login({ email: other.email, unlock: await ticket(shop.email, shop.device, phoneApp), device: shop.device }))).toBe('401 UNLOCK_FAILED');
    // Neither a password nor a ticket: refused by the door's own rules.
    expect((await login({ email: shop.email, device: shop.device })).status).toBe(400);
    // The password works as it always did.
    await login({ email: shop.email, password: shop.password, device: shop.device }).expect(201);
  });

  it('asking tells a stranger nothing: one shape, and one answer, for every address there is or is not', async () => {
    const shop = await aShop();
    const plain = await aShop();
    const phoneApp = await turnOn(shop.token, shop.device, shop.password);
    const strangers = [await options(`nobody.${digits()}@example.com`), await options(shop.email), await options(shop.email, 'dvc_made-up'), await options(shop.email, plain.device), await options(plain.email, plain.device)];
    const mine = await options(shop.email, shop.device);
    for (const s of strangers) {
      expect(Object.keys(s).sort()).toEqual(Object.keys(mine).sort());
      expect(s.allowCredentials).toEqual([]);
    }
    expect(mine.allowCredentials).toEqual([expect.objectContaining({ id: phoneApp.id })]);
    // The phone's answer, sent for an address nobody has, or from a phone that is not the shop's: one answer.
    const asked = await options(shop.email, shop.device);
    for (const [email, device] of [[`nobody.${digits()}@example.com`, shop.device], [shop.email, 'dvc_made-up'], [shop.email, plain.device]]) {
      expect([email, device, await said(http().post('/v1/sbg/auth/unlock').send({ email, device, response: phoneApp.assert(asked.challenge) }))]).toEqual([email, device, '403 UNLOCK_OFF']);
    }
  });

  it('a bad answer counts with the wrong passwords; the right unlock starts the count again; a locked sign-in answers neither', async () => {
    const shop = await aShop();
    const phoneApp = await turnOn(shop.token, shop.device, shop.password);
    const wrongPassword = () => said(login({ email: shop.email, password: 'not-the-password', device: shop.device }));
    // Four wrong — passwords and forged signatures together — and the right unlock: the count starts again…
    expect([await wrongPassword(), await wrongPassword()]).toEqual(['401 AUTH_FAILED', '401 AUTH_FAILED']);
    expect([await said(unlock(shop.email, shop.device, phoneApp, { tamper: true })), await said(unlock(shop.email, shop.device, phoneApp, { verified: false }))]).toEqual(['401 UNLOCK_FAILED', '401 UNLOCK_FAILED']);
    await login({ email: shop.email, unlock: await ticket(shop.email, shop.device, phoneApp), device: shop.device }).expect(201);
    // …so four more lock nothing, and the fifth after them locks it.
    for (let i = 0; i < 2; i++) expect(await wrongPassword()).toBe('401 AUTH_FAILED');
    const held = await ticket(shop.email, shop.device, phoneApp);
    for (let i = 0; i < 2; i++) expect(await said(unlock(shop.email, shop.device, phoneApp, { tamper: true }))).toBe('401 UNLOCK_FAILED');
    expect(await said(unlock(shop.email, shop.device, phoneApp, { tamper: true }))).toBe('403 PASSWORD_LOCKED');
    expect(await said(unlock(shop.email, shop.device, phoneApp))).toBe('403 PASSWORD_LOCKED');
    expect(await said(login({ email: shop.email, unlock: held, device: shop.device }))).toBe('403 PASSWORD_LOCKED');
    expect(await said(login({ email: shop.email, password: shop.password, device: shop.device }))).toBe('403 PASSWORD_LOCKED');
  });

  it('turned off, the password changed or reset, the phone forgotten: offered nowhere, opens nothing — the password is the way in', async () => {
    const shop = await aShop();
    const offered = async () => (await options(shop.email, shop.device)).allowCredentials.length;
    let phoneApp = await turnOn(shop.token, shop.device, shop.password);
    const held = await ticket(shop.email, shop.device, phoneApp);

    // Off: no password asked, and the ticket already handed out is refused.
    const off = await http().post('/v1/sbg/account/shop-passkey/off').set(bearer(shop.token)).send({ device: shop.device }).expect(201);
    expect(off.body).toMatchObject({ on: false, which: 0, dropped: phoneApp.id, rpId: 'localhost' });
    expect(await said(login({ email: shop.email, unlock: held, device: shop.device }))).toBe('401 UNLOCK_FAILED');
    expect(await offered()).toBe(0);
    expect(await said(unlock(shop.email, shop.device, phoneApp))).toBe('403 UNLOCK_OFF');
    let token = (await login({ email: shop.email, password: shop.password, device: shop.device }).expect(201)).body.token.access_token as string;

    // The password changed: every passkey made with the old one goes.
    phoneApp = await turnOn(token, shop.device, shop.password);
    const newPassword = 'kitu-kipya-kabisa-1';
    token = (await http().post('/v1/sbg/auth/password').send({ email: shop.email, password: shop.password, newPassword, device: shop.device }).expect(201)).body.token.access_token;
    expect(await offered()).toBe(0);

    // The password reset by its code: the same.
    phoneApp = await turnOn(token, shop.device, newPassword);
    const issued = (await http().post('/v1/sbg/auth/forgot').send({ email: shop.email }).expect(201)).body as { resetToken: string };
    const reset = 'kitu-kingine-kipya-2';
    await http().post('/v1/sbg/auth/reset').send({ token: issued.resetToken, password: reset }).expect(201);
    expect(await offered()).toBe(0);
    token = (await login({ email: shop.email, password: reset, device: shop.device }).expect(201)).body.token.access_token;

    // "Forget this one" from the phones list: the passkey goes with the phone.
    phoneApp = await turnOn(token, shop.device, reset);
    expect(await offered()).toBe(1);
    await http().post('/v1/sbg/account/shop-devices/forget-this').set(bearer(token)).send({ device: shop.device }).expect(201);
    expect(await offered()).toBe(0);
    expect(await said(unlock(shop.email, shop.device, phoneApp))).toBe('403 UNLOCK_OFF');
  });

  it('a hub: the same door; a store: its own door, which takes only a store’s ticket', async () => {
    const u = digits();
    const hubPhone = await verified(`+2547${u}4`);
    const hub = { email: `sort.${u}@hub.example`, password: 'kituo-cha-kupanga-9' };
    const madeHub = (await http().post('/v1/sbg/auth/signup').send({ ...AGREED, role: 'mdp', email: hub.email, password: hub.password, phone: hubPhone, profile: { mdp: { name: `Kati Sort ${u}`, zones: [`HZ${u}`], country: 'KE', location: { lat: -1.25, lng: 36.85 } } } }).expect(201)).body;
    const hubApp = await turnOn(madeHub.token.access_token, madeHub.device, hub.password);
    expect((await login({ email: hub.email, unlock: await ticket(hub.email, madeHub.device, hubApp), device: madeHub.device }).expect(201)).body).toMatchObject({ did: madeHub.did, role: 'mdp' });

    const v = digits();
    const store = { email: `soko.${v}@store.example`, password: 'vitenge-vya-pwani-8' };
    const madeStore = (await http().post('/v1/sbg/vendors').send({ ...AGREED, name: `Soko Letu ${v}`, email: store.email, password: store.password, ownerPhone: await verified(`+2547${digits()}7`) }).expect(201)).body;
    const storeApp = await turnOn(madeStore.token.access_token, madeStore.device, store.password);
    const opened = await http().post('/v1/sbg/vendors/session').send({ email: store.email, unlock: await ticket(store.email, madeStore.device, storeApp), device: madeStore.device }).expect(201);
    expect(opened.body).toMatchObject({ vendorId: madeStore.vendorId, hasAccount: true });
    // The store's door takes a store's ticket only: a hub's is refused there as a hub's password is.
    expect(await said(http().post('/v1/sbg/vendors/session').send({ email: hub.email, unlock: await ticket(hub.email, madeHub.device, hubApp), device: madeHub.device }))).toBe('401 UNLOCK_FAILED');
  });

  it('the people at a counter open their session with their PIN, never with a fingerprint; and they cannot turn the shop’s on or off', async () => {
    const shop = await aShop();
    const phone = await verified(`+2547${digits()}2`);
    const email = `kaunta${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const me = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201)).body as { token: { access_token: string }; device: string };
    const added = (await http().post('/v1/sbg/shop/staff').set(bearer(shop.token)).send({ phone, name: 'Wanjiru' }).expect(201)).body;
    await http().post(`/v1/sbg/shop-invitations/${added.memberId}/accept`).set(bearer(me.token.access_token)).expect(201);

    // Their own fingerprint, turned on for their own sign-in, opens their own sign-in…
    const personApp = new SoftAuthenticator();
    const asked = await http().post('/v1/sbg/account/passkey/options').set(bearer(me.token.access_token)).send({ devices: [me.device], pin: PIN }).expect(201);
    await http().post('/v1/sbg/account/passkey/on').set(bearer(me.token.access_token)).send({ devices: [me.device], response: personApp.register(asked.body.options) }).expect(201);
    const challenge = (await http().post('/v1/sbg/identity/unlock/options').send({ phone, device: me.device }).expect(201)).body.challenge;
    const t = (await http().post('/v1/sbg/identity/unlock').send({ phone, device: me.device, response: personApp.assert(challenge) }).expect(201)).body.unlock;
    const byFinger = (await http().post('/v1/sbg/identity/login').send({ phone, unlock: t, device: me.device }).expect(201)).body.token.access_token as string;
    // …but not a session at a counter: the counter's phone unlocks for whoever can open it.
    const refused = await http().post(`/v1/sbg/shops/${shop.did}/staff-session`).set(bearer(byFinger)).expect(403);
    expect(refused.body.detail).toMatch(/sign in with your PIN/);
    const byPin = (await http().post('/v1/sbg/identity/login').send({ phone, pin: PIN, device: me.device }).expect(201)).body.token.access_token as string;
    const session = (await http().post(`/v1/sbg/shops/${shop.did}/staff-session`).set(bearer(byPin)).expect(201)).body;

    // The shop's own fingerprint is the shop's: its people and SeeBuyGet's staff turn it on or off for nobody.
    expect((await http().post('/v1/sbg/account/shop-passkey').set(bearer(session.token.access_token)).send({ device: shop.device })).status).toBe(403);
    expect((await http().post('/v1/sbg/account/shop-passkey/off').set(bearer(session.token.access_token)).send({ device: shop.device })).status).toBe(403);
    expect((await http().post('/v1/sbg/account/shop-passkey').set(bearer(operator)).send({ device: shop.device })).status).toBe(403);
  });
});
