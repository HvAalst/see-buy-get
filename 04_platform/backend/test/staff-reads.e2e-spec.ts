import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

/**
 * WHAT STAFF OPENED, over the wire (the ISO 28000 check: "a log of what staff opened"). A record a member of staff opens
 * by its name or number is noted with their name; the same again soon counts on the same line; a list is not noted, nor
 * anybody who is not staff; the shared key is said to be nobody; reading the log is noted in it too.
 */
describe('what staff opened, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let setupKey: string;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const tag = digits();

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    setupKey = (await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token;
  });

  afterAll(async () => {
    await app?.close();
  });

  async function aStaff(name: string): Promise<string> {
    const made = await http().post('/v1/sbg/operators').set(bearer(setupKey)).send({ email: `${name}-${tag}@sbg.test`, name: `${name} ${tag}` }).expect(201);
    const login = await http().post('/v1/sbg/operators/login').send({ email: made.body.email, password: made.body.temporaryPassword }).expect(201);
    return login.body.token.access_token;
  }

  it('notes each record a member of staff opens, by name, once a run; never a list, never anybody else', async () => {
    const halima = bearer(await aStaff('Halima'));
    const u = digits();
    const hours = { open: '00:00', close: '23:59' };
    const shop = (
      await http()
        .post('/v1/sbg/agents')
        .set(bearer(setupKey))
        .send({
          shopName: `Read Shop ${tag}`, zone: `Read${tag}`, country: 'KE', location: { lat: -1.286, lng: 36.817 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
          openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: hours },
          fullName: 'Read owner', nationalId: `ID-RD-${u}`, mobile: `+2547${u}5`, deviceImei: `IMEI-RD-${u}`,
          requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
        })
        .expect(201)
    ).body.did as string;
    const asShop = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did: shop }).expect(201)).body.access_token);
    const log = async (record: string) => ((await http().get('/v1/sbg/staff-reads').query({ record }).set(halima).expect(200)).body.items as Array<{ byKind: string; byName: string; route: string; record: string; times: number }>).filter((r) => r.route !== 'GET /v1/sbg/staff-reads');

    // Halima opens the shop's record twice: one line, twice, with her name.
    await http().get(`/v1/sbg/agents/${shop}`).set(halima).expect(200);
    await http().get(`/v1/sbg/agents/${shop}`).set(halima).expect(200);
    expect(await log(shop)).toEqual([expect.objectContaining({ byKind: 'staff', byName: `Halima ${tag}`, route: 'GET /v1/sbg/agents/:did', record: shop, times: 2 })]);
    // The shop reading its own record is not staff; a list names no record.
    await http().get(`/v1/sbg/agents/${shop}`).set(asShop).expect(200);
    await http().get('/v1/sbg/mdps').set(halima).expect(200);
    expect((await log(shop)).map((r) => r.times)).toEqual([2]);
    // Another record she opens is a line of its own, and a search for the shop does not show it.
    const u2 = digits();
    const other = (
      await http()
        .post('/v1/sbg/agents')
        .set(bearer(setupKey))
        .send({
          shopName: `Other Read Shop ${tag}`, zone: `ReadOther${tag}`, country: 'KE', location: { lat: -1.29, lng: 36.82 }, landmark: 'by the bus stage', shelf: { rows: 3, cols: 3 },
          openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: hours },
          fullName: 'Other owner', nationalId: `ID-RD-${u2}`, mobile: `+2547${u2}6`, deviceImei: `IMEI-RD-${u2}`,
          requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
        })
        .expect(201)
    ).body.did as string;
    await http().get(`/v1/sbg/agents/${other}`).set(halima).expect(200);
    expect((await log(other)).map((r) => r.record)).toEqual([other]);
    expect((await log(shop)).map((r) => r.record)).toEqual([shop]); // never the other shop's line
    const mine = (await http().get('/v1/sbg/staff-reads').query({ by: `Halima ${tag}` }).set(halima).expect(200)).body.items as Array<{ route: string }>;
    expect(mine.map((r) => r.route).filter((r) => !r.includes(':') && r !== 'GET /v1/sbg/staff-reads')).toEqual([]);
    // The shared key is nobody, and is said so.
    await http().get(`/v1/sbg/agents/${shop}`).set(bearer(setupKey)).expect(200);
    expect((await log(shop)).map((r) => [r.byKind, r.byName]).sort()).toEqual([['key', 'the shared key'], ['staff', `Halima ${tag}`]]);
    // Reading the log is in the log.
    const whole = (await http().get('/v1/sbg/staff-reads').query({ by: `Halima ${tag}` }).set(halima).expect(200)).body.items as Array<{ route: string; record: string }>;
    expect(whole.some((r) => r.route === 'GET /v1/sbg/staff-reads' && r.record === `record ${shop}`)).toBe(true);
    // Only staff read it.
    await http().get('/v1/sbg/staff-reads').set(asShop).expect(403);
  });
});
