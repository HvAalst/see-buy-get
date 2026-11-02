import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { generateKeyPairSync } from 'crypto';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { OtpService } from '../src/modules/pudo/otp.service';
import { PersonService } from '../src/modules/pudo/person.service';
import { ConversationService } from '../src/modules/pudo/conversation.service';
import { RateLimitGuard } from '../src/foundation/http/rate-limit.guard';
import { OutboxPushSender } from '../src/modules/pudo/push-sender';
import { AGREED } from './agreed';

/**
 * MESSAGES IN THE CAR, OVER THE WIRE (05_engineering/android-auto-messages.md; the owner, 2026-11-02: "we start with 2" —
 * the driver's messages read aloud in the car and answered by voice).
 *
 * Through the booted application, with a server standing where Google's Firebase stands (nothing leaves this machine):
 * a driver turns it on under Settings with the PIN, on a phone the PIN works on; the car key that comes back is the only
 * thing the car's doors take, and it opens no other door; the phone tells us its Firebase token with it; a message from
 * the poster wakes the phone with the chat's id and nothing else; the car reads the chat's unread messages, replies
 * through the chat's own send — refused as a typed message is, and marked "Sent from the car" for both sides — and marks
 * it read. A token Firebase says is dead is dropped. And every path a phone goes by takes its car key with it.
 */
