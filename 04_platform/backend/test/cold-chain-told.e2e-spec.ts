import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BusinessHookService } from '../src/modules/pudo/business-hooks.service';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { FleetHookService } from '../src/modules/pudo/fleet-hooks.service';
import { FleetManagerService } from '../src/modules/pudo/fleet-manager.service';
import { NoteArchiveService } from '../src/modules/pudo/note-archive.service';
import { AGREED } from './agreed';

/**
 * A COLD CHAIN BROKEN IS TOLD, over the wire (round 25, the user: "A breach is told"; "The shipper and the fleet"). Until
 * now a breach was a flag in the control tower and a line on the note, and nobody who could act heard of it. Now the
 * shipper and the office of the fleet carrying it hear at once — in their inbox and on their system — with the reading,
 * when it was read and, read with no signal, that it reached us later. Once, however many readings follow.
 */
describe('a cold chain broken is told, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator = '';
  let receiver: Server;
  let origin = '';
  const landed: Array<{ path: string; event: string; raw: string }> = [];
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const H = 3_600_000;
  const iso = (ms: number) => new Date(ms).toISOString();

  beforeAll(async () => {
    receiver = createServer((req: IncomingMessage, res: ServerResponse) => {
      const chunks: Buffer[] = [];
      req.on('data', (c: Buffer) => chunks.push(c));
      req.on('end', () => {
        landed.push({ path: String(req.url), event: String(req.headers['x-sbg-event']), raw: Buffer.concat(chunks).toString() });
        res.writeHead(200);
        res.end();
      });
    });
    await new Promise<void>((r) => receiver.listen(0, '127.0.0.1', r));
    const a = receiver.address();
    origin = `http://127.0.0.1:${typeof a === 'object' && a ? a.port : 0}`;
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
    await new Promise<void>((r) => receiver.close(() => r()));
  });

  /** A shipper with its system's address given. */
  async function aShipper(): Promise<string> {
    const phone = `+2547${digits()}6`;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `cold-${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    const biz = (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `Highland Dairy ${digits()}`, country: 'KE', registrationNo: `COLD-${digits()}`, activities: ['shipper'], yourName: 'Owner' }).expect(201)).body.token.access_token as string;
    await http().put('/v1/sbg/business/me/system').set(bearer(biz)).send({ url: `${origin}/shipper` }).expect(200);
    return biz;
  }

  /** A fleet with its system's address given, and its office signed in. */
  async function aFleet(): Promise<{ did: string; office: string }> {
    const managers = app.get(FleetManagerService);
    const n = digits();
    const m = managers.register({
      companyName: `Baridi Haulage ${n}`, contactPhone: `+2548${n}4`, contactEmail: `baridi-${n}@example.com`, ownerFullName: 'O O', ownerNationalId: `MGR-CC-${n}`, location: { lat: -1.2, lng: 36.8 },
      requirements: { businessRegistrationNo: `BRN-CC-${n}`, transportOperatorLicence: `TOL-CC-${n}`, taxId: `TAX-CC-${n}` },
    });
    managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    const office = (await http().post('/v1/auth/token').send({ role: 'fleet_manager', did: m.did, tenant: m.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    await http().put(`/v1/sbg/fleet/managers/${encodeURIComponent(m.did)}/system`).set(bearer(office)).send({ url: `${origin}/fleet` }).expect(200);
    return { did: m.did, office };
  }

  async function aDriverOf(fleetDid?: string): Promise<{ did: string; token: string }> {
    const n = digits();
    const r = await http().post('/v1/sbg/drivers/onboard').set(bearer(operator)).send({ displayName: 'Chebet', fullName: 'Chebet Reefer', nationalId: `DRV-CC-${n}`, mobile: `+2547${n}3`, licenceClasses: ['truck'], licenceNumber: `DL-CC-${n}`, licenceExpiresAt: '2030-01-01', ...(fleetDid ? { managerDid: fleetDid } : {}) }).expect(201);
    const token = (await http().post('/v1/auth/token').send({ role: 'driver', did: r.body.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    return { did: r.body.did as string, token };
  }

  /** Chilled milk on the road with this driver since three hours ago. */
  async function chilledLoad(biz: string, driverDid: string): Promise<{ freightId: string; code: string }> {
    const posted = (await http().post('/v1/sbg/dispatch/freight').set(bearer(biz)).send({ description: 'Fresh milk, chilled', pickupLocation: { lat: -1.31, lng: 36.84 }, pickupLabel: 'Highland dairy', destLabel: 'Nakuru cold store', destLocation: { lat: -0.3, lng: 36.08 }, weightKg: 300, packaging: 'palletised', natureCode: 'FOP' }).expect(201)).body;
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    store.set(posted.freightId, { ...store.get(posted.freightId), status: 'in_transit', claimedBy: driverDid, claimedAt: iso(Date.now() - 4 * H), pickedUpAt: iso(Date.now() - 3 * H) });
    return { freightId: posted.freightId, code: posted.code };
  }
  const read = (freightId: string, driver: { did: string; token: string }, celsius: number, at?: number) =>
    http().post(`/v1/sbg/dispatch/freight/${freightId}/temperature`).set(bearer(driver.token)).send({ driverDid: driver.did, celsius, ...(at ? { observedAt: iso(at) } : {}) }).expect(201);
  const inbox = async (token: string) => ((await http().get('/v1/sbg/notifications/inbox').set(bearer(token)).expect(200)).body.items ?? []) as Array<{ kind: string; title: string; body: string }>;
  const drain = async () => {
    await app.get(BusinessHookService).drain();
    await app.get(FleetHookService).drain();
  };

  it('tells the shipper and the carrying fleet, in their inbox and on their system — when it was read, and that it came late — once', async () => {
    const biz = await aShipper();
    const fleet = await aFleet();
    const driver = await aDriverOf(fleet.did);
    const { freightId, code } = await chilledLoad(biz, driver.did);

    // In the band: nobody is told anything.
    await read(freightId, driver, 5, Date.now() - 150 * 60_000);
    await drain();
    expect(landed.filter((l) => l.event === 'load.cold_chain_broken')).toEqual([]);

    // Too warm two hours ago, read with no signal and sent now.
    const warm = Date.now() - 2 * H;
    await read(freightId, driver, 11.5, warm);
    // …and warmer still, a moment later: the chain was already broken, nobody is told twice.
    await read(freightId, driver, 13);
    await drain();
    const told = landed.filter((l) => l.event === 'load.cold_chain_broken');
    expect(told.map((l) => l.path).sort()).toEqual(['/fleet', '/shipper']);
    for (const l of told) {
      const reading = JSON.parse(l.raw).data.reading;
      expect(reading).toMatchObject({ celsius: 11.5, at: iso(warm), band: { minC: 2, maxC: 8 } });
      expect(Date.parse(reading.receivedAt)).toBeGreaterThan(Date.now() - 60_000);
    }
    // The shipper's load, as its Loads screen reads it, says so too.
    expect(JSON.parse(told.find((l) => l.path === '/shipper')!.raw).data.load.coldChainBroken).toMatchObject({ celsius: 11.5, at: iso(warm), minC: 2, maxC: 8 });
    const row = (await http().get('/v1/sbg/dispatch/posted').set(bearer(biz)).expect(200)).body.items.find((r: { freightId: string }) => r.freightId === freightId);
    expect(row.coldChainBroken).toMatchObject({ celsius: 11.5, at: iso(warm) });
    expect(row.coldChainBroken.receivedAt).toBeDefined();

    // Their inboxes: the reading, when, and that it may be different now. Never anybody's phone number in it.
    const when = `on ${new Date(warm).getUTCDate()} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][new Date(warm).getUTCMonth()]} at ${iso(warm).slice(11, 16)} UTC`;
    const shipperTold = (await inbox(biz)).filter((n) => n.title === `The cold chain on load ${code} was broken`);
    expect(shipperTold).toHaveLength(1);
    expect(shipperTold[0].body).toContain(`11.5 °C was read ${when}, outside the 2–8 °C it must be kept in. The driver read it with no signal, and it reached us`);
    const fleetTold = (await inbox(fleet.office)).filter((n) => n.title === `The cold chain on load ${code} was broken`);
    expect(fleetTold).toHaveLength(1);
    expect(fleetTold[0].body).toMatch(/The shipper has been told\. Call the driver to check the cooling unit\.$/);

    // A copy of the note is kept as it stood then, with the breach on it — the note the shipper opens.
    const note = (await http().get(`/v1/sbg/dispatch/freight/${freightId}/consignment-note`).set(bearer(biz)).expect(200)).body;
    expect((note.reservations as string[]).some((r) => r.startsWith('Cold chain breached in transit: 11.5 °C read'))).toBe(true);
    expect(app.get(NoteArchiveService).latestForFreight(freightId)).toMatchObject({ stage: 'cold_chain_broken', event: 'The cold chain was found broken on the road' });
  });

  it('tells nobody on the carrier’s side when the driver is their own carrier — they read it themselves', async () => {
    const biz = await aShipper();
    const driver = await aDriverOf();
    const { freightId, code } = await chilledLoad(biz, driver.did);
    await read(freightId, driver, 0.5);
    expect((await inbox(driver.token)).filter((n) => n.title === `The cold chain on load ${code} was broken`)).toEqual([]);
    expect((await inbox(biz)).filter((n) => n.title === `The cold chain on load ${code} was broken`)).toHaveLength(1);
  });
});
