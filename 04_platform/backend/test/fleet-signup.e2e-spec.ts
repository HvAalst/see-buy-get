import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AGREED } from './agreed';

/**
 * A FLEET SIGNS ITSELF UP, AND STAFF CHECK IT — over the wire (the user, 2026-10-23: "the fleet app register is
 * impossible. It gives a help page while it should give a clear sign up form that can be checked by sbg staff").
 *
 * The person who runs the fleet signs in as themselves (a code to the phone, a PIN, a recovery email), fills in what a
 * member of staff would have typed into the console, and sends the four papers. It waits where the console looks; one
 * member of staff may approve papers the fleet sent itself; a refusal goes back to the fleet, by email and on the front
 * page, and the fleet sends them again; the bond makes it active, and the same phone and PIN open the Fleet app.
 */
describe('a fleet signs itself up, and staff check it, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: Record<string, string> = {};
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const tag = Math.random().toString(36).slice(2, 8);
  let seq = 0;

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

  /** A person through the ordinary phone door: a code to the phone, a PIN, a confirmed recovery email. */
  async function aPerson(): Promise<{ phone: string; auth: Record<string, string>; device: string }> {
    seq += 1;
    const phone = `+2547${digits()}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `fleet-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const enrolled = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body;
    return { phone, auth: bearer(enrolled.token.access_token as string), device: enrolled.device as string };
  }
  /** A photograph uploaded by whoever holds `auth`: its id. */
  const photo = async (auth: Record<string, string>, kind: string) =>
    (await http().post('/v1/sbg/media').set(auth).send({ kind, dataUrl: `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${tag}:${digits()}`)]).toString('base64')}` }).expect(201)).body.mediaId as string;
  const fourPapers = async (auth: Record<string, string>) => ({
    businessRegCertRef: await photo(auth, 'kyc_registration'),
    operatorLicenceRef: await photo(auth, 'kyc_licence'),
    ownerIdRef: await photo(auth, 'kyc_id'),
    proofOfAddressRef: await photo(auth, 'kyc_address'),
  });
  const mails = async (to: string) => ((await http().get('/v1/mail/outbox').query({ to }).expect(200)).body.items as Array<{ template: string; subject: string; text: string }>).filter((m) => m.template === 'fleet-signup');

  it('signs up with its papers, waits for staff, is sent back with the reason, sends them again, and opens the Fleet app once active', async () => {
    const owner = await aPerson();
    const stranger = await aPerson();
    const u = digits();
    const contactEmail = `office-${tag}-${u}@kilima.example`;
    const papers = await fourPapers(owner.auth);
    const body = {
      phone: owner.phone,
      companyName: `Kilima ${u} Logistics`,
      jurisdiction: 'ke',
      contactEmail,
      ownerFullName: 'Wanjiru Kilima',
      ownerNationalId: `ID-${u}`,
      depotAddress: 'Enterprise Road, Nairobi',
      location: { lat: -1.3, lng: 36.85 },
      requirements: { businessRegistrationNo: `BR-${u}`, transportOperatorLicence: `TOL-${u}`, taxId: `P0${u}` },
      papers,
    };
    const signUp = (auth: Record<string, string> | null, b: Record<string, unknown>) => (auth ? http().post('/v1/sbg/fleet/signups').set(auth) : http().post('/v1/sbg/fleet/signups')).send(b);
    const mine = async (auth: Record<string, string>) => (await http().get('/v1/sbg/fleet/signups/mine').set(auth).expect(200)).body.items as Array<Record<string, unknown>>;

    // Signed in as themselves, and nobody else: not signed in, not staff, not with somebody else's number.
    await signUp(null, body).expect(401);
    await signUp(operator, body).expect(403);
    expect((await signUp(owner.auth, { ...body, phone: stranger.phone }).expect(403)).body.detail).toMatch(/phone number you signed in with/);
    // Each paper a photograph of its own that this person took.
    const notTheirs = await photo(stranger.auth, 'kyc_id');
    expect((await signUp(owner.auth, { ...body, papers: { ...papers, ownerIdRef: notTheirs } })).body.code).toBe('PHOTO_REQUIRED');
    expect((await signUp(owner.auth, { ...body, papers: { ...papers, ownerIdRef: papers.businessRegCertRef } })).body.code).toBe('PHOTO_REQUIRED');
    // The record's own checks, before anything is written.
    expect((await signUp(owner.auth, { ...body, requirements: { ...body.requirements, taxId: ' ' } })).body.code).toBe('REQUIREMENTS_NOT_MET');
    expect((await signUp(owner.auth, { ...body, contactEmail: 'not-an-address' })).body.code).toBe('EMAIL_INVALID');
    expect(await mine(owner.auth)).toEqual([]);

    // Signed up: its papers are with SeeBuyGet, and the company is told at the address it gave.
    const signed = (await signUp(owner.auth, body).expect(201)).body;
    expect(signed).toEqual({ did: expect.any(String), companyName: body.companyName, status: 'KYC_PENDING', createdAt: expect.any(String), papersSentAt: expect.any(String) });
    expect(await mine(owner.auth)).toEqual([signed]);
    expect(await mine(stranger.auth)).toEqual([]);
    expect((await mails(contactEmail)).map((m) => m.subject)).toEqual([`We have the papers for ${body.companyName}`]);
    // The same company again is refused, by the same check the console's form meets.
    const again = { ...body, companyName: 'Another name', papers: await fourPapers(owner.auth) };
    expect((await signUp(owner.auth, again)).body.code).toBe('DUPLICATE');

    // Staff see it where they set fleets up: signed up by itself, its papers entered by no member of staff.
    const row = async () => ((await http().get('/v1/sbg/fleet/managers/setting-up').set(operator).expect(200)).body.items as Array<Record<string, unknown>>).find((r) => r.did === signed.did)!;
    expect(await row()).toMatchObject({ companyName: body.companyName, jurisdiction: 'KE', status: 'KYC_PENDING', signedUpAt: expect.any(String), papers: { ...papers, enteredByMe: false } });
    expect(((await row()).papers as Record<string, unknown>).enteredBy).toBeUndefined();
    await http().get(`/v1/sbg/media/${papers.operatorLicenceRef}`).set(operator).expect(200);

    // The Fleet app names it to its person, and does not open it yet.
    const listed = (await http().post('/v1/sbg/fleet/managers/mine').send({ phone: owner.phone, pin: '48261', device: owner.device }).expect(201)).body.fleets;
    expect(listed).toEqual([{ did: signed.did, companyName: body.companyName, status: 'KYC_PENDING' }]);
    expect((await http().post('/v1/sbg/fleet/managers/session').send({ did: signed.did, phone: owner.phone, pin: '48261', device: owner.device })).body.code).toBe('AUTH_NOT_ACTIVE');
    // Nor by the other door: switching roles from the person's own sign-in handed out a manager's token here.
    const switchToFleet = () => http().post('/v1/sbg/identity/switch').set(owner.auth).send({ role: 'fleet_manager' });
    expect((await switchToFleet()).body).toMatchObject({ code: 'AUTH_NOT_ACTIVE' });

    // Papers already with SeeBuyGet are not sent twice.
    const sendAgain = (auth: Record<string, string>, b: Record<string, unknown>) => http().post(`/v1/sbg/fleet/signups/${signed.did}/papers`).set(auth).send(b);
    expect((await sendAgain(owner.auth, await fourPapers(owner.auth))).body.detail).toMatch(/with SeeBuyGet already/);

    // Sent back, with the reason: the fleet reads it on the front page and in its email.
    const decide = (b: Record<string, unknown>) => http().post(`/v1/sbg/fleet/managers/${signed.did}/kyc-decision`).set(operator).send(b);
    await decide({ approve: false, reason: 'The operator’s licence in the photo ran out in March' }).expect(201);
    expect(await mine(owner.auth)).toEqual([{ did: signed.did, companyName: body.companyName, status: 'DRAFT', createdAt: signed.createdAt, refused: { reason: 'The operator’s licence in the photo ran out in March', at: expect.any(String) } }]);
    const refusedMail = (await mails(contactEmail)).find((m) => m.subject.startsWith('Something to put right'));
    expect(refusedMail?.text).toContain('The operator’s licence in the photo ran out in March');
    expect(refusedMail?.text).toContain('?join=fleet');

    // Only its own person sends them again — and only the paper that was wrong needs taking again: the other three are
    // this fleet's already. Somebody else's photograph is still not one of them.
    await sendAgain(stranger.auth, await fourPapers(stranger.auth)).expect(404);
    expect((await sendAgain(owner.auth, { ...papers, operatorLicenceRef: await photo(stranger.auth, 'kyc_licence') })).body.code).toBe('PHOTO_REQUIRED');
    const second = { ...papers, operatorLicenceRef: await photo(owner.auth, 'kyc_licence') };
    expect((await sendAgain(owner.auth, second).expect(201)).body).toMatchObject({ status: 'KYC_PENDING', papersSentAt: expect.any(String) });
    expect((await row()).papers).toMatchObject(second);
    expect((await mine(owner.auth))[0].refused).toBeUndefined();

    // One member of staff approves papers the fleet sent itself; the bond makes it active; each step is told.
    expect((await decide({ approve: true }).expect(201)).body.status).toBe('APPROVED');
    expect((await http().post(`/v1/sbg/fleet/managers/${signed.did}/bond`).set(operator).expect(201)).body.status).toBe('ACTIVE');
    expect((await mails(contactEmail)).map((m) => m.subject).reverse()).toEqual([ // the outbox reads newest first
      `We have the papers for ${body.companyName}`,
      `Something to put right for ${body.companyName}`,
      `The papers for ${body.companyName} are approved`,
      `${body.companyName} is active on SeeBuyGet`,
    ]);

    // And the same phone and PIN open the Fleet app, on the fleet it signed up.
    const session = (await http().post('/v1/sbg/fleet/managers/session').send({ did: signed.did, phone: owner.phone, pin: '48261', device: owner.device }).expect(201)).body;
    expect(session).toMatchObject({ did: signed.did, status: 'ACTIVE', token: { access_token: expect.any(String) } });
    expect((await http().get(`/v1/sbg/fleet/managers/${signed.did}`).set(bearer(session.token.access_token)).expect(200)).body.companyName).toBe(body.companyName);
    // …and, active now, the switch opens it too.
    expect((await switchToFleet().expect(201)).body).toMatchObject({ role: 'fleet_manager', entityDid: signed.did, token: { access_token: expect.any(String) } });
  });

  it('a person without a PIN cannot sign a fleet up: the Fleet app would not open for them', async () => {
    const phone = `+2547${digits()}9`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const auth = bearer((await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone }).expect(201)).body.token.access_token);
    const refused = await http().post('/v1/sbg/fleet/signups').set(auth).send({
      phone,
      companyName: 'No PIN Haulage',
      jurisdiction: 'KE',
      contactEmail: 'office@nopin.example',
      ownerFullName: 'A Person',
      ownerNationalId: 'ID-0',
      depotAddress: 'Somewhere',
      requirements: { businessRegistrationNo: 'BR-NOPIN', transportOperatorLicence: 'TOL-NOPIN', taxId: 'TAX-NOPIN' },
      papers: await fourPapers(auth),
    });
    expect([refused.body.code, refused.body.detail]).toEqual(['INVALID_STATE', 'Choose your PIN first: it is how you open the Fleet app']);
  });
});
