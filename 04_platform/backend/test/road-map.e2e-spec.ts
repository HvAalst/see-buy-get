import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * A ROAD MAP OF HUBS, over the wire (2026-11-12 — the plan "Hubs on the Road", step 2). Staff read the proposal, make it the map
 * being looked at, change a hub's role and a road, set the country's minimum distance, and confirm it; a hub reads its own place
 * on the road, never another's; a hub cannot change the road map. Placed in Turkana, far from any other test's hubs.
 */
describe('a road map of hubs, over the wire', () => {
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

  it('proposed, changed and confirmed by staff; each hub reads its own place on the road', async () => {
    const hub = async (name: string, lat: number, lng: number) => {
      const made = (await http().post('/v1/sbg/mdps').set(operator).send({ name, zones: ['TurkanaTown'], country: 'KE', location: { lat, lng } }).expect(201)).body;
      return { ...made, token: bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: made.did }).expect(201)).body.access_token) };
    };
    const lodwar = await hub('Lodwar Road Hub', 3.119, 35.597);
    const lodwarTwo = await hub('Lodwar Market Hub', 3.135, 35.61);
    const kakuma = await hub('Kakuma Road Hub', 3.716, 34.866);
    const loki = await hub('Lokichogio Road Hub', 4.204, 34.348);

    const v0 = (await http().get('/v1/sbg/entities/sbg-ke/road-map').set(operator).expect(200)).body;
    expect(v0).toMatchObject({ country: 'KE', minKmStart: 60 });
    // The two Lodwar hubs are a few km apart: one of them is local only, carried by the other.
    const lodwars = [lodwar.mdpId, lodwarTwo.mdpId];
    const localLodwar = v0.proposal.local.find((l: { mdpId: string }) => lodwars.includes(l.mdpId));
    expect(lodwars).toContain(localLodwar.via);
    // A hub cannot read or change the road map; nothing is in force yet.
    await http().get('/v1/sbg/entities/sbg-ke/road-map').set(kakuma.token).expect(403);
    await http().post('/v1/sbg/entities/sbg-ke/road-map/propose').set(kakuma.token).expect(403);
    expect((await http().get(`/v1/sbg/mdps/${kakuma.mdpId}/road`).set(kakuma.token).expect(200)).body).toMatchObject({ inForce: false });

    // Staff: the proposal, a role changed and back, a road, the minimum distance, confirmed.
    const proposed = (await http().post('/v1/sbg/entities/sbg-ke/road-map/propose').set(operator).expect(201)).body;
    expect(proposed.draft).toBeTruthy();
    await http().post(`/v1/sbg/entities/sbg-ke/road-map/hubs/${localLodwar.mdpId}`).set(operator).send({ role: 'shop' }).expect(400);
    const both = (await http().post(`/v1/sbg/entities/sbg-ke/road-map/hubs/${localLodwar.mdpId}`).set(operator).send({ role: 'stop' }).expect(201)).body;
    expect(both.draft.tooClose.length).toBeGreaterThan(0);
    await http().post(`/v1/sbg/entities/sbg-ke/road-map/hubs/${localLodwar.mdpId}`).set(operator).send({ role: 'local' }).expect(201);
    await http().post('/v1/sbg/entities/sbg-ke/road-map/links').set(operator).send({ a: kakuma.mdpId, b: kakuma.mdpId, on: true }).expect(400);
    await http().post('/v1/sbg/entities/sbg-ke/road-map/min-km').set(operator).send({ km: 0 }).expect(400);
    expect((await http().post('/v1/sbg/entities/sbg-ke/road-map/min-km').set(operator).send({ km: 60 }).expect(201)).body.minKm).toBe(60);
    const done = (await http().post('/v1/sbg/entities/sbg-ke/road-map/confirm').set(operator).expect(201)).body;
    expect(done.confirmed.pieces).toBe(1);
    expect(done.draft).toBeUndefined();

    // Each hub its own place: Kakuma a stop with Lokichogio a neighbour; the local Lodwar hub carried by the other.
    const atKakuma = (await http().get(`/v1/sbg/mdps/${kakuma.mdpId}/road`).set(kakuma.token).expect(200)).body;
    expect(atKakuma).toMatchObject({ inForce: true, role: 'stop' });
    expect(atKakuma.neighbours.map((n: { mdpId: string }) => n.mdpId)).toContain(loki.mdpId);
    const local = localLodwar.mdpId === lodwar.mdpId ? lodwar : lodwarTwo;
    expect((await http().get(`/v1/sbg/mdps/${local.mdpId}/road`).set(local.token).expect(200)).body).toMatchObject({ inForce: true, role: 'local', via: { mdpId: localLodwar.via } });
    await http().get(`/v1/sbg/mdps/${kakuma.mdpId}/road`).set(loki.token).expect(403);
    expect((await http().get(`/v1/sbg/mdps/${kakuma.mdpId}/road`).set(operator).expect(200)).body.role).toBe('stop');
  });
});
