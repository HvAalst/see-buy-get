import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DriverService } from '../src/modules/pudo/driver.service';

/**
 * 2026-11-19 — A CARRIER CONNECTS ITS OWN MOLLIE ACCOUNT, OVER THE WIRE (the payments plan, part 2). Through the real doors:
 * a Dutch courier connects — here on SeeBuyGet's own test key, test money only — sees it, and disconnects; elsewhere it is
 * not offered; a fleet driver is told its office connects it; staff connect nobody's; and Mollie's sign-in comes back to the
 * courier's own app saying how it ended.
 */
describe('a carrier connects its own Mollie account, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator = '';
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const was = { key: process.env.GLOS_MOLLIE_TEST_KEY, url: process.env.SBG_PUBLIC_URL, id: process.env.GLOS_MOLLIE_CLIENT_ID };

  beforeAll(async () => {
    process.env.GLOS_MOLLIE_TEST_KEY = 'test_e2e_key';
    process.env.SBG_PUBLIC_URL = 'https://seebuyget.test';
    delete process.env.GLOS_MOLLIE_CLIENT_ID;
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
    for (const [k, v] of [['GLOS_MOLLIE_TEST_KEY', was.key], ['SBG_PUBLIC_URL', was.url], ['GLOS_MOLLIE_CLIENT_ID', was.id]] as const) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  });

  /** A driver, living in `country`; with `fleetDid`, a driver of that fleet, whose fleet is paid for its work. */
  async function aDriver(country: string, fleetDid?: string): Promise<{ did: string; token: string }> {
    const n = digits();
    const r = await http().post('/v1/sbg/drivers/onboard').set(bearer(operator)).send({ displayName: 'Daan', fullName: 'Daan de Vries', nationalId: `DRV-MO-${n}`, mobile: `+2547${n}3`, licenceClasses: ['truck'], licenceNumber: `DL-MO-${n}`, licenceExpiresAt: '2030-01-01' }).expect(201);
    const driver = app.get(DriverService).get(r.body.did as string);
    Object.assign(driver, { jurisdiction: country, ...(fleetDid ? { managerDid: fleetDid } : {}) });
    const token = (await http().post('/v1/auth/token').send({ role: 'driver', did: r.body.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    return { did: r.body.did as string, token };
  }

  it('a Dutch courier connects — on our test key, test money only — sees it, and disconnects', async () => {
    const courier = await aDriver('NL');
    expect((await http().get('/v1/sbg/mollie').set(bearer(courier.token)).expect(200)).body).toEqual({ available: true, via: 'test_key' });
    const started = (await http().post('/v1/sbg/mollie/connect').set(bearer(courier.token)).expect(201)).body;
    expect(started).toEqual({ connected: expect.objectContaining({ via: 'test_key', testmode: true }) });
    expect((await http().get('/v1/sbg/mollie').set(bearer(courier.token)).expect(200)).body.connected).toMatchObject({ via: 'test_key', testmode: true });
    const gone = (await http().delete('/v1/sbg/mollie').set(bearer(courier.token)).expect(200)).body;
    expect(gone).toEqual({ available: true, via: 'test_key' });
  });

  it('is not offered elsewhere; a fleet driver is told its office connects it; staff connect nobody’s; nobody signed out', async () => {
    const kenyan = await aDriver('KE');
    expect((await http().get('/v1/sbg/mollie').set(bearer(kenyan.token)).expect(200)).body).toEqual({ available: false, why: 'country' });
    const refused = await http().post('/v1/sbg/mollie/connect').set(bearer(kenyan.token));
    expect([refused.status, refused.body.detail]).toEqual([403, 'Payments by Mollie are for carriers in the Netherlands']);

    const fleetDriver = await aDriver('NL', 'did:glos:fleet-somebody');
    expect((await http().get('/v1/sbg/mollie').set(bearer(fleetDriver.token)).expect(200)).body).toEqual({ available: false, why: 'fleet' });
    const notTheirs = await http().post('/v1/sbg/mollie/connect').set(bearer(fleetDriver.token));
    expect([notTheirs.status, notTheirs.body.detail]).toEqual([403, 'Your fleet is paid for your work: its office connects Mollie']);

    const staff = await http().get('/v1/sbg/mollie').set(bearer(operator));
    expect([staff.status, staff.body.detail]).toEqual([403, 'Staff do not connect a carrier’s Mollie account: the carrier does, in its own Settings']);
    await http().get('/v1/sbg/mollie').expect(401);
  });

  it('Mollie’s sign-in comes back to the courier’s own app, saying how it ended — a state not ours is an expired one', async () => {
    const back = await http().get('/v1/sbg/mollie/oauth/callback?state=not-ours&code=abc').expect(302);
    expect(back.headers.location).toBe('https://seebuyget.test/driver/?mollie=failed&why=expired');
  });

  // 2026-11-19 — part 2b: Mollie's notice comes form-encoded and unsigned; one not about a payment of ours is answered and
  // ignored. The page a payer comes back to answers anybody, and says nothing of a reference that is not ours.
  it('Mollie’s notice is read as Mollie sends it, and one not ours is answered and ignored; the payer’s page knows nothing of a made-up reference', async () => {
    const notice = await http().post('/v1/sbg/mollie/webhook').type('form').send('id=tr_not_ours').expect(200);
    expect(notice.body).toEqual({ ok: true });
    const page = await http().get('/v1/sbg/mollie/paid/made-up-reference').expect(200);
    expect(page.headers['content-type']).toMatch(/text\/html/);
    expect(page.text).toContain('Deze link is onbekend.');
    await http().get('/v1/sbg/dispatch/freight/frt_x/mollie').expect(401);
  });
});
