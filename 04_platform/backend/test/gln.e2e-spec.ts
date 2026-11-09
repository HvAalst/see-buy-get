import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { gs1CheckDigit } from '../src/foundation/gs1/gs1';
import { AGREED } from './agreed';

/**
 * GLOBAL LOCATION NUMBERS, over the wire (2026-11-09, the owner: "build it"). A business gives its own GLN in its
 * details, an expeditor its client's on the client's record, and a company each of its places' on the place; staff change
 * none of it. A load to a receiving point carries the receiver's and the place's as they were when it was posted: the
 * consignment note prints the sender's, the consignee's and the place's, and each package label the ship-to as a GS1-128
 * barcode (AI 410) above its SSCC.
 */
describe('GLNs, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator = '';
  const tag = Math.random().toString(36).slice(2, 8);
  let seq = 0;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  /** A GLN nobody else in this run gives: GS1 Netherlands' 871, then random digits, then the check digit. */
  const aGln = () => {
    const body = `871${String(Math.floor(Math.random() * 1e9)).padStart(9, '0')}`;
    return `${body}${gs1CheckDigit(body)}`;
  };

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

  async function aPerson(): Promise<{ phone: string; token: string }> {
    seq += 1;
    const phone = `+2547${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `gln-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    return { phone, token: (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token };
  }
  async function aBusiness(name: string, activities: string[]): Promise<{ token: string; entityId: string; viewer: () => Promise<string> }> {
    const owner = await aPerson();
    const made = await http().post('/v1/sbg/business').set(bearer(owner.token)).send({ name: `${name} ${tag}`, country: 'KE', registrationNo: `GLN-${tag}-${seq}`, activities, yourName: 'Owner' }).expect(201);
    const token = made.body.token.access_token as string;
    const entityId = made.body.business.entityId as string;
    const viewer = async () => {
      const who = await aPerson();
      await http().post('/v1/sbg/business/me/members').set(bearer(token)).send({ phone: who.phone, name: `${name} viewer`, role: 'viewer' }).expect(201);
      const invite = (await http().get('/v1/sbg/business/mine').set(bearer(who.token)).expect(200)).body.items.find((i: { entityId: string }) => i.entityId === entityId);
      await http().post(`/v1/sbg/business/invitations/${invite.memberId}/accept`).set(bearer(who.token)).expect(201);
      return (await http().post(`/v1/sbg/business/${entityId}/session`).set(bearer(who.token)).expect(201)).body.token.access_token as string;
    };
    return { token, entityId, viewer };
  }
  const load = (extra: Record<string, unknown>) => ({ description: 'Cement, bagged', pickupLocation: { lat: -1.42, lng: 36.95 }, pickupLabel: 'Athi River works', destLabel: 'Mombasa Road yard', destLocation: { lat: -1.33, lng: 36.88 }, weightKg: 2000, packaging: 'bagged', packages: 2, pickupCountry: 'KE', destCountry: 'KE', ...extra });

  it('a business’s own GLN: checked, its own, staff change none of it', async () => {
    const mill = await aBusiness('Mlima Cement', ['shipper']);
    const rival = await aBusiness('Rival Cement', ['shipper']);
    const gln = aGln();
    const bad = `${gln.slice(0, 12)}${(Number(gln[12]) + 1) % 10}`;
    expect((await http().patch('/v1/sbg/business/me').set(bearer(mill.token)).send({ gln: bad }).expect(400)).body.detail).toMatch(/last digit does not match/);
    expect((await http().patch('/v1/sbg/business/me').set(bearer(mill.token)).send({ gln: '978123456789' + gs1CheckDigit('978123456789') }).expect(400)).body.detail).toMatch(/not a GLN/);
    expect((await http().patch('/v1/sbg/business/me').set(bearer(mill.token)).send({ gln: `${gln.slice(0, 4)} ${gln.slice(4)}` }).expect(200)).body.gln).toBe(gln);
    expect((await http().get('/v1/sbg/business/me').set(bearer(mill.token)).expect(200)).body.gln).toBe(gln);
    // Another business giving the same number is refused: two companies printing one number send goods to the wrong one.
    expect((await http().patch('/v1/sbg/business/me').set(bearer(rival.token)).send({ gln }).expect(409)).body.detail).toMatch(/Another business on SeeBuyGet gives GLN/);
    // A viewer, and staff, change none of it.
    await http().patch('/v1/sbg/business/me').set(bearer(await mill.viewer())).send({ gln: aGln() }).expect(403);
    await http().patch('/v1/sbg/business/me').set(bearer(operator)).send({ gln: aGln() }).expect(403);
    // Cleared: it has none, and the number is free again.
    expect((await http().patch('/v1/sbg/business/me').set(bearer(mill.token)).send({ gln: null }).expect(200)).body.gln).toBeUndefined();
    expect((await http().patch('/v1/sbg/business/me').set(bearer(rival.token)).send({ gln }).expect(200)).body.gln).toBe(gln);
  });

  it('a load to a receiving point: the note prints the three GLNs, the labels the ship-to as a barcode above the SSCC', async () => {
    const yard = await aBusiness('Jenga Builders', ['receiver']);
    const mill = await aBusiness('Simba Cement', ['shipper']);
    const yardGln = aGln();
    const placeGln = aGln();
    const millGln = aGln();
    await http().patch('/v1/sbg/business/me').set(bearer(yard.token)).send({ gln: yardGln }).expect(200);
    await http().patch('/v1/sbg/business/me').set(bearer(mill.token)).send({ gln: millGln }).expect(200);
    await http().post('/v1/sbg/business/me/gs1').set(bearer(mill.token)).send({ companyPrefix: `61${String(Math.floor(Math.random() * 90_000) + 10_000)}`, extensionDigit: 3 }).expect(201);
    const site = (await http().post(`/v1/sbg/entities/${yard.entityId}/sites`).set(bearer(yard.token)).send({ kind: 'delivery', name: 'Mombasa Road yard', location: { lat: -1.33, lng: 36.88 } }).expect(201)).body;
    const glnAt = `/v1/sbg/entities/${yard.entityId}/sites/${site.siteId}/gln`;
    // The place's GLN: the company's own to set — staff are refused by name; checked; one number one place.
    expect((await http().post(glnAt).set(bearer(operator)).send({ gln: placeGln }).expect(403)).body.detail).toMatch(/staff read them and change none/);
    await http().post(glnAt).set(bearer(yard.token)).send({ gln: '12345' }).expect(400);
    expect((await http().post(glnAt).set(bearer(yard.token)).send({ gln: placeGln }).expect(201)).body.gln).toBe(placeGln);
    const other = (await http().post(`/v1/sbg/entities/${yard.entityId}/sites`).set(bearer(yard.token)).send({ kind: 'delivery', name: 'Thika Road yard', location: { lat: -1.22, lng: 36.89 } }).expect(201)).body;
    expect((await http().post(`/v1/sbg/entities/${yard.entityId}/sites/${other.siteId}/gln`).set(bearer(yard.token)).send({ gln: placeGln }).expect(409)).body.detail).toMatch(/Mombasa Road yard.*already has GLN/);
    expect((await http().get(`/v1/sbg/entities/${yard.entityId}/sites`).set(bearer(yard.token)).expect(200)).body.sites.find((s: { siteId: string }) => s.siteId === site.siteId).gln).toBe(placeGln);
    const point = (await http().post(`/v1/sbg/business/me/receiving/${site.siteId}`).set(bearer(yard.token)).expect(201)).body;

    const posted = (await http().post('/v1/sbg/dispatch/freight').set(bearer(mill.token)).send(load({ receivingPoint: point.code, receiverRef: 'PO-1', maxSpend: 45000 })).expect(201)).body;
    // Changed after posting: the load keeps the numbers it was posted with.
    await http().post(glnAt).set(bearer(yard.token)).send({ gln: null }).expect(201);
    await http().patch('/v1/sbg/business/me').set(bearer(yard.token)).send({ gln: aGln() }).expect(200);
    const note = (await http().get(`/v1/sbg/dispatch/freight/${posted.freightId}/consignment-note`).set(bearer(mill.token)).expect(200)).body;
    expect(note.sender.gln).toBe(millGln);
    expect(note.consignee.gln).toBe(yardGln);
    expect(note.delivery.gln).toBe(placeGln);
    const noteHtml = (await http().get(`/v1/sbg/dispatch/freight/${posted.freightId}/consignment-note.html`).set(bearer(mill.token)).expect(200)).text;
    for (const g of [millGln, yardGln, placeGln]) expect(noteHtml).toContain(`GLN ${g}`);

    const labels = (await http().get(`/v1/sbg/dispatch/freight/${posted.freightId}/package-labels`).set(bearer(mill.token)).expect(200)).body;
    expect(labels).toMatchObject({ labels: 2, shipToGln: placeGln });
    expect(labels.codes).toHaveLength(2);
    const html = (await http().get(`/v1/sbg/dispatch/freight/${posted.freightId}/package-labels.html`).set(bearer(mill.token)).expect(200)).text;
    expect(html.match(/SHIP TO \(GLN\)/g)).toHaveLength(2);
    expect(html).toContain(`(410) ${placeGln}`);
    expect(html).toContain(`GLN ${millGln}`);
    expect(html).toContain(`GLN ${yardGln}`);
    expect(html).toContain(`(00) ${labels.codes[0]}`);
    const zpl = (await http().get(`/v1/sbg/dispatch/freight/${posted.freightId}/package-labels.zpl`).set(bearer(mill.token)).expect(200)).text;
    expect(zpl).toContain(`>;>8410${placeGln}`);
    expect(zpl).toContain(`>;>800${labels.codes[1]}`);
  });

  it('an expeditor’s client’s GLN is the sender’s on the loads sent for it; a load with no receiver GLN has no ship-to', async () => {
    const forwarder = await aBusiness('Swift Forwarders', ['shipper', 'expeditor']);
    await http().post('/v1/sbg/business/me/clients').set(bearer(forwarder.token)).send({ name: 'Unga Millers', country: 'KE', gln: '12' }).expect(400);
    const clientGln = aGln();
    const unga = (await http().post('/v1/sbg/business/me/clients').set(bearer(forwarder.token)).send({ name: 'Unga Millers', country: 'KE', gln: clientGln }).expect(201)).body;
    expect(unga.gln).toBe(clientGln);
    const posted = (await http().post('/v1/sbg/dispatch/freight').set(bearer(forwarder.token)).send(load({ forClientId: unga.clientId })).expect(201)).body;
    // Changed on the record afterwards: the load keeps the number it was made with.
    expect((await http().patch(`/v1/sbg/business/me/clients/${unga.clientId}`).set(bearer(forwarder.token)).send({ gln: '' }).expect(200)).body.gln).toBeUndefined();
    const note = (await http().get(`/v1/sbg/dispatch/freight/${posted.freightId}/consignment-note`).set(bearer(forwarder.token)).expect(200)).body;
    expect(note.sender).toMatchObject({ name: 'Unga Millers', gln: clientGln });
    expect(note.consignee.gln).toBeUndefined();
    const labels = (await http().get(`/v1/sbg/dispatch/freight/${posted.freightId}/package-labels`).set(bearer(forwarder.token)).expect(200)).body;
    expect(labels.shipToGln).toBeUndefined();
    const html = (await http().get(`/v1/sbg/dispatch/freight/${posted.freightId}/package-labels.html`).set(bearer(forwarder.token)).expect(200)).text;
    expect(html).not.toContain('SHIP TO');
    expect(html).toContain(`GLN ${clientGln}`);
  });
});
