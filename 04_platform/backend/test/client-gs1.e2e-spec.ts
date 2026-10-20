import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ssccOf } from '../src/foundation/gs1/gs1';

/**
 * A FORWARDER'S CLIENT'S OWN GS1 PREFIX, over the wire (round 20, the user: "A client's own GS1 prefix"; "The forwarder, on
 * the client's record"). The forwarder enters it on its client's record; a load it posts for the client is coded under
 * it, its own loads are not; round 18's rules hold for it — and staff set none of it.
 */
describe('a forwarder’s client’s GS1 prefix, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator = '';
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
    const email = `cgs1-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    return { phone, token: (await http().post('/v1/sbg/identity/enroll').send({ phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token };
  }
  let lastEntityId = '';
  async function aBusiness(name: string, activities: string[]): Promise<string> {
    const person = await aPerson();
    const made = await http().post('/v1/sbg/business').set(bearer(person.token)).send({ name: `${name} ${tag}`, country: 'KE', registrationNo: `CGS1-${tag}-${seq}`, activities, yourName: 'Owner' }).expect(201);
    lastEntityId = made.body.business.entityId;
    return made.body.token.access_token as string;
  }
  /** One of the business's people who may book loads but is not an owner. */
  async function aBooker(ownerBiz: string, entityId: string): Promise<string> {
    const who = await aPerson();
    await http().post('/v1/sbg/business/me/members').set(bearer(ownerBiz)).send({ phone: who.phone, name: 'Bekele Booker', role: 'booker' }).expect(201);
    const invite = (await http().get('/v1/sbg/business/mine').set(bearer(who.token)).expect(200)).body.items.find((i: { entityId: string }) => i.entityId === entityId);
    await http().post(`/v1/sbg/business/invitations/${invite.memberId}/accept`).set(bearer(who.token)).expect(201);
    return (await http().post(`/v1/sbg/business/${entityId}/session`).set(bearer(who.token)).expect(201)).body.token.access_token as string;
  }
  const post = async (token: string, forClientId?: string) => {
    const posted = await http()
      .post('/v1/sbg/dispatch/freight')
      .set(bearer(token))
      .send({ description: 'Maize flour, bagged', pickupLocation: { lat: -1.31, lng: 36.84 }, pickupLabel: 'Unga mill', destLabel: 'Kisumu depot', destLocation: { lat: -0.1, lng: 34.76 }, weightKg: 180, packaging: 'bagged', packages: 2, ...(forClientId ? { forClientId } : {}) })
      .expect(201);
    return (await http().get(`/v1/sbg/dispatch/freight/${posted.body.freightId}/package-labels`).set(bearer(token)).expect(200)).body.codes as string[];
  };

  it('codes a client’s loads under the prefix on its record — never the forwarder’s own — under round 18’s rules', async () => {
    const forwarder = await aBusiness('Swift Forwarders', ['shipper', 'expeditor']);
    const booker = await aBooker(forwarder, lastEntityId);
    const rival = await aBusiness('Rival Millers', ['shipper']);
    const unga = (await http().post('/v1/sbg/business/me/clients').set(bearer(forwarder)).send({ name: 'Unga Millers', country: 'KE' }).expect(201)).body;
    const at = `/v1/sbg/business/me/clients/${unga.clientId}/gs1`;

    // Staff set none of it; another business's client is not this forwarder's to code.
    expect((await http().post(at).set(bearer(operator)).send({ companyPrefix: P, extensionDigit: 4 }).expect(403)).body.detail).toMatch(/change none of it/);
    await http().post(at).set(bearer(rival)).send({ companyPrefix: P, extensionDigit: 4 }).expect(404);
    // Its booker posts for the client; an owner says whose barcode its packages carry.
    expect((await http().post(at).set(bearer(booker)).send({ companyPrefix: P, extensionDigit: 4 }).expect(403)).body.detail).toMatch(/Only an owner/);
    expect((await http().post(at).set(bearer(forwarder)).send({ companyPrefix: P, extensionDigit: 4 }).expect(201)).body).toMatchObject({ clientId: unga.clientId, gs1: { companyPrefix: P, extensionDigit: 4, left: 1_000_000_000, setBy: 'Owner' } });
    expect((await http().get('/v1/sbg/business/me/clients').set(bearer(forwarder)).expect(200)).body.items).toEqual([expect.objectContaining({ name: 'Unga Millers', gs1: expect.objectContaining({ companyPrefix: P }) })]);

    // A load for the client carries the client's codes; the forwarder's own load carries none — it holds no prefix.
    expect(await post(forwarder, unga.clientId)).toEqual([ssccOf(P, 4, 0), ssccOf(P, 4, 1)]);
    expect(await post(forwarder)).toEqual([]);

    // Round 18 holds: the client's digit is refused to another business; numbers carry on past those printed.
    expect((await http().post('/v1/sbg/business/me/gs1').set(bearer(rival)).send({ companyPrefix: P, extensionDigit: 4 }).expect(409)).body).toMatchObject({ code: 'GS1_PREFIX_TAKEN' });
    await http().delete(at).set(bearer(forwarder)).expect(200);
    expect((await http().get('/v1/sbg/business/me/clients').set(bearer(forwarder)).expect(200)).body.items[0].gs1).toBeUndefined();
    await http().post('/v1/sbg/business/me/gs1').set(bearer(rival)).send({ companyPrefix: P, extensionDigit: 4 }).expect(201);
    expect(await post(rival)).toEqual([ssccOf(P, 4, 2), ssccOf(P, 4, 3)]);
  });
});
