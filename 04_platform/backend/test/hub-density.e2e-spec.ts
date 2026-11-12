import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * WHERE HUBS ARE NEEDED, over the wire (2026-11-12 — the plan "Hubs on the Road", step 3). Staff read the map's coverage,
 * hubs and suggestions; two stops kept too close are suggested; a suggestion is set aside with why and brought back; the
 * country's reach is set; a hub reads none of it. Two hubs in Wajir, far from any other test's.
 */
describe('where hubs are needed, over the wire', () => {
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

  it('two stops kept too close are suggested; set aside with why, brought back; the reach is the country’s own', async () => {
    const hub = async (name: string, lat: number, lng: number) => {
      const made = (await http().post('/v1/sbg/mdps').set(operator).send({ name, zones: ['WajirTown'], country: 'KE', location: { lat, lng } }).expect(201)).body;
      return { ...made, token: bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: made.did }).expect(201)).body.access_token) };
    };
    const a = await hub('Wajir North Hub', 1.76, 40.06);
    const b = await hub('Wajir South Hub', 1.73, 40.07);

    // Both kept as stops on the road map in force, though a few km apart.
    await http().post('/v1/sbg/entities/sbg-ke/road-map/propose').set(operator).expect(201);
    await http().post(`/v1/sbg/entities/sbg-ke/road-map/hubs/${a.mdpId}`).set(operator).send({ role: 'stop' }).expect(201);
    await http().post(`/v1/sbg/entities/sbg-ke/road-map/hubs/${b.mdpId}`).set(operator).send({ role: 'stop' }).expect(201);
    await http().post('/v1/sbg/entities/sbg-ke/road-map/confirm').set(operator).expect(201);

    const v = (await http().get('/v1/sbg/entities/sbg-ke/hub-density').set(operator).expect(200)).body;
    expect(v).toMatchObject({ country: 'KE', reachStart: { urban: 15, rural: 60, remote: 150 }, roadMapInForce: true });
    expect(v.hubs.map((h: { mdpId: string }) => h.mdpId)).toEqual(expect.arrayContaining([a.mdpId, b.mdpId]));
    const close = v.suggestions.find((s: { kind: string; hubs: string[] }) => s.kind === 'too_close' && s.hubs.includes(a.mdpId) && s.hubs.includes(b.mdpId));
    expect(close).toMatchObject({ numbers: { min: 60 } });
    expect(close.numbers.apart).toBeLessThan(60);

    // A hub reads none of it, and changes nothing.
    await http().get('/v1/sbg/entities/sbg-ke/hub-density').set(a.token).expect(403);
    await http().post(`/v1/sbg/entities/sbg-ke/hub-density/aside/${encodeURIComponent(close.id)}`).set(a.token).send({ reason: 'Two owners, one town' }).expect(403);

    // Set aside with why (too short a why is refused), then brought back.
    await http().post(`/v1/sbg/entities/sbg-ke/hub-density/aside/${encodeURIComponent(close.id)}`).set(operator).send({ reason: 'no' }).expect(400);
    const aside = (await http().post(`/v1/sbg/entities/sbg-ke/hub-density/aside/${encodeURIComponent(close.id)}`).set(operator).send({ reason: 'Two owners, one town' }).expect(201)).body;
    expect(aside.suggestions.map((s: { id: string }) => s.id)).not.toContain(close.id);
    expect(aside.setAside.find((s: { id: string }) => s.id === close.id).aside).toMatchObject({ reason: 'Two owners, one town' });
    const back = (await http().post(`/v1/sbg/entities/sbg-ke/hub-density/back/${encodeURIComponent(close.id)}`).set(operator).expect(201)).body;
    expect(back.suggestions.map((s: { id: string }) => s.id)).toContain(close.id);
    await http().post('/v1/sbg/entities/sbg-ke/hub-density/back/close:none:none').set(operator).expect(404);

    // The reach: refused out of bounds, kept within them.
    await http().post('/v1/sbg/entities/sbg-ke/hub-density/reach').set(operator).send({ urban: 0, rural: 60, remote: 150 }).expect(400);
    expect((await http().post('/v1/sbg/entities/sbg-ke/hub-density/reach').set(operator).send({ urban: 20, rural: 70, remote: 180 }).expect(201)).body.reach).toEqual({ urban: 20, rural: 70, remote: 180 });
  });
});
