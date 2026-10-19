import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { ssccOf } from '../src/foundation/gs1/gs1';

/**
 * A GS1 PREFIX TWO BUSINESSES SAY IS THEIRS, over the wire (round 18, the user: "Refuse the same digit"; "Only when
 * disputed"). Two real businesses, a real photograph of a licence, two named members of staff: the refusal and its code,
 * a group sharing a prefix under its own digit, the dispute opened and answered, decided by two different people — and
 * what the decision does to who prints what, the numbers already printed included.
 */
describe('a GS1 prefix disputed, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let setupKey = '';
  const tag = Math.random().toString(36).slice(2, 8);
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const P = `61${String(Math.floor(Math.random() * 90_000) + 10_000)}`; // a 7-digit prefix of this run's own
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

  async function aPerson(): Promise<{ phone: string; token: string }> {
    seq += 1;
    const phone = `+2547${String(Math.floor(Math.random() * 9_000_000) + 1_000_000)}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `gs1-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    return { phone, token: (await http().post('/v1/sbg/identity/enroll').send({ phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token };
  }
  let lastEntityId = '';
  async function aBusiness(name: string): Promise<string> {
    const person = await aPerson();
    const made = await http().post('/v1/sbg/business').set(bearer(person.token)).send({ name: `${name} ${tag}`, country: 'KE', registrationNo: `GS1-${tag}-${seq}`, activities: ['shipper'], yourName: 'Owner' }).expect(201);
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
  async function aStaff(name: string): Promise<string> {
    const made = await http().post('/v1/sbg/operators').set(bearer(setupKey)).send({ email: `${name}-${tag}@sbg.test`, name: `${name} ${tag}` }).expect(201);
    return (await http().post('/v1/sbg/operators/login').send({ email: made.body.email, password: made.body.temporaryPassword }).expect(201)).body.token.access_token;
  }
  const licence = async (token: string) => {
    seq += 1;
    const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`gs1:${tag}:${seq}`)]).toString('base64')}`;
    return (await http().post('/v1/sbg/media').set(bearer(token)).send({ kind: 'gs1_licence', dataUrl }).expect(201)).body.mediaId as string;
  };
  const postLoad = async (token: string, packages: number) => {
    const posted = await http()
      .post('/v1/sbg/dispatch/freight')
      .set(bearer(token))
      .send({ description: 'Soap, bagged', pickupLocation: { lat: -1.3, lng: 36.85 }, pickupLabel: 'Industrial Area', destLabel: 'Nakuru depot', destLocation: { lat: -0.3, lng: 36.08 }, weightKg: 400, packaging: 'bagged', packages })
      .expect(201);
    return (await http().get(`/v1/sbg/dispatch/freight/${posted.body.freightId}/package-labels`).set(bearer(token)).expect(200)).body.codes as string[];
  };

  it('refused the same digit, shared under its own — disputed with a licence, decided by two staff, and the prefix moves without a number printed twice', async () => {
    const acme = await aBusiness('Acme Traders');
    const sub = await aBusiness('Acme Kisumu');
    const genuine = await aBusiness('Genuine Goods');
    const genuineBooker = await aBooker(genuine, lastEntityId);
    const amina = await aStaff('amina-gs1');
    const brian = await aStaff('brian-gs1');

    await http().post('/v1/sbg/business/me/gs1').set(bearer(acme)).send({ companyPrefix: P, extensionDigit: 4 }).expect(201);
    expect(await postLoad(acme, 2)).toEqual([ssccOf(P, 4, 0), ssccOf(P, 4, 1)]);
    // A group's company shares the prefix under its own digit; the same digit is refused, with a code the app reads.
    await http().post('/v1/sbg/business/me/gs1').set(bearer(sub)).send({ companyPrefix: P, extensionDigit: 5 }).expect(201);
    const refused = await http().post('/v1/sbg/business/me/gs1').set(bearer(genuine)).send({ companyPrefix: P, extensionDigit: 4 }).expect(409);
    expect(refused.body).toMatchObject({ code: 'GS1_PREFIX_TAKEN' });

    // Staff never open one; a licence that is not the business's own is refused.
    const genuineLicence = await licence(genuine);
    expect((await http().post('/v1/sbg/business/me/gs1/disputes').set(bearer(setupKey)).send({ companyPrefix: P, extensionDigit: 4, licenceRef: genuineLicence }).expect(403)).body.detail).toMatch(/never open one/);
    await http().post('/v1/sbg/business/me/gs1/disputes').set(bearer(genuine)).send({ companyPrefix: P, extensionDigit: 4, licenceRef: await licence(acme) }).expect(400);
    // Its booker may post loads, not say whose a prefix is: an owner does.
    expect((await http().post('/v1/sbg/business/me/gs1/disputes').set(bearer(genuineBooker)).send({ companyPrefix: P, extensionDigit: 4, licenceRef: await licence(genuineBooker) }).expect(403)).body.detail).toMatch(/Only an owner/);
    const opened = (await http().post('/v1/sbg/business/me/gs1/disputes').set(bearer(genuine)).send({ companyPrefix: P, extensionDigit: 4, licenceRef: genuineLicence, note: 'GS1 Kenya, 2019' }).expect(201)).body;
    expect(opened).toMatchObject({ side: 'claimant', state: 'open', licenceSent: true });
    expect(opened.holderNames.sort()).toEqual([`Acme Kisumu ${tag}`, `Acme Traders ${tag}`]);

    // Both businesses using it read it, and are told in their bell.
    expect((await http().get('/v1/sbg/business/me/gs1/disputes').set(bearer(acme)).expect(200)).body.items).toEqual([expect.objectContaining({ side: 'holder', claimantName: `Genuine Goods ${tag}`, licenceSent: false })]);
    expect(JSON.stringify((await http().get('/v1/sbg/notifications/inbox').set(bearer(sub)).expect(200)).body)).toContain(`Another business says the GS1 prefix ${P} is its own`);

    // Staff wait for the licences; staff read both sides' pictures, another business cannot.
    const row = async (as: string) => ((await http().get('/v1/sbg/gs1-disputes').set(bearer(as)).expect(200)).body.items as Array<{ disputeId: string; mayDecide: boolean }>).find((d) => d.disputeId === opened.disputeId)!;
    expect((await row(amina)).mayDecide).toBe(false);
    await http().post(`/v1/sbg/gs1-disputes/${opened.disputeId}/propose`).set(bearer(amina)).send({ to: 'claimant', what: 'x', reason: 'y' }).expect(400);
    await http().get('/v1/sbg/gs1-disputes').set(bearer(acme)).expect(403);
    await http().post(`/v1/sbg/business/me/gs1/disputes/${opened.disputeId}/licence`).set(bearer(acme)).send({ licenceRef: await licence(acme) }).expect(200);
    await http().post(`/v1/sbg/business/me/gs1/disputes/${opened.disputeId}/licence`).set(bearer(sub)).send({ licenceRef: await licence(sub), note: 'Licensed through the parent' }).expect(200);
    expect((await row(amina)).mayDecide).toBe(true);
    await http().get(`/v1/sbg/media/${genuineLicence}`).set(bearer(amina)).expect(200);
    expect((await http().get(`/v1/sbg/media/${genuineLicence}`).set(bearer(acme))).status).toBeGreaterThanOrEqual(403);

    // One says whose it is; that one cannot approve; another does.
    await http().post(`/v1/sbg/gs1-disputes/${opened.disputeId}/propose`).set(bearer(amina)).send({ to: 'claimant', what: 'GS1 Kenya register: the prefix is licensed to Genuine Goods', reason: 'The GS1 licence for this prefix is in Genuine Goods’ name' }).expect(200);
    expect((await http().post(`/v1/sbg/gs1-disputes/${opened.disputeId}/approve`).set(bearer(amina)).send({}).expect(409)).body.detail).toMatch(/A second member of staff has to approve/);
    expect((await http().post(`/v1/sbg/gs1-disputes/${opened.disputeId}/approve`).set(bearer(brian)).send({}).expect(200)).body).toMatchObject({ state: 'decided', decided: { to: 'claimant' } });

    // The prefix moved: both Acme companies stop printing under it, Genuine prints past every number printed there.
    expect((await http().get('/v1/sbg/business/me').set(bearer(acme)).expect(200)).body.gs1).toBeUndefined();
    expect((await http().get('/v1/sbg/business/me').set(bearer(sub)).expect(200)).body.gs1).toBeUndefined();
    expect((await http().get('/v1/sbg/business/me').set(bearer(genuine)).expect(200)).body.gs1).toMatchObject({ companyPrefix: P, extensionDigit: 4 });
    expect(await postLoad(genuine, 1)).toEqual([ssccOf(P, 4, 2)]);
    expect((await http().post('/v1/sbg/business/me/gs1').set(bearer(acme)).send({ companyPrefix: P, extensionDigit: 7 }).expect(409)).body.detail).toMatch(/SeeBuyGet staff decided/);
    expect((await http().get('/v1/sbg/business/me/gs1/disputes').set(bearer(acme)).expect(200)).body.items[0]).toMatchObject({ state: 'decided', decided: { mine: false, reason: 'The GS1 licence for this prefix is in Genuine Goods’ name' } });
    expect(JSON.stringify((await http().get('/v1/sbg/notifications/inbox').set(bearer(genuine)).expect(200)).body)).toContain(`The GS1 prefix ${P} is yours`);
  });
});
