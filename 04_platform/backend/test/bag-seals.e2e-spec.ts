import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { contentPhotoOver, CONTENTS_PNG } from './content-photo';

/**
 * A BAG CLOSED ON OUR OWN SEAL, AND RECEIVED BY IT, over the wire (round 36; the user: "Receiving on our own seals"; "we
 * wire in both options. we suggest coded security seals"). A shop closes its bag with a coded seal and a photograph; the
 * hub it reaches reads the number off the seal — never shown it — and photographs it before opening it. The hub closes
 * the bag onward with a photograph alone; the shop it reaches finds it cut, reports it, and the bag is held until
 * operations releases it, then received as found. A bag nobody closed does not leave.
 */
describe('a bag closed on our own seal, and received by it, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const tag = digits();
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

  const photo = async (who: { authorization: string }, kind: string) => {
    seq += 1;
    const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${tag}:${seq}`)]).toString('base64')}`;
    return (await http().post('/v1/sbg/media').set(who).send({ kind, dataUrl }).expect(201)).body.mediaId as string;
  };

  async function aShop(shopName: string, zone: string): Promise<{ did: string; token: { authorization: string } }> {
    const u = digits();
    const hours = { open: '00:00', close: '23:59' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({
        shopName, zone, country: 'KE', location: { lat: -1.286, lng: 36.817 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: hours },
        fullName: `${shopName} owner`, nationalId: `ID-BAG-${u}`, mobile: `+2547${u}9`, deviceImei: `IMEI-BAG-${u}`,
        requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
      })
      .expect(201);
    const did = reg.body.did as string;
    const token = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const shopPhoto = async (kind: string) => (await http().post('/v1/sbg/media').set(token).send({ kind, dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(token).send({ idCopyRef: await shopPhoto('kyc_id'), tradingLicenceRef: await shopPhoto('kyc_licence'), shopPhotoRefs: [await shopPhoto('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(operator).send({ approve: true }).expect(201);
    const asked = await http().post(`/v1/sbg/agents/${did}/top-up`).set(operator).send({ amount: 50 }).expect(201);
    await http().post(`/v1/rails/funding/${asked.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 50 }).expect(201);
    return { did, token };
  }

  it('a shop’s coded seal read off the bag at the hub; the hub’s photographed bag found cut at the shop, held, released, received as found', async () => {
    const north = await aShop(`North BAG ${tag}`, `BagNorth${tag}`);
    const south = await aShop(`South BAG ${tag}`, `BagSouth${tag}`);
    const made = (await http().post('/v1/sbg/vendors').set(operator).send({ name: `Bag Store ${tag}`, callbackUrl: 'https://store.example/hook' }).expect(201)).body;
    const storeToken = bearer((await http().post('/v1/sbg/vendors/login').send({ vendorId: made.vendorId, secret: made.secret }).expect(201)).body.token.access_token);
    const funded = await http().post(`/v1/sbg/vendors/${made.vendorId}/top-up`).set(storeToken).send({ amount: 5000 }).expect(201);
    await http().post(`/v1/rails/funding/${funded.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 5000 }).expect(201);
    const hub = (await http().post('/v1/sbg/mdps').set(operator).send({ name: `Bag Hub ${tag}`, zones: [`BagSouth${tag}`], location: { lat: -1.25, lng: 36.9 } }).expect(201)).body;
    const hubToken = bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: hub.did }).expect(201)).body.access_token);
    const ids: string[] = [];
    for (let i = 0; i < 2; i += 1) {
      const order = (await http().post('/v1/sbg/inbound/orders').set(storeToken).send({ vendorId: made.vendorId, originPudoDid: north.did, destPudoDid: south.did, buyerMobile: `+2547${digits()}${i}`, size: 'M', weightKg: 2, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), storeToken) }).expect(201)).body;
      await http().post(`/v1/sbg/parcels/${order.parcel.parcelId}/intake`).set(north.token).send({ agentDid: north.did }).expect(201);
      ids.push(order.parcel.parcelId);
    }
    const SEAL = `KE ${String(Date.now()).slice(-7)}`;

    // THE SHOP CLOSES ITS BAG: a coded seal and a photograph. No photograph is no closing; the number is never on the bag.
    const shopBag = (await http().post(`/v1/sbg/agents/${north.did}/totes`).set(north.token).send({ destZone: `BagSouth${tag}` }).expect(201)).body.code as string;
    for (const id of ids) await http().post(`/v1/sbg/agents/${north.did}/totes/${shopBag}/fill`).set(north.token).send({ parcelId: id }).expect(201);
    expect((await http().post(`/v1/sbg/agents/${north.did}/totes/${shopBag}/seal`).set(north.token).send({ closure: { seal: SEAL } }).expect(400)).body.detail).toMatch(/photograph the bag/);
    await http().post(`/v1/sbg/agents/${north.did}/totes/${shopBag}/seal`).set(north.token).send({ closure: { seal: SEAL, photoRef: await photo(north.token, 'seal') } }).expect(201);
    const asSeen = (await http().get(`/v1/sbg/totes/${shopBag}`).set(north.token).expect(200)).body;
    expect(asSeen).toMatchObject({ closedWith: 'seal' });
    expect(JSON.stringify(asSeen)).not.toContain(SEAL.slice(3));
    // One coded seal closes one bag: the same number on another bag still travelling is refused.
    const late = (await http().post('/v1/sbg/inbound/orders').set(storeToken).send({ vendorId: made.vendorId, originPudoDid: north.did, destPudoDid: south.did, buyerMobile: `+2547${digits()}9`, size: 'S', weightKg: 1, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), storeToken) }).expect(201)).body.parcel.parcelId as string;
    await http().post(`/v1/sbg/parcels/${late}/intake`).set(north.token).send({ agentDid: north.did }).expect(201);
    const second = (await http().post(`/v1/sbg/agents/${north.did}/totes`).set(north.token).send({ destZone: `BagSouth${tag}` }).expect(201)).body.code as string;
    await http().post(`/v1/sbg/agents/${north.did}/totes/${second}/fill`).set(north.token).send({ parcelId: late }).expect(201);
    expect((await http().post(`/v1/sbg/agents/${north.did}/totes/${second}/seal`).set(north.token).send({ acknowledgeShortShip: true, shortShipReason: 'in the first bag', closure: { seal: SEAL.replace(' ', '-'), photoRef: await photo(north.token, 'seal') } }).expect(400)).body.detail).toMatch(/closes another bag still on its way: a coded seal is used once/);

    // ON ITS WAY: a bag closed is loaded; staff close nothing.
    await http().post(`/v1/sbg/totes/${shopBag}/close`).set(operator).send({ photoRef: 'x' }).expect(403);
    await http().post(`/v1/sbg/totes/${shopBag}/load`).set(operator).send({ driverBadgeId: 'BUS-7' }).expect(201);

    // AT THE HUB: read off the seal, photographed as it arrived, before it opens. A number not the one it was closed with
    // and nothing happens; as it was closed must be said; not as closed is reported first.
    const drop = (receipt: Record<string, unknown>) => http().post(`/v1/sbg/mdps/${hub.mdpId}/drop-bag`).set(operator).send({ code: shopBag, receipt });
    expect((await drop({ sealNumber: SEAL, asClosed: true }).expect(400)).body.detail).toMatch(/Photograph the bag as it arrived/);
    const wrong = (await drop({ sealNumber: 'KE 0000000', photoRef: await photo(hubToken, 'seal'), asClosed: true }).expect(409)).body;
    expect(wrong).toMatchObject({ code: 'SEAL_MISMATCH' });
    expect(wrong.detail).toMatch(/not the one it was closed with. Read it again — still not the same\? Report it/);
    expect((await http().get(`/v1/sbg/totes/${shopBag}`).set(operator).expect(200)).body).toMatchObject({ status: 'in_transit', parcels: ids });
    expect((await drop({ photoRef: await photo(hubToken, 'seal'), asClosed: true }).expect(400)).body.detail).toMatch(/Read the number on bag .*’s seal/);
    expect((await drop({ sealNumber: SEAL, photoRef: await photo(north.token, 'seal'), asClosed: true }).expect(400)).body.code).toBe('PHOTO_REQUIRED');
    expect((await drop({ sealNumber: SEAL, photoRef: await photo(hubToken, 'seal') }).expect(400)).body.detail).toMatch(/as it was closed/);
    expect((await drop({ sealNumber: SEAL, photoRef: await photo(hubToken, 'seal'), asClosed: false }).expect(409)).body.code).toBe('TAMPER_REPORT_FIRST');
    // The seal "not the one it was closed with", reported with the number it WAS closed with, is no report.
    expect((await http().post(`/v1/sbg/totes/${shopBag}/tamper`).set(hubToken).send({ finding: 'seal_not_as_written', numberRead: SEAL.replace(' ', ''), photoRefs: [await photo(hubToken, 'tamper')] }).expect(400)).body.detail).toMatch(/That is the number it was closed with/);
    // Still not the same: reported with the number read. Held: not emptied until operations releases it — then as found.
    expect((await http().post(`/v1/sbg/totes/${shopBag}/tamper`).set(hubToken).send({ finding: 'seal_not_as_written', numberRead: 'KE 0000000', photoRefs: [await photo(hubToken, 'tamper')] }).expect(201)).body.held).toMatchObject({ finding: 'seal_not_as_written', stage: 'hub' });
    expect((await drop({ sealNumber: SEAL, photoRef: await photo(hubToken, 'seal'), asClosed: true }).expect(409)).body.code).toBe('UNIT_HELD');
    expect((await http().get(`/v1/sbg/ops/tamper/${shopBag}`).set(operator).expect(200)).body).toMatchObject({ closedWith: { kind: 'seal', number: SEAL } });
    await http().post(`/v1/sbg/ops/tamper/${shopBag}/release`).set(operator).send({ reason: 'Shop confirms it used seal 0000000 by mistake from an old roll', by: 'Halima at operations' }).expect(201);
    expect((await drop({ sealNumber: 'KE 0000000', photoRef: await photo(hubToken, 'seal'), asClosed: false }).expect(201)).body.emptied).toEqual(ids);
    // Received and opened: the bag is free again, its closing over.
    expect((await http().get(`/v1/sbg/totes/${shopBag}`).set(operator).expect(200)).body.closedWith).toBeUndefined();

    // THE HUB CLOSES THE BAG ONWARD, photographed: nothing more goes in. A bag nobody closed does not leave.
    const sorted = (await http().post(`/v1/sbg/mdps/${hub.mdpId}/sort`).set(operator).send({ parcelId: ids[0] }).expect(201)).body;
    expect((await http().post(`/v1/sbg/totes/${sorted.toteCode}/load`).set(operator).send({ driverBadgeId: 'BUS-7' }).expect(409)).body.code).toBe('BAG_NOT_CLOSED');
    expect((await http().post(`/v1/sbg/totes/${sorted.toteCode}/close`).set(north.token).send({ photoRef: await photo(north.token, 'seal') }).expect(403)).body.detail).toMatch(/is not here/);
    expect((await http().post(`/v1/sbg/totes/${sorted.toteCode}/close`).set(hubToken).send({ photoRef: await photo(north.token, 'seal') }).expect(400)).body.code).toBe('PHOTO_REQUIRED');
    const closed = (await http().post(`/v1/sbg/totes/${sorted.toteCode}/close`).set(hubToken).send({ photoRef: await photo(hubToken, 'seal') }).expect(201)).body;
    expect(closed).toMatchObject({ closedWith: 'photo', tote: { status: 'available' } });
    expect((await http().post(`/v1/sbg/totes/${sorted.toteCode}/close`).set(hubToken).send({ photoRef: await photo(hubToken, 'seal') }).expect(400)).body.detail).toMatch(/closed already/);
    expect((await http().post(`/v1/sbg/totes/${sorted.toteCode}/fill`).set(operator).send({ parcelId: ids[1] }).expect(400)).body.detail).toMatch(/is closed: open another bag/);
    // …and a second parcel for the same shop goes into a bag of its own: the closed one takes nothing more.
    const next = (await http().post(`/v1/sbg/mdps/${hub.mdpId}/sort`).set(operator).send({ parcelId: ids[1] }).expect(201)).body;
    expect(next.toteCode).not.toBe(sorted.toteCode);
    // A bag at the hub found cut before it leaves: held — not closed, not loaded — until released.
    await http().post(`/v1/sbg/totes/${next.toteCode}/tamper`).set(hubToken).send({ finding: 'wrap_cut', photoRefs: [await photo(hubToken, 'tamper')] }).expect(201);
    expect((await http().post(`/v1/sbg/totes/${next.toteCode}/close`).set(hubToken).send({ photoRef: await photo(hubToken, 'seal') }).expect(409)).body.code).toBe('UNIT_HELD');
    await http().post(`/v1/sbg/ops/tamper/${next.toteCode}/release`).set(operator).send({ reason: 'Hub supervisor taped it again and counted the parcel', by: 'Halima at operations' }).expect(201);
    await http().post(`/v1/sbg/totes/${next.toteCode}/close`).set(hubToken).send({ seal: `KE ${String(Date.now() + 1).slice(-7)}`, photoRef: await photo(hubToken, 'seal') }).expect(201);
    await http().post(`/v1/sbg/totes/${next.toteCode}/tamper`).set(hubToken).send({ finding: 'seal_broken', photoRefs: [await photo(hubToken, 'tamper')] }).expect(201);
    expect((await http().post(`/v1/sbg/totes/${next.toteCode}/load`).set(operator).send({ driverBadgeId: 'BUS-8' }).expect(409)).body.code).toBe('UNIT_HELD');
    await http().post(`/v1/sbg/totes/${sorted.toteCode}/load`).set(operator).send({ driverBadgeId: 'BUS-8' }).expect(201);

    // AT THE SHOP: the bag is cut. Reported before it is opened: held, operations told; not received until released.
    const asFound = [await photo(south.token, 'tamper')];
    await http().post(`/v1/sbg/totes/${sorted.toteCode}/tamper`).set(operator).send({ finding: 'wrap_cut', photoRefs: [] }).expect(403);
    expect((await http().post(`/v1/sbg/totes/${sorted.toteCode}/tamper`).set(north.token).send({ finding: 'wrap_cut', photoRefs: [await photo(north.token, 'tamper')] }).expect(404)).body.detail).toBe('No bag you hold or are receiving has that code');
    expect((await http().post(`/v1/sbg/totes/${sorted.toteCode}/tamper`).set(south.token).send({ finding: 'seal_broken', photoRefs: asFound }).expect(400)).body.detail).toMatch(/not closed with a coded seal/);
    const held = (await http().post(`/v1/sbg/totes/${sorted.toteCode}/tamper`).set(south.token).send({ finding: 'wrap_cut', photoRefs: asFound, note: 'Zip pulled back, tape torn' }).expect(201)).body;
    expect(held).toMatchObject({ unitType: 'bag', ref: sorted.toteCode, held: { finding: 'wrap_cut', stage: 'counter', where: `at South BAG ${tag}` } });
    const receive = (receipt: Record<string, unknown>) => http().post(`/v1/sbg/agents/${south.did}/receive-bag`).set(south.token).send({ code: sorted.toteCode, receipt });
    expect((await receive({ photoRef: await photo(south.token, 'seal'), asClosed: false }).expect(409)).body.code).toBe('UNIT_HELD');
    await http().post(`/v1/sbg/agents/${south.did}/receive-bag`).set(south.token).send({ code: next.toteCode }).expect(409);
    const cases = (await http().get('/v1/sbg/flag-cases').query({ kind: 'Tamper_Hold' }).set(operator).expect(200)).body.items as Array<{ subject: string; severity: string }>;
    expect(cases.find((c) => c.subject === sorted.toteCode)).toMatchObject({ severity: 'critical' });
    expect((await http().get(`/v1/sbg/ops/tamper/${sorted.toteCode}`).set(operator).expect(200)).body).toMatchObject({ closedWith: { kind: 'photo', place: `Bag Hub ${tag}` } });
    await http().post(`/v1/sbg/ops/tamper/${sorted.toteCode}/release`).set(operator).send({ reason: 'Counted with the shop on the phone: both parcels there, boxes intact', by: 'Halima at operations' }).expect(201);
    // Released: received as found — the report is what it was received on.
    const received = (await receive({ photoRef: await photo(south.token, 'seal'), asClosed: false }).expect(201)).body;
    expect(received.delivered).toEqual([ids[0]]);
  });
});
