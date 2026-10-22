import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { shopPhotoOver } from './content-photo';
import { declared } from './declared';
import { AgentService } from '../src/modules/pudo/agent.service';

/**
 * ROUND 40 — A SHOP'S TRADING LICENCE THAT LAPSES, OVER THE WIRE (the user: "Expiry, notice, grace"). Staff note the date at
 * approval; the shop reads where its licence stands; it sends the renewed one from its own sign-in; staff record it or send
 * it back with a reason, on the Papers list; and once the grace is over no new parcel starts there, or names it, until the
 * renewed date is recorded.
 */
describe('a shop’s trading licence — over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let staff: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    staff = bearer((await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token);
  });

  afterAll(async () => {
    await app?.close();
  });

  async function aShop(shopName: string): Promise<{ did: string; token: { authorization: string }; licencePhoto: string; photograph: (kind: string) => Promise<string> }> {
    const u = digits();
    const hours = { open: '08:00', close: '18:00' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(staff)
      .send({
        shopName, zone: `Lic${u}`, country: 'KE', location: { lat: -1.286, lng: 36.817 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: null },
        fullName: `${shopName} owner`, nationalId: `ID-LIC-${u}`, mobile: `+2547${u}6`, deviceImei: `IMEI-LIC-${u}`,
        requirements: { androidVersion: 13, reliablePower: true, tradingLicence: `TL-${u}`, criminalRecordClear: true },
      })
      .expect(201);
    const did = reg.body.did as string;
    const token = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    let n = 0;
    const photograph = async (kind: string) => {
      n += 1;
      const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${did}:${n}`)]).toString('base64')}`;
      return (await http().post('/v1/sbg/media').set(token).send({ kind, dataUrl }).expect(201)).body.mediaId as string;
    };
    const licencePhoto = await photograph('kyc_licence');
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(token).send({ idCopyRef: await photograph('kyc_id'), tradingLicenceRef: licencePhoto, shopPhotoRefs: [await photograph('shop')] }).expect(201);
    return { did, token, licencePhoto, photograph };
  }

  const approve = (did: string, body: Record<string, unknown>) => http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(staff).send({ approve: true, ...body });
  const mine = async (shop: { did: string; token: { authorization: string } }) => (await http().get(`/v1/sbg/agents/${shop.did}`).set(shop.token).expect(200)).body;
  const shopRow = async (did: string) => ((await http().get('/v1/sbg/fleet/papers').set(staff).expect(200)).body.shops as Array<{ did: string }>).find((r) => r.did === did) as Record<string, unknown> | undefined;

  it('an approval notes the date the licence runs to, read off it — and is refused without one, or with one past', async () => {
    const shop = await aShop('Mama Pendo');
    expect((await approve(shop.did, {}).expect(400)).body).toMatchObject({ code: 'FIELD_REQUIRED', params: { field: 'licenceExpiresAt' } });
    expect((await approve(shop.did, { licenceExpiresAt: '2020-06-30' }).expect(400)).body).toMatchObject({ code: 'VALIDATION_FAILED' });
    expect((await mine(shop)).status).toBe('KYC_PENDING');
    await approve(shop.did, { licenceExpiresAt: '2099-12-31', by: 'Amina' }).expect(201);
    const after = await mine(shop);
    expect(after.licence).toMatchObject({ expiresAt: '2099-12-31', copyRef: shop.licencePhoto });
    expect(after.licenceStanding).toMatchObject({ state: 'ok', expiresAt: '2099-12-31', renewalSent: false });
    // On staff's list, with the licence number and what it was read from.
    expect(await shopRow(shop.did)).toMatchObject({ shopName: 'Mama Pendo', number: expect.stringMatching(/^TL-/), licence: { expiresAt: '2099-12-31', copyRef: shop.licencePhoto }, standing: { state: 'ok' } });
  });

  it('the shop sends its renewed licence from its own sign-in; staff send it back with a reason, or record it', async () => {
    const shop = await aShop('Duka la Juma');
    await approve(shop.did, { licenceExpiresAt: '2099-12-31' }).expect(201);
    const other = await aShop('Another Duka');
    const renewed = await shop.photograph('kyc_licence');
    const send = (who: { authorization: string }, copyRef: string) => http().post(`/v1/sbg/agents/${shop.did}/licence-renewal`).set(who).send({ copyRef, expiresAt: '2100-06-30' });

    // Nobody else sends it: not staff, not another shop.
    await send(staff, renewed).expect(403);
    await send(other.token, renewed).expect(403);
    // Not the licence already on record.
    expect((await send(shop.token, shop.licencePhoto).expect(400)).body).toMatchObject({ code: 'PHOTO_REQUIRED' });
    expect((await send(shop.token, renewed).expect(201)).body).toMatchObject({ licenceRenewal: { copyRef: renewed, expiresAt: '2100-06-30' }, licenceStanding: { renewalSent: true } });
    // Staff can open what was sent, and it waits first on their list.
    await http().get(`/v1/sbg/media/${renewed}`).set(staff).expect(200);
    const list = (await http().get('/v1/sbg/fleet/papers').set(staff).expect(200)).body.shops as Array<{ did: string }>;
    expect(list[0]).toMatchObject({ did: shop.did, renewal: { copyRef: renewed } });

    // The shop does not record its own licence.
    await http().post(`/v1/sbg/agents/${shop.did}/licence`).set(shop.token).send({ expiresAt: '2100-06-30' }).expect(403);
    // Sent back: the reason, which the shop reads.
    await http().post(`/v1/sbg/agents/${shop.did}/licence-renewal/refuse`).set(staff).send({ reason: '' }).expect(400);
    await http().post(`/v1/sbg/agents/${shop.did}/licence-renewal/refuse`).set(staff).send({ reason: 'The photo is of last year’s licence', by: 'Brian' }).expect(201);
    expect(await mine(shop)).toMatchObject({ licenceRenewalRefusal: { reason: 'The photo is of last year’s licence' }, licenceStanding: { renewalSent: false } });

    // Sent again, and recorded: the photograph sent becomes the licence on record.
    const again = await shop.photograph('kyc_licence');
    await send(shop.token, again).expect(201);
    expect((await http().post(`/v1/sbg/agents/${shop.did}/licence`).set(staff).send({ expiresAt: '2100-06-30', by: 'Brian' }).expect(201)).body).toMatchObject({ licence: { expiresAt: '2100-06-30', copyRef: again } });
    const after = await mine(shop);
    expect(after.licenceRenewal).toBeUndefined();
    expect(after.licenceRenewalRefusal).toBeUndefined();
  });

  it('once the grace is over no new parcel starts there or names it, until the renewed date is recorded', async () => {
    const shop = await aShop('Kona Shop');
    await approve(shop.did, { licenceExpiresAt: '2099-12-31' }).expect(201);
    await http().post(`/v1/sbg/agents/${shop.did}/deposit`).set(staff).expect(201);
    await http().post(`/v1/sbg/agents/${shop.did}/top-up`).set(staff).send({ amount: 50 });
    declared(app, 'shop', shop.did);
    const walkUp = async () =>
      http()
        .post('/v1/sbg/parcels/accept')
        .set(shop.token)
        .send({ agentDid: shop.did, parcelId: `LIC-${digits()}`, size: 'S', destZone: 'Elsewhere', senderMobile: '+254700000601', receiverMobile: '+254700000602', paymentMode: 'prepaid', dropoffPhotoRef: await shopPhotoOver(app.getHttpServer(), shop.did) });

    // Time passes: it ran to a day more than fourteen days gone. (A date in the past cannot be typed, so it is written here.)
    const record = app.get(AgentService).get(shop.did);
    record.licence = { ...record.licence!, expiresAt: new Date(Date.now() - 16 * 86_400_000).toISOString().slice(0, 10) };

    expect((await mine(shop)).licenceStanding).toMatchObject({ state: 'stopped' });
    const refused = await walkUp();
    expect([refused.status, refused.body.code]).toEqual([409, 'LICENCE_LAPSED']);
    expect(refused.body.detail).toMatch(/^No new parcel can be started at this shop: its trading licence ran to .+ and the 14 days' grace are over\. Parcels already booked to be handed in here, and everything on the shelf, go on as usual\./);
    // The counter is told before anybody tries, and the board does not offer it.
    expect((await http().get(`/v1/sbg/agents/${shop.did}/can-transact`).set(shop.token).expect(200)).body).toMatchObject({ ok: false, code: 'LICENCE_LAPSED' });
    const points = (await http().get('/v1/sbg/network/points').expect(200)).body as Array<{ did: string; takesNew: boolean }>;
    expect(points.find((p) => p.did === shop.did)).toMatchObject({ takesNew: false });
    expect(await shopRow(shop.did)).toMatchObject({ standing: { state: 'stopped' } });

    // Recorded to a new date: new parcels again, at once.
    await http().post(`/v1/sbg/agents/${shop.did}/licence`).set(staff).send({ expiresAt: '2099-12-31' }).expect(201);
    expect((await walkUp()).status).toBe(201);
    expect(((await http().get('/v1/sbg/network/points').expect(200)).body as Array<{ did: string; takesNew: boolean }>).find((p) => p.did === shop.did)).toMatchObject({ takesNew: true });
  });
});