describe('messages in the car, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator = '';
  let google: Server;
  const sends: Array<{ url?: string; authorization?: string; body: string }> = [];
  const dead = new Set<string>();
  const before = { ...process.env };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const car = (key: string) => ({ authorization: `Car ${key}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const PIN = '48261';
  const tag = Math.random().toString(36).slice(2, 8);
  let seq = 0;

  beforeAll(async () => {
    // GOOGLE, STOOD IN FOR: an access token for any assertion, and every wake-up kept; a token in `dead` is UNREGISTERED.
    google = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        res.setHeader('content-type', 'application/json');
        if (req.url === '/token') return res.end(JSON.stringify({ access_token: 'ya29.stand-in', expires_in: 3599, token_type: 'Bearer' }));
        sends.push({ url: req.url, authorization: req.headers.authorization, body });
        const token = (JSON.parse(body) as { message?: { token?: string } }).message?.token ?? '';
        if (dead.has(token)) {
          res.statusCode = 404;
          return res.end(JSON.stringify({ error: { code: 404, status: 'NOT_FOUND', message: 'Requested entity was not found.', details: [{ '@type': 'type.googleapis.com/google.firebase.fcm.v1.FcmError', errorCode: 'UNREGISTERED' }] } }));
        }
        res.end(JSON.stringify({ name: 'projects/sbg-car-e2e/messages/1' }));
      });
    });
    await new Promise<void>((r) => google.listen(0, '127.0.0.1', r));
    // A service account made for this run: nobody's.
    const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
    process.env.GLOS_FCM_SERVICE_ACCOUNT = JSON.stringify({ type: 'service_account', project_id: 'sbg-car-e2e', client_email: 'wake@sbg-car-e2e.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString() });
    process.env.GLOS_FCM_URL = `http://127.0.0.1:${(google.address() as AddressInfo).port}`;

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
    google?.closeAllConnections();
    await new Promise((r) => google?.close(r));
    process.env = { ...before };
  });

  const said = async (r: PromiseLike<{ status: number; body: { code?: string } }>) => {
    const answer = await r;
    return `${answer.status} ${answer.body.code ?? 'in'}`;
  };
  const typeTheCode = async (phone: string) => {
    (app.get(OtpService) as unknown as { rates: Map<string, unknown> }).rates.clear();
    // This file signs up a few dozen people from one address: the sign-up doors' own counts are not what it is about.
    (app.get(RateLimitGuard) as unknown as { hits: Map<string, unknown> }).hits.clear();
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
  };
  /** Wait for the stand-in to have been sent `n` wake-ups: a wake-up is never awaited by the message it is for. */
  const sent = async (n: number) => {
    for (let i = 0; i < 100 && sends.length < n; i++) await new Promise((r) => setTimeout(r, 20));
    expect(sends.length).toBeGreaterThanOrEqual(n);
  };
  const quiet = () => new Promise((r) => setTimeout(r, 150));

  /** A business that posts a load. */
  const aBusiness = async () => {
    seq += 1;
    const phone = `+2547${digits()}${seq % 10}`;
    await typeTheCode(phone);
    const email = `car-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    return (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `Mama Njeri Stores ${tag}${seq}`, country: 'KE', registrationNo: `CAR-${tag}-${seq}`, activities: ['shipper'], yourName: 'Njeri' }).expect(201)).body.token.access_token as string;
  };
  const aLoad = async (business: string, description = 'Roses') =>
    (await http().post('/v1/sbg/dispatch/freight').set(bearer(business)).send({ description, pickupLocation: { lat: -1.29, lng: 36.82 }, pickupLabel: 'Nairobi', destLabel: 'Nakuru', destLocation: { lat: -0.3, lng: 36.08 }, weightKg: 300, packaging: 'palletised', packages: 3 }).expect(201)).body as { freightId: string; code: string };

  /** A driver, signed up on their phone with a PIN, signed in to the Driver app there. */
  const aDriver = async () => {
    seq += 1;
    const phone = `+2547${digits()}${seq % 10}`;
    const u = `${tag}${seq}`;
    const made = await http().post('/v1/sbg/drivers/onboard').set(bearer(operator)).send({ displayName: `Otieno ${u}`, fullName: `Otieno ${u} Truck`, nationalId: `CAR-${u}`, mobile: phone, licenceClasses: ['truck'], licenceNumber: `DL-CAR-${u}`, licenceExpiresAt: '2030-01-01', criminalRecordClear: true }).expect(201);
    // Checked and approved, so that they may ask about a load: the vetting this is not about.
    await http().post(`/v1/sbg/fleet/drivers/${made.body.did}/submit-kyc`).set(bearer(operator)).send({ idCopyRef: 'id.jpg', licenceCopyRef: 'licence.jpg' }).expect(201);
    await http().post(`/v1/sbg/fleet/drivers/${made.body.did}/kyc-decision`).set(bearer(operator)).send({ approve: true, by: 'Test' }).expect(201);
    await typeTheCode(phone);
    const email = `drv-${u}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const me = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201)).body as { device: string };
    const session = (await http().post('/v1/sbg/drivers/session').send({ phone, pin: PIN, device: me.device }).expect(201)).body as { did: string; token: { access_token: string } };
    expect(session.did).toBe(made.body.did);
    return { phone, did: session.did, device: me.device, token: session.token.access_token, personDid: app.get(PersonService).findByPhone(phone)!.personDid };
  };
  /** The driver asks about the load: the chat the car reads. */
  const openChat = async (token: string, freightId: string) => {
    const r = await http().post('/v1/sbg/conversations').set(bearer(token)).send({ freightId });
    expect([r.status, r.body.detail]).toEqual([201, undefined]);
    return r.body as { conversationId: string };
  };
  const turnOn = async (token: string, device: string, lang?: string) => {
    const on = await http().post('/v1/sbg/account/car/on').set(bearer(token)).send({ devices: [device], pin: PIN, ...(lang ? { lang } : {}) }).expect(201);
    expect(on.body).toMatchObject({ on: true, which: 0, phone: 'waiting', key: expect.stringMatching(/^car_[0-9a-f]{64}$/) });
    return on.body.key as string;
  };
  const here = async (token: string, device: string) => (await http().post('/v1/sbg/account/car').set(bearer(token)).send({ devices: [device] }).expect(201)).body;
  const fcmToken = (name: string) => `${name}${tag}:APA91b${'Q'.repeat(60)}`;
  const register = (key: string, token: string) => http().post('/v1/sbg/car/token').set(car(key)).send({ token });

  it('turned on under Settings with the PIN, on a phone the PIN works on — and only by the driver', async () => {
    const d = await aDriver();
    expect(await here(d.token, d.device)).toEqual({ on: false, which: 0 });
    // Not on a phone that is not theirs — said before the PIN is looked at: five wrong PINs there lock nothing.
    for (let i = 0; i < 5; i++) expect(await said(http().post('/v1/sbg/account/car/on').set(bearer(d.token)).send({ devices: ['dvc_made-up'], pin: '00000' }))).toBe('403 DEVICE_NOT_KNOWN');
    // A wrong PIN on their own phone is counted, and is not a sign-out (403, not 401).
    expect(await said(http().post('/v1/sbg/account/car/on').set(bearer(d.token)).send({ devices: [d.device], pin: '00000' }))).toBe('403 PIN_WRONG');
    // Staff pass the role check, and are refused by name; a business is refused at the door.
    expect(await said(http().post('/v1/sbg/account/car/on').set(bearer(operator)).send({ devices: [d.device], pin: PIN }))).toBe('403 FORBIDDEN');
    expect(await said(http().post('/v1/sbg/account/car/on').set(bearer(await aBusiness())).send({ devices: [d.device], pin: PIN }))).toBe('403 FORBIDDEN');

    const key = await turnOn(d.token, d.device);
    // The key is shown once: never again, and never in a read.
    const read = await here(d.token, d.device);
    expect(read).toEqual({ on: true, which: 0, phone: 'waiting', addedAt: expect.any(String) });
    expect(JSON.stringify(read)).not.toContain(key);
    // The phone tells us where Firebase reaches it: "On for this phone".
    expect((await register(key, fcmToken('one')).expect(201)).body).toEqual({ registered: true });
    expect(await here(d.token, d.device)).toMatchObject({ on: true, phone: 'on', tokenAt: expect.any(String) });
    expect(await said(register(key, 'not a token at all'))).toBe('400 INVALID_INPUT');
    // On again: a new key, and the one before opens nothing.
    const again = await turnOn(d.token, d.device);
    expect(again).not.toBe(key);
    expect(await said(register(key, fcmToken('two')))).toBe('401 UNAUTHORIZED');
    await register(again, fcmToken('two')).expect(201);
  });

  it('a message wakes the phone with the chat and nothing else; the car reads it, replies through the chat, marks it read', async () => {
    const business = await aBusiness();
    const load = await aLoad(business);
    const d = await aDriver();
    const chat = await openChat(d.token, load.freightId);
    const key = await turnOn(d.token, d.device);
    const token = fcmToken('wake');
    await register(key, token).expect(201);

    const before = sends.length;
    await http().post(`/v1/sbg/conversations/${chat.conversationId}/messages`).set(bearer(business)).send({ body: 'Gate 3, not gate 1' }).expect(201);
    await sent(before + 1);
    const wake = sends[before];
    expect(wake.url).toBe('/v1/projects/sbg-car-e2e/messages:send');
    expect(wake.authorization).toBe('Bearer ya29.stand-in');
    expect(JSON.parse(wake.body)).toEqual({ message: { token, data: { kind: 'chat', conversationId: chat.conversationId }, android: { priority: 'HIGH' } } });
    // No word of the message, no name, no load passes through Google.
    for (const words of ['Gate 3', 'Mama Njeri', 'Roses', load.code, 'Nakuru', d.did]) expect(wake.body).not.toContain(words);

    await http().post(`/v1/sbg/conversations/${chat.conversationId}/messages`).set(bearer(business)).send({ quick: 'running_late' }).expect(201);
    const read = (await http().get(`/v1/sbg/car/chats/${chat.conversationId}`).set(car(key)).expect(200)).body;
    expect(read).toEqual({
      conversationId: chat.conversationId,
      title: `${load.code} · Roses · Nairobi → Nakuru`,
      code: load.code,
      label: 'Roses · Nairobi → Nakuru',
      from: 'The poster',
      lang: 'en',
      unread: 2,
      lastSeq: 2,
      canReply: true,
      messages: [
        { seq: 1, from: 'The poster', text: 'Gate 3, not gate 1', kind: 'text', at: expect.any(String) },
        { seq: 2, from: 'The poster', text: 'Running late', kind: 'quick', at: expect.any(String) },
      ],
    });

    // A reply spoken in the car: the chat's own message, marked for both sides.
    const reply = (await http().post(`/v1/sbg/car/chats/${chat.conversationId}/reply`).set(car(key)).send({ text: 'Nearly there' }).expect(201)).body;
    expect(reply).toEqual({ sent: true, seq: 3, at: expect.any(String), via: 'car' });
    const poster = (await http().get(`/v1/sbg/conversations/${chat.conversationId}/messages`).set(bearer(business)).expect(200)).body.items;
    expect(poster[2]).toMatchObject({ seq: 3, kind: 'text', body: 'Nearly there', mine: false, via: 'car' });
    const driver = (await http().get(`/v1/sbg/conversations/${chat.conversationId}/messages`).set(bearer(d.token)).expect(200)).body.items;
    expect(driver[2]).toMatchObject({ seq: 3, mine: true, via: 'car' });
    expect(driver[0].via).toBeUndefined();

    // Mark as read, up to what the car showed — what arrived after it stays unread.
    await http().post(`/v1/sbg/conversations/${chat.conversationId}/messages`).set(bearer(business)).send({ body: 'See you' }).expect(201);
    expect((await http().post(`/v1/sbg/car/chats/${chat.conversationId}/read`).set(car(key)).send({ seq: 3 }).expect(201)).body).toEqual({ read: true, unread: 1 });
    expect((await http().get(`/v1/sbg/car/chats/${chat.conversationId}`).set(car(key)).expect(200)).body).toMatchObject({ unread: 1, messages: [{ seq: 4, text: 'See you' }] });
    await http().post(`/v1/sbg/car/chats/${chat.conversationId}/read`).set(car(key)).send({ seq: 4 }).expect(201);
    expect((await http().get(`/v1/sbg/car/chats/${chat.conversationId}`).set(car(key)).expect(200)).body).toMatchObject({ unread: 0, messages: [] });

    // Another driver's key reads nothing of this chat: there is no such chat, to them.
    const other = await aDriver();
    const otherKey = await turnOn(other.token, other.device);
    expect(await said(http().get(`/v1/sbg/car/chats/${chat.conversationId}`).set(car(otherKey)))).toBe('404 NOT_FOUND');
    expect(await said(http().post(`/v1/sbg/car/chats/${chat.conversationId}/reply`).set(car(otherKey)).send({ text: 'hi' }))).toBe('404 NOT_FOUND');
  });

  it('a driver the car reaches is not ALSO pushed the chat notice — it waits in the bell; a driver without it is pushed as before', async () => {
    const business = await aBusiness();
    const load = await aLoad(business, 'Onions');
    const inCar = await aDriver();
    const plain = await aDriver();
    const pushes = app.get(OutboxPushSender);
    for (const d of [inCar, plain]) await http().post('/v1/sbg/notifications/subscribe').set(bearer(d.token)).send({ endpoint: `https://fcm.googleapis.com/fcm/send/${d.did}`, keys: { p256dh: 'p', auth: 'a' } }).expect(201);
    const carChat = await openChat(inCar.token, load.freightId);
    const plainChat = await openChat(plain.token, load.freightId);
    const key = await turnOn(inCar.token, inCar.device);
    // Turned on, the phone not answered yet: the car does not reach them, so the notice is pushed as before.
    await http().post(`/v1/sbg/conversations/${carChat.conversationId}/messages`).set(bearer(business)).send({ body: 'First' }).expect(201);
    expect(pushes.outboxFor(inCar.did)).toHaveLength(1);
    await register(key, fcmToken('bell')).expect(201);
    const before = sends.length;
    await http().post(`/v1/sbg/conversations/${carChat.conversationId}/messages`).set(bearer(business)).send({ body: 'Gate 3' }).expect(201);
    await http().post(`/v1/sbg/conversations/${plainChat.conversationId}/messages`).set(bearer(business)).send({ body: 'Gate 4' }).expect(201);
    await sent(before + 1);
    expect(pushes.outboxFor(inCar.did)).toHaveLength(1);
    expect(pushes.outboxFor(plain.did)).toHaveLength(1);
    // Kept in the bell all the same.
    const bell = (await http().get('/v1/sbg/notifications/inbox').set(bearer(inCar.token)).expect(200)).body;
    expect(bell.items.filter((n: { kind: string }) => n.kind === 'message')).toHaveLength(2);
  });

  it('a reply from the car is refused exactly as a typed one: nothing said, too long, the hourly cap, a closed chat', async () => {
    const business = await aBusiness();
    const load = await aLoad(business, 'Cement');
    const d = await aDriver();
    const chat = await openChat(d.token, load.freightId);
    const key = await turnOn(d.token, d.device);
    const reply = (text: string) => http().post(`/v1/sbg/car/chats/${chat.conversationId}/reply`).set(car(key)).send({ text });

    expect(await said(reply('  '))).toBe('400 FIELD_REQUIRED');
    const long = await reply('x'.repeat(1001));
    expect([long.status, long.body.code, long.body.detail]).toEqual([400, 'INVALID_INPUT', 'Keep a message under 1000 characters']);
    expect(await said(http().post(`/v1/sbg/car/chats/${chat.conversationId}/reply`).set(car(key)).send({}))).toBe('400 VALIDATION_FAILED');
    // The hourly cap is the sender's, across the app and the car alike.
    const chats = app.get(ConversationService) as unknown as { sentAt: Map<string, number[]> };
    chats.sentAt.set(d.did, Array.from({ length: 60 }, () => Date.now()));
    expect((await reply('one more')).body.detail).toMatch(/a lot of messages in one hour/);
    chats.sentAt.delete(d.did);
    await reply('ok').expect(201);

    await http().post(`/v1/sbg/conversations/${chat.conversationId}/block`).set(bearer(business)).expect(201);
    const closed = await reply('hello?');
    expect([closed.status, closed.body.detail]).toEqual([403, 'This conversation is closed']);
    expect((await http().get(`/v1/sbg/car/chats/${chat.conversationId}`).set(car(key)).expect(200)).body).toMatchObject({ canReply: false, closed: 'This conversation is closed.' });
  });

  it('each car door counts the calls of each key', async () => {
    const business = await aBusiness();
    const load = await aLoad(business, 'Tiles');
    const d = await aDriver();
    const chat = await openChat(d.token, load.freightId);
    const key = await turnOn(d.token, d.device);
    const other = await aDriver();
    const theirs = await openChat(other.token, load.freightId);
    const otherKey = await turnOn(other.token, other.device);
    for (let i = 0; i < 20; i++) await http().post(`/v1/sbg/car/chats/${chat.conversationId}/reply`).set(car(key)).send({ text: `on my way ${i}` }).expect(201);
    expect(await said(http().post(`/v1/sbg/car/chats/${chat.conversationId}/reply`).set(car(key)).send({ text: 'once more' }))).toBe('429 RATE_LIMITED');
    // Another phone's key has its own count, on the same door — from the same address.
    await http().post(`/v1/sbg/car/chats/${theirs.conversationId}/reply`).set(car(otherKey)).send({ text: 'on my way' }).expect(201);
  });

  it('the car’s doors take a car key and nothing else; a car key opens no other door', async () => {
    const business = await aBusiness();
    const load = await aLoad(business, 'Maize');
    const d = await aDriver();
    const chat = await openChat(d.token, load.freightId);
    const key = await turnOn(d.token, d.device);
    const door = `/v1/sbg/car/chats/${chat.conversationId}`;
    const madeUp = `car_${'0'.repeat(64)}`;
    for (const [what, headers] of [
      ['nothing', {}],
      ['the driver’s sign-in', bearer(d.token)],
      ['staff', bearer(operator)],
      ['the driver’s sign-in, called a car key', { authorization: `Car ${d.token}` }],
      ['the phone’s device key', { authorization: `Car ${d.device}` }],
      ['the car key as a sign-in', bearer(key)],
      ['the car key as a company key', { 'x-sbg-key': key }],
      ['a car key nobody has', car(madeUp)],
    ] as Array<[string, Record<string, string>]>) {
      expect([what, await said(http().get(door).set(headers))]).toEqual([what, '401 UNAUTHORIZED']);
      expect([what, await said(http().post(`${door}/reply`).set(headers).send({ text: 'hi' }))]).toEqual([what, '401 UNAUTHORIZED']);
      expect([what, await said(http().post('/v1/sbg/car/token').set(headers).send({ token: fcmToken('x') }))]).toEqual([what, '401 UNAUTHORIZED']);
    }
    // …and the key itself, anywhere else: the chat's own doors, the account, Settings.
    for (const [method, path] of [['get', '/v1/sbg/conversations'], ['get', `/v1/sbg/conversations/${chat.conversationId}/messages`], ['post', `/v1/sbg/conversations/${chat.conversationId}/messages`], ['get', '/v1/sbg/account/me'], ['post', '/v1/sbg/account/car'], ['post', '/v1/sbg/account/car/off']] as const) {
      for (const headers of [car(key), bearer(key)]) expect([path, (await http()[method](path).set(headers).send({ body: 'hi' })).status]).toEqual([path, 401]);
    }
    // The key still works where it belongs.
    await http().get(door).set(car(key)).expect(200);
  });

  it('a token Firebase says is dead is dropped: Settings says "waiting" again, and nothing more is sent to it', async () => {
    const business = await aBusiness();
    const load = await aLoad(business, 'Sugar');
    const d = await aDriver();
    const chat = await openChat(d.token, load.freightId);
    const key = await turnOn(d.token, d.device);
    const token = fcmToken('gone');
    dead.add(token);
    await register(key, token).expect(201);
    const before = sends.length;
    await http().post(`/v1/sbg/conversations/${chat.conversationId}/messages`).set(bearer(business)).send({ body: 'Are you near?' }).expect(201);
    await sent(before + 1);
    for (let i = 0; i < 50 && (await here(d.token, d.device)).phone !== 'waiting'; i++) await new Promise((r) => setTimeout(r, 20));
    expect(await here(d.token, d.device)).toMatchObject({ on: true, phone: 'waiting' });
    await http().post(`/v1/sbg/conversations/${chat.conversationId}/messages`).set(bearer(business)).send({ body: 'Hello?' }).expect(201);
    await quiet();
    expect(sends.slice(before).filter((s) => s.body.includes(token))).toHaveLength(1);
    // The key itself still works: the phone tells us a new token, and is woken again.
    await register(key, fcmToken('fresh')).expect(201);
    expect(await here(d.token, d.device)).toMatchObject({ phone: 'on' });
  });

  it('every path a phone goes by takes its car key: off, this phone forgotten, the others forgotten, the PIN changed or replaced, the number moved, the account closed', async () => {
    const works = async (key: string) => (await register(key, fcmToken('probe'))).status;

    // Turned off: no PIN asked.
    let d = await aDriver();
    let key = await turnOn(d.token, d.device);
    expect(await works(key)).toBe(201);
    expect((await http().post('/v1/sbg/account/car/off').set(bearer(d.token)).send({ devices: [d.device] }).expect(201)).body).toEqual({ on: false, which: 0 });
    expect(await works(key)).toBe(401);

    // This phone forgotten, from Settings › Phones and browsers.
    d = await aDriver();
    key = await turnOn(d.token, d.device);
    await http().post('/v1/sbg/account/pin-devices/forget-this').set(bearer(d.token)).send({ devices: [d.device] }).expect(201);
    expect(await works(key)).toBe(401);

    // Every other phone forgotten, from a second one — whose own car key stays.
    d = await aDriver();
    key = await turnOn(d.token, d.device);
    await typeTheCode(d.phone);
    const tablet = (await http().post('/v1/sbg/identity/device').send({ phone: d.phone }).expect(201)).body.device as string;
    const onTablet = (await http().post('/v1/sbg/drivers/session').send({ phone: d.phone, pin: PIN, device: tablet }).expect(201)).body.token.access_token as string;
    const tabletKey = await turnOn(onTablet, tablet);
    await http().post('/v1/sbg/account/pin-devices/forget-others').set(bearer(onTablet)).send({ devices: [tablet], pin: PIN }).expect(201);
    expect([await works(key), await works(tabletKey)]).toEqual([401, 201]);

    // The PIN changed.
    d = await aDriver();
    key = await turnOn(d.token, d.device);
    await http().post('/v1/sbg/account/pin/change').set(bearer(d.token)).send({ currentPin: PIN, newPin: '73914' }).expect(201);
    expect(await works(key)).toBe(401);

    // The PIN replaced by a code, on the same phone.
    d = await aDriver();
    key = await turnOn(d.token, d.device);
    await typeTheCode(d.phone);
    await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone: d.phone, pin: '73914', device: d.device }).expect(201);
    expect(await works(key)).toBe(401);

    // The number moved.
    d = await aDriver();
    key = await turnOn(d.token, d.device);
    const newPhone = `+2547${digits()}9`;
    await typeTheCode(newPhone);
    await http().post('/v1/sbg/account/phone/change').set(bearer(d.token)).send({ pin: PIN, newPhone }).expect(201);
    expect(await works(key)).toBe(401);

    // The account closed (AccountClosingService does the whole, through this same step).
    d = await aDriver();
    key = await turnOn(d.token, d.device);
    app.get(PersonService).close(d.personDid);
    expect(await works(key)).toBe(401);
  });
});
