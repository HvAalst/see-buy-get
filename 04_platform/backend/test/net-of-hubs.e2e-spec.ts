import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/** A square of `size` degrees whose south-west corner is (lng, lat). */
const square = (lng: number, lat: number, size = 0.1): number[][] => [
  [lng, lat],
  [lng + size, lat],
  [lng + size, lat + size],
  [lng, lat + size],
  [lng, lat],
];

/**
 * A NET OF HUBS, over the wire (2026-11-09 — the owner: "we should not restrict hubs … to 1 per zone … We should aim for a
 * net of hubs"; "Own zone + hub adds"). Two hubs standing in one zone both serve it; a hub adds a zone near it from its own
 * app, and drops it, but never the zone it stands in; staff take a hub away from a zone, and the hub cannot add it back;
 * staff never change a hub's zones in its name, and one hub never another's.
 */
describe('a net of hubs, over the wire', () => {
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

  it('two hubs in one zone both serve it; a hub adds and drops a zone near it; staff take one away; nobody acts in another’s name', async () => {
    const geojson = JSON.stringify({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { shapeName: 'Net West' }, geometry: { type: 'Polygon', coordinates: [square(36.6, -1.3)] } },
        { type: 'Feature', properties: { shapeName: 'Net East' }, geometry: { type: 'Polygon', coordinates: [square(36.7, -1.3)] } },
      ],
    });
    await http().post('/v1/sbg/entities/sbg-ke/zones/areas').set(operator).send({ geojson, source: 'A test survey', licence: 'CC BY 4.0', attribution: 'Its contributors' }).expect(201);
    const setup = (await http().post('/v1/sbg/entities/sbg-ke/zones/draft/publish').set(operator).send({}).expect(201)).body;
    const codeOf = (name: string) => (setup.inForce.zones as Array<{ code: string; name: string }>).find((z) => z.name === name)!.code;
    const west = codeOf('Net West');
    const east = codeOf('Net East');
    const hub = async (name: string, lng: number) => {
      const made = (await http().post('/v1/sbg/mdps').set(operator).send({ name, zones: ['NetTown'], country: 'KE', location: { lat: -1.25, lng } }).expect(201)).body;
      return { ...made, token: bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: made.did }).expect(201)).body.access_token) };
    };
    const a = await hub('Net Hub A', 36.62);
    const b = await hub('Net Hub B', 36.68);
    const c = await hub('Net Hub C', 36.75);

    // Both western hubs serve the western zone, by standing in it; the eastern one the east.
    const zonesOf = async () => (await http().get('/v1/sbg/entities/sbg-ke/catchments').set(operator).expect(200)).body.zones as Array<{ code: string; hubs: Array<{ mdpId: string; how: string }>; taken: string[] }>;
    const hubsIn = async (code: string) => (await zonesOf()).find((z) => z.code === code)!.hubs.map((h) => [h.mdpId, h.how]);
    expect((await hubsIn(west)).sort()).toEqual([[a.mdpId, 'stands'], [b.mdpId, 'stands']].sort());
    expect(await hubsIn(east)).toEqual([[c.mdpId, 'stands']]);

    // Hub C, in its own app: where it stands, and the zone near it to add.
    const mine = (await http().get(`/v1/sbg/mdps/${c.mdpId}/zones-served`).set(c.token).expect(200)).body;
    expect(mine.standsIn).toMatchObject({ code: east, how: 'stands' });
    expect(mine.nearby.map((z: { code: string }) => z.code)).toContain(west);
    const added = (await http().post(`/v1/sbg/mdps/${c.mdpId}/zones-served/${west}`).set(c.token).send({ serve: true }).expect(201)).body;
    expect(added.serves.find((z: { code: string }) => z.code === west)).toMatchObject({ how: 'hub' });
    expect((await hubsIn(west)).map(([id]) => id)).toContain(c.mdpId);
    // Never the zone it stands in.
    await http().post(`/v1/sbg/mdps/${c.mdpId}/zones-served/${east}`).set(c.token).send({ serve: false }).expect(400);
    // Nobody in its name: not staff, not another hub.
    expect((await http().post(`/v1/sbg/mdps/${c.mdpId}/zones-served/${west}`).set(operator).send({ serve: false }).expect(403)).body.detail).toMatch(/Staff add or take away a hub on the Zones screen, never in its name/);
    await http().post(`/v1/sbg/mdps/${c.mdpId}/zones-served/${west}`).set(a.token).send({ serve: false }).expect(403);
    await http().get(`/v1/sbg/mdps/${c.mdpId}/zones-served`).set(a.token).expect(403);
    // Staff read it, and take hub C away from the western zone: it cannot add it back itself.
    expect((await http().get(`/v1/sbg/mdps/${c.mdpId}/zones-served`).set(operator).expect(200)).body.mdpId).toBe(c.mdpId);
    await http().post(`/v1/sbg/entities/sbg-ke/catchments/${west}`).set(operator).send({ mdpId: c.mdpId, serve: false }).expect(201);
    expect((await zonesOf()).find((z) => z.code === west)!.taken).toEqual([c.mdpId]);
    const refused = await http().post(`/v1/sbg/mdps/${c.mdpId}/zones-served/${west}`).set(c.token).send({ serve: true }).expect(403);
    expect(refused.body.detail).toMatch(/staff took Net West away from Net Hub C: ask them to give it back/);
    expect((await http().get(`/v1/sbg/mdps/${c.mdpId}/zones-served`).set(c.token).expect(200)).body.taken.map((z: { code: string }) => z.code)).toEqual([west]);
  });
});
