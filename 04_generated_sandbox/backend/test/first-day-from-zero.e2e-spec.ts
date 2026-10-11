import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import { MAIL_SENDER, OutgoingMail } from '../src/foundation/mail/mail.types';
import { OutgoingSms, SMS_SENDER } from '../src/foundation/sms/sms.types';
import { totpCode, totpStep } from '../src/foundation/auth/totp';
import { pdfDataUrl } from '../src/foundation/entity/company.test-util';
import { HANDOVER_FEE, RELEASE_FEE, SHELVING_FEE, WHOLESALE } from '../src/modules/pudo/pudo.config';

/**
 * THE FIRST DAY OF A NEW INSTALLATION, AS IT WOULD BE LIVE — from an empty server to a parcel collected.
 *
 * The user, 2026-10-11: the first testing with real people runs on "a server, as it would be live". Such a server
 * starts with nothing on it, and nothing a laptop leans on is there: no code is handed back to whoever asked for it,
 * the client secret acts for nobody, and the seeder cannot run. So the only way in is the way a real first day goes.
 *
 * This walks that day under the live rules (GLOS_ENV=production, secrets of its own), with a sender standing where
 * the text provider's does and another where the mail provider's does: what they catch is what a phone and an inbox
 * would have received, and nothing else is used to get in anywhere. The steps run in order and each leans on the last.
 */
