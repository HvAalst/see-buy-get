import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { ParcelService } from '../src/modules/pudo/parcel.service';
import { contentPhotoOver, CONTENTS_PNG } from './content-photo';

/**
 * THE TAMPER PROTOCOL, over the wire (round 35; the user, answering the ISO 28000/28001 check: "The tamper protocol" — a
 * seal not as written, a broken seal or a cut wrap holds the unit, logs the exception against it and its SSCC, and tells
 * operations before custody is taken). A load: its seal not as written at pickup, its wrap cut on the road, its seals not
 * as the note says at the door. A parcel: its wrap cut at the shop it was handed in at, and at the hub it stands at.
 */
describe('the tamper protocol, over the wire', () => {
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

  /** A photograph taken by whoever holds `who`. */
  const photo = async (who: { authorization: string }, kind: string) => {
    seq += 1;
    const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${tag}:${seq}`)]).toString('base64')}`;
    return (await http().post('/v1/sbg/media').set(who).send({ kind, dataUrl }).expect(201)).body.mediaId as string;
  };
  const liveCases = async () => (await http().get('/v1/sbg/flag-cases').query({ kind: 'Tamper_Hold' }).set(operator).expect(200)).body.items as Array<{ caseId: string; subject: string; severity: string; state: string; history: Array<{ act: string; text?: string }> }>;
  const release = (ref: string, reason: string) => http().post(`/v1/sbg/ops/tamper/${encodeURIComponent(ref)}/release`).set(operator).send({ reason, by: 'Halima at operations' });

  async function aBusiness(): Promise<{ authorization: string }> {
    seq += 1;
    const phone = `+2547${digits()}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `tamper-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const owner = (await http().post('/v1/sbg/identity/enroll').send({ phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token as string;
    const created = await http().post('/v1/sbg/business').set(bearer(owner)).send({ name: `Tamper Traders ${tag}`, country: 'KE', registrationNo: `TMP-${tag}`, activities: ['shipper'], yourName: 'Achieng Owner' }).expect(201);
    return bearer(created.body.token.access_token);
  }

  async function aDriver(name: string): Promise<{ did: string; token: { authorization: string } }> {
    seq += 1;
    const u = `${tag}${seq}`;
    const r = await http().post('/v1/sbg/drivers/onboard').set(operator).send({ displayName: name, fullName: `${name} Truck`, nationalId: `DRV-T-${u}`, mobile: `+2547${digits().slice(-6)}${seq}`, licenceClasses: ['truck'], licenceNumber: `DL-${u}`, licenceExpiresAt: '2030-01-01' }).expect(201);
    const token = (await http().post('/v1/auth/token').send({ role: 'driver', did: r.body.did, type: 'client_credentials' }).expect(201)).body.access_token as string;
    return { did: r.body.did as string, token: bearer(token) };
  }

  it('a load: held at pickup, on the road and at the door — logged, operations told, released only by operations with a reason', async () => {
    const biz = await aBusiness();
    const posted = await http()
      .post('/v1/sbg/dispatch/freight')
      .set(biz)
      .send({ description: 'Tiles, 2 pallets', pickupLocation: { lat: -1.33, lng: 36.87 }, pickupLabel: 'Mlolongo yard', destLabel: 'Nakuru store', destLocation: { lat: -0.3, lng: 36.07 }, weightKg: 900, packaging: 'palletised', packages: 2, pickupCountry: 'KE', destCountry: 'KE' })
      .expect(201);
    const freightId = posted.body.freightId as string;
    const shot = async () => ({ loadedOpen: await photo(biz, 'seal'), closedWithSeal: await photo(biz, 'seal'), sealCloseUp: await photo(biz, 'seal') });
    const seal = (await http().post(`/v1/sbg/dispatch/freight/${freightId}/seals`).set(biz).send({ number: 'KE 5555-001', sealClass: 'H', appliedBy: 'sender', photos: await shot() }).expect(201)).body;
    const driver = await aDriver('Wafula');
    const other = await aDriver('Kiprop');
    const store = (app.get(DispatchService) as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    store.set(freightId, { ...store.get(freightId), status: 'claimed', claimedBy: driver.did, claimedAt: new Date().toISOString() });
    const code = store.get(freightId).code as string;
    const report = (who: { authorization: string }, body: Record<string, unknown>) => http().post(`/v1/sbg/dispatch/freight/${freightId}/tamper`).set(who).send(body);
    const claim = (await http().get(`/v1/sbg/fleet/drivers/${driver.did}/claims`).set(driver.token).expect(200)).body.claims.find((c: { ref: string }) => c.ref === freightId);
    const pickup = async (number: string) => ({ confirmed: claim.loadChecklist.map((x: { key: string }) => x.key), securementPhotoId: await photo(driver.token, 'securement'), seals: [{ sealId: seal.sealId, number, photoRef: await photo(driver.token, 'seal') }] });

    // AT PICKUP: the seal on the door is not the one written. Reported with the number read and a photograph — the number
    // written is not a report; no photograph is not a report; staff and another driver do not report it.
    expect((await report(driver.token, { finding: 'seal_not_as_written', sealId: seal.sealId, numberRead: 'ke5555001', photoRefs: [await photo(driver.token, 'tamper')] }).expect(400)).body.detail).toMatch(/That is the number written/);
    expect((await report(driver.token, { finding: 'seal_not_as_written', sealId: seal.sealId, numberRead: 'KE 5555-009' }).expect(400)).body.detail).toMatch(/Photograph what you found/);
    expect((await report(operator, { finding: 'wrap_cut', photoRefs: [] }).expect(403)).body.detail).toMatch(/whoever has the goods in front of them/);
    await report(other.token, { finding: 'wrap_cut', photoRefs: [await photo(other.token, 'tamper')] }).expect(404);
    const asFound = [await photo(driver.token, 'tamper')];
    const held = (await report(driver.token, { finding: 'seal_not_as_written', sealId: seal.sealId, numberRead: 'KE 5555-009', photoRefs: asFound, note: 'Bolt looks re-crimped' }).expect(201)).body;
    expect(held).toMatchObject({ unitType: 'load', unitId: freightId, ref: code, held: { finding: 'seal_not_as_written', stage: 'pickup', where: 'at pickup' } });
    expect(held.exceptions).toEqual([expect.objectContaining({ finding: 'seal_not_as_written', stage: 'pickup', byAs: 'driver', sealNo: 1, numberRead: 'KE 5555-009', photoRefs: asFound, note: 'Bolt looks re-crimped', fingerprint: expect.stringMatching(/^[0-9a-f]{64}$/) })]);
    expect(held.exceptions[0].byName).toBeUndefined();
    // The phone sending it again (kept with no signal): the one already made.
    expect((await report(driver.token, { finding: 'seal_not_as_written', sealId: seal.sealId, numberRead: 'KE 5555-009', photoRefs: [await photo(driver.token, 'tamper')] }).expect(201)).body.exceptions).toHaveLength(1);

    // HELD: not taken over, even read right. The driver's load card says so; the shipper's list says so, and its bell.
    const refused = (await http().post(`/v1/sbg/dispatch/freight/${freightId}/pickup`).set(driver.token).send(await pickup('KE 5555-001')).expect(409)).body;
    expect(refused).toMatchObject({ code: 'UNIT_HELD' });
    expect(refused.detail).toMatch(/This load is held: a seal on the door is not the one written \(at pickup, .*\)\. Keep it closed/);
    expect(store.get(freightId).status).toBe('claimed');
    expect((await http().get(`/v1/sbg/fleet/drivers/${driver.did}/claims`).set(driver.token).expect(200)).body.claims.find((c: { ref: string }) => c.ref === freightId).held).toMatchObject({ finding: 'seal_not_as_written' });
    expect((await http().get('/v1/sbg/dispatch/posted').set(biz).expect(200)).body.items.find((r: { freightId: string }) => r.freightId === freightId).held).toMatchObject({ stage: 'pickup' });
    expect(JSON.stringify((await http().get('/v1/sbg/notifications/inbox').set(biz).expect(200)).body)).toMatch(new RegExp(`Load ${code} is held`));

    // OPERATIONS TOLD at once: a critical case under the load's code, that closes only by the release.
    let cases = (await liveCases()).filter((c) => c.subject === code);
    expect(cases).toEqual([expect.objectContaining({ severity: 'critical', state: 'open' })]);
    expect((await http().post(`/v1/sbg/flag-cases/${cases[0].caseId}/done`).set(operator).send({ reason: 'Looked into it', recheckHours: 24, by: 'Halima at operations' }).expect(400)).body.detail).toMatch(/closes when the unit is released/);

    // WHO READS IT: the shipper and the carrier, with the party that found it; staff with the name. Nobody else.
    expect((await http().get(`/v1/sbg/dispatch/freight/${freightId}/tamper`).set(biz).expect(200)).body.exceptions[0]).toMatchObject({ byAs: 'driver', numberRead: 'KE 5555-009' });
    expect((await http().get(`/v1/sbg/ops/tamper/${code}`).set(operator).expect(200)).body.exceptions[0].byName).toBe('Wafula');
    await http().get(`/v1/sbg/dispatch/freight/${freightId}/tamper`).set(other.token).expect(404);

    // RELEASED by operations, with what was found and done — never without. The case closes with the same words.
    expect((await release(code, 'ok').expect(400)).body.detail).toMatch(/released with a reason/);
    const freed = (await release(code, 'Shipper re-sealed after counting the tiles; new seal written').expect(201)).body;
    expect(freed.held).toBeUndefined();
    expect(freed.exceptions[0].release).toMatchObject({ reason: 'Shipper re-sealed after counting the tiles; new seal written' });
    expect((await liveCases()).filter((c) => c.subject === code)).toEqual([]);
    const closed = (await http().get('/v1/sbg/flag-cases').query({ which: 'closed', kind: 'Tamper_Hold' }).set(operator).expect(200)).body.items.find((c: { subject: string }) => c.subject === code);
    expect(closed.history.at(-1)).toMatchObject({ act: 'done', text: 'Released: Shipper re-sealed after counting the tiles; new seal written' });
    expect((await release(code, 'Released twice is not a release').expect(400)).body.detail).toBe('This is not held');
    await http().post(`/v1/sbg/dispatch/freight/${freightId}/pickup`).set(driver.token).send(await pickup('KE 5555-001')).expect(201);

    // ON THE ROAD: the wrap cut. Held again at once, under a new case — the earlier one's close does not quiet it.
    await report(driver.token, { finding: 'seal_not_as_written', sealId: seal.sealId, numberRead: 'X1', photoRefs: [await photo(driver.token, 'tamper')] }).expect(400);
    expect((await report(driver.token, { finding: 'wrap_cut', photoRefs: [await photo(driver.token, 'tamper')], location: { lat: -0.9, lng: 36.5 } }).expect(201)).body.held).toMatchObject({ finding: 'wrap_cut', stage: 'road', where: 'on the road' });
    cases = (await liveCases()).filter((c) => c.subject === code);
    expect(cases).toHaveLength(1);
    expect(cases[0].history[0].act).toBe('opened_again');
    const deliver = async (extra: Record<string, unknown>) => ({ confirmed: claim.unloadChecklist.map((x: { key: string }) => x.key), receiverName: 'Njoroge at the store', podPhotoId: await photo(driver.token, 'pod'), ...extra });
    expect((await http().post(`/v1/sbg/dispatch/freight/${freightId}/deliver`).set(driver.token).send(await deliver({ sealsAtDelivery: 'as_on_the_note' })).expect(409)).body.code).toBe('UNIT_HELD');
    await release(code, 'Driver re-wrapped at Naivasha weighbridge; no pallet short').expect(201);

    // AT THE DOOR: the seals not as the note says. Reported first — the receiver does not take the goods before operations
    // is told — then held until operations releases it.
    expect((await http().post(`/v1/sbg/dispatch/freight/${freightId}/deliver`).set(driver.token).send(await deliver({ sealsAtDelivery: 'not_as_on_the_note' })).expect(409)).body.code).toBe('TAMPER_REPORT_FIRST');
    expect((await report(driver.token, { finding: 'seal_not_as_on_the_note', photoRefs: [await photo(driver.token, 'tamper')] }).expect(201)).body.held).toMatchObject({ stage: 'delivery', where: 'at delivery' });
    await http().post(`/v1/sbg/dispatch/freight/${freightId}/deliver`).set(driver.token).send(await deliver({ sealsAtDelivery: 'not_as_on_the_note' })).expect(409);
    await release(code, 'Receiver counted with our agent on the phone: complete').expect(201);
    await http().post(`/v1/sbg/dispatch/freight/${freightId}/deliver`).set(driver.token).send(await deliver({ sealsAtDelivery: 'not_as_on_the_note' })).expect(201);

    // THE NOTE, box 18: each exception, where and when, and its release — never who found it by name.
    const note = (await http().get(`/v1/sbg/dispatch/freight/${freightId}/consignment-note`).set(biz).expect(200)).body;
    const said = JSON.stringify(note);
    expect(said).toMatch(/Held at pickup, .*: a seal on the door is not the one written \(seal 1, read as KE 5555-009\)\. Released by operations .*: Shipper re-sealed/);
    expect(said).toMatch(/Held on the road, .*: the wrap or packaging is cut or opened\. Released by operations/);
    expect(said).toMatch(/Held at delivery, .*: the seals are not as the note says\. Released by operations/);
    // The carrier is named in its own box, as the note always names it; the exceptions never say who found them.
    expect(JSON.stringify(note.reservations)).not.toContain('Wafula');
    expect((await http().get(`/v1/sbg/ops/tamper/${code}`).set(operator).expect(200)).body.exceptions).toHaveLength(3);
  });

  /** A shop signed up, vetted and funded: its did and its own sign-in. */
  async function aShop(shopName: string, zone: string): Promise<{ did: string; token: { authorization: string } }> {
    const u = digits();
    const hours = { open: '00:00', close: '23:59' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({
        shopName, zone, country: 'KE', location: { lat: -1.286, lng: 36.817 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: hours },
        fullName: `${shopName} owner`, nationalId: `ID-TMP-${u}`, mobile: `+2547${u}9`, deviceImei: `IMEI-TMP-${u}`,
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

  it('a parcel: its wrap cut at the shop that holds it and at the hub it stands at — set apart, into no bag, released by operations', async () => {
    const north = await aShop(`North TMP ${tag}`, `TmpNorth${tag}`);
    const south = await aShop(`South TMP ${tag}`, `TmpSouth${tag}`);
    const made = (await http().post('/v1/sbg/vendors').set(operator).send({ name: `Tamper Store ${tag}`, callbackUrl: 'https://store.example/hook' }).expect(201)).body;
    const storeToken = bearer((await http().post('/v1/sbg/vendors/login').send({ vendorId: made.vendorId, secret: made.secret }).expect(201)).body.token.access_token);
    const funded = await http().post(`/v1/sbg/vendors/${made.vendorId}/top-up`).set(storeToken).send({ amount: 5000 }).expect(201);
    await http().post(`/v1/rails/funding/${funded.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 5000 }).expect(201);
    const P = `63${String(Math.floor(Math.random() * 90_000) + 10_000)}`;
    await http().put(`/v1/sbg/vendors/${made.vendorId}/gs1`).set(storeToken).send({ companyPrefix: P, extensionDigit: 4 }).expect(200);
    const hub = (await http().post('/v1/sbg/mdps').set(operator).send({ name: `Tamper Hub ${tag}`, zones: [`TmpSouth${tag}`], location: { lat: -1.25, lng: 36.9 } }).expect(201)).body;
    const hubToken = bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: hub.did }).expect(201)).body.access_token);
    const parcels: Array<{ parcelId: string; sscc: string }> = [];
    for (let i = 0; i < 2; i += 1) {
      const order = (await http().post('/v1/sbg/inbound/orders').set(storeToken).send({ vendorId: made.vendorId, originPudoDid: north.did, destPudoDid: south.did, buyerMobile: `+2547${digits()}${i}`, size: 'M', weightKg: 2, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), storeToken) }).expect(201)).body;
      await http().post(`/v1/sbg/parcels/${order.parcel.parcelId}/intake`).set(north.token).send({ agentDid: north.did }).expect(201);
      parcels.push({ parcelId: order.parcel.parcelId, sscc: order.parcel.sscc });
    }
    const [one, two] = parcels;
    const atCounter = (who: { authorization: string }, id: string, body: Record<string, unknown>) => http().post(`/v1/sbg/parcels/${id}/tamper`).set(who).send(body);

    // AT THE SHOP THAT HOLDS IT: the wrap cut, photographed. Another shop is told what it would be told of a number nobody
    // was given; staff do not report from a desk.
    await atCounter(north.token, one.parcelId, {}).expect(400);
    expect((await atCounter(south.token, one.parcelId, { photoRefs: [await photo(south.token, 'tamper')] }).expect(404)).body.detail).toBe('No parcel you hold has that number');
    await atCounter(operator, one.parcelId, { photoRefs: [] }).expect(403);
    const held = (await atCounter(north.token, one.parcelId, { photoRefs: [await photo(north.token, 'tamper')], note: 'Tape slit along the side' }).expect(201)).body;
    expect(held).toMatchObject({ unitType: 'parcel', ref: one.parcelId, held: { finding: 'wrap_cut', stage: 'counter', where: `at North TMP ${tag}` } });
    expect(held.exceptions[0]).toMatchObject({ ssccs: [one.sscc], byAs: 'shop', note: 'Tape slit along the side' });

    // SET APART: into no bag; the store's own system is told it is held.
    const bag = (await http().post(`/v1/sbg/mdps/${hub.mdpId}/totes`).set(operator).expect(201)).body.code as string;
    await http().post(`/v1/sbg/totes/${bag}/assign`).set(operator).send({ destinationNodeId: hub.mdpId, destinationLabel: 'Tamper Hub' }).expect(201);
    expect((await http().post(`/v1/sbg/totes/${bag}/fill`).set(operator).send({ parcelId: one.parcelId }).expect(409)).body.detail).toMatch(new RegExp(`Parcel ${one.parcelId} is held: the wrap or packaging is cut or opened`));
    const outbox = (await http().get(`/v1/sbg/vendors/${made.vendorId}/callbacks`).set(storeToken).expect(200)).body as Array<{ event: string; body: string }>;
    const toldHeld = outbox.find((c) => c.event === 'held');
    expect(toldHeld?.body).toContain(one.parcelId);
    expect(toldHeld?.body).toContain('"finding":"wrap_cut"');
    expect((await liveCases()).find((c) => c.subject === one.parcelId)).toMatchObject({ severity: 'critical' });
    // Not in the shop's bag plan, not due onto a bus, refused onto one — and the parcel left on the shelf beside it is
    // what the bus is short of, not the one set apart.
    const plan = (await http().get(`/v1/sbg/agents/${north.did}/bag-plan`).set(north.token).expect(200)).body as { groups: Array<{ parcelIds: string[] }> };
    expect(plan.groups.flatMap((g) => g.parcelIds)).toEqual([two.parcelId]);
    const corridor = (await http().post('/v1/sbg/corridors').set(operator).send({ name: `TmpNorth → TmpSouth ${tag}`, originZone: `TmpNorth${tag}`, destZone: `TmpSouth${tag}` }).expect(201)).body;
    const bus = (await http().post('/v1/sbg/drivers').set(operator).send({ driverDid: `did:glos:tmpbus${tag}`, name: 'Odhiambo', corridorId: corridor.corridorId }).expect(201)).body;
    const manifest = (await http().post('/v1/sbg/parcels/handover/manifest').set(north.token).send({ driverBadgeId: bus.badgeId }).expect(201)).body as { parcels: Array<{ parcelId: string }> };
    expect(manifest.parcels.map((p) => p.parcelId)).toEqual([two.parcelId]);
    const handed = (await http().post('/v1/sbg/parcels/handover').set(north.token).send({ driverBadgeId: bus.badgeId, parcelIds: [one.parcelId], acknowledgeShortShip: true, shortShipReason: 'Next bus' }).expect(201)).body;
    expect(handed.rejected).toEqual([{ parcelId: one.parcelId, reason: 'held' }]);
    expect(handed.handed).toEqual([]);
    // Every other act that would move it refuses too, by reading the parcel itself.
    const parcelsSvc = app.get(ParcelService);
    for (const act of [
      () => parcelsSvc.void(one.parcelId, north.did, 'med_x'),
      () => parcelsSvc.arrive(one.parcelId, south.did),
      () => parcelsSvc.shelve(one.parcelId, south.did),
      () => parcelsSvc.pickup(one.parcelId, south.did, '000000'),
      () => parcelsSvc.collectConfirm(one.parcelId, south.did, '000000'),
      () => parcelsSvc.closeAsReturned(one.parcelId, 'prc_return'),
      () => parcelsSvc.setTransit(one.parcelId, 'On_Bus', bus.badgeId, 'bag'),
    ]) expect(act).toThrow(/is held/);

    // Released: it goes into the bag with the other, onto the bus, to the hub.
    await release(one.parcelId, 'Store confirmed the box was taped twice at packing; contents photo matches').expect(201);
    expect(((await http().get(`/v1/sbg/vendors/${made.vendorId}/callbacks`).set(storeToken).expect(200)).body as Array<{ event: string }>).some((c) => c.event === 'released')).toBe(true);
    for (const p of parcels) await http().post(`/v1/sbg/totes/${bag}/fill`).set(operator).send({ parcelId: p.parcelId }).expect(201);
    await http().post(`/v1/sbg/totes/${bag}/load`).set(operator).send({ driverBadgeId: 'BUS-9' }).expect(201);
    await http().post(`/v1/sbg/mdps/${hub.mdpId}/drop-bag`).set(operator).send({ code: bag }).expect(201);

    // AT THE HUB: one sorted into the bag onward, then found cut — taken back out of that bag; the other found cut before
    // sorting. Neither sorted, bagged or moved on until released; the shop it was handed in at no longer holds it.
    const sorted = (await http().post(`/v1/sbg/mdps/${hub.mdpId}/sort`).set(operator).send({ parcelId: one.parcelId }).expect(201)).body;
    const atHub = (id: string) => http().post(`/v1/sbg/mdps/${hub.mdpId}/parcels/${id}/tamper`);
    await atHub(two.parcelId).set(north.token).send({ photoRefs: [await photo(north.token, 'tamper')] }).expect(403);
    await atCounter(north.token, two.parcelId, { photoRefs: [await photo(north.token, 'tamper')] }).expect(404);
    expect((await atHub(one.parcelId).set(hubToken).send({ photoRefs: [await photo(hubToken, 'tamper')] }).expect(201)).body.held).toMatchObject({ stage: 'hub', where: `at Tamper Hub ${tag}` });
    expect((await http().get(`/v1/sbg/totes/${sorted.toteCode}`).set(operator).expect(200)).body.parcels).not.toContain(one.parcelId);
    await atHub(two.parcelId).set(hubToken).send({ photoRefs: [await photo(hubToken, 'tamper')] }).expect(201);
    expect((await http().post(`/v1/sbg/mdps/${hub.mdpId}/sort`).set(operator).send({ parcelId: two.parcelId }).expect(409)).body.code).toBe('UNIT_HELD');
    const staffView = (await http().get(`/v1/sbg/ops/tamper/${one.parcelId}`).set(operator).expect(200)).body;
    expect(staffView.exceptions.map((e: { stage: string }) => e.stage)).toEqual(['hub', 'counter']);
    await release(two.parcelId, 'Hub supervisor resealed with our tape; weight matches the label').expect(201);
    await http().post(`/v1/sbg/mdps/${hub.mdpId}/sort`).set(operator).send({ parcelId: two.parcelId }).expect(201);
  });
});
