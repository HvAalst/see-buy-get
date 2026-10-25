import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ssccOf } from '../src/foundation/gs1/gs1';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { AGREED } from './agreed';

/**
 * A LOAD FOUND BY WHAT WAS SCANNED, over the wire (round 19, the user: "A scan finds the load"; "Every scan box we
 * have"). A business's load with three packages under its GS1 prefix: the second package's barcode, as a handheld scanner
 * types it, finds the load and says which package; our label's QR and the typed code find it too — for the shipper, the
 * driver carrying it and staff. Anybody else reads the same as for a code that names nothing.
 */
describe('a load found by what was scanned, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let setupKey = '';
  const tag = Math.random().toString(36).slice(2, 8);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const P = `61${String(Math.floor(Math.random() * 90_000) + 10_000)}`;
  let seq = 0;

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

  async function aBusiness(name: string): Promise<string> {
    seq += 1;
    const phone = `+2547${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `find-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    return (await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `${name} ${tag}`, country: 'KE', registrationNo: `FIND-${tag}-${seq}`, activities: ['shipper'], yourName: 'Owner' }).expect(201)).body.token.access_token as string;
  }
  async function aDriver(name: string): Promise<string> {
    seq += 1;
    const u = `${tag}${seq}`;
    const r = await http().post('/v1/sbg/drivers/onboard').set(bearer(setupKey)).send({ displayName: name, fullName: `${name} Truck`, nationalId: `DRV-F-${u}`, mobile: `+2547${String(Date.now()).slice(-6)}${seq}`, licenceClasses: ['truck'], licenceNumber: `DL-F-${u}`, licenceExpiresAt: '2030-01-01' });
    if (r.status !== 201) throw new Error(JSON.stringify(r.body));
    return r.body.did as string;
  }
  const driverToken = async (did: string) => (await http().post('/v1/auth/token').send({ role: 'driver', did, type: 'client_credentials' }).expect(201)).body.access_token as string;
  const find = (token: string, scanned: string) => http().get('/v1/sbg/dispatch/find-load').query({ scanned }).set(bearer(token));

  it('finds the load and the package by its barcode, its label’s QR or its code — for those who may open it, and nobody else', async () => {
    const shipper = await aBusiness('Jenga Bricks');
    const rival = await aBusiness('Rival Bricks');
    await http().post('/v1/sbg/business/me/gs1').set(bearer(shipper)).send({ companyPrefix: P, extensionDigit: 4 }).expect(201);
    const posted = (
      await http()
        .post('/v1/sbg/dispatch/freight')
        .set(bearer(shipper))
        .send({ description: 'Clay bricks', pickupLocation: { lat: -1.33, lng: 36.87 }, pickupLabel: 'Jenga yard', destLabel: 'Nakuru depot', destLocation: { lat: -0.3, lng: 36.08 }, weightKg: 1200, packaging: 'palletised', packages: 3 })
        .expect(201)
    ).body;
    const codes = (await http().get(`/v1/sbg/dispatch/freight/${posted.freightId}/package-labels`).set(bearer(shipper)).expect(200)).body.codes as string[];
    expect(codes).toEqual([0, 1, 2].map((n) => ssccOf(P, 4, n)));
    const note = (await http().get(`/v1/sbg/dispatch/freight/${posted.freightId}/consignment-note`).set(bearer(shipper)).expect(200)).body;

    // The shipper: the second pallet's barcode as a handheld scanner types it — and the label's QR, and the code.
    expect((await find(shipper, `]C100${codes[1]}`).expect(200)).body).toEqual({ freightId: posted.freightId, code: posted.code, description: 'Clay bricks', pickupLabel: 'Jenga yard', destLabel: 'Nakuru depot', status: 'available', package: 2, packages: 3, sscc: codes[1] });
    expect((await find(shipper, note.trackingUrl).expect(200)).body).toMatchObject({ freightId: posted.freightId, code: posted.code });
    expect((await find(shipper, posted.code.toLowerCase()).expect(200)).body.package).toBeUndefined();

    // Staff open it; the driver carrying it does; another driver, another business, do not — and read what a code that
    // names nothing reads.
    await find(setupKey, `(00) ${codes[2]}`).expect(200);
    const carrier = await aDriver('Otieno');
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    store.set(posted.freightId, { ...store.get(posted.freightId), status: 'claimed', claimedBy: carrier, claimedAt: new Date().toISOString() });
    expect((await find(await driverToken(carrier), codes[0]).expect(200)).body).toMatchObject({ package: 1, status: 'claimed' });
    const nothing = (await find(rival, ssccOf(P, 4, 99)).expect(404)).body.detail;
    expect(nothing).toBe('No load you can open has that code');
    expect((await find(rival, codes[1]).expect(404)).body.detail).toBe(nothing);
    expect((await find(await driverToken(await aDriver('Kamau')), codes[1]).expect(404)).body.detail).toBe(nothing);
    expect((await find(rival, note.trackingUrl).expect(404)).body.detail).toBe(nothing);
    // A parcel's sticker is no load's code; nobody signed in is asked nothing.
    expect((await find(shipper, 'PUD-123456').expect(400)).body.detail).toMatch(/not a load’s code/);
    await http().get('/v1/sbg/dispatch/find-load').query({ scanned: codes[1] }).expect(401);
  });
});
