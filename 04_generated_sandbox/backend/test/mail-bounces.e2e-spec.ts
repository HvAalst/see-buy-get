import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { producerSignatureFor } from '../src/foundation/mail/mail-bounces';
import { PROVIDER_EVENTS_PATH, readProviderEventsRaw } from '../src/foundation/mail/provider-events.raw';

/**
 * A BOUNCE NOTICE, OVER THE WIRE — through the booted app, started the way `main.ts` starts it: with the provider's
 * address read as raw bytes before any parser. That is the part no unit test can see: whether the bytes a signature
 * is over are still there when the route is reached, for a form-wrapped body and for a JSON one.
 *
 * The provider is stood in for by this test signing as its documentation says it signs. No real notice has ever
 * been received.
 */
describe('a bounce notice from the mail provider, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let staff = '';
  const KEY = 'e2e-webhook-authentication-key';
  const tag = Math.random().toString(36).slice(2, 8);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const before = process.env.ZEPTOMAIL_WEBHOOK_KEY;

  beforeAll(async () => {
    process.env.ZEPTOMAIL_WEBHOOK_KEY = KEY;
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    readProviderEventsRaw(app as never);
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    staff = (await http().post('/v1/auth/token').send({ role: 'operator' })).body.access_token;
  });

  afterAll(async () => {
    if (before === undefined) delete process.env.ZEPTOMAIL_WEBHOOK_KEY;
    else process.env.ZEPTOMAIL_WEBHOOK_KEY = before;
    await app?.close();
  });

  const hardBounce = (address: string, id: string) => JSON.stringify({ event_name: ['hardbounce'], event_message: [{ event_data: [{ object: 'hardbounce', details: [{ bounced_recipient: address, reason: 'relaying-issues', diagnostic_message: 'bad-mailbox', time: new Date().toISOString() }] }] }], webhook_request_id: id });
  /** As the provider's own sample code reads one: the notice as a form field, URL-encoded. */
  const asForm = (json: string) => `payload=${encodeURIComponent(json)}`;
  const post = (body: string, type: string, signature?: string) => {
    const r = http().post(PROVIDER_EVENTS_PATH).set('content-type', type);
    return (signature ? r.set('producer-signature', signature) : r).send(body);
  };
  const FORM = 'application/x-www-form-urlencoded';

  it('believes only a signed notice, stops the address, tells its owner in their own app, and stops telling them once the address is replaced', async () => {
    // Somebody with a recovery email.
    const phone = `+2519${String(Math.floor(Math.random() * 90_000_000) + 10_000_000)}`.slice(0, 13);
    const email = `came-back-${tag}@example.com`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ phone, pin: '4826', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    const me = async () => (await http().get('/v1/sbg/account/me').set(bearer(person)).expect(200)).body;
    expect((await me()).emailBounced).toBeUndefined();

    const notice = hardBounce(email, `w-${tag}-1`);
    // Not signed; signed with another key; signed, and then changed. Each is refused the same way, and says nothing of why.
    const refusals = [
      await post(asForm(notice), FORM),
      await post(asForm(notice), FORM, producerSignatureFor(notice, 'somebody-elses-key', Date.now())),
      await post(asForm(notice.replace('hardbounce', 'hardbounce ')), FORM, producerSignatureFor(notice, KEY, Date.now())),
      await post(asForm(notice), FORM, producerSignatureFor(notice, KEY, Date.now() - 60 * 60_000)),
    ];
    expect(refusals.map((r) => r.status)).toEqual([401, 401, 401, 401]);
    expect(new Set(refusals.map((r) => r.body.detail))).toEqual(new Set(['This notice was not taken']));
    expect((await me()).emailBounced).toBeUndefined();
    // Being signed in — even as staff — is not being the provider.
    await post(asForm(notice), FORM).set(bearer(staff)).expect(401);
    await http().get(PROVIDER_EVENTS_PATH).expect(404);

    // Signed: taken. The bytes the signature is over reached the route — as a form, and as plain JSON.
    expect((await post(asForm(notice), FORM, producerSignatureFor(notice, KEY, Date.now())).expect(200)).body).toEqual({ ok: true });
    const other = hardBounce(`another-${tag}@example.com`, `w-${tag}-2`);
    await post(other, 'application/json', producerSignatureFor(other, KEY, Date.now())).expect(200);
    await post(other, 'text/plain', producerSignatureFor(other, KEY, Date.now())).expect(200);

    // Its owner is told, on their own account — and nobody else's says it.
    expect(await me()).toMatchObject({ emailBounced: true, email: expect.stringContaining('@example.com') });

    // Staff see what is listened for and what became of the notices; nothing there names an address.
    const conn = (await http().get('/v1/sbg/connections').set(bearer(staff)).expect(200)).body;
    // Two came with no signature (anybody's); three were signed and refused, the last of those for its time.
    expect(conn.mail.bounces).toMatchObject({ listening: true, received: 3, unsigned: 2, refused: 3, stopped: 2, lastRefused: 'stale' });
    expect(conn.mail.bounced).toBe(0);
    expect(JSON.stringify(conn)).not.toMatch(/came-back|another-/);

    // The way out is one they would use anyway: put an address that works in its place. (The other way — a code to the
    // SAME address, read and typed in — is proved on the real services in email-bounced.spec.ts: a second code to one
    // address has to wait a minute, which a test of the wire should not.) The old address stays stopped.
    const better = `works-${tag}@example.com`;
    const proof = await http().post('/v1/sbg/identity/email/request').send({ email: better });
    await http().post('/v1/sbg/account/email').set(bearer(person)).send({ pin: '4826', email: better, code: proof.body.code }).expect(201);
    expect((await me()).emailBounced).toBeUndefined();
    expect((await http().get('/v1/sbg/connections').set(bearer(staff)).expect(200)).body.mail.bounces.stopped).toBe(2);
  });

  it('answers as an address that is not there when no key is set — signed or not', async () => {
    delete process.env.ZEPTOMAIL_WEBHOOK_KEY;
    try {
      const notice = hardBounce(`nobody-${tag}@example.com`, `w-${tag}-3`);
      await post(asForm(notice), FORM, producerSignatureFor(notice, KEY, Date.now())).expect(404);
      await post(asForm(notice), FORM).expect(404);
      expect((await http().get('/v1/sbg/connections').set(bearer(staff)).expect(200)).body.mail.bounces.listening).toBe(false);
    } finally {
      process.env.ZEPTOMAIL_WEBHOOK_KEY = KEY;
    }
  });
});
