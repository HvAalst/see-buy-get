import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * A HUB DOWN, over the wire (2026-11-11 — the ISO 28000 check, gap 12; the owner: "build it now"). The hub says it is down
 * and why from its own app; another hub cannot say it for it; staff say it when the hub cannot be reached; it shows on its
 * own start screen and on staff's list of hubs; a reason the server does not know, or an opening time already past, is
 * refused; and it opens again.
 */
describe('a hub down, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

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

  it('the hub says it is down, another hub cannot, staff can; shown to the hub and to staff; it opens again', async () => {
    const hub = async (name: string, lng: number) => {
      const made = (await http().post('/v1/sbg/mdps').set(operator).send({ name, zones: ['DownTown'], country: 'KE', location: { lat: -1.25, lng } }).expect(201)).body;
      return { ...made, token: bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: made.did }).expect(201)).body.access_token) };
    };
    const a = await hub('Down Hub A', 36.62);
    const b = await hub('Down Hub B', 36.64);

    // Refused: no reopening time (mandatory, the owner, 2026-11-11), a reason the server does not know, an opening time
    // already past, another hub saying it.
    const soon = new Date(Date.now() + 3_600_000).toISOString();
    await http().post(`/v1/sbg/mdps/${a.mdpId}/down`).set(a.token).send({ reason: 'power' }).expect(400);
    await http().post(`/v1/sbg/mdps/${a.mdpId}/down`).set(a.token).send({ reason: 'holiday', until: soon }).expect(400);
    await http().post(`/v1/sbg/mdps/${a.mdpId}/down`).set(a.token).send({ reason: 'power', until: '2020-01-01T00:00:00Z' }).expect(400);
    await http().post(`/v1/sbg/mdps/${a.mdpId}/down`).set(b.token).send({ reason: 'power', until: soon }).expect(403);

    // The hub says it, until a time to come.
    const until = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const said = (await http().post(`/v1/sbg/mdps/${a.mdpId}/down`).set(a.token).send({ reason: 'flood', note: 'Road under water', until }).expect(201)).body;
    expect(said.down).toMatchObject({ reason: 'flood', note: 'Road under water', until, byRole: 'hub' });
    expect(said.redirected).toEqual([]);
    // Its own start screen and staff's list of hubs say so; another hub's does not see it.
    const listed = async (auth: { authorization: string }) => ((await http().get('/v1/sbg/mdps').set(auth).expect(200)).body as Array<{ mdpId: string; down?: { reason: string } }>).find((m) => m.mdpId === a.mdpId);
    expect((await listed(a.token))?.down).toMatchObject({ reason: 'flood' });
    expect((await listed(operator))?.down).toMatchObject({ reason: 'flood' });
    expect((await listed(b.token))?.down).toBeUndefined();

    // Its word on reopening: too early to confirm; a new time is kept; another hub cannot say it. Drivers may collect its bags.
    expect((await http().post(`/v1/sbg/mdps/${a.mdpId}/down/reopening`).set(a.token).send({}).expect(400)).body.detail).toMatch(/last day before it/);
    // A new time is checked as the first was: to come, and no more than 30 days away.
    await http().post(`/v1/sbg/mdps/${a.mdpId}/down/reopening`).set(a.token).send({ until: '2020-01-01T00:00:00Z' }).expect(400);
    await http().post(`/v1/sbg/mdps/${a.mdpId}/down/reopening`).set(a.token).send({ until: new Date(Date.now() + 40 * 86_400_000).toISOString() }).expect(400);
    const later = new Date(Date.now() + 12 * 3_600_000).toISOString();
    expect((await http().post(`/v1/sbg/mdps/${a.mdpId}/down/reopening`).set(a.token).send({ until: later }).expect(201)).body.down).toMatchObject({ until: later });
    await http().post(`/v1/sbg/mdps/${a.mdpId}/down/reopening`).set(b.token).send({}).expect(403);
    expect((await http().post(`/v1/sbg/mdps/${a.mdpId}/down/reopening`).set(a.token).send({}).expect(201)).body.down.confirmedAt).toBeTruthy();
    await http().post(`/v1/sbg/mdps/${a.mdpId}/down/collect`).set(b.token).send({ collectable: true }).expect(403);
    expect((await http().post(`/v1/sbg/mdps/${a.mdpId}/down/collect`).set(operator).send({ collectable: true }).expect(201)).body.down.collectable).toMatchObject({ byRole: 'staff' });
    expect((await http().post(`/v1/sbg/mdps/${a.mdpId}/down/collect`).set(a.token).send({ collectable: false }).expect(201)).body.down.collectable).toBeUndefined();

    // Open again: not by another hub; by staff, when the hub cannot be reached; and not twice.
    await http().post(`/v1/sbg/mdps/${a.mdpId}/up`).set(b.token).send({}).expect(403);
    expect((await http().post(`/v1/sbg/mdps/${a.mdpId}/up`).set(operator).send({}).expect(201)).body).toEqual({ mdpId: a.mdpId, down: null });
    await http().post(`/v1/sbg/mdps/${a.mdpId}/up`).set(operator).send({}).expect(400);

    // Staff say it down in its place, and the hub opens it again itself.
    const byStaff = (await http().post(`/v1/sbg/mdps/${a.mdpId}/down`).set(operator).send({ reason: 'no_staff', until: soon, by: 'Amina' }).expect(201)).body;
    expect(byStaff.down).toMatchObject({ reason: 'no_staff', byRole: 'staff' });
    await http().post(`/v1/sbg/mdps/${a.mdpId}/up`).set(a.token).send({}).expect(201);
    expect((await listed(a.token))?.down).toBeUndefined();
  });

  it('how runs and extra legs are paid is each country’s: by bag until it says by km, logged; staff set it, a hub cannot', async () => {
    expect((await http().get('/v1/sbg/entities/sbg-ke/run-pay').set(operator).expect(200)).body).toEqual({ entityId: 'sbg-ke', mode: 'bag' });
    await http().post('/v1/sbg/entities/sbg-ke/run-pay').set(operator).send({ mode: 'mile' }).expect(400);
    expect((await http().post('/v1/sbg/entities/sbg-ke/run-pay').set(operator).send({ mode: 'km' }).expect(201)).body).toEqual({ entityId: 'sbg-ke', mode: 'km' });
    const made = (await http().post('/v1/sbg/mdps').set(operator).send({ name: 'Run Pay Hub', zones: ['RunTown'], country: 'KE', location: { lat: -1.25, lng: 36.7 } }).expect(201)).body;
    const hubToken = bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: made.did }).expect(201)).body.access_token);
    await http().post('/v1/sbg/entities/sbg-ke/run-pay').set(hubToken).send({ mode: 'bag' }).expect(403);
    await http().post('/v1/sbg/entities/sbg-ke/run-pay').set(operator).send({ mode: 'bag' }).expect(201);
  });
});
