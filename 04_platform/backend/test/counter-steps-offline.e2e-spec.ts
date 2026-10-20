import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { shopPhotoOver } from './content-photo';
import { ParcelService } from '../src/modules/pudo/parcel.service';
import { ToteService } from '../src/modules/pudo/tote.service';

/**
 * A COUNTER'S STEP DONE WITH NO SIGNAL KEEPS ITS TIME, over the wire (round 23, the user: "Counters' writes keep their
 * time"; "Every custody step"). A take-in, a hand-over to the bus, an arrival at the shop, and a shop's bag filled, sealed
 * and loaded — each sent hours after it was done — are dated when they were done, by round 22's rule: the phone's word
 * within limits, never before the parcel's step before it, and when it reached us kept beside it.
 */
describe('a counter’s step done with no signal keeps its time, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let staff: Record<string, string>;
  const tag = Math.random().toString(36).slice(2, 8);
  const H = 3_600_000;
  const iso = (ms: number) => new Date(ms).toISOString();
  const north = `North-${tag}`;
  const south = `South-${tag}`;
  let origin = '';
  let dest = '';
  let badge = '';
  let parcels: ParcelService;
  let totes: ToteService;
  let seq = 0;

  const hours = { open: '00:00', close: '23:59' };
  const onboard = async (shopName: string, zone: string): Promise<string> => {
    const u = Math.random().toString(16).slice(2, 10);
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(staff)
      .send({ shopName, zone, location: { lat: -1.2, lng: 36.8 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 }, openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: hours }, fullName: `${shopName} owner`, nationalId: `ID-${u}`, mobile: `+254${u}`, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } })
      .expect(201);
    const did = reg.body.did as string;
    const shop = await asShop(did);
    await http()
      .post(`/v1/sbg/agents/${did}/submit-kyc`)
      .set(shop)
      .send({ idCopyRef: await photo(shop, 'kyc_id'), tradingLicenceRef: await photo(shop, 'kyc_licence'), shopPhotoRefs: [await photo(shop, 'shop')] })
      .expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(staff).send({ approve: true }).expect(201);
    return did;
  };
  const asShop = async (did: string) => ({ authorization: `Bearer ${(await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token}` });
  const photo = async (who: Record<string, string>, kind: string) => {
    seq += 1;
    const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${tag}:${seq}`)]).toString('base64')}`;
    return (await http().post('/v1/sbg/media').set(who).send({ kind, dataUrl }).expect(201)).body.mediaId as string;
  };
  /** A walk-up taken in at the north shop, for the south — done at `at` and sent now. */
  const takeIn = async (parcelId: string, at?: number) =>
    (await http().post('/v1/sbg/parcels/accept').set(staff).send({ agentDid: origin, parcelId, size: 'S', destZone: south, destPudoDid: dest, senderMobile: '+254700000001', receiverMobile: '+254700000002', dropoffPhotoRef: await shopPhotoOver(app.getHttpServer(), origin), paymentMode: 'prepaid', ...(at ? { observedAt: iso(at) } : {}) }).expect(201)).body;
  const near = (a: string | undefined, b: number) => expect(Math.abs(Date.parse(a!) - b)).toBeLessThan(5_000);
  const lastScan = (id: string) => parcels.get(id).scans[parcels.get(id).scans.length - 1];
  const leg = (id: string, kind: string) => (parcels.get(id).custody ?? []).find((l) => l.holderKind === kind)!;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    staff = { authorization: `Bearer ${(await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token}` };
    parcels = app.get(ParcelService);
    totes = app.get(ToteService);
    origin = await onboard(`North ${tag}`, north);
    dest = await onboard(`South ${tag}`, south);
    const corridor = await http().post('/v1/sbg/corridors').set(staff).send({ name: `N-S ${tag}`, originZone: north, destZone: south }).expect(201);
    badge = (await http().post('/v1/sbg/drivers').set(staff).send({ driverDid: `did:glos:bus-${tag}`, name: 'John', corridorId: corridor.body.corridorId }).expect(201)).body.badgeId;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('dates a take-in, a hand-over to the bus and an arrival by the phone, within limits — and keeps when each reached us', async () => {
    // Taken in three hours ago with no signal, sent now: dated then, everywhere the take-in is written, with when it reached us.
    const tA = Date.now() - 3 * H;
    const a = await takeIn(`A-${tag}`, tA);
    expect(a.acceptedAt).toBe(iso(tA));
    expect(a.birthplace.at).toBe(iso(tA));
    expect(a.scans[0]).toMatchObject({ at: iso(tA), status: 'CREATED' });
    near(a.scans[0].receivedAt, Date.now());
    expect(a.custody[0]).toMatchObject({ holderKind: 'shop', from: iso(tA) });
    near(a.custody[0].receivedAt, Date.now());
    // The promise runs from the take-in: the journey is planned from three hours ago, not from now.
    const fresh = await takeIn(`FRESH-${tag}`);
    expect(fresh.scans[0].receivedAt).toBeUndefined();
    const readyBy = (id: string) => Date.parse(parcels.get(id).plan!.pickupReadyAt);
    expect(readyBy(`FRESH-${tag}`) - readyBy(`A-${tag}`)).toBeGreaterThan(3 * H - 60_000);

    // The limits: a phone ahead of the clock reads as now; a week is as far back as a phone is believed.
    const ahead = await takeIn(`AHEAD-${tag}`, Date.now() + 2 * H);
    near(ahead.acceptedAt, Date.now());
    expect(ahead.scans[0].receivedAt).toBeUndefined();
    const stale = await takeIn(`STALE-${tag}`, Date.now() - 10 * 24 * H);
    near(stale.acceptedAt, Date.now() - 7 * 24 * H);

    // Taken in an hour ago; and a third left on the shelf.
    const tB = Date.now() - 1 * H;
    await takeIn(`B-${tag}`, tB);
    await takeIn(`C-${tag}`, tA);

    // Handed to the bus two hours ago, sent now. A was taken in before then: handed then. B was taken in after: never
    // before its take-in. C, left behind on purpose, was left behind when the bus left.
    const tBus = Date.now() - 2 * H;
    const handed = (await http().post('/v1/sbg/parcels/handover').set(staff).send({ agentDid: origin, driverBadgeId: badge, parcelIds: [`A-${tag}`, `B-${tag}`], acknowledgeShortShip: true, shortShipReason: 'no room', observedAt: iso(tBus) }).expect(201)).body;
    expect(handed.handed).toEqual([`A-${tag}`, `B-${tag}`]);
    expect(handed.missed).toEqual(expect.arrayContaining([`C-${tag}`]));
    expect(parcels.get(`A-${tag}`).handedToBusAt).toBe(iso(tBus));
    expect(lastScan(`A-${tag}`)).toMatchObject({ status: 'On_Bus', at: iso(tBus) });
    near(lastScan(`A-${tag}`).receivedAt, Date.now());
    expect(leg(`A-${tag}`, 'shop').to).toBe(iso(tBus));
    expect(leg(`A-${tag}`, 'driver')).toMatchObject({ from: iso(tBus) });
    near(leg(`A-${tag}`, 'driver').receivedAt, Date.now());
    expect(parcels.get(`B-${tag}`).handedToBusAt).toBe(iso(tB));
    expect(parcels.get(`C-${tag}`).shortShippedAt).toBe(iso(tBus));
    near(lastScan(`C-${tag}`).receivedAt, Date.now());

    // Arrived at the shop an hour ago, sent now: on the shelf since then (the wait for collection began then). B arrived
    // before it was handed over, by its phone: never before the hand-over.
    const tShelf = Date.now() - 1 * H;
    await http().post(`/v1/sbg/parcels/A-${tag}/arrive`).set(staff).send({ destAgentDid: dest, observedAt: iso(tShelf) }).expect(201);
    expect(parcels.get(`A-${tag}`).readyAt).toBe(iso(tShelf));
    expect(lastScan(`A-${tag}`)).toMatchObject({ status: 'Ready_For_Pickup', at: iso(tShelf) });
    near(lastScan(`A-${tag}`).receivedAt, Date.now());
    expect(leg(`A-${tag}`, 'driver').to).toBe(iso(tShelf));
    await http().post(`/v1/sbg/parcels/B-${tag}/arrive`).set(staff).send({ destAgentDid: dest, observedAt: iso(Date.now() - 90 * 60_000) }).expect(201);
    expect(parcels.get(`B-${tag}`).readyAt).toBe(iso(tB));

    // The damage claim report carries it, and says it: a problem found at the shop, the steps as they were done.
    const shop = await asShop(dest);
    await http().post(`/v1/sbg/parcels/A-${tag}/dispute`).set(shop).send({ agentDid: dest, reason: 'Box crushed on one corner', photoProofRef: await photo(shop, 'dispute') }).expect(201);
    const report = (await http().get(`/v1/sbg/parcels/A-${tag}/damage-report`).set(staff).expect(200)).body;
    const bus = report.body.events.find((e: { status: string }) => e.status === 'On_Bus');
    expect(bus.at).toBe(iso(tBus));
    near(bus.receivedAt, Date.now());
    expect(report.body.custody.find((l: { holder: { kind: string } }) => l.holder.kind === 'driver').receivedAt).toBeDefined();
    const file = await http()
      .get(`/v1/sbg/parcels/A-${tag}/damage-report/file`)
      .set(staff)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((file.body as Buffer).toString('utf8')).toContain('Done with no signal; the phone there dated it, and SeeBuyGet heard of it');
  });

  it('dates a shop’s bag filled, sealed and loaded by the phone, never before the step it follows', async () => {
    const tIn = Date.now() - 4 * H;
    for (const id of [`D-${tag}`, `E-${tag}`, `F-${tag}`]) await takeIn(id, tIn);
    const shop = await asShop(origin);
    const { code } = (await http().post(`/v1/sbg/agents/${origin}/totes`).set(shop).send({ destZone: south }).expect(201)).body;

    // Filled three hours ago, sent now.
    const tFill = Date.now() - 3 * H;
    await http().post(`/v1/sbg/agents/${origin}/totes/${code}/fill`).set(shop).send({ parcelId: `D-${tag}`, observedAt: iso(tFill) }).expect(201);
    await http().post(`/v1/sbg/agents/${origin}/totes/${code}/fill`).set(shop).send({ parcelId: `E-${tag}`, observedAt: iso(tFill) }).expect(201);
    expect(totes.requireByCode(code).filledAt).toBe(iso(tFill));
    near(totes.requireByCode(code).filledReceivedAt, Date.now());

    // Sealed ninety minutes ago, F knowingly left out: closed then, and F left behind then.
    const tSeal = Date.now() - 90 * 60_000;
    await http().post(`/v1/sbg/agents/${origin}/totes/${code}/seal`).set(shop).send({ acknowledgeShortShip: true, shortShipReason: 'next bag', observedAt: iso(tSeal) }).expect(201);
    const sealed = totes.requireByCode(code);
    expect(sealed.sealedAt).toBe(iso(tSeal));
    expect(sealed.availableAt).toBe(iso(tSeal));
    near(sealed.sealedReceivedAt, Date.now());
    expect(parcels.get(`F-${tag}`).shortShippedAt).toBe(iso(tSeal));

    // Loaded "two hours ago" by a phone whose clock is behind: never before the bag was sealed.
    await http().post(`/v1/sbg/totes/${code}/load`).set(shop).send({ driverBadgeId: badge, observedAt: iso(Date.now() - 2 * H) }).expect(201);
    expect(parcels.get(`D-${tag}`).handedToBusAt).toBe(iso(tSeal));
    expect(lastScan(`D-${tag}`)).toMatchObject({ status: 'On_Bus', at: iso(tSeal) });
    near(lastScan(`D-${tag}`).receivedAt, Date.now());
    expect(leg(`D-${tag}`, 'driver').from).toBe(iso(tSeal));
  });

  it('dates a step sent with no time of its own when it arrives, as before', async () => {
    const before = Date.now();
    const g = await takeIn(`G-${tag}`);
    expect(Date.parse(g.acceptedAt)).toBeGreaterThanOrEqual(before);
    expect(g.scans[0].receivedAt).toBeUndefined();
    await http().post('/v1/sbg/parcels/handover').set(staff).send({ agentDid: origin, driverBadgeId: badge, parcelIds: [`G-${tag}`], acknowledgeShortShip: true }).expect(201);
    expect(Date.parse(parcels.get(`G-${tag}`).handedToBusAt!)).toBeGreaterThanOrEqual(before);
    expect(lastScan(`G-${tag}`).receivedAt).toBeUndefined();
  });
});
