import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { HandleDirectory } from '../src/modules/pudo/handle-directory.service';
import { HandleService } from '../src/foundation/handle/handle.service';

/**
 * A PAGE NAME ONLY ONCE STAFF HAVE SAID YES — for a shop and a fleet too, as for a hub and a company (the owner,
 * 2026-10-30). A handle is never taken back, so one issued at sign-up let anybody sign a shop up as "DHL" and hold
 * @dhl for good before a paper was looked at. Through the booted application: signed up, papers sent, no address and
 * no page; approved, and the address is the one its name gives.
 */
describe('a shop and a fleet are given their page name only once approved, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  let staff: Record<string, string> = {};

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    staff = bearer((await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token);
  }, 60_000);

  afterAll(async () => {
    await app?.close();
  });

  /** The handle the sweep has given this participant, after the sweep ran — as every page read runs it. */
  const handleOf = (did: string) => (app.get(HandleDirectory).ensure(), app.get(HandleService).forId(did));
  /** A photograph uploaded by whoever holds `token`: its id. */
  const photo = async (token: Record<string, string>, kind: string, tag: string) =>
    (await http().post('/v1/sbg/media').set(token).send({ kind, dataUrl: `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${tag}:${digits()}`)]).toString('base64')}` }).expect(201)).body.mediaId as string;

  it('a shop: none while it waits for staff, and its own name once approved', async () => {
    const u = digits();
    const hours = { open: '08:00', close: '18:00' };
    const did = (
      await http()
        .post('/v1/sbg/agents')
        .set(staff)
        .send({
          shopName: `Duka Jina ${u}`, zone: `Jina${u}`, country: 'KE', location: { lat: -1.286, lng: 36.817 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
          openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: null },
          fullName: 'Neema Jina', nationalId: `ID-JINA-${u}`, mobile: `+2547${u}3`, deviceImei: `IMEI-JINA-${u}`,
          requirements: { androidVersion: 13, reliablePower: true, tradingLicence: `TL-${u}`, criminalRecordClear: true },
        })
        .expect(201)
    ).body.did as string;
    expect(handleOf(did)).toBeUndefined();
    await http().get(`/v1/sbg/profiles/duka-jina-${u}`).expect(404);

    const shop = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    await http()
      .post(`/v1/sbg/agents/${did}/submit-kyc`)
      .set(shop)
      .send({ idCopyRef: await photo(shop, 'kyc_id', did), tradingLicenceRef: await photo(shop, 'kyc_licence', did), shopPhotoRefs: [await photo(shop, 'shop', did)] })
      .expect(201);
    // Papers sent is not papers checked.
    expect(handleOf(did)).toBeUndefined();

    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(staff).send({ approve: true, licenceExpiresAt: '2099-12-31' }).expect(201);
    expect(handleOf(did)).toMatchObject({ handle: `duka-jina-${u}`, kind: 'shop', derivedFrom: `Duka Jina ${u}` });
    await http().get(`/v1/sbg/profiles/duka-jina-${u}`).expect(200);
  });

  it('a fleet: none while it waits for staff, and its own name once approved', async () => {
    const u = digits();
    const name = `Malori Jina ${u}`;
    const did = (
      await http()
        .post('/v1/sbg/fleet/managers')
        .set(staff)
        .send({ companyName: name, contactPhone: `+2547${u}4`, ownerFullName: 'Baraka Jina', ownerNationalId: `MGR-JINA-${u}`, location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-${u}`, transportOperatorLicence: `TOL-${u}`, taxId: `TAX-${u}` } })
        .expect(201)
    ).body.did as string;
    expect(handleOf(did)).toBeUndefined();

    await http()
      .post(`/v1/sbg/fleet/managers/${did}/submit-kyc`)
      .set(staff)
      .send({ businessRegCertRef: await photo(staff, 'kyc_registration', did), operatorLicenceRef: await photo(staff, 'kyc_licence', did), ownerIdRef: await photo(staff, 'kyc_id', did), proofOfAddressRef: await photo(staff, 'kyc_address', did) })
      .expect(201);
    expect(handleOf(did)).toBeUndefined();

    await http().post(`/v1/sbg/fleet/managers/${did}/kyc-decision`).set(staff).send({ approve: true, by: 'ops' }).expect(201);
    expect(handleOf(did)).toMatchObject({ handle: `malori-jina-${u}`, kind: 'fleet', derivedFrom: name });
  });
});
