import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CONTENTS_PNG } from './content-photo';

/**
 * EVERY PHOTO IS ONE WE HOLD, over the wire (round 31, the user: "Every photo is one we hold"; "Every party's evidence").
 * What a claim or a dispute is read against — the counter's take-in, hand-over, problem and void photos here — was taken
 * as any text: a name, another shop's photo, the same photo twice. Now each is refused by name, before anything is
 * written, unless it is a photo we hold that the shop took, of that one thing.
 */
describe('every evidence photo is one we hold, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let staff: Record<string, string>;
  const tag = Math.random().toString(36).slice(2, 8);
  const north = `PhN-${tag}`;
  const south = `PhS-${tag}`;
  let origin = '';
  let dest = '';
  let elsewhere = '';
  let badge = '';
  let northShop: Record<string, string> = {};

  const hours = { open: '00:00', close: '23:59' };
  const asShop = async (did: string) => ({ authorization: `Bearer ${(await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token}` });
  const upload = async (who: Record<string, string>, kind: string) => (await http().post('/v1/sbg/media').set(who).send({ kind, dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
  const onboard = async (shopName: string, zone: string): Promise<string> => {
    const u = Math.random().toString(16).slice(2, 10);
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(staff)
      .send({ shopName, zone, location: { lat: -1.2, lng: 36.8 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 }, openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: hours }, fullName: `${shopName} owner`, nationalId: `ID-PH-${u}`, mobile: `+2547${u.replace(/\D/g, '').padEnd(8, '1').slice(0, 8)}`, deviceImei: `IMEI-PH-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } })
      .expect(201);
    const did = reg.body.did as string;
    const shop = await asShop(did);
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(shop).send({ idCopyRef: await upload(shop, 'kyc_id'), tradingLicenceRef: await upload(shop, 'kyc_licence'), shopPhotoRefs: [await upload(shop, 'shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(staff).send({ approve: true }).expect(201);
    const asked = await http().post(`/v1/sbg/agents/${did}/top-up`).set(staff).send({ amount: 50 }).expect(201);
    await http().post(`/v1/rails/funding/${asked.body.fundingId}/simulate`).set(staff).send({ providerRef: `MPX${u}`, amount: 50 }).expect(201);
    return did;
  };
  /** A walk-up taken in at the north shop, for the south one. */
  const take = (parcelId: string, dropoffPhotoRef: string) =>
    http().post('/v1/sbg/parcels/accept').set(northShop).send({ agentDid: origin, parcelId, size: 'S', destZone: south, destPudoDid: dest, senderMobile: '+254700000011', receiverMobile: '+254700000012', dropoffPhotoRef });
  const status = async (parcelId: string) => (await http().get(`/v1/sbg/parcels/${parcelId}`).set(staff)).body.status as string | undefined;
  const refusedForThePhoto = (r: { body: { code?: string; detail?: string } }) => expect(r.body).toMatchObject({ code: 'PHOTO_REQUIRED', detail: expect.stringMatching(/^We do not hold that photo/) });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    staff = { authorization: `Bearer ${(await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token}` };
    origin = await onboard(`Ph North ${tag}`, north);
    northShop = await asShop(origin);
    dest = await onboard(`Ph South ${tag}`, south);
    elsewhere = await onboard(`Ph Else ${tag}`, north);
    const corridor = await http().post('/v1/sbg/corridors').set(staff).send({ name: `PhN-PhS ${tag}`, originZone: north, destZone: south }).expect(201);
    badge = (await http().post('/v1/sbg/drivers').set(staff).send({ driverDid: `did:glos:phbus-${tag}`, name: 'John', corridorId: corridor.body.corridorId }).expect(201)).body.badgeId;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('takes a parcel in only on the shop’s own photo, of that parcel alone — refused before anything is written', async () => {
    const id = `PH-T1-${tag}`;
    // A name; another shop's photo; a photo still held on a phone with no signal, sent as it was: none is a photo we hold.
    for (const ref of ['IMG_0001.jpg', await upload(await asShop(elsewhere), 'dropoff'), 'local:81e9']) refusedForThePhoto(await take(id, ref).expect(400));
    await http().get(`/v1/sbg/parcels/${id}`).set(staff).expect(404); // nothing was made
    const mine = await upload(await asShop(origin), 'dropoff');
    await take(id, mine).expect(201);
    // One photo, one parcel: the next parcel is photographed for itself.
    refusedForThePhoto(await take(`PH-T2-${tag}`, mine).expect(400));
  });

  it('hands over, reports a problem and voids only on the shop’s own photo — and counts no code for a refused one', async () => {
    const id = `PH-H1-${tag}`;
    const taken = (await take(id, await upload(northShop, 'dropoff')).expect(201)).body;
    await http().post('/v1/sbg/parcels/handover').set(staff).send({ agentDid: origin, driverBadgeId: badge, parcelIds: [id], acknowledgeShortShip: true }).expect(201);
    await http().post(`/v1/sbg/parcels/${id}/arrive`).set(staff).send({ destAgentDid: dest }).expect(201);
    const south = await asShop(dest);
    const theirs = await upload(await asShop(origin), 'pod');

    // A problem reported at the counter: on another shop's photo, refused; on its own, recorded.
    refusedForThePhoto(await http().post(`/v1/sbg/parcels/${id}/dispute`).set(south).send({ agentDid: dest, reason: 'Box crushed on one corner', photoProofRef: theirs }).expect(400));
    await http().post(`/v1/sbg/parcels/${id}/dispute`).set(south).send({ agentDid: dest, reason: 'Box crushed on one corner', photoProofRef: await upload(south, 'dispute') }).expect(201);

    // The hand-over: a photo not the shop's is refused before the code is looked at — five times over, and the parcel
    // is not locked, because a refused photo is not a wrong code.
    for (let i = 0; i < 5; i++) refusedForThePhoto(await http().post(`/v1/sbg/parcels/${id}/pickup`).set(south).send({ agentDid: dest, otp: '000000', deliveredPhotoRef: theirs }).expect(400));
    expect(await status(id)).toBe('Ready_For_Pickup');
    await http().post(`/v1/sbg/parcels/${id}/pickup`).set(south).send({ agentDid: dest, otp: taken.otp, deliveredPhotoRef: await upload(south, 'pod') }).expect(201);
    expect(await status(id)).toBe('Delivered');

    // A void at the counter that took it in: on a name, refused and still taken in; on the shop's own photo, voided.
    const v = `PH-V1-${tag}`;
    await take(v, await upload(northShop, 'dropoff')).expect(201);
    const north = await asShop(origin);
    refusedForThePhoto(await http().post(`/v1/sbg/parcels/${v}/void`).set(north).send({ agentDid: origin, voidedPhotoRef: 'torn-label.jpg' }).expect(400));
    expect(await status(v)).toBe('At_PUDO');
    await http().post(`/v1/sbg/parcels/${v}/void`).set(north).send({ agentDid: origin, voidedPhotoRef: await upload(north, 'dropoff') }).expect(201);
    expect(await status(v)).toBe('Voided');
  });
});