describe('the first day of a new installation, as it would be live', () => {
  const before = { ...process.env };
  const texts: OutgoingSms[] = [];
  const mails: OutgoingMail[] = [];
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const secret = () => randomBytes(32).toString('hex');
  const CLIENT_SECRET = secret();
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

  /** The answer, or a failure that says which call it was and what the server said: this file is read when it breaks. */
  const must = async (call: request.Test, status = 201): Promise<any> => {
    const r = await call;
    const asked = (r as unknown as { request: { method: string; url: string } }).request;
    if (r.status !== status) throw new Error(`${asked.method} ${asked.url.replace(/^https?:\/\/[^/]+/, '')} answered ${r.status}, wanted ${status}: ${JSON.stringify(r.body).slice(0, 500)}`);
    return r.body;
  };
  /** The newest mail to an address, by its template — what that person would find in their inbox. */
  const mailTo = (address: string, template: string) => [...mails].reverse().find((m) => m.to.address === address && m.template === template);
  /** The newest text to a number. */
  const textTo = (phone: string) => [...texts].reverse().find((t) => t.to === phone);

  beforeAll(async () => {
    Object.assign(process.env, {
      GLOS_ENV: 'production',
      GLOS_CLIENT_SECRET: CLIENT_SECRET,
      GLOS_AUTH_SECRET: secret(),
      GLOS_VAULT_KEY: secret(),
      GLOS_PHONE_PEPPER: secret(),
      GLOS_IDENTITY_PEPPER: secret(),
      GLOS_FUNDING_SECRET: secret(),
      GLOS_LABEL_KEY: secret(),
      GLOS_DISCLOSURE_KEY: secret(),
      SBG_CONSOLE_URL: 'https://console.rehearsal.example.org',
    });
    // Loaded only now: whatever the server reads from its environment as it starts, it reads as a live one.
    const { AppModule } = await import('../src/app.module');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(SMS_SENDER)
      .useValue({ send: async (sms: OutgoingSms) => void texts.push(sms) })
      .overrideProvider(MAIL_SENDER)
      .useValue({ send: async (mail: OutgoingMail) => void mails.push(mail) })
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
  });

  afterAll(async () => {
    await app?.close();
    process.env = { ...before };
  });

  /* ------------------------------------------------------------------ staff -- */

  /**
   * A member of staff signs in as a live server asks: the password, and then a code from the authenticator app they
   * set up at their first sign-in. What the app would show is worked out here from the same secret it was given.
   */
  const authenticator = new Map<string, string>();
  const staffSignIn = async (email: string, password: string): Promise<string> => {
    const login = (code?: string) => http().post('/v1/sbg/operators/login').send({ email, password, ...(code ? { code } : {}) });
    if (!authenticator.has(email)) {
      const first = await must(login());
      expect(first).not.toHaveProperty('token');
      authenticator.set(email, first.setup.secret as string);
    }
    return (await must(login(totpCode(authenticator.get(email)!, totpStep())))).token.access_token as string;
  };
  const AMINA = { email: 'amina@staff.sbg-rehearsal.org', name: 'Amina Otieno' };
  const BRIAN = { email: 'brian@staff.sbg-rehearsal.org', name: 'Brian Kamau' };
  let amina = '';
  let brian = '';

  it('1 · nobody is on staff: the setup key makes the first account and seconds the second, who gets in by a link sent to them', async () => {
    // An empty server: no country open, nobody able to sign up, one company — the group itself.
    const countries = await must(http().get('/v1/sbg/countries'), 200);
    expect(countries.filter((c: { joinable: boolean }) => c.joinable)).toEqual([]);

    const setupKey = (await must(http().post('/v1/auth/token').send({ role: 'operator', clientSecret: CLIENT_SECRET }))).access_token as string;
    const made = await must(http().post('/v1/sbg/operators').set(bearer(setupKey)).send(AMINA));
    amina = await staffSignIn(AMINA.email, made.temporaryPassword);
    expect((await must(http().get('/v1/sbg/entities').set(bearer(amina)), 200)).map((e: { kind: string }) => e.kind)).toEqual(['group']);

    // The second: asked for by the first, approved by the setup key (there is nobody else), and never shown a password.
    const asked = await must(http().post('/v1/sbg/operators/proposals').set(bearer(amina)).send(BRIAN));
    const invited = await must(http().post(`/v1/sbg/operators/proposals/${asked.proposalId}/approve`).set(bearer(setupKey)));
    expect(invited).toMatchObject({ email: BRIAN.email, sent: true });
    expect(invited).not.toHaveProperty('link');
    expect(invited).not.toHaveProperty('temporaryPassword');
    // What Brian finds in his inbox is the only way in.
    const letter = mailTo(BRIAN.email, 'staff-account-welcome');
    const token = JSON.stringify(letter).match(/#welcome=([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeTruthy();
    await must(http().post('/v1/sbg/operators/welcome').send({ token, password: 'brian-chose-this-himself-9' }));
    brian = await staffSignIn(BRIAN.email, 'brian-chose-this-himself-9');
    expect((await must(http().get('/v1/sbg/operators/me').set(bearer(brian)), 200)).email).toBe(BRIAN.email);
  });

  /* -------------------------------------------------------- the first country -- */

  let kenya = '';
  /** The Kenyan company's own administrator. */
  let wanjiru = '';

  it('2 · the company for Kenya: made as a draft, its record entered, and every paper checked by a second person', async () => {
    const draft = await must(http().post('/v1/sbg/entities').set(bearer(amina)).send({ kind: 'sister', jurisdiction: 'KE', name: 'SeeBuyGet Kenya' }));
    kenya = draft.entityId;
    expect(draft).toMatchObject({ status: 'draft', currency: 'KES' });

    const record = async () => (await must(http().get(`/v1/sbg/entities/${kenya}/record`).set(bearer(amina)), 200)) as { readiness: { ready: boolean; items: Array<{ key: string; met: boolean; label: string }> } };
    const missing = async () => (await record()).readiness.items.filter((i) => !i.met).map((i) => i.key);
    const obligations = (await missing()).filter((k) => k.startsWith('obligation:')).map((k) => k.slice('obligation:'.length));
    expect(obligations.length).toBeGreaterThan(0);

    await must(
      http()
        .post(`/v1/sbg/entities/${kenya}/record`)
        .set(bearer(amina))
        .send({
          legalName: 'SeeBuyGet Kenya Limited',
          legalForm: 'private_limited',
          registrationNumber: 'PVT-REHEARSAL-1',
          registeredAddress: { line1: '1 Kenyatta Avenue', city: 'Nairobi', country: 'KE' },
          representatives: [{ name: 'Grace Wanjiku', role: 'Managing director', signing: 'alone' }],
          beneficialOwners: [{ name: 'SeeBuyGet Group', sharePct: 100 }],
          taxRegistrations: [{ kind: 'vat', number: 'P051REHEARSAL' }],
          bankAccounts: [{ bankName: 'National Bank of Kenya', accountName: 'SeeBuyGet Kenya Limited', accountNumber: '0001', currency: 'KES', purpose: 'payouts' }],
          obligations: obligations.map((key) => ({ key, reference: `REF-${key}` })),
        }),
    );
    // What is left is paper: each one put on record by one person and verified by ANOTHER.
    const papers: Array<[string, string?]> = [['certificate_of_incorporation'], ['tax_registration_certificate'], ['bank_confirmation'], ...obligations.map((key): [string, string] => ['obligation_registration', key])];
    for (const [kind, relatesTo] of papers) {
      const put = await must(http().post(`/v1/sbg/entities/${kenya}/documents`).set(bearer(amina)).send({ kind, title: kind.replace(/_/g, ' '), ...(relatesTo ? { relatesTo } : {}), dataUrl: pdfDataUrl(`rehearsal:${kind}:${relatesTo ?? ''}`) }));
      // Not by the person who put it there.
      await must(http().post(`/v1/sbg/entities/${kenya}/documents/${put.documentId}/verify`).set(bearer(amina)).send({}), 403);
      await must(http().post(`/v1/sbg/entities/${kenya}/documents/${put.documentId}/verify`).set(bearer(brian)).send({}));
    }
    // What is left is the company's OWN to say, and staff cannot say it for them: where people come in person, and when.
    expect(await missing()).toEqual(['visitors_address', 'visiting_days']);
    const admin = await must(http().post(`/v1/sbg/entities/${kenya}/admins`).set(bearer(amina)).send({ email: 'wanjiru@kenya.sbg-rehearsal.org', name: 'Wanjiru Kamau' }));
    wanjiru = (await must(http().post('/v1/sbg/entities/admins/login').send({ email: 'wanjiru@kenya.sbg-rehearsal.org', password: admin.temporaryPassword ?? admin.password }))).token.access_token as string;
    await must(
      http()
        .post(`/v1/sbg/entities/${kenya}/contact`)
        .set(bearer(wanjiru))
        .send({ contactName: 'Front desk', phone: '+254700100200', address: '1 Kenyatta Avenue, Nairobi', visitDays: ['mon', 'tue', 'wed', 'thu', 'fri'], visitFrom: '09:00', visitTo: '16:00', visitorsPerHour: 6 }),
    );
    expect(await missing()).toEqual([]);
    expect((await record()).readiness.ready).toBe(true);
  });

  it('3 · Kenya is switched on: asked for by one member of staff, approved by another — and only then can anybody join there', async () => {
    const asked = await must(http().post('/v1/sbg/presence/KE').set(bearer(amina)).send({ level: 'established', note: 'The company is ready' }));
    const proposals = (await must(http().get('/v1/sbg/presence/proposals').set(bearer(brian)), 200)).items as Array<{ proposalId: string; jurisdiction: string }>;
    const proposal = proposals.find((p) => p.jurisdiction === 'KE')!;
    expect(proposal).toBeTruthy();
    expect(asked).toBeTruthy();
    // Not yet: asking changes nothing.
    expect((await must(http().get('/v1/sbg/presence/KE').set(bearer(amina)), 200)).level).toBe('observed');
    await must(http().post(`/v1/sbg/presence/proposals/${proposal.proposalId}/approve`).set(bearer(amina)).send({}), 403);
    await must(http().post(`/v1/sbg/presence/proposals/${proposal.proposalId}/approve`).set(bearer(brian)).send({}));

    const now = await must(http().get('/v1/sbg/presence/KE').set(bearer(amina)), 200);
    expect(now).toMatchObject({ level: 'established', capabilities: { takeIn: true, holdFloat: true } });
    const countries = await must(http().get('/v1/sbg/countries'), 200);
    expect(countries.find((c: { country: string }) => c.country === 'KE')).toMatchObject({ joinable: true, settles: true, currency: 'KES' });
    // And a code may now be texted there: the list of countries a text goes to is the list of countries switched on.
    expect((await must(http().get('/v1/sbg/connections').set(bearer(amina)), 200)).sms).toMatchObject({ sends: true, countries: ['KE +254'] });
    expect(texts).toEqual([]);
  });

  /* ------------------------------------------------------------------ shops -- */

  /** A photograph, as a phone's camera hands it over: a real picture file, different for each label. */
  const shot = (label: string) => `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(label)]).toString('base64')}`;
  /** Somebody takes a picture in their app: it is uploaded as theirs, and what comes back is its id. */
  const photograph = async (token: string, kind: string, label: string) => (await must(http().post('/v1/sbg/media').set(bearer(token)).send({ kind, dataUrl: shot(label) }))).mediaId as string;
  /** The code a text carries: its first six digits, as the person reads them off their phone. */
  const codeIn = (sms: OutgoingSms | undefined) => sms?.body.match(/^(\d{6}) /)?.[1] ?? '';
  const HOURS = Object.fromEntries(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'].map((d) => [d, { open: '07:30', close: '20:30' }]));
  interface Shop {
    did: string;
    token: string;
    phone: string;
  }
  /**
   * A shop joins the way a shopkeeper does: a code texted to their phone, then the form. Nothing hands the code back —
   * it is read off the text, as on a counter in Nairobi.
   */
  const joinAsShop = async (shopName: string, zone: string, phone: string, at: { lat: number; lng: number }): Promise<Shop> => {
    const asked = await must(http().post('/v1/sbg/auth/phone/request').send({ phone }));
    expect(asked).toEqual({ sent: true });
    await must(http().post('/v1/sbg/auth/phone/verify').send({ phone, code: codeIn(textTo(phone)) }));
    const slug = shopName.toLowerCase().replace(/[^a-z]+/g, '-');
    const account = await must(
      http()
        .post('/v1/sbg/auth/signup')
        .send({
          role: 'pudo',
          email: `${slug}@shops.sbg-rehearsal.org`,
          password: `${slug}-keeps-this-to-itself-7`,
          phone,
          profile: {
            agent: {
              shopName,
              fullName: `${shopName} Keeper`,
              nationalId: `KE-ID-${slug}`,
              mobile: phone,
              deviceImei: `IMEI-${slug}`,
              zone,
              landmark: 'Next to the market',
              location: at,
              pricePerParcel: 1.5,
              shelf: { rows: 4, cols: 5 },
              openingHours: HOURS,
              requirements: { androidVersion: 13, reliablePower: true, tradingLicence: `TL-${slug}`, criminalRecordClear: true },
            },
          },
        }),
    );
    return { did: account.did, token: account.token.access_token, phone };
  };
  let mamaSarah: Shop;
  let riverside: Shop;
  /** The first shop's ID photograph: the second shop tries to send it as its own. */
  let papersOfTheFirst = '';

  it('4 · two shops join by a code texted to the shopkeeper’s phone, send their papers, and are approved by staff', async () => {
    mamaSarah = await joinAsShop('Mama Sarah Shop', 'Nairobi CBD', '+254711000101', { lat: -1.2864, lng: 36.8172 });
    riverside = await joinAsShop('Riverside Corner', 'Westlands', '+254711000102', { lat: -1.2676, lng: 36.8108 });
    expect(texts.map((t) => t.to)).toEqual(['+254711000101', '+254711000102']);

    for (const shop of [mamaSarah, riverside]) {
      const own = `/v1/sbg/agents/${encodeURIComponent(shop.did)}`;
      expect((await must(http().get(own).set(bearer(shop.token)), 200)).status).toBe('DRAFT');
      // Nothing for staff to look at yet: a shop that has sent no papers is not in their queue.
      expect((await must(http().get('/v1/sbg/agents/kyc-queue').set(bearer(amina)), 200)).map((a: { did: string }) => a.did)).not.toContain(shop.did);
      // ITS PAPERS ARE PHOTOGRAPHS IT TOOK. A file name with nothing behind it is not a paper…
      const refusedName = await http().post(`${own}/submit-kyc`).set(bearer(shop.token)).send({ idCopyRef: 'id.jpg', tradingLicenceRef: 'licence.jpg', shopPhotoRefs: ['shop-front.jpg'] });
      expect([refusedName.status, refusedName.body.code]).toEqual([400, 'PHOTO_REQUIRED']);
      const [idCopyRef, tradingLicenceRef, shopFront] = [await photograph(shop.token, 'kyc_id', `id of ${shop.did}`), await photograph(shop.token, 'kyc_licence', `licence of ${shop.did}`), await photograph(shop.token, 'shop', `front of ${shop.did}`)];
      // …nor is a photograph somebody else took.
      if (shop === riverside) {
        const borrowed = await http().post(`${own}/submit-kyc`).set(bearer(shop.token)).send({ idCopyRef: papersOfTheFirst, tradingLicenceRef, shopPhotoRefs: [shopFront] });
        expect([borrowed.status, borrowed.body.code]).toEqual([400, 'PHOTO_REQUIRED']);
      } else {
        papersOfTheFirst = idCopyRef;
      }
      // EACH of the three, not the first only: a good ID does not carry a licence or a shop front that is only a name.
      for (const papers of [
        { idCopyRef, tradingLicenceRef: 'licence.jpg', shopPhotoRefs: [shopFront] },
        { idCopyRef, tradingLicenceRef, shopPhotoRefs: ['shop-front.jpg'] },
        { idCopyRef, tradingLicenceRef, shopPhotoRefs: [shopFront, 'another-angle.jpg'] },
      ]) {
        const refused = await http().post(`${own}/submit-kyc`).set(bearer(shop.token)).send(papers);
        expect([refused.status, refused.body.code]).toEqual([400, 'PHOTO_REQUIRED']);
      }
      expect((await must(http().get(own).set(bearer(shop.token)), 200)).status).toBe('DRAFT');
      expect((await must(http().post(`${own}/submit-kyc`).set(bearer(shop.token)).send({ idCopyRef, tradingLicenceRef, shopPhotoRefs: [shopFront] }))).status).toBe('KYC_PENDING');
      // Staff find it in their queue, with pictures they can open.
      const queued = (await must(http().get('/v1/sbg/agents/kyc-queue').set(bearer(amina)), 200)).find((a: { did: string }) => a.did === shop.did);
      expect(queued.kyc).toMatchObject({ idCopyRef, tradingLicenceRef, shopPhotoRefs: [shopFront] });
      await must(http().get(`/v1/sbg/media/${idCopyRef}`).set(bearer(amina)), 200);
      // Sent once: a second sending is refused, not queued twice — and it is told THAT, whatever it sends this time.
      for (const again of [{ idCopyRef, tradingLicenceRef, shopPhotoRefs: [shopFront] }, { idCopyRef: 'id.jpg', tradingLicenceRef: 'licence.jpg', shopPhotoRefs: ['shop-front.jpg'] }]) {
        const second = await http().post(`${own}/submit-kyc`).set(bearer(shop.token)).send(again);
        expect([second.status, second.body.code]).toEqual([400, 'INVALID_STATE']);
      }
      // A shop cannot approve itself.
      await must(http().post(`${own}/kyc-decision`).set(bearer(shop.token)).send({ approve: true }), 403);
      await must(http().post(`${own}/kyc-decision`).set(bearer(amina)).send({ approve: true }));
      await must(http().post(`${own}/deposit`).set(bearer(amina)));
      // Approved, and still not able to take a parcel in: there is no money in its float.
      expect(await must(http().get(`${own}/can-transact`).set(bearer(shop.token)), 200)).toMatchObject({ canTransact: false, code: 'AGENT_LOCKED', balance: 0 });
    }
  });

  it('5 · a shop pays in: it asks, pays outside the system, and a member of staff confirms the line they see on the statement', async () => {
    for (const shop of [mamaSarah, riverside]) {
      const own = `/v1/sbg/agents/${encodeURIComponent(shop.did)}`;
      const asked = await must(http().post(`${own}/top-up`).set(bearer(shop.token)).send({ amount: 60 }));
      expect(asked).toMatchObject({ fundingId: expect.any(String), reference: expect.any(String), currency: 'KES' });
      // Asking moves nothing.
      expect((await must(http().get(`${own}/can-transact`).set(bearer(shop.token)), 200)).balance).toBe(0);
      // Nobody stands in for a payment provider on a live server…
      await must(http().post(`/v1/rails/funding/${asked.fundingId}/simulate`).set(bearer(amina)).send({ providerRef: 'MPX-PRETEND', amount: 60 }), 404);
      // …and the shop cannot confirm its own payment.
      await must(http().post(`/v1/rails/funding/${asked.fundingId}/confirm`).set(bearer(shop.token)).send({ providerRef: 'STMT-1', amount: 60 }), 403);
      await must(http().post(`/v1/rails/funding/${asked.fundingId}/confirm`).set(bearer(amina)).send({ providerRef: `STMT-${asked.reference}`, amount: 60 }));
      expect(await must(http().get(`${own}/can-transact`).set(bearer(shop.token)), 200)).toMatchObject({ canTransact: true, balance: 60 });
    }
    // On the Kenyan company's books, as what it was: a statement line, and who read it.
    const paidIn = (await must(http().get(`/v1/rails/funding?entityId=${kenya}`).set(bearer(amina)), 200)).items as Array<{ status: string; provider: string; currency: string; payerName: string }>;
    expect(paidIn.map((p) => [p.payerName, p.status, p.provider, p.currency]).sort()).toEqual([
      ['Mama Sarah Shop', 'confirmed', 'statement', 'KES'],
      ['Riverside Corner', 'confirmed', 'statement', 'KES'],
    ]);
  });

  /* ------------------------------------------------------------ the carrier -- */

  /** The code a mail carries, as its subject line says it. */
  const codeMailedTo = (address: string) => mailTo(address, 'email-code')?.subject.match(/^(\d{6}) /)?.[1] ?? '';
  /**
   * A person makes their sign-in: their phone confirmed by a texted code, a recovery email confirmed by a mailed one,
   * and a PIN — which then belongs to the device they did it on. What comes back is that device's key.
   */
  const enrol = async (phone: string, email: string, pin: string): Promise<string> => {
    await must(http().post('/v1/sbg/auth/phone/request').send({ phone }));
    await must(http().post('/v1/sbg/auth/phone/verify').send({ phone, code: codeIn(textTo(phone)) }));
    await must(http().post('/v1/sbg/identity/email/request').send({ email }));
    const enrolled = await must(http().post('/v1/sbg/identity/enroll').send({ phone, pin, email, emailCode: codeMailedTo(email) }));
    expect(enrolled.device).toBeTruthy();
    return enrolled.device as string;
  };
  let fleetDid = '';
  let office = '';
  let amos: { did: string; token: string; badgeId?: string };
  let vehicleId = '';

  it('6 · a fleet is set up by staff: one member registers it and puts its papers on record, ANOTHER approves; then its office signs in', async () => {
    const phone = '+254711000201';
    const settingUp = async (token: string, did: string) => ((await must(http().get('/v1/sbg/fleet/managers/setting-up').set(bearer(token)), 200)).items as Array<Record<string, any>>).find((f) => f.did === did)!;
    const registered = await must(
      http()
        .post('/v1/sbg/fleet/managers')
        .set(bearer(amina))
        .send({ companyName: 'Kilima Logistics', contactPhone: phone, ownerFullName: 'Kilima Owner', ownerNationalId: 'KE-ID-KILIMA', depotAddress: 'Enterprise Road depot, Nairobi', requirements: { businessRegistrationNo: 'BR-KILIMA', transportOperatorLicence: 'TOL-KILIMA', taxId: 'TAX-KILIMA' } }),
    );
    fleetDid = registered.did;
    const own = `/v1/sbg/fleet/managers/${encodeURIComponent(fleetDid)}`;
    expect(await settingUp(amina, fleetDid)).toMatchObject({ companyName: 'Kilima Logistics', status: 'DRAFT' });
    expect(await settingUp(amina, fleetDid)).not.toHaveProperty('papers');

    // ITS PAPERS ARE PICTURES, put on record by the member of staff setting it up. A file name is not a paper…
    const names = await http().post(`${own}/submit-kyc`).set(bearer(amina)).send({ businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'tol.pdf', ownerIdRef: 'id.jpg', proofOfAddressRef: 'poa.pdf' });
    expect([names.status, names.body.code]).toEqual([400, 'PHOTO_REQUIRED']);
    const scan = async (token: string, kind: string) => photograph(token, kind, `${kind} of Kilima`);
    const papers = { businessRegCertRef: await scan(amina, 'kyc_registration'), operatorLicenceRef: await scan(amina, 'kyc_licence'), ownerIdRef: await scan(amina, 'kyc_id'), proofOfAddressRef: await scan(amina, 'kyc_address') };
    // …and neither is a picture a colleague uploaded: whoever puts them on record answers for all four.
    const mixed = await http().post(`${own}/submit-kyc`).set(bearer(amina)).send({ ...papers, proofOfAddressRef: await scan(brian, 'kyc_address') });
    expect([mixed.status, mixed.body.code]).toEqual([400, 'PHOTO_REQUIRED']);
    // EACH of the four is held to it: three real pictures do not carry a fourth that is only a name.
    for (const key of ['businessRegCertRef', 'operatorLicenceRef', 'ownerIdRef', 'proofOfAddressRef']) {
      const one = await http().post(`${own}/submit-kyc`).set(bearer(amina)).send({ ...papers, [key]: 'scan.pdf' });
      expect([key, one.status, one.body.code]).toEqual([key, 400, 'PHOTO_REQUIRED']);
    }
    expect(await settingUp(amina, fleetDid)).toMatchObject({ status: 'DRAFT' });
    expect((await must(http().post(`${own}/submit-kyc`).set(bearer(amina)).send(papers))).status).toBe('KYC_PENDING');

    // TWO PEOPLE. Amina put them on record, so Amina is not the one to approve them — and each is told which they are.
    expect((await settingUp(amina, fleetDid)).papers).toMatchObject({ ...papers, enteredBy: AMINA.name, enteredByMe: true });
    expect((await settingUp(brian, fleetDid)).papers).toMatchObject({ enteredBy: AMINA.name, enteredByMe: false });
    const self = await http().post(`${own}/kyc-decision`).set(bearer(amina)).send({ approve: true });
    expect([self.status, self.body.detail]).toEqual([403, 'You put these papers on record — a different person must approve them']);
    // The pictures open for the colleague who has to look at them.
    await must(http().get(`/v1/sbg/media/${papers.operatorLicenceRef}`).set(bearer(brian)), 200);

    // A refusal says why, and sends it back to be put right.
    const silent = await http().post(`${own}/kyc-decision`).set(bearer(brian)).send({ approve: false });
    expect([silent.status, silent.body.code]).toEqual([400, 'REASON_REQUIRED']);
    await must(http().post(`${own}/kyc-decision`).set(bearer(brian)).send({ approve: false, reason: 'The operator’s licence is last year’s' }));
    expect(await settingUp(amina, fleetDid)).toMatchObject({ status: 'DRAFT', refused: { reason: 'The operator’s licence is last year’s', by: BRIAN.name } });
    expect(await settingUp(amina, fleetDid)).not.toHaveProperty('papers');
    // Put on record again — by Brian this time, so now it is Amina who approves.
    const again = { businessRegCertRef: await scan(brian, 'kyc_registration'), operatorLicenceRef: await scan(brian, 'kyc_licence'), ownerIdRef: await scan(brian, 'kyc_id'), proofOfAddressRef: await scan(brian, 'kyc_address') };
    await must(http().post(`${own}/submit-kyc`).set(bearer(brian)).send(again));
    expect(await settingUp(brian, fleetDid)).not.toHaveProperty('refused');
    await must(http().post(`${own}/kyc-decision`).set(bearer(brian)).send({ approve: true }), 403);
    expect((await must(http().post(`${own}/kyc-decision`).set(bearer(amina)).send({ approve: true }))).status).toBe('APPROVED');

    // Its bond is recorded, and only then is it active and has a code — which staff read here and pass on.
    expect(await settingUp(amina, fleetDid)).not.toHaveProperty('loginCode');
    await must(http().post(`${own}/bond`).set(bearer(amina)).send({}));
    const code = (await settingUp(brian, fleetDid)).loginCode as string;
    expect(code).toMatch(/^FM-/);
    expect(await settingUp(brian, fleetDid)).toMatchObject({ status: 'ACTIVE' });
    // Nobody but staff reads that list.
    await must(http().get('/v1/sbg/fleet/managers/setting-up').set(bearer(mamaSarah.token)), 403);

    // The code names the fleet and admits nobody: the person signs in, with a PIN that lives on their own device.
    const device = await enrol(phone, 'office@kilima.sbg-rehearsal.org', '24689');
    await must(http().post('/v1/sbg/fleet/managers/session').send({ code, phone, pin: '24689' }), 403);
    const session = await must(http().post('/v1/sbg/fleet/managers/session').send({ code, phone, pin: '24689', device }));
    office = session.token.access_token as string;
    expect((await must(http().get('/v1/sbg/fleet/dashboard').set(bearer(office)), 200)).managerDid).toBe(fleetDid);
  });

  it('7 · a vehicle, a driver who signs in for themselves and starts their own shift, and the corridor they run', async () => {
    const vehicle = await must(http().post('/v1/sbg/vehicles').set(bearer(office)).send({ plate: 'KMFA 001B', vehicleClass: 'bike', ownerName: 'Kilima Logistics', ownerType: 'fleet_owned', pricePerKm: 0.5 }));
    vehicleId = vehicle.vehicleId;
    const phone = '+254711000301';
    const driver = await must(http().post('/v1/sbg/drivers/onboard').set(bearer(office)).send({ displayName: 'Amos K.', fullName: 'Amos Kariuki', nationalId: 'KE-ID-AMOS', mobile: phone, licenceClasses: ['bike'], managerDid: fleetDid }));
    expect(driver).toMatchObject({ status: 'ACTIVE', managerDid: fleetDid, badgeId: expect.stringMatching(/^DRV-/) });

    const device = await enrol(phone, 'amos@drivers.sbg-rehearsal.org', '13570');
    const session = await must(http().post('/v1/sbg/drivers/session').send({ phone, pin: '13570', device }));
    amos = { did: driver.did, token: session.token.access_token, badgeId: driver.badgeId };
    const own = `/v1/sbg/fleet/drivers/${encodeURIComponent(amos.did)}`;
    // The office says which vehicle; it cannot start the shift. The driver does, with their PIN.
    await must(http().post(`${own}/start-session`).set(bearer(office)).send({ vehicleId }), 403);
    expect(await must(http().post(`${own}/start-session`).set(bearer(amos.token)).send({ vehicleId, pin: '13570' }))).toMatchObject({ status: 'active', driverDid: amos.did, vehicleId });

    const corridor = await must(http().post('/v1/sbg/corridors').set(bearer(amina)).send({ name: 'Nairobi CBD → Westlands', originZone: 'Nairobi CBD', destZone: 'Westlands' }));
    await must(http().post(`${own}/assign-corridor`).set(bearer(office)).send({ corridorId: corridor.corridorId }));
    expect(await must(http().get(`${own}/session`).set(bearer(amos.token)), 200)).toMatchObject({ active: true, assignment: { corridorId: corridor.corridorId, vehicleId } });
  });

  /* ------------------------------------------------------- the first parcel -- */

  it('8 · the first parcel: taken in at one shop, handed to the driver, arrived at the other, and collected with the code', async () => {
    const sender = '+254722000001';
    const receiver = '+254722000002';
    const sent = texts.length;
    const taken = await must(
      http().post('/v1/sbg/parcels/accept').set(bearer(mamaSarah.token)).send({ agentDid: mamaSarah.did, parcelId: 'QR-FIRST-0001', size: 'M', destZone: 'Westlands', senderMobile: sender, receiverMobile: receiver, dropoffPhotoRef: 'dropoff.jpg' }),
    );
    expect(taken).toMatchObject({ parcelId: 'QR-FIRST-0001', originZone: 'Nairobi CBD', destZone: 'Westlands', collectingEntityId: kenya, takeInPromise: 'ours' });
    // The code that will release it is given to the SENDER, at the counter, and to nobody else.
    const code = taken.otp as string;
    expect(code).toMatch(/^\d{4,8}$/);

    const handed = await must(http().post('/v1/sbg/parcels/handover').set(bearer(mamaSarah.token)).send({ agentDid: mamaSarah.did, driverBadgeId: amos.badgeId, parcelIds: ['QR-FIRST-0001'] }));
    expect(handed).toMatchObject({ driverDid: amos.did, handed: ['QR-FIRST-0001'], rejected: [], shortShipped: false });
    expect(await must(http().post('/v1/sbg/parcels/QR-FIRST-0001/arrive').set(bearer(riverside.token)).send({ destAgentDid: riverside.did }))).toMatchObject({ status: 'Ready_For_Pickup', binSlot: expect.any(String) });

    // The shop holding it never learns the code: what it reads back carries none.
    const held = await must(http().get('/v1/sbg/parcels/QR-FIRST-0001').set(bearer(riverside.token)), 200);
    expect(JSON.stringify(held)).not.toContain(code);
    // A wrong code leaves it on the shelf; the right one hands it over.
    const wrong = code === '0000' ? '1111' : '0000';
    const refused = await http().post('/v1/sbg/parcels/QR-FIRST-0001/pickup').set(bearer(riverside.token)).send({ agentDid: riverside.did, otp: wrong, deliveredPhotoRef: 'handed.jpg' });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect((await must(http().get('/v1/sbg/parcels/QR-FIRST-0001').set(bearer(riverside.token)), 200)).status).toBe('Ready_For_Pickup');
    // Not by another shop, even with the right code in hand: it is on Riverside's shelf.
    const elsewhere = await http().post('/v1/sbg/parcels/QR-FIRST-0001/pickup').set(bearer(mamaSarah.token)).send({ agentDid: mamaSarah.did, otp: code, deliveredPhotoRef: 'handed.jpg' });
    expect([elsewhere.status, elsewhere.body.code]).toEqual([403, 'WRONG_PUDO']);
    await must(http().post('/v1/sbg/parcels/QR-FIRST-0001/pickup').set(bearer(riverside.token)).send({ agentDid: riverside.did, otp: code, deliveredPhotoRef: 'handed.jpg' }));
    expect((await must(http().get('/v1/sbg/parcels/QR-FIRST-0001').set(bearer(riverside.token)), 200)).status).toBe('Delivered');

    // NOBODY WAS TEXTED about the parcel: on a live server a text carries a sign-in code and nothing else. A receiver
    // hears that it arrived only through the app, if they hold it — and learns the code from the sender.
    expect(texts.slice(sent)).toEqual([]);
  });

  it('9 · what the day left behind: each shop was paid for what it did, and the Kenyan company’s books balance to the shilling', async () => {
    const cents = (n: number) => Math.round(n * 100) / 100;
    const float = async (shop: Shop) => (await must(http().get(`/v1/sbg/agents/${encodeURIComponent(shop.did)}/can-transact`).set(bearer(shop.token)), 200)).balance as number;
    // The shop that took it in paid for the journey out of its float and was paid for handing the batch to the driver.
    expect(await float(mamaSarah)).toBe(cents(60 - WHOLESALE + HANDOVER_FEE));
    // The shop that received it was paid for shelving it, and again for handing it over.
    expect(await float(riverside)).toBe(cents(60 + SHELVING_FEE + RELEASE_FEE));

    const books = await must(http().get(`/v1/sbg/entities/${kenya}/books`).set(bearer(amina)), 200);
    const account = (code: string) => (books.accounts as Array<{ code: string; balance: number; currency: string }>).filter((a) => a.code === code);
    expect(books.integrity).toEqual({ balanced: true, drift: 0 });
    expect(books.accounts.every((a: { currency: string }) => a.currency === 'KES')).toBe(true);
    // Held: the two payments in. Owed back: the two floats. Earned: the journey. Paid out: the three steps of work.
    expect(account('cash.custody').map((a) => a.balance)).toEqual([120]);
    expect(cents(-account('deposit.agent').reduce((sum, a) => sum + a.balance, 0))).toBe(cents((await float(mamaSarah)) + (await float(riverside))));
    expect(account('revenue').map((a) => cents(-a.balance))).toEqual([WHOLESALE]);
    expect(account('expense.provider_fees').map((a) => cents(a.balance))).toEqual([cents(HANDOVER_FEE + SHELVING_FEE + RELEASE_FEE)]);
  });
});
