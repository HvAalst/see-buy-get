import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { gsinOf, isGsin } from '../src/foundation/gs1/gs1';
import { AGREED } from './agreed';

/**
 * THE SHIPMENT'S GSIN, over the wire (2026-11-09, the owner: "go ahead with gsin"). A load posted by a business with a GS1
 * company prefix gets one Global Shipment Identification Number under that prefix and the digit it set aside — the next
 * each time — whether or not its packages were counted. It is on the load's labels and its consignment note, and a
 * scan of it finds the load; a business without a prefix gets none.
 */
describe('the GSIN, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const tag = Math.random().toString(36).slice(2, 8);
  let seq = 0;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const P = `61${String(Math.floor(Math.random() * 90_000) + 10_000)}`;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
  });

  async function aBusiness(name: string): Promise<string> {
    seq += 1;
    const phone = `+2547${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `gsin-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token;
    const made = await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `${name} ${tag}`, country: 'KE', registrationNo: `GSIN-${tag}-${seq}`, activities: ['shipper'], yourName: 'Owner' }).expect(201);
    return made.body.token.access_token as string;
  }
  const post = async (token: string, packages?: number) =>
    (await http().post('/v1/sbg/dispatch/freight').set(bearer(token)).send({ description: 'Maize flour, bagged', pickupLocation: { lat: -1.31, lng: 36.84 }, pickupLabel: 'Unga mill', destLabel: 'Kisumu depot', destLocation: { lat: -0.1, lng: 34.76 }, weightKg: 180, packaging: 'bagged', ...(packages ? { packages } : {}) }).expect(201)).body.freightId as string;

  it('one GSIN a load under the shipper’s prefix: on its labels and its note, found by a scan of it', async () => {
    const mill = await aBusiness('Unga Millers');
    await http().post('/v1/sbg/business/me/gs1').set(bearer(mill)).send({ companyPrefix: P, extensionDigit: 8 }).expect(201);
    const first = await post(mill, 2);
    const labels = (await http().get(`/v1/sbg/dispatch/freight/${first}/package-labels`).set(bearer(mill)).expect(200)).body;
    expect(isGsin(labels.gsin)).toBe(true);
    expect(labels.gsin).toBe(gsinOf(P, 8, 0));
    expect(labels.codes).toHaveLength(2);
    const html = (await http().get(`/v1/sbg/dispatch/freight/${first}/package-labels.html`).set(bearer(mill)).expect(200)).text;
    expect(html.split(`GSIN (402) ${labels.gsin}`)).toHaveLength(3); // on both labels
    const note = (await http().get(`/v1/sbg/dispatch/freight/${first}/consignment-note`).set(bearer(mill)).expect(200)).body;
    expect(note.gsin).toBe(labels.gsin);
    expect((await http().get(`/v1/sbg/dispatch/freight/${first}/consignment-note.html`).set(bearer(mill)).expect(200)).text).toContain(`Shipment GSIN (402) ${labels.gsin}`);
    // A scan of it — as a scanner hands it over, or typed — finds the load.
    for (const scanned of [`]C1402${labels.gsin}`, `(402) ${labels.gsin}`, labels.gsin]) {
      expect((await http().get('/v1/sbg/dispatch/find-load').query({ scanned }).set(bearer(mill)).expect(200)).body.freightId).toBe(first);
    }
    // The next load the next number — packages counted or not.
    const second = await post(mill);
    const again = (await http().get(`/v1/sbg/dispatch/freight/${second}/package-labels`).set(bearer(mill)).expect(200)).body;
    expect(again).toMatchObject({ gsin: gsinOf(P, 8, 1), codes: [] });
    expect((await http().get(`/v1/sbg/dispatch/freight/${second}/package-labels.html`).set(bearer(mill)).expect(200)).text).toContain('SHIPMENT (GSIN)');
    // Another business can neither open the load by it nor learn it exists.
    const stranger = await aBusiness('Someone Else');
    await http().get('/v1/sbg/dispatch/find-load').query({ scanned: labels.gsin }).set(bearer(stranger)).expect(404);
    // A business without a prefix: no GSIN anywhere.
    const plain = await post(stranger, 1);
    expect((await http().get(`/v1/sbg/dispatch/freight/${plain}/package-labels`).set(bearer(stranger)).expect(200)).body.gsin).toBeUndefined();
    expect((await http().get(`/v1/sbg/dispatch/freight/${plain}/consignment-note`).set(bearer(stranger)).expect(200)).body.gsin).toBeUndefined();
  });
});
