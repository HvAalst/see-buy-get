import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AGREED } from './agreed';

/**
 * WHERE HUBS ARE NEEDED, over the wire (2026-11-12 — the plan "Hubs on the Road", step 3). Staff read the map's coverage,
 * hubs and suggestions; two stops kept too close are suggested; the hub list (the owner's D2 and D7): rows filled in, rejected
 * with why, an invitation made, a hub signing up through it making its row joined; the
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

  it('two stops kept too close are suggested; the hub list: rows filled in, rejected with why, invited, joined by a sign-up; the reach is the country’s own', async () => {
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
    await http().get('/v1/sbg/entities/sbg-ke/hub-list').set(a.token).expect(403);

    // The hub list: both Wajir hubs joined from the start; a place staff add, filled in, rejected only with why.
    const list0 = (await http().get('/v1/sbg/entities/sbg-ke/hub-list').set(operator).expect(200)).body;
    expect(list0.rows.filter((r: { status: string; mdpId?: string }) => r.status === 'joined' && [a.mdpId, b.mdpId].includes(r.mdpId!))).toHaveLength(2);
    await http().post(`/v1/sbg/entities/sbg-ke/hub-list/${encodeURIComponent('hub:' + a.mdpId)}`).set(operator).send({ phone: '+254700000001' }).expect(403);
    const added = (await http().post('/v1/sbg/entities/sbg-ke/hub-list').set(operator).send({ name: 'Habaswein junction', lat: 1.01, lng: 39.49 }).expect(201)).body;
    const row = added.rows.find((r: { name?: string }) => r.name === 'Habaswein junction');
    expect(row).toMatchObject({ source: 'staff', status: 'open' });
    const rowPath = `/v1/sbg/entities/sbg-ke/hub-list/${encodeURIComponent(row.rowId)}`;
    await http().post(rowPath).set(operator).send({ status: 'joined' }).expect(400);
    await http().post(rowPath).set(operator).send({ email: 'not-an-email' }).expect(400);
    await http().post(rowPath).set(operator).send({ status: 'rejected' }).expect(400);
    expect((await http().post(rowPath).set(operator).send({ phone: '+254722000333', status: 'negotiating' }).expect(201)).body.rows.find((r: { rowId: string }) => r.rowId === row.rowId)).toMatchObject({ phone: '+254722000333', status: 'negotiating' });
    // The invitation: the row's code, which a hub signs up with — the row is joined by itself, linked to the new hub.
    const code = (await http().post(`${rowPath}/invite`).set(operator).expect(201)).body.rows.find((r: { rowId: string }) => r.rowId === row.rowId).code;
    expect(code).toMatch(/^[A-Z2-9]{6}$/);
    const u = String(Date.now()).slice(-6);
    const phone = `+2547${u}7`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const signed = (await http().post('/v1/sbg/auth/signup').send({ ...AGREED, role: 'mdp', email: `habaswein.${u}@depot.example`, password: 'mabati-na-misumari-4', phone, profile: { mdp: { name: `Habaswein Sort ${u}`, zones: ['WajirTown'], country: 'KE', location: { lat: 1.01, lng: 39.49 }, inviteCode: code.toLowerCase() } } }).expect(201)).body;
    const joined = (await http().get('/v1/sbg/entities/sbg-ke/hub-list').set(operator).expect(200)).body.rows.find((r: { rowId: string }) => r.rowId === row.rowId);
    expect(joined).toMatchObject({ status: 'joined', hubName: `Habaswein Sort ${u}` });
    expect(joined.joinedAt).toBeTruthy();
    expect(signed).toBeTruthy();

    // The reach: refused out of bounds, kept within them.
    await http().post('/v1/sbg/entities/sbg-ke/hub-density/reach').set(operator).send({ urban: 0, rural: 60, remote: 150 }).expect(400);
    expect((await http().post('/v1/sbg/entities/sbg-ke/hub-density/reach').set(operator).send({ urban: 20, rural: 70, remote: 180 }).expect(201)).body.reach).toEqual({ urban: 20, rural: 70, remote: 180 });
  });
});
