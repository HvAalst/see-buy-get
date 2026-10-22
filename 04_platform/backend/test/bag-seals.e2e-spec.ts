import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { createHash } from 'crypto';
import { AppModule } from '../src/app.module';
import { contentPhotoOver, CONTENTS_PNG } from './content-photo';
import { declared } from './declared';
import { CorridorService } from '../src/modules/pudo/corridor.service';

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
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(operator).send({ approve: true, licenceExpiresAt: '2099-12-31' }).expect(201);
    declared(app, 'shop', did);
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
    // Round 39 — tampering found at the hub proposes a raise for pilferage there, for a person to decide.
    const register = async () => (await http().get('/v1/sbg/risk-register').set(operator).expect(200)).body;
    const proposed = (await register()).proposals.find((p: { subject: string; id: string }) => p.subject === 'hub' && p.id === hub.mdpId);
    expect(proposed).toMatchObject({ threat: 'pilferage', to: 'medium', because: expect.stringContaining(shopBag) });
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
    // Round 39 — the proposal accepted, then rated high by hand: the hub is told, and a bag leaves it only on a coded seal.
    await http().post(`/v1/sbg/risk-register/proposals/${proposed.proposalId}/decide`).set(operator).send({ accept: true, by: 'Halima at operations' }).expect(201);
    const rate = (level: string) => http().post('/v1/sbg/risk-register/rate').set(operator).send({ subject: 'hub', id: hub.mdpId, threat: 'pilferage', level, why: 'A seal not as written this week', by: 'Halima at operations' }).expect(201);
    await rate('high');
    expect((await register()).rows.find((r: { id: string }) => r.id === hub.mdpId)).toMatchObject({ high: true, ratings: expect.arrayContaining([expect.objectContaining({ threat: 'pilferage', level: 'high', ratedBy: 'Halima at operations', overdue: false })]) });
    expect(JSON.stringify((await http().get('/v1/sbg/notifications/inbox').set(hubToken).expect(200)).body)).toMatch(/is rated high for pilferage/);
    const unsealed = (await http().post(`/v1/sbg/totes/${sorted.toteCode}/close`).set(hubToken).send({ photoRef: await photo(hubToken, 'seal') }).expect(409)).body;
    expect(unsealed).toMatchObject({ code: 'RISK_SEAL_REQUIRED' });
    expect(unsealed.detail).toMatch(/is rated high for pilferage: a bag leaves it only on a coded seal/);
    // Looked at again and lowered: a photograph is enough once more.
    await rate('low');
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
    // Round 39 — a bus on a corridor rated high: a bag closed with only a photograph does not go onto it (nor anything at night).
    const line = (await http().post('/v1/sbg/corridors').set(operator).send({ name: `Risky line ${Date.now()}`, originZone: 'RiskA', destZone: 'RiskB' }).expect(201)).body;
    const bus = `BUS-R${String(Date.now()).slice(-6)}`;
    await http().post('/v1/sbg/drivers').set(operator).send({ driverDid: `did:glos:bus-${bus}`, name: 'Risky bus', corridorId: line.corridorId, badgeId: bus }).expect(201);
    const busCorridor = app.get(CorridorService).driverByBadge(bus)?.corridorId as string;
    expect(busCorridor).toBe(line.corridorId);
    const rateCorridor = (level: string) => http().post('/v1/sbg/risk-register/rate').set(operator).send({ subject: 'corridor', id: busCorridor, threat: 'unrest', level, by: 'Halima at operations' }).expect(201);
    await rateCorridor('high');
    const onHigh = (await http().post(`/v1/sbg/totes/${sorted.toteCode}/load`).set(operator).send({ driverBadgeId: bus }).expect(409)).body;
    expect(onHigh.code).toMatch(/^(RISK_SEAL_REQUIRED|RISK_NIGHT)$/);
    expect(onHigh.detail).toMatch(/is rated high for unrest: (a bag travels on it only on a coded seal, and this one was closed with a photograph|nothing goes onto it between 19:00 and 06:00)/);
    await rateCorridor('low');
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

  /*
   * Round 37 — A DRIVER TAKES A BAG ON ITS SEAL (the user: "A driver takes a bag on its seal"). Loading it from their own
   * app, the driver reads the number off the seal — never shown it — photographs it as taken and says it is as it was
   * closed. A bag a counter loads onto them by the pass on their phone, they read afterwards, and it is received nowhere
   * until they have. A bag they find cut on the road, they report: held, operations told.
   */
  it('a driver takes a bag on its seal — loading it themselves, or reading it after a counter loaded it onto them — and it is received only then', async () => {
    const north = await aShop(`North TAKE ${tag}`, `TakeNorth${tag}`);
    const south = await aShop(`South TAKE ${tag}`, `TakeSouth${tag}`);
    const made = (await http().post('/v1/sbg/vendors').set(operator).send({ name: `Take Store ${tag}`, callbackUrl: 'https://store.example/hook' }).expect(201)).body;
    const storeToken = bearer((await http().post('/v1/sbg/vendors/login').send({ vendorId: made.vendorId, secret: made.secret }).expect(201)).body.token.access_token);
    const funded = await http().post(`/v1/sbg/vendors/${made.vendorId}/top-up`).set(storeToken).send({ amount: 5000 }).expect(201);
    await http().post(`/v1/rails/funding/${funded.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 5000 }).expect(201);
    const hub = (await http().post('/v1/sbg/mdps').set(operator).send({ name: `Take Hub ${tag}`, zones: [`TakeSouth${tag}`], location: { lat: -1.25, lng: 36.9 } }).expect(201)).body;
    const hubToken = bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: hub.did }).expect(201)).body.access_token);
    /** A bag of one parcel, closed at the north shop on a coded seal. */
    const sealedBag = async (seal: string): Promise<string> => {
      const order = (await http().post('/v1/sbg/inbound/orders').set(storeToken).send({ vendorId: made.vendorId, originPudoDid: north.did, destPudoDid: south.did, buyerMobile: `+2547${digits()}1`, size: 'M', weightKg: 2, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), storeToken) }).expect(201)).body;
      await http().post(`/v1/sbg/parcels/${order.parcel.parcelId}/intake`).set(north.token).send({ agentDid: north.did }).expect(201);
      const code = (await http().post(`/v1/sbg/agents/${north.did}/totes`).set(north.token).send({ destZone: `TakeSouth${tag}` }).expect(201)).body.code as string;
      await http().post(`/v1/sbg/agents/${north.did}/totes/${code}/fill`).set(north.token).send({ parcelId: order.parcel.parcelId }).expect(201);
      // One parcel a bag: the other bag's parcel is on the shelf still, in a bag of its own.
      await http().post(`/v1/sbg/agents/${north.did}/totes/${code}/seal`).set(north.token).send({ acknowledgeShortShip: true, shortShipReason: 'in a bag of its own', closure: { seal, photoRef: await photo(north.token, 'seal') } }).expect(201);
      return code;
    };
    /** A motorcycle courier on shift, signed in on their own phone. */
    const onShift = async (name: string): Promise<{ did: string; token: { authorization: string } }> => {
      seq += 1;
      const u = `${tag}${seq}`;
      const d = (await http().post('/v1/sbg/drivers/onboard').set(operator).send({ displayName: name, fullName: `${name} Rider`, nationalId: `DRV-TK-${u}`, mobile: `+2547${digits().slice(-6)}${seq}`, licenceClasses: ['motorcycle'] }).expect(201)).body;
      declared(app, 'driver', d.did);
      const moto = (await http().post('/v1/sbg/vehicles').set(operator).send({ plate: `TK-${u}`, vehicleClass: 'motorcycle', ownerName: name }).expect(201)).body;
      await http().post(`/v1/sbg/fleet/drivers/${d.did}/start-session`).set(operator).send({ vehicleId: moto.vehicleId }).expect(201);
      return { did: d.did as string, token: bearer((await http().post('/v1/auth/token').send({ role: 'driver', did: d.did, type: 'client_credentials' }).expect(201)).body.access_token) };
    };
    type Held = { ref: string; bagSeal?: { closedWith: string; check?: string; taken: boolean } };
    const claimOf = async (driver: { did: string; token: { authorization: string } }, code: string): Promise<Held | undefined> =>
      ((await http().get(`/v1/sbg/fleet/drivers/${driver.did}/claims`).set(driver.token).expect(200)).body.claims as Held[]).find((c) => c.ref === code);
    const drop = (code: string, receipt: Record<string, unknown>) => http().post(`/v1/sbg/mdps/${hub.mdpId}/drop-bag`).set(operator).send({ code, receipt });
    const SEAL_ONE = `KE ${String(Date.now()).slice(-7)}`;
    const SEAL_TWO = `KE ${String(Date.now() + 7).slice(-7)}`;
    const one = await sealedBag(SEAL_ONE);
    const two = await sealedBag(SEAL_TWO);
    const amina = await onShift('Amina');
    const baraka = await onShift('Baraka');

    // LOADING IT THEMSELVES: a photograph as taken, the number read off the seal, as it was closed — each asked for, and
    // each refusal before anything is written.
    const load = (take?: Record<string, unknown>) => http().post(`/v1/sbg/totes/${one}/load`).set(amina.token).send(take ? { take } : {});
    expect((await load().expect(400)).body.detail).toMatch(/Photograph the bag as you take it/);
    expect((await load({ photoRef: await photo(north.token, 'seal'), sealNumber: SEAL_ONE, asClosed: true }).expect(400)).body.code).toBe('PHOTO_REQUIRED');
    expect((await load({ photoRef: await photo(amina.token, 'seal'), asClosed: true }).expect(400)).body.detail).toMatch(/Read the number on bag .*’s seal/);
    expect((await load({ photoRef: await photo(amina.token, 'seal'), sealNumber: 'KE 0000000', asClosed: true }).expect(409)).body.detail).toMatch(/not the one it was closed with. Read it again — still not the same\? Report it: the bag is held, and does not leave until operations releases it/);
    expect((await load({ photoRef: await photo(amina.token, 'seal'), sealNumber: SEAL_ONE, asClosed: false }).expect(409)).body.code).toBe('TAMPER_REPORT_FIRST');
    expect((await http().get(`/v1/sbg/totes/${one}`).set(operator).expect(200)).body.status).not.toBe('in_transit');
    // Read as a person reads it — a dash, lower case — and it is the number it was closed with.
    expect((await load({ photoRef: await photo(amina.token, 'seal'), sealNumber: SEAL_ONE.replace(' ', '-').toLowerCase(), asClosed: true }).expect(201)).body.moved).toHaveLength(1);
    expect(await claimOf(amina, one)).toMatchObject({ bagSeal: { closedWith: 'seal', taken: true } });
    await drop(one, { sealNumber: SEAL_ONE, photoRef: await photo(hubToken, 'seal'), asClosed: true }).expect(201);

    // LOADED ONTO THEM AT THE COUNTER, by the pass on their phone: on their vehicle, and received nowhere until they have
    // read it themselves. What they are shown is how it was closed and what their phone checks a reading against — never
    // the number.
    const pass = (await http().get(`/v1/sbg/fleet/drivers/${baraka.did}/session`).set(baraka.token).expect(200)).body.handoverPass as string;
    await http().post(`/v1/sbg/totes/${two}/load`).set(north.token).send({ driverBadgeId: pass }).expect(201);
    expect((await drop(two, { sealNumber: SEAL_TWO, photoRef: await photo(hubToken, 'seal'), asClosed: true }).expect(409)).body.detail).toMatch(/The driver has not read bag .*’s seal yet/);
    expect((await http().get(`/v1/sbg/totes/${two}`).set(operator).expect(200)).body).toMatchObject({ status: 'in_transit' });
    const mine = await claimOf(baraka, two);
    expect(mine?.bagSeal).toEqual({ closedWith: 'seal', taken: false, check: createHash('sha256').update(`${two}|${SEAL_TWO.replace(' ', '')}`).digest('hex') });
    expect(JSON.stringify(mine)).not.toContain(SEAL_TWO.slice(3));
    expect((await claimOf(amina, two))).toBeUndefined();
    // Never claimed, and on the motorcycle all the same: the space left says so (a medium parcel's bag counts 5 kg of 50).
    expect((await http().get(`/v1/sbg/fleet/drivers/${baraka.did}/claims`).set(baraka.token).expect(200)).body).toMatchObject({ remainingCapacityKg: 45 });
    const take = (who: { authorization: string }, body: Record<string, unknown>) => http().post(`/v1/sbg/totes/${two}/take`).set(who).send(body);
    await take(operator, { photoRef: 'x', asClosed: true }).expect(403);
    expect((await take(amina.token, { photoRef: await photo(amina.token, 'seal'), sealNumber: SEAL_TWO, asClosed: true }).expect(404)).body.detail).toBe('No bag you carry has that code');
    expect((await take(baraka.token, { photoRef: await photo(baraka.token, 'seal'), sealNumber: 'KE 0000000', asClosed: true }).expect(409)).body.code).toBe('SEAL_MISMATCH');
    const asTaken = await photo(baraka.token, 'seal');
    expect((await take(baraka.token, { photoRef: asTaken, sealNumber: SEAL_TWO, asClosed: true }).expect(201)).body).toEqual({ code: two, taken: true });
    // The phone sending it again (kept with no signal): the reading already made stands, whatever is sent after it.
    await take(baraka.token, { photoRef: await photo(baraka.token, 'seal'), sealNumber: 'KE 0000000', asClosed: true }).expect(201);
    expect((await claimOf(baraka, two))?.bagSeal).toMatchObject({ taken: true });

    // ON THE ROAD the rider finds it cut: reported with a photograph, held where it is, operations told. Another rider
    // reports nothing of it. Released, it is received at the hub as found.
    expect((await http().post(`/v1/sbg/totes/${two}/tamper`).set(amina.token).send({ finding: 'wrap_cut', photoRefs: [await photo(amina.token, 'tamper')] }).expect(404)).body.detail).toBe('No bag you hold or are receiving has that code');
    const held = (await http().post(`/v1/sbg/totes/${two}/tamper`).set(baraka.token).send({ finding: 'wrap_cut', photoRefs: [await photo(baraka.token, 'tamper')], note: 'Tape torn at the zip' }).expect(201)).body;
    // Held: not read again either, until operations releases it.
    expect((await take(baraka.token, { photoRef: await photo(baraka.token, 'seal'), sealNumber: SEAL_TWO, asClosed: true }).expect(409)).body.code).toBe('UNIT_HELD');
    expect(held).toMatchObject({ unitType: 'bag', ref: two, held: { finding: 'wrap_cut', stage: 'road', where: 'on the road' } });
    expect((await drop(two, { sealNumber: SEAL_TWO, photoRef: await photo(hubToken, 'seal'), asClosed: true }).expect(409)).body.code).toBe('UNIT_HELD');
    // Staff read what it was closed with beside what the driver read off it.
    expect((await http().get(`/v1/sbg/ops/tamper/${two}`).set(operator).expect(200)).body.closedWith).toMatchObject({ kind: 'seal', number: SEAL_TWO, taken: { numberRead: SEAL_TWO, asClosed: true, by: 'Baraka' } });
    // A driver's session carries no name: their own record names them.
    expect((await http().get(`/v1/sbg/ops/tamper/${two}`).set(operator).expect(200)).body.exceptions[0]).toMatchObject({ byAs: 'driver', byName: 'Baraka' });
    await http().post(`/v1/sbg/ops/tamper/${two}/release`).set(operator).send({ reason: 'Rider called it in; the hub counts the parcel on arrival', by: 'Halima at operations' }).expect(201);
    expect((await drop(two, { photoRef: await photo(hubToken, 'seal'), asClosed: false }).expect(201)).body.emptied).toHaveLength(1);
    // The trail: closed, taken, reported, received — each anchored as it was kept, and intact.
    const trail = (await http().get(`/v1/sbg/ops/trail/${two}`).set(operator).expect(200)).body as { kind: string; steps: Array<{ kind: string; state: string }> };
    expect(trail.kind).toBe('bag');
    expect(trail.steps.map((s) => s.kind)).toEqual(expect.arrayContaining(['bag_closed', 'bag_taken', 'exception', 'bag_received']));
    expect(trail.steps.every((s) => s.state === 'intact')).toBe(true);

    // A bag its driver never read — their phone lost — is not stranded: the hub reports it, operations releases it, and it
    // is received as found.
    const SEAL_THREE = `KE ${String(Date.now() + 13).slice(-7)}`;
    const three = await sealedBag(SEAL_THREE);
    const passAgain = (await http().get(`/v1/sbg/fleet/drivers/${amina.did}/session`).set(amina.token).expect(200)).body.handoverPass as string;
    await http().post(`/v1/sbg/totes/${three}/load`).set(north.token).send({ driverBadgeId: passAgain }).expect(201);
    expect((await drop(three, { sealNumber: SEAL_THREE, photoRef: await photo(hubToken, 'seal'), asClosed: true }).expect(409)).body.code).toBe('BAG_NOT_TAKEN');
    await http().post(`/v1/sbg/totes/${three}/tamper`).set(hubToken).send({ finding: 'wrap_cut', photoRefs: [await photo(hubToken, 'tamper')], note: 'Driver’s phone lost: seal never read on the road' }).expect(201);
    await http().post(`/v1/sbg/ops/tamper/${three}/release`).set(operator).send({ reason: 'Driver called: phone lost on the way; the hub counts the parcel', by: 'Halima at operations' }).expect(201);
    expect((await drop(three, { photoRef: await photo(hubToken, 'seal'), asClosed: false }).expect(201)).body.emptied).toHaveLength(1);
  });
});
