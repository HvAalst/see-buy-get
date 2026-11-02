import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { contentPhotoOver, CONTENTS_PNG } from './content-photo';
import { declared } from './declared';
import { AGREED } from './agreed';

type Auth = Record<string, string>;
interface Hub {
  mdpId: string;
  did: string;
  name: string;
  token: Auth;
}
interface Shop {
  did: string;
  token: Auth;
}

/**
 * 2026-11-02 — A HUB DECLARES ITS SPACE, AND A FULL ONE IS ROUTED AROUND, over the wire (the owner: "shouldn't a hub also
 * declare its space?"). Its owner says how many bags its floor holds and how many parcels it sorts a day — at sign-up or on
 * its start screen; its people read it, and neither they nor staff say it. What stands on the floor is counted: bags waiting
 * to be sorted and bags going out, never a flat empty one. A full floor sends the next bag to another approved hub for the
 * zone; with none, the bag waits where it is, offered to nobody, and its holder is told once; room freed, it goes on by
 * itself and the holder is told. A driver dropping bags is never turned away: the floor shows over-full. A full day goes to
 * another hub with room today, or goes on. A hub that never said is never full, and is asked.
 */
describe('a hub declares its space, and a full hub is routed around, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: Auth;
  const bearer = (token: string): Auth => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const tag = digits();
  let seq = 0;
  let store: { vendorId: string; token: Auth };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    app.setGlobalPrefix('v1');
    await app.init();
    http = () => request(app.getHttpServer());
    operator = bearer((await http().post('/v1/auth/token').send({ role: 'operator', type: 'client_credentials' }).expect(201)).body.access_token);
    const made = (await http().post('/v1/sbg/vendors').set(operator).send({ ...AGREED, name: `Space Store ${tag}`, callbackUrl: 'https://store.example/hook' }).expect(201)).body;
    const token = bearer((await http().post('/v1/sbg/vendors/login').send({ vendorId: made.vendorId, secret: made.secret }).expect(201)).body.token.access_token);
    const funded = await http().post(`/v1/sbg/vendors/${made.vendorId}/top-up`).set(token).send({ amount: 20000 }).expect(201);
    await http().post(`/v1/rails/funding/${funded.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 20000 }).expect(201);
    store = { vendorId: made.vendorId, token };
  });

  afterAll(async () => {
    await app?.close();
  });

  const photo = async (who: Auth, kind: string) => {
    seq += 1;
    const dataUrl = `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${tag}:${seq}`)]).toString('base64')}`;
    return (await http().post('/v1/sbg/media').set(who).send({ kind, dataUrl }).expect(201)).body.mediaId as string;
  };

  async function aShop(shopName: string, zone: string): Promise<Shop> {
    const u = digits();
    const hours = { open: '00:00', close: '23:59' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({
        shopName, zone, country: 'KE', location: { lat: -1.286, lng: 36.817 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: hours },
        fullName: `${shopName} owner`, nationalId: `ID-SPC-${u}`, mobile: `+2547${u}9`, deviceImei: `IMEI-SPC-${u}`,
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
    // Room at the counter for every bag these tests close there: the hub's floor is what is under test, not the shop's.
    await http().post(`/v1/sbg/agents/${did}/bag-bays`).set(token).send({ bays: 10 }).expect(201);
    return { did, token };
  }

  /** A hub staff register, approved by them: with its space said, or not. */
  async function aHub(name: string, zones: string[], space?: { bagPlaces: number; sortPerDay: number }): Promise<Hub> {
    const hub = (await http().post('/v1/sbg/mdps').set(operator).send({ name, zones, location: { lat: -1.25, lng: 36.9 }, ...(space ?? {}) }).expect(201)).body;
    declared(app, 'hub', hub.did);
    return { mdpId: hub.mdpId, did: hub.did, name: hub.name, token: bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: hub.did }).expect(201)).body.access_token) };
  }

  /** A store's parcel taken in at `from`, for `to`. */
  async function aParcel(from: Shop, to: Shop): Promise<string> {
    const order = (await http().post('/v1/sbg/inbound/orders').set(store.token).send({ vendorId: store.vendorId, originPudoDid: from.did, destPudoDid: to.did, buyerMobile: `+2547${digits()}1`, size: 'M', weightKg: 2, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), store.token) }).expect(201)).body;
    await http().post(`/v1/sbg/parcels/${order.parcel.parcelId}/intake`).set(from.token).send({ agentDid: from.did }).expect(201);
    return order.parcel.parcelId as string;
  }

  /** A bag at `from` for `zone`, with one new parcel for `to` in it, closed on a photograph — and so offered, or held. */
  async function aClosedBag(from: Shop, to: Shop, zone: string): Promise<{ code: string; parcelId: string }> {
    const parcelId = await aParcel(from, to);
    const code = (await http().post(`/v1/sbg/agents/${from.did}/totes`).set(from.token).send({ destZone: zone }).expect(201)).body.code as string;
    await http().post(`/v1/sbg/agents/${from.did}/totes/${code}/fill`).set(from.token).send({ parcelId }).expect(201);
    await http().post(`/v1/sbg/agents/${from.did}/totes/${code}/seal`).set(from.token).send({ acknowledgeShortShip: true, shortShipReason: 'in a bag of its own', closure: { photoRef: await photo(from.token, 'seal') } }).expect(201);
    return { code, parcelId };
  }

  const bag = async (code: string) => (await http().get(`/v1/sbg/totes/${code}`).set(operator).expect(200)).body;
  const spaceOf = async (hub: Hub) => (await http().get(`/v1/sbg/mdps/${hub.mdpId}/space`).set(hub.token).expect(200)).body;
  const told = async (who: Auth, title: RegExp) =>
    ((await http().get('/v1/sbg/notifications/inbox').set(who).expect(200)).body.items as Array<{ kind: string; title: string; body: string; link?: string }>).filter((n) => n.kind === 'hub_space' && title.test(n.title));
  const load = (code: string, badge = 'BUS-7') => http().post(`/v1/sbg/totes/${code}/load`).set(operator).send({ driverBadgeId: badge });
  /** A bag dropped at a hub: taken, whatever its floor holds. */
  const drop = async (hub: Hub, code: string) => (await http().post(`/v1/sbg/mdps/${hub.mdpId}/drop-bag`).set(hub.token).send({ code, receipt: { photoRef: await photo(hub.token, 'seal'), asClosed: true } }).expect(201)).body;

  /** A motorcycle courier on shift at the shops, and what they are offered around them. */
  async function aRider(): Promise<() => Promise<string[]>> {
    seq += 1;
    const u = `${tag}${seq}`;
    const d = (await http().post('/v1/sbg/drivers/onboard').set(operator).send({ displayName: 'Juma', fullName: 'Juma Rider', nationalId: `DRV-SPC-${u}`, mobile: `+2547${digits().slice(-6)}${seq}`, licenceClasses: ['bike'] }).expect(201)).body;
    declared(app, 'driver', d.did);
    const moto = (await http().post('/v1/sbg/vehicles').set(operator).send({ plate: `SP-${u}`, vehicleClass: 'bike', ownerName: 'Juma' }).expect(201)).body;
    await http().post(`/v1/sbg/fleet/drivers/${d.did}/start-session`).set(operator).send({ vehicleId: moto.vehicleId }).expect(201);
    return async () =>
      ((await http().post(`/v1/sbg/fleet/drivers/${d.did}/suggest-nearby`).set(operator).send({ at: { lat: -1.286, lng: 36.817 }, radiusKm: 5 }).expect(201)).body.offers as Array<{ ref: string }>).map((o) => o.ref);
  }

  it('is said by the hub’s owner — at sign-up or on its start screen — read by its people, and said by neither them nor staff; one that never said is never full, and is asked', async () => {
    // AT SIGN-UP ("About your hub"): two numbers, or neither; a number out of bounds is refused before anything is made.
    const signUp = async (u: string, space: Record<string, unknown>, status: number) => {
      const phone = `+2547${u}5`;
      const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
      await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
      return (await http().post('/v1/sbg/auth/signup').send({ ...AGREED, role: 'mdp', email: `ghala.${u}@depot.example`, password: 'mabati-na-misumari-4', phone, profile: { mdp: { name: `Ghala ${u}`, zones: [`SU${u}`], country: 'KE', location: { lat: -1.3, lng: 36.9 }, ...space } } }).expect(status)).body;
    };
    const refused = await signUp(digits(), { bagPlaces: 0, sortPerDay: 600 }, 400);
    expect(refused).toMatchObject({ code: 'INVALID_INPUT', params: { field: 'bagPlaces' } });
    expect(await signUp(digits(), { bagPlaces: 40 }, 400)).toMatchObject({ params: { field: 'sortPerDay' } });
    const said = await signUp(digits(), { bagPlaces: 40, sortPerDay: 600 }, 201);
    const saidToken = bearer(said.token.access_token as string);
    const own = ((await http().get('/v1/sbg/mdps').set(saidToken).expect(200)).body as Array<{ did: string; bagPlaces?: number; space?: Record<string, unknown> }>).find((m) => m.did === said.did);
    expect(own).toMatchObject({ bagPlaces: 40, sortPerDay: 600, space: { declared: true, bagPlaces: 40, sortPerDay: 600, free: 40, onFloor: 0, sortedToday: 0, floorFull: false, dayFull: false } });
    const silent = await signUp(digits(), {}, 201);
    const silentRow = ((await http().get('/v1/sbg/mdps').set(bearer(silent.token.access_token as string)).expect(200)).body as Array<{ did: string; space?: Record<string, unknown> }>).find((m) => m.did === silent.did);
    expect(silentRow?.space).toMatchObject({ declared: false, floorFull: false, dayFull: false, noRoom: false });

    // ON ITS START SCREEN: the owner says it; staff are refused by name; a number out of bounds is refused.
    const hub = await aHub(`Space Hub ${tag}`, [`SpaceZ${tag}`]);
    expect(await spaceOf(hub)).toMatchObject({ declared: false, onFloor: 0, floorFull: false, noRoom: false });
    expect((await http().put(`/v1/sbg/mdps/${hub.mdpId}/space`).set(operator).send({ bagPlaces: 10, sortPerDay: 100 }).expect(403)).body.detail).toMatch(/Staff change nothing in its name/);
    await http().put(`/v1/sbg/mdps/${hub.mdpId}/space`).set(hub.token).send({ bagPlaces: 0, sortPerDay: 100 }).expect(400);
    await http().put(`/v1/sbg/mdps/${hub.mdpId}/space`).set(hub.token).send({ bagPlaces: 10.5, sortPerDay: 100 }).expect(400);
    expect((await http().put(`/v1/sbg/mdps/${hub.mdpId}/space`).set(hub.token).send({ bagPlaces: 10, sortPerDay: 100 }).expect(200)).body).toMatchObject({ declared: true, bagPlaces: 10, sortPerDay: 100, free: 10, saidAt: expect.any(String) });
    // Another hub reads nothing of it; staff read it.
    const other = await aHub(`Other Space Hub ${tag}`, [`OtherZ${tag}`]);
    await http().get(`/v1/sbg/mdps/${hub.mdpId}/space`).set(other.token).expect(403);
    await http().put(`/v1/sbg/mdps/${hub.mdpId}/space`).set(other.token).send({ bagPlaces: 1, sortPerDay: 1 }).expect(403);
    expect((await http().get(`/v1/sbg/mdps/${hub.mdpId}/space`).set(operator).expect(200)).body).toMatchObject({ bagPlaces: 10 });

    // ITS PEOPLE read it, and are refused its saying — the owner's door.
    const phone = `+2547${digits()}3`;
    const added = (await http().post('/v1/sbg/hub/staff').set(hub.token).send({ phone, name: 'Otieno' }).expect(201)).body;
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `sakafu${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const person = bearer((await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token as string);
    await http().post(`/v1/sbg/shop-invitations/${added.memberId}/accept`).set(person).expect(201);
    const staff = bearer((await http().post(`/v1/sbg/hubs/${hub.did}/staff-session`).set(person).expect(201)).body.token.access_token as string);
    expect((await http().get(`/v1/sbg/mdps/${hub.mdpId}/space`).set(staff).expect(200)).body).toMatchObject({ bagPlaces: 10, sortPerDay: 100 });
    expect((await http().put(`/v1/sbg/mdps/${hub.mdpId}/space`).set(staff).send({ bagPlaces: 99, sortPerDay: 999 }).expect(403)).body.detail).toMatch(/owner/);
    expect(await spaceOf(hub)).toMatchObject({ bagPlaces: 10, sortPerDay: 100 });

    // ONE THAT NEVER SAID IS NEVER FULL: a bag on its floor, and the next bag for it is offered all the same.
    const zone = `NeverZ${tag}`;
    const never = await aHub(`Never Said Hub ${tag}`, [zone]);
    const from = await aShop(`Never From ${tag}`, `NeverFrom${tag}`);
    const to = await aShop(`Never To ${tag}`, zone);
    const first = await aClosedBag(from, to, zone);
    expect(await bag(first.code)).toMatchObject({ status: 'available', toHubId: never.mdpId });
    await load(first.code).expect(201);
    await drop(never, first.code);
    expect(await spaceOf(never)).toMatchObject({ declared: false, inbound: 1, onFloor: 1, floorFull: false, noRoom: false });
    const second = await aClosedBag(from, to, zone);
    expect((await bag(second.code)).waitsForRoom).toBeUndefined();
  });

  it('counts what stands on the floor — bags waiting to be sorted and bags going out, never a flat empty one — and sends the next bag to another hub for the zone when it is full; with none, it waits, is offered to nobody, and its holder is told once — and goes on when the owner raises the places', async () => {
    const zone = `RouteZ${tag}`;
    const first = await aHub(`First Hub ${tag}`, [zone], { bagPlaces: 1, sortPerDay: 500 });
    const second = await aHub(`Second Hub ${tag}`, [zone], { bagPlaces: 2, sortPerDay: 500 });
    const from = await aShop(`Route From ${tag}`, `RouteFrom${tag}`);
    const to = await aShop(`Route To ${tag}`, zone);
    const offered = await aRider();

    // A flat empty bag takes no place; a bag opened for a destination does.
    const flat = (await http().post(`/v1/sbg/mdps/${first.mdpId}/totes`).set(first.token).expect(201)).body.code as string;
    expect(await spaceOf(first)).toMatchObject({ onFloor: 0, free: 1, floorFull: false });
    await http().post(`/v1/sbg/totes/${flat}/assign`).set(first.token).send({ destinationNodeId: to.did, destinationLabel: 'Route To' }).expect(201);
    await http().post(`/v1/sbg/mdps/${first.mdpId}/totes`).set(first.token).expect(201); // another flat one
    expect(await spaceOf(first)).toMatchObject({ inbound: 0, outbound: 1, onFloor: 1, free: 0, floorFull: true, noRoom: true });

    // The first hub is full: the next bag goes to the second, which serves the zone too.
    const one = await aClosedBag(from, to, zone);
    expect(await bag(one.code)).toMatchObject({ status: 'available', toHubId: second.mdpId });
    expect((await bag(one.code)).waitsForRoom).toBeUndefined();
    const two = await aClosedBag(from, to, zone);
    expect(await bag(two.code)).toMatchObject({ toHubId: second.mdpId });
    expect(await spaceOf(second)).toMatchObject({ onFloor: 0, comingIn: 2, floorFull: false, noRoom: true });

    // Neither has room: it waits at the shop, offered to nobody, handed to no driver, and the shop is told — once.
    const three = await aClosedBag(from, to, zone);
    expect(await bag(three.code)).toMatchObject({ status: 'available', waitsForRoom: { hubId: first.mdpId, hubName: first.name } });
    expect(await offered()).toEqual(expect.arrayContaining([one.code, two.code]));
    expect(await offered()).not.toContain(three.code);
    expect((await load(three.code).expect(409)).body).toMatchObject({ code: 'BAG_WAITS_FOR_ROOM' });
    const waits = await told(from.token, new RegExp(`Bag ${three.code} waits for room`));
    expect(waits).toHaveLength(1);
    expect(waits[0]).toMatchObject({ link: '/?go=bag' });
    expect(waits[0].body).toMatch(/no room on its floor .* it is offered to drivers again by itself when there is room/);
    expect(((await http().get(`/v1/sbg/agents/${from.did}/bag-plan`).set(from.token).expect(200)).body.bags as Array<{ code: string; waitsFor?: string }>).find((b) => b.code === three.code)).toMatchObject({ waitsFor: first.name });
    expect(await spaceOf(first)).toMatchObject({ waiting: 1 });
    await http().post('/v1/sbg/dispatch/publish-ready').set(operator).expect(201);
    expect(await told(from.token, new RegExp(`Bag ${three.code} waits for room`))).toHaveLength(1);

    // The first hub's owner raises its places: the bag goes on by itself, to it, and the shop is told.
    await http().put(`/v1/sbg/mdps/${first.mdpId}/space`).set(first.token).send({ bagPlaces: 3, sortPerDay: 500 }).expect(200);
    const gone = await bag(three.code);
    expect(gone.waitsForRoom).toBeUndefined();
    expect(gone).toMatchObject({ toHubId: first.mdpId });
    expect(await told(from.token, new RegExp(`Bag ${three.code} can go on`))).toHaveLength(1);
    expect(await offered()).toContain(three.code);
  });

  it('takes every bag a driver drops, a full floor shown over-full; a bag for the only hub of its zone waits at its shop, and goes on by itself once a bag is collected off that floor', async () => {
    const zone = `FloorZ${tag}`;
    const hub = await aHub(`Floor Hub ${tag}`, [zone], { bagPlaces: 2, sortPerDay: 500 });
    const north = await aShop(`Floor North ${tag}`, `FloorNorth${tag}`);
    const waitingShop = await aShop(`Floor East ${tag}`, `FloorEast${tag}`);
    const south = await aShop(`Floor South ${tag}`, zone);
    const one = await aClosedBag(north, south, zone);
    const two = await aClosedBag(north, south, zone);
    expect([(await bag(one.code)).toHubId, (await bag(two.code)).toHubId]).toEqual([hub.mdpId, hub.mdpId]);
    // Its owner says fewer places while both are on their way: both are taken all the same.
    await http().put(`/v1/sbg/mdps/${hub.mdpId}/space`).set(hub.token).send({ bagPlaces: 1, sortPerDay: 500 }).expect(200);
    await load(one.code).expect(201);
    await load(two.code).expect(201);
    await drop(hub, one.code);
    expect(await spaceOf(hub)).toMatchObject({ inbound: 1, onFloor: 1, free: 0, floorFull: true });
    await drop(hub, two.code);
    expect(await spaceOf(hub)).toMatchObject({ inbound: 2, onFloor: 2, free: 0, overBy: 1, floorFull: true });

    // The zone's only hub is full: the next bag waits at its shop, and the shop is told.
    const three = await aClosedBag(waitingShop, south, zone);
    expect(await bag(three.code)).toMatchObject({ waitsForRoom: { hubId: hub.mdpId } });
    expect(await told(waitingShop.token, new RegExp(`Bag ${three.code} waits for room at ${hub.name}`))).toHaveLength(1);

    // Sorting turns the bags that came in into one going out: still a bag on the floor, so it still waits.
    const sorted = (await http().post(`/v1/sbg/mdps/${hub.mdpId}/sort`).set(hub.token).send({ parcelId: one.parcelId }).expect(201)).body;
    expect(await spaceOf(hub)).toMatchObject({ inbound: 1, outbound: 1, onFloor: 2, sortedToday: 1 });
    expect((await http().post(`/v1/sbg/mdps/${hub.mdpId}/sort`).set(hub.token).send({ parcelId: two.parcelId }).expect(201)).body.toteCode).toBe(sorted.toteCode);
    expect(await spaceOf(hub)).toMatchObject({ inbound: 0, outbound: 1, onFloor: 1, sortedToday: 2, floorFull: true });
    expect((await bag(three.code)).waitsForRoom).toMatchObject({ hubId: hub.mdpId });

    // Its bag closed and collected: its place is free, and the waiting bag goes on by itself — the shop told.
    await http().post(`/v1/sbg/totes/${sorted.toteCode}/close`).set(hub.token).send({ photoRef: await photo(hub.token, 'seal') }).expect(201);
    await load(sorted.toteCode, 'BUS-8').expect(201);
    expect(await spaceOf(hub)).toMatchObject({ onFloor: 0, comingIn: 1, free: 1 });
    expect((await bag(three.code)).waitsForRoom).toBeUndefined();
    expect(await told(waitingShop.token, new RegExp(`Bag ${three.code} can go on`))).toHaveLength(1);
    await load(three.code).expect(201);
  });

  it('sends a bag to another hub with room today when a hub’s day is full, and on to it all the same where it is the only one — the hub told its day is full', async () => {
    const both = `DayZ${tag}`;
    const onlyFirst = `DayOnly${tag}`;
    const full = await aHub(`Day Hub ${tag}`, [both, onlyFirst], { bagPlaces: 50, sortPerDay: 1 });
    const room = await aHub(`Day Room Hub ${tag}`, [both], { bagPlaces: 50, sortPerDay: 100 });
    const from = await aShop(`Day From ${tag}`, `DayFrom${tag}`);
    const to = await aShop(`Day To ${tag}`, both);
    const toOnly = await aShop(`Day Only To ${tag}`, onlyFirst);

    const first = await aClosedBag(from, to, both);
    expect(await bag(first.code)).toMatchObject({ toHubId: full.mdpId });
    await load(first.code).expect(201);
    await drop(full, first.code);
    await http().post(`/v1/sbg/mdps/${full.mdpId}/sort`).set(full.token).send({ parcelId: first.parcelId }).expect(201);
    expect(await spaceOf(full)).toMatchObject({ sortedToday: 1, dayFull: true, floorFull: false });
    const dayTold = await told(full.token, /Today’s sorting is full/);
    expect(dayTold).toHaveLength(1);
    expect(dayTold[0].body).toMatch(/Bags are still taken from every driver/);

    // Another hub has room today: the next bag goes there. The only hub for its zone: it goes on, to be sorted tomorrow.
    expect(await bag((await aClosedBag(from, to, both)).code)).toMatchObject({ toHubId: room.mdpId });
    const onward = await bag((await aClosedBag(from, toOnly, onlyFirst)).code);
    expect(onward).toMatchObject({ status: 'available', toHubId: full.mdpId });
    expect(onward.waitsForRoom).toBeUndefined();
  });
});
