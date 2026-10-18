import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CorridorService } from '../src/modules/pudo/corridor.service';

/**
 * FLAGS AS CASES — through the booted application, over HTTP: a blocked corridor raises a flag, the flag is a case,
 * staff take it, note it and close it with a reason, and it stays closed while its time to look again runs. Staff only.
 */
describe('flags as cases, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  let operator = '';

  beforeAll(async () => {
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
  });

  it('opens a case for a flag that staff take, note and close with a reason — and nobody else reads', async () => {
    const corridors = app.get(CorridorService);
    const name = `Case Lane ${Math.floor(Math.random() * 1e6)}`;
    const c = corridors.addCorridor({ name, originZone: 'CASE-A', destZone: 'CASE-B' });
    corridors.setStatus(c.corridorId, 'blocked');
    // A second one nobody takes: the taken list must leave it out.
    const other = `${name} North`;
    corridors.setStatus(corridors.addCorridor({ name: other, originZone: 'CASE-C', destZone: 'CASE-D' }).corridorId, 'blocked');

    // Only staff read the cases.
    const somebody = (await http().post('/v1/did').send({ controller: 'not-staff' }).expect(201)).body.id as string;
    const shopper = (await http().post('/v1/auth/token').send({ sub: somebody, type: 'did' }).expect(201)).body.access_token as string;
    await http().get('/v1/sbg/flag-cases').set(bearer(shopper)).expect(403);

    const live = (await http().get('/v1/sbg/flag-cases').set(bearer(operator)).expect(200)).body;
    const blocked = live.items.find((x: { subject: string }) => x.subject === name);
    expect(blocked).toMatchObject({ kind: 'Blocked_Corridor', severity: 'high', state: 'open', history: [{ act: 'opened' }] });
    expect(live.waiting).toBeGreaterThanOrEqual(1);

    const url = `/v1/sbg/flag-cases/${blocked.caseId}`;
    expect((await http().post(`${url}/take`).set(bearer(operator)).send({ by: 'Amina' }).expect(201)).body).toMatchObject({ state: 'taken', owner: { name: 'Amina' } });
    // Somebody else is told whose it is.
    expect((await http().post(`${url}/take`).set(bearer(operator)).send({ by: 'Otieno' }).expect(409)).body.detail).toMatch(/Amina has this case/);
    // Found again in the taken list; a kind asked for brings only its own, with the counts of every kind.
    const taken = (await http().get('/v1/sbg/flag-cases?which=taken').set(bearer(operator)).expect(200)).body;
    expect(taken.items.find((x: { caseId: string }) => x.caseId === blocked.caseId)).toMatchObject({ owner: { name: 'Amina' } });
    expect(taken.items.every((x: { state: string }) => x.state === 'taken')).toBe(true);
    expect(taken.items.some((x: { subject: string }) => x.subject === other)).toBe(false);
    const buses = (await http().get('/v1/sbg/flag-cases?kind=Ghost_Bus').set(bearer(operator)).expect(200)).body;
    expect(buses.items.some((x: { subject: string }) => x.subject === name)).toBe(false);
    expect(buses.kinds.find((k: { kind: string }) => k.kind === 'Blocked_Corridor')).toMatchObject({ count: expect.any(Number) });
    await http().post(`${url}/note`).set(bearer(operator)).send({ by: 'Otieno', text: 'Bridge out at Kibwezi; the county says Thursday' }).expect(201);
    // A case is closed with a reason, and a time to look again within a week.
    await http().post(`${url}/done`).set(bearer(operator)).send({ by: 'Amina', reason: 'ok' }).expect(400);
    await http().post(`${url}/done`).set(bearer(operator)).send({ by: 'Amina', reason: 'Rerouted via Voi until the bridge reopens', recheckHours: 500 }).expect(400);
    const done = (await http().post(`${url}/done`).set(bearer(operator)).send({ by: 'Amina', reason: 'Rerouted via Voi until the bridge reopens', recheckHours: 48 }).expect(201)).body;
    expect(done.state).toBe('done');
    expect(done.history.map((e: { act: string; by?: string }) => `${e.act}${e.by ? `:${e.by}` : ''}`)).toEqual(['opened', 'taken:Amina', 'note:Otieno', 'done:Amina']);

    // The corridor is still blocked, but the case was put to rest: it is not back among the live ones.
    const after = (await http().get('/v1/sbg/flag-cases').set(bearer(operator)).expect(200)).body;
    expect(after.items.some((x: { subject: string }) => x.subject === name)).toBe(false);
    const closed = (await http().get('/v1/sbg/flag-cases?which=closed').set(bearer(operator)).expect(200)).body;
    expect(closed.items.find((x: { caseId: string }) => x.caseId === blocked.caseId)).toMatchObject({ state: 'done' });
  });
});
