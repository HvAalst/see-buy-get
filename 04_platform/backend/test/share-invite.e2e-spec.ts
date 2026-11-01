import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AGREED } from './agreed';

/**
 * 2026-11-01 — SHARE SEEBUYGET FROM EVERY APP (the owner: "the invite a contact feature is not in every app's settings").
 *
 * An invite was the Send app's alone: its routes let in only a consumer's token, so a driver, a hub or a fleet had no
 * link of their own. Now any sign-in with a person behind it makes one, and a newcomer who signs up through it is
 * counted to that person; a sign-in with no person behind it is told so rather than handed a link nobody owns.
 */
describe('share SeeBuyGet: a link of your own from any app', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const rand = () => `+2547${Math.floor(Math.random() * 9_000_000) + 1_000_000}`;

  /** A phone through the ordinary door: code, recovery email, PIN — with an invite token when one is given. */
  async function enroll(phone: string, pin: string, inviteToken?: string) {
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code });
    const email = `share${phone.slice(-7)}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    return (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin, email, emailCode: mailed.body.code, ...(inviteToken ? { inviteToken } : {}) }).expect(201)).body;
  }

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

  it('a DRIVER makes a share link, and a newcomer who signs up through it is counted to them', async () => {
    const op = (await http().post('/v1/auth/token').send({ role: 'operator' })).body.access_token;
    const phone = rand();
    await http()
      .post('/v1/sbg/drivers/onboard')
      .set('authorization', `Bearer ${op}`)
      .send({ displayName: 'Tsehay', fullName: 'Tsehay Rider', nationalId: `ID-${phone.slice(-6)}`, mobile: phone, licenceClasses: ['bike'], jurisdiction: 'KE' })
      .expect(201);
    const { device } = await enroll(phone, '24689');
    const driver = (await http().post('/v1/sbg/drivers/session').send({ phone, pin: '24689', device }).expect(201)).body.token.access_token;

    // Before 2026-11-01 this was refused: an invite was a consumer's only.
    const made = (await http().post('/v1/sbg/identity/invites').set('authorization', `Bearer ${driver}`).send({ channels: ['share'] }).expect(201)).body;
    expect(made.token).toMatch(/^[0-9a-f]{16}$/);
    expect(made.channels).toEqual(['share']);
    const before = (await http().get('/v1/sbg/identity/invites').set('authorization', `Bearer ${driver}`).expect(200)).body;
    expect(before).toMatchObject({ joined: 0, invites: [{ token: made.token, channels: ['share'] }] });

    // A newcomer opens the link and signs up — on the front page, the Send app or the Business app alike.
    const joined = await enroll(rand(), '58204', made.token);
    expect(joined.isNew).toBe(true);
    const after = (await http().get('/v1/sbg/identity/invites').set('authorization', `Bearer ${driver}`).expect(200)).body;
    expect(after.joined).toBe(1);
  });

  it('a sign-in with no person behind it is told so, not handed a link nobody owns', async () => {
    const op = (await http().post('/v1/auth/token').send({ role: 'operator' })).body.access_token;
    const r = await http().post('/v1/sbg/identity/invites').set('authorization', `Bearer ${op}`).send({ channels: ['share'] });
    expect(r.status).toBe(403);
    expect(r.body.message ?? r.body.error?.message ?? JSON.stringify(r.body)).toMatch(/no person behind it/);
  });
});
