import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OutboxMailSender } from '../src/foundation/mail/outbox-mail.sender';
import { AGREED } from './agreed';

/**
 * ONE EMAIL, SEVERAL KINDS OF ACCOUNT (the owner, 2026-11-03: a shop "with the same email as my business account" was told
 * "this email is already used"; "the email would then be linked … a confirmation mail will ask the user to click the 'yes it
 * is me' button") — over the wire.
 *
 * A hub signed up with an address a shop signs in with is kept beside the shop. It signs in once the address's owner
 * clicked "Yes, it is me" in the email it was sent; the shop signs in as before throughout. The same kind twice is refused.
 */
describe('one email, a shop and a hub, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const HOURS = { open: '08:00', close: '18:00' };

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

  const verified = async (phone: string) => {
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
  };
  const shopProfile = (u: string, phone: string) => ({
    agent: { shopName: `Kona ${u}`, zone: `Z${u}`, location: { lat: -1.2, lng: 36.8 }, landmark: 'x', shelf: { rows: 3, cols: 3 }, openingHours: { mon: HOURS, tue: HOURS, wed: HOURS, thu: HOURS, fri: HOURS, sat: HOURS, sun: null }, fullName: 'Kona Shop', nationalId: `ID-${u}`, mobile: phone, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } },
  });

  it('keeps the hub beside the shop, opens it after “Yes, it is me”, and refuses the same kind twice', async () => {
    const u = digits();
    const email = `amani.${u}@example.com`;
    const shopPhone = `+2547${u}4`;
    const hubPhone = `+2547${u}5`;
    const outbox = app.get(OutboxMailSender);

    await verified(shopPhone);
    const shop = (await http().post('/v1/sbg/auth/signup').send({ ...AGREED, role: 'pudo', email, password: 'duka-la-kona-2026', phone: shopPhone, profile: shopProfile(u, shopPhone) }).expect(201)).body;
    expect(shop.linkPending).toBeUndefined();

    // The same address for a hub: kept, not refused — and not welcomed yet, but asked.
    await verified(hubPhone);
    const hub = (await http().post('/v1/sbg/auth/signup').send({ ...AGREED, role: 'mdp', email, password: 'kituo-cha-amani-2026', phone: hubPhone, profile: { mdp: { name: `Kituo ${u}`, zones: [`HZ${u}`], country: 'KE', location: { lat: -1.25, lng: 36.85 } } } }).expect(201)).body;
    expect(hub).toMatchObject({ role: 'mdp', email, linkPending: true, device: expect.stringMatching(/^dvc_/) });
    expect(hub.did).not.toBe(shop.did);
    const mails = outbox.recent(email);
    expect(mails.filter((m) => m.template === 'welcome')).toHaveLength(1); // the shop's only
    const ask = mails.find((m) => m.template === 'yes-it-is-me');
    expect(ask?.subject).toBe(`Is this you? Kituo ${u} uses your email too`);
    const token = /#link=([A-Za-z0-9_-]+)/.exec(ask!.html)?.[1];
    expect(token).toBeTruthy();

    const login = (password: string, device: string, role?: string) => http().post('/v1/sbg/auth/login').send({ email, password, device, ...(role ? { role } : {}) });
    // Before the click: the hub's right password says what to do, naming the address; the shop signs in as before.
    const waiting = await login('kituo-cha-amani-2026', hub.device, 'mdp').expect(403);
    expect(waiting.body).toMatchObject({ code: 'LINK_PENDING', params: { email, sentAgain: false } });
    expect((await login('duka-la-kona-2026', shop.device, 'pudo').expect(201)).body.did).toBe(shop.did);
    // An app that names no kind signs in to the first, as every app did before.
    expect((await login('duka-la-kona-2026', shop.device).expect(201)).body.did).toBe(shop.did);
    // The hub's password at the shop's door is a wrong password there, and the other way round.
    expect((await login('kituo-cha-amani-2026', shop.device, 'pudo')).body.code).toBe('AUTH_FAILED');
    expect((await login('duka-la-kona-2026', hub.device, 'mdp')).body.code).toBe('AUTH_FAILED');

    // "Yes, it is me": once. Then the hub signs in, and is welcomed.
    await http().post('/v1/sbg/auth/link/confirm').send({ token: 'not-one-of-ours-at-all' }).expect(404);
    expect((await http().post('/v1/sbg/auth/link/confirm').send({ token }).expect(201)).body).toEqual({ email, kind: 'hub', role: 'mdp' });
    await http().post('/v1/sbg/auth/link/confirm').send({ token }).expect(404);
    const signedIn = (await login('kituo-cha-amani-2026', hub.device, 'mdp').expect(201)).body;
    expect(signedIn.did).toBe(hub.did);
    // Inside the hub, its own password is the one asked: the shop's opens nothing there.
    const hubBearer = { authorization: `Bearer ${signedIn.token.access_token}` };
    await http().post('/v1/sbg/account/shop-devices/forget-others').set(hubBearer).send({ password: 'duka-la-kona-2026', device: hub.device }).expect(401);
    await http().post('/v1/sbg/account/shop-devices/forget-others').set(hubBearer).send({ password: 'kituo-cha-amani-2026', device: hub.device }).expect(201);
    expect(outbox.recent(email).filter((m) => m.template === 'welcome')).toHaveLength(2);

    // A forgotten password is the kind's own: the hub's code resets the hub's, and the shop's stays.
    const forgot = (await http().post('/v1/sbg/auth/forgot').send({ email, role: 'mdp' }).expect(201)).body;
    if (forgot.resetToken) {
      await http().post('/v1/sbg/auth/reset').send({ token: forgot.resetToken, password: 'kituo-kipya-cha-2026' }).expect(201);
      await login('kituo-kipya-cha-2026', hub.device, 'mdp').expect(201);
      await login('duka-la-kona-2026', shop.device, 'pudo').expect(201);
    }

    // The same kind twice is refused, saying which (from another proven number).
    const otherPhone = `+2547${u}6`;
    await verified(otherPhone);
    const third = await http().post('/v1/sbg/auth/signup').send({ ...AGREED, role: 'mdp', email, password: 'kituo-cha-pili-2026', phone: otherPhone, profile: { mdp: { name: `Kituo B ${u}`, zones: [`HY${u}`], country: 'KE', location: { lat: -1.25, lng: 36.85 } } } });
    expect(third.status).toBe(409);
    expect(third.body).toMatchObject({ code: 'DUPLICATE', params: { field: 'email', kind: 'hub' } });
    expect(third.body.detail).toMatch(/already signs in to a SeeBuyGet hub/);
  });
});
