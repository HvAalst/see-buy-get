import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * ROUND 39 — A LIGHT COURIER RIDES AT ONCE, UNDER A SMALLER CAP UNTIL THEIR ID HAS BEEN SEEN (the user: "Ride at once,
 * smaller cap"). A bicycle or motorcycle rider in no fleet rides the moment they register; until a member of staff has
 * seen a photo of their ID, their custody cap stays at the country's starting number. They send the photo themselves;
 * vetting sees it, or sends it back with the reason they are shown; from then their cap grows as anybody's does.
 */
describe('a light courier’s ID, seen — over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const tag = String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  let staff: { authorization: string };
  let seq = 0;
  const png = (label: string) => `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${label}:${tag}:${Math.random()}`)]).toString('base64')}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    staff = bearer((await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token);
  });

  afterAll(async () => {
    await app?.close();
  });

  async function aRider(licenceClasses: string[]): Promise<{ did: string; token: { authorization: string } }> {
    seq += 1;
    const u = `${tag}${seq}`;
    const r = await http()
      .post('/v1/sbg/drivers/onboard')
      .set(staff)
      .send({ displayName: `Rider ${seq}`, fullName: `Rider ${u}`, nationalId: `ID-RIDER-${u}`, mobile: `+2547${u.slice(-7)}${seq}`.slice(0, 13), licenceClasses, licenceNumber: `L-${u}`, licenceExpiresAt: '2031-01-01', jurisdiction: 'KE' })
      .expect(201);
    const token = (await http().post('/v1/auth/token').send({ role: 'driver', did: r.body.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    return { did: r.body.did as string, token: bearer(token) };
  }
  const photo = async (who: { authorization: string }) => (await http().post('/v1/sbg/media').set(who).send({ kind: 'kyc_id', dataUrl: png('id') }).expect(201)).body.mediaId as string;

  it('rides at once at the starting number; sends a photo of the ID; refused with a reason, then seen — and the cap grows', async () => {
    await http().post('/v1/sbg/entities/sbg-ke/custody-caps').set(staff).send({ rider: { start: 2, liftedAfter: 50 }, by: 'Grace' }).expect(201);
    const rider = await aRider(['motorcycle']);
    const cap = async () => (await http().get('/v1/sbg/custody-cap').set(rider.token).expect(200)).body;
    // Riding already — and held at the start, the screen told why.
    expect(await cap()).toMatchObject({ capped: true, kind: 'rider', cap: 2, idUnseen: true });

    // Their own photo, from their own sign-in: not somebody else's, not staff's for them.
    const other = await aRider(['bike']);
    const mine = await photo(rider.token);
    await http().post(`/v1/sbg/fleet/drivers/${rider.did}/id-photo`).set(other.token).send({ photoRef: mine }).expect(403);
    await http().post(`/v1/sbg/fleet/drivers/${rider.did}/id-photo`).set(staff).send({ photoRef: mine }).expect(403);
    // A photo somebody else uploaded is not theirs to send.
    await http().post(`/v1/sbg/fleet/drivers/${rider.did}/id-photo`).set(rider.token).send({ photoRef: await photo(other.token) }).expect(400);
    const sent = (await http().post(`/v1/sbg/fleet/drivers/${rider.did}/id-photo`).set(rider.token).send({ photoRef: mine }).expect(201)).body;
    expect(sent.idCheck).toEqual({ photoRef: mine, sentAt: expect.any(String) });

    // Waiting for vetting; still the starting number until somebody has looked.
    const queue = async () => (await http().get('/v1/sbg/fleet/drivers/id-photos').set(staff).expect(200)).body.items as Array<{ did: string; idCheck: { photoRef: string } }>;
    expect((await queue()).find((r) => r.did === rider.did)).toMatchObject({ idCheck: { photoRef: mine }, country: 'KE' });
    expect(await cap()).toMatchObject({ cap: 2, idUnseen: true });

    // Not their ID: said with the reason, which they are shown; they send another.
    await http().post(`/v1/sbg/fleet/drivers/${rider.did}/id-photo-decision`).set(staff).send({ seen: false }).expect(400);
    const refused = (await http().post(`/v1/sbg/fleet/drivers/${rider.did}/id-photo-decision`).set(staff).send({ seen: false, reason: 'The photo is blurred: the name cannot be read' }).expect(201)).body;
    expect(refused.idCheckRefusal).toMatchObject({ reason: 'The photo is blurred: the name cannot be read' });
    expect((await queue()).find((r) => r.did === rider.did)).toBeUndefined();
    expect(JSON.stringify((await http().get('/v1/sbg/notifications/inbox').set(rider.token).expect(200)).body)).toMatch(/Your ID photo was not accepted/);
    expect(await cap()).toMatchObject({ cap: 2, idUnseen: true });

    // Sent again, and seen: from now the cap grows as anybody's does.
    await http().post(`/v1/sbg/fleet/drivers/${rider.did}/id-photo`).set(rider.token).send({ photoRef: await photo(rider.token) }).expect(201);
    await http().post(`/v1/sbg/fleet/drivers/${rider.did}/id-photo-decision`).set(staff).send({ seen: true }).expect(201);
    const after = await cap();
    expect(after).toMatchObject({ capped: true, cap: 2 });
    expect(after.idUnseen).toBeUndefined();
    expect((await queue()).find((r) => r.did === rider.did)).toBeUndefined();
    expect(JSON.stringify((await http().get('/v1/sbg/notifications/inbox').set(rider.token).expect(200)).body)).toMatch(/SeeBuyGet has seen your ID/);
    // Seen once is seen: nothing more to send, and nothing waiting to decide.
    await http().post(`/v1/sbg/fleet/drivers/${rider.did}/id-photo`).set(rider.token).send({ photoRef: await photo(rider.token) }).expect(400);
    await http().post(`/v1/sbg/fleet/drivers/${rider.did}/id-photo-decision`).set(staff).send({ seen: true }).expect(400);
  });

  it('is asked only of a light courier in no fleet: a truck driver was vetted before they drove', async () => {
    const trucker = await aRider(['truck']);
    await http().post(`/v1/sbg/fleet/drivers/${trucker.did}/id-photo`).set(trucker.token).send({ photoRef: 'med_nothing' }).expect(400);
  });
});
