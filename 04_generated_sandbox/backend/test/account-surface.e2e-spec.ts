import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * THE ACCOUNT IS THE PERSON, AND EVERY APP CAN REACH IT.
 *
 * A driver's avatar, their PIN and where they live were reachable from exactly one app — the Send app,
 * because its token is the only `consumer` one. Everywhere else the facts existed on the server with no
 * door, which is why a courier could not change their own PIN.
 *
 * What makes this work is that every role already signs in through the same identity spine; the token
 * simply never said so. It says `personDid` now. These tests hold the two things that follow: a DRIVER's
 * token reaches the person's account, and a token that is not a person reaches nothing.
 */
describe('the account, reached from a role app', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;

  const PHONE = `+2547${Math.floor(Math.random() * 9_000_000) + 1_000_000}`;
  const PIN = '2468';
  let driverToken = '';
  let driverDid = '';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());

    const op = (await http().post('/v1/auth/token').send({ role: 'operator' })).body.access_token;

    // A courier who rides on their own: registered, then given a PIN through the ordinary phone door.
    const driver = await http()
      .post('/v1/sbg/drivers/onboard')
      .set('authorization', `Bearer ${op}`)
      .send({
        displayName: 'Njeri',
        fullName: 'Njeri Rider',
        nationalId: `ID-${PHONE.slice(-6)}`,
        mobile: PHONE,
        licenceClasses: ['bike'],
        jurisdiction: 'KE',
      });
    driverDid = driver.body.did;

    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone: PHONE });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone: PHONE, code: asked.body.code });
    await http().post('/v1/sbg/identity/enroll').send({ phone: PHONE, pin: PIN });

    const session = await http().post('/v1/sbg/drivers/session').send({ phone: PHONE, pin: PIN });
    driverToken = session.body.token.access_token;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('gives a DRIVER their own account — the thing that had no door', () => {
    expect(driverToken).toBeTruthy();
    return http()
      .get('/v1/sbg/account/me')
      .set('authorization', `Bearer ${driverToken}`)
      .expect(200)
      .expect((res) => {
        // The PERSON, reached with a DRIVER's token. Before `personDid` this was a 403.
        expect(res.body.personId).toMatch(/^did:glos:/);
        expect(res.body.hasPin).toBe(true);
        // And who they are acting as, which is what the menu heads itself with.
        expect(res.body.actingAs).toBe('driver');
        expect(res.body.actingDid).toBe(driverDid);
      });
  });

  it('takes a name and an address, and gives them back to the person who set them', async () => {
    await http()
      .patch('/v1/sbg/account/profile')
      .set('authorization', `Bearer ${driverToken}`)
      .send({ displayName: 'Njeri W.', address: '12 Ngong Road, Nairobi' })
      .expect(200);

    await http()
      .get('/v1/sbg/account/me')
      .set('authorization', `Bearer ${driverToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.displayName).toBe('Njeri W.');
        expect(res.body.address).toBe('12 Ngong Road, Nairobi');
      });
  });

  it('lets somebody take their address back, because a field that only fills is one nobody should fill', async () => {
    await http().patch('/v1/sbg/account/profile').set('authorization', `Bearer ${driverToken}`).send({ address: '' }).expect(200);
    await http()
      .get('/v1/sbg/account/me')
      .set('authorization', `Bearer ${driverToken}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.address).toBeUndefined();
        expect(res.body.displayName).toBe('Njeri W.'); // and clearing one field left the other alone
      });
  });

  describe('what it refuses', () => {
    it('refuses a token that is nobody — a machine credential is not a person', async () => {
      const machine = (await http().post('/v1/auth/token').send({ role: 'operator' })).body.access_token;
      // An operator is maximally trusted and still gets nothing here. Acting on behalf of a shop is
      // administration; setting somebody's PIN or reading their address is impersonation.
      await http().get('/v1/sbg/account/me').set('authorization', `Bearer ${machine}`).expect(403);
      await http().patch('/v1/sbg/account/profile').set('authorization', `Bearer ${machine}`).send({ displayName: 'Whoever' }).expect(403);
      await http().post('/v1/sbg/account/pin/change').set('authorization', `Bearer ${machine}`).send({ currentPin: '0000', newPin: '1111' }).expect(403);
    });

    it('refuses a wrong current PIN, and never takes a phone number to say whose PIN to change', async () => {
      await http()
        .post('/v1/sbg/account/pin/change')
        .set('authorization', `Bearer ${driverToken}`)
        .send({ currentPin: '9999', newPin: '1357' })
        // 403, not 401: the session is fine. Every app reads a 401 as 'your sign-in ended' and signs the person out —
        // which is what a mistyped current PIN used to do to them.
        .expect(403)
        .expect((res) => expect(res.body.code).toBe('PIN_WRONG'));
      await http().get('/v1/sbg/account/me').set('authorization', `Bearer ${driverToken}`).expect(200);
      // The old PIN still opens the door: a failed change changed nothing.
      const again = await http().post('/v1/sbg/drivers/session').send({ phone: PHONE, pin: PIN }).expect(201);
      // One phone at a time: that sign-in ended the earlier one, so the rest of this file carries the new token.
      await http().get('/v1/sbg/account/me').set('authorization', `Bearer ${driverToken}`).expect(401);
      driverToken = again.body.token.access_token;
    });
  });

  describe('the doors a stranger knocks on', () => {
    it('a driver’s own token cannot add a driver to anybody’s fleet — the role is checked at the door, not just in the handler', async () => {
      await http()
        .post('/v1/sbg/drivers/onboard')
        .set('authorization', `Bearer ${driverToken}`)
        .send({ displayName: 'Ghost', fullName: 'Ghost Rider', nationalId: `ID-GHOST-${PHONE.slice(-5)}`, mobile: `+2547${PHONE.slice(-7, -1)}9`, licenceClasses: ['bike'] })
        .expect(403);
    });

    it('a fleet code is answered twenty times a quarter of an hour from one caller, then not at all', async () => {
      for (let i = 0; i < 20; i++) await http().post('/v1/sbg/fleet/managers/login').send({ code: `FM-${String(i).padStart(6, '0')}` }).expect(401);
      const limited = await http().post('/v1/sbg/fleet/managers/login').send({ code: 'FM-ABCDEF' }).expect(429);
      expect(limited.body.code).toBe('RATE_LIMITED');
    });
  });

  it('changes the PIN and signs every session out, this one included', async () => {
    await http()
      .post('/v1/sbg/account/pin/change')
      .set('authorization', `Bearer ${driverToken}`)
      .send({ currentPin: PIN, newPin: '1357' })
      .expect(201)
      .expect((res) => {
        expect(res.body.changed).toBe(true);
        expect(res.body.signedOutEverywhere).toBe(true);
      });

    // THE TOKEN THAT MADE THE CALL IS DEAD, necessarily — it carries the person as its revocation key.
    // That is why the response hands back nothing to swap in, and why the app signs the person back in.
    await http().get('/v1/sbg/account/me').set('authorization', `Bearer ${driverToken}`).expect(401);
    // The new PIN works; the old one does not.
    await http().post('/v1/sbg/drivers/session').send({ phone: PHONE, pin: PIN }).expect(401);
    await http().post('/v1/sbg/drivers/session').send({ phone: PHONE, pin: '1357' }).expect(201);
  });
});
