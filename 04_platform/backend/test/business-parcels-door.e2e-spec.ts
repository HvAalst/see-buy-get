import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CONTENTS_PNG } from './content-photo';
import { AGREED } from './agreed';
import { declared } from './declared';
import { FundingService } from '../src/foundation/funding/funding.service';
import { EventBus } from '../src/foundation/events/event-bus.service';
import { GlosEvent } from '../src/foundation/events/glos-events';
import { VendorService } from '../src/modules/pudo/vendor.service';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { ParcelService } from '../src/modules/pudo/parcel.service';
import { DriverService } from '../src/modules/pudo/driver.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { FleetService } from '../src/modules/pudo/fleet.service';
import { BusinessHookService } from '../src/modules/pudo/business-hooks.service';
import { BusinessDoorService } from '../src/modules/pudo/business-door.service';
import { NotificationDispatcher } from '../src/modules/pudo/notification-dispatcher.service';
import { UnclaimedService } from '../src/modules/pudo/unclaimed.service';
import { WalletGateService } from '../src/modules/pudo/wallet-gate.service';

/**
 * A BUSINESS'S PARCEL DELIVERED TO ITS OWN PLACE, over the wire (the user, 2026-10-29: "A driver's last leg, priced on the
 * day"; "At the nearest shop"). It goes to the shop nearest the place, as every parcel goes to a shop; once ready there, a
 * load is posted from the shop to the place, at the driver's price and never above what the business allows, billed to its
 * parcel balance when a driver takes it. The shop hands the box only to that driver, by their pass; at the door its chain
 * ends with whoever signed. Collected at the shop with its code instead, the load is withdrawn. Without the money for the
 * last leg, nothing is posted until there is, and the business is told.
 */
describe('a business’s parcel delivered to its own place', () => {
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

  const simulate = async (fundingId: string, amount: number) => http().post(`/v1/rails/funding/${fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount }).expect(201);

  async function aShop(shopName: string, zone: string, location: { lat: number; lng: number }): Promise<{ did: string; token: { authorization: string } }> {
    const u = digits();
    const hours = { open: '00:00', close: '23:59' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({
        shopName, zone, country: 'KE', location, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: hours },
        fullName: `${shopName} owner`, nationalId: `ID-BPO-${u}`, mobile: `+2547${u}5`, deviceImei: `IMEI-BPO-${u}`,
        requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
      })
      .expect(201);
    const did = reg.body.did as string;
    const token = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const photograph = async (kind: string) => (await http().post('/v1/sbg/media').set(token).send({ kind, dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(token).send({ idCopyRef: await photograph('kyc_id'), tradingLicenceRef: await photograph('kyc_licence'), shopPhotoRefs: [await photograph('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(operator).send({ approve: true, licenceExpiresAt: '2099-12-31' }).expect(201);
    const asked = await http().post(`/v1/sbg/agents/${did}/top-up`).set(operator).send({ amount: 50 }).expect(201);
    await simulate(asked.body.fundingId, 50);
    return { did, token };
  }

  async function aBusiness(name: string): Promise<{ token: { authorization: string }; entityId: string }> {
    seq += 1;
    const phone = `+2547${digits()}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `bpdoor-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const person = (await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token as string;
    const created = await http().post('/v1/sbg/business').set(bearer(person)).send({ name: `${name} ${tag}`, country: 'KE', registrationNo: `BPO-${tag}-${seq}`, activities: ['shipper'], yourName: `${name} Owner` }).expect(201);
    return { token: bearer(created.body.token.access_token as string), entityId: created.body.business.entityId as string };
  }

  let nairobi = '';
  let kisumu: { did: string; token: { authorization: string } };
  beforeAll(async () => {
    nairobi = (await aShop(`Nairobi BPO ${tag}`, `BpoNairobi${tag}`, { lat: -1.286, lng: 36.817 })).did;
    kisumu = await aShop(`Kisumu BPO ${tag}`, `BpoKisumu${tag}`, { lat: -0.0917, lng: 34.768 });
    await http().post('/v1/sbg/corridors').set(operator).send({ name: `BpoNairobi → BpoKisumu ${tag}`, originZone: `BpoNairobi${tag}`, destZone: `BpoKisumu${tag}` }).expect(201);
  });

  /** As the network would: ready on its shop's shelf. */
  const readyAtShop = async (parcelId: string) => {
    Object.assign(app.get(ParcelService).get(parcelId), { status: 'Ready_For_Pickup', binSlot: 'B2' });
    await app.get(EventBus).publish(GlosEvent.Pudo.ParcelReadyForPickup, { parcelId, destAgentDid: kisumu.did }, { source: 'test' });
  };

  /** A rider near the shop takes the load, at their own price. */
  const aRiderTakes = (freightId: string) => {
    const drivers = app.get(DriverService);
    const rider = drivers.register({ displayName: `Otieno ${seq}`, fullName: 'Otieno Rider', nationalId: `ID-BPO-R-${digits()}`, mobile: `+2547${digits()}1`.slice(0, 13), licenceClasses: ['motorcycle'] } as never);
    const bike = app.get(VehicleService).register({ plate: `KMA ${digits().slice(0, 3)}X`, vehicleClass: 'motorcycle', ownerName: 'Otieno' } as never);
    app.get(FleetService).couple(rider.did, bike.vehicleId);
    declared(app, 'driver', rider.did);
    const dispatch = app.get(DispatchService);
    const load = dispatch.requireFreightPublic(freightId);
    const offer = dispatch.suggest(rider.did, { from: load.pickupLocation, to: load.pickupLocation }).find((o) => o.ref === freightId);
    expect(offer).toBeDefined();
    dispatch.claim(offer!.offerId);
    return { did: rider.did, badge: drivers.get(rider.did).badgeId! };
  };

  it('goes to the shop nearest its place, then a driver’s load to its door — handed over by pass, billed when taken, signed for at the door', async () => {
    const biz = await aBusiness('Lakeside Clinics');
    const vendors = app.get(VendorService);
    await http().post('/v1/sbg/business/me/parcels/account').set(biz.token).expect(201);
    await http().post('/v1/sbg/business/me/parcels/top-up').set(biz.token).send({ amount: 3000 }).expect(201);
    const till = vendors.forBusiness(biz.entityId)!;
    await simulate(app.get(FundingService).openFor(till.vendorId)!.fundingId, 3000);
    await http().put('/v1/sbg/business/me/system').set(biz.token).send({ url: 'https://erp.lakeside.example/hooks' }).expect(200);
    const site = async (kind: string, name: string, location: { lat: number; lng: number }) => (await http().post(`/v1/sbg/entities/${biz.entityId}/sites`).set(biz.token).send({ kind, name, location }).expect(201)).body.siteId as string;
    const clinic = await site('delivery', 'Milimani clinic', { lat: -0.1, lng: 34.75 });
    const far = await site('delivery', 'Lodwar clinic', { lat: 3.12, lng: 35.6 });
    const photo = async () => (await http().post('/v1/sbg/media').set(biz.token).send({ kind: 'content', dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;

    // Priced to its place: via the shop nearest it, with the most we suggest for the last leg.
    const priced = (await http().get('/v1/sbg/business/me/parcels/price').query({ origin: nairobi, toPlace: clinic, l: 30, w: 20, h: 10, kg: 2 }).set(biz.token).expect(200)).body;
    expect(priced.door).toMatchObject({ via: `Kisumu BPO ${tag}`, viaDid: kisumu.did });
    expect(priced.door.suggestedMax).toBeGreaterThan(0);
    const most = priced.door.suggestedMax + 50;
    const parcel = async (more: Record<string, unknown>) => ({ originPudoDid: nairobi, receiverMobile: '+254744000555', dimensionsCm: { l: 30, w: 20, h: 10 }, weightKg: 2, contentPhotoRef: await photo(), ...more });
    const send = (body: Record<string, unknown>) => http().post('/v1/sbg/business/me/parcels').set(biz.token).send(body);

    // Never a shop and its place at once; never a place no shop is near.
    expect((await send(await parcel({ destPudoDid: kisumu.did, toOwnPlace: { siteId: clinic, maxSpend: most } })).expect(400)).body.detail).toMatch(/not both/);
    expect((await send(await parcel({ toOwnPlace: { siteId: far, maxSpend: most } })).expect(400)).body.detail).toMatch(/^No shop of ours is within 30 km of Lodwar clinic/);
    const sent = (await send(await parcel({ toOwnPlace: { siteId: clinic, maxSpend: most }, expectedTotal: priced.flexible })).expect(201)).body;
    expect(sent.parcel).toMatchObject({ to: { did: kisumu.did }, toOwnPlace: { label: 'Milimani clinic', via: `Kisumu BPO ${tag}`, maxSpend: most, state: 'waiting', currency: 'KES' } });
    const id = sent.parcel.parcelId as string;
    const dispatch = app.get(DispatchService);
    expect(dispatch.deliversParcelLoads().filter((f) => f.deliversParcel?.parcelId === id)).toEqual([]);

    // Ready at the shop: the load is posted, from the shop to the clinic, at most what it allows.
    await readyAtShop(id);
    const posted = (await http().get(`/v1/sbg/business/me/parcels/${id}`).set(biz.token).expect(200)).body.toOwnPlace;
    expect(posted).toMatchObject({ state: 'posted', loadCode: expect.any(String), loadStatus: 'available' });
    const load = dispatch.deliversParcelLoads().find((f) => f.deliversParcel?.parcelId === id)!;
    expect(load).toMatchObject({ shipperDid: till.vendorId, pickupLabel: `Kisumu BPO ${tag}`, destLabel: 'Milimani clinic', maxSpend: most, instructions: expect.objectContaining({ contactPhone: '+254744000555' }), deliversParcel: { parcelId: id, atShopDid: kisumu.did } });

    // At the counter: listed for its driver; not handed before a driver has taken it, nor to another, nor by staff.
    const list = () => http().get(`/v1/sbg/agents/${kisumu.did}/door-handovers`).set(kisumu.token).expect(200).then((r) => r.body);
    expect(await list()).toEqual([expect.objectContaining({ parcelId: id, binSlot: 'B2', load: expect.objectContaining({ code: load.code, status: 'available' }) })]);
    expect((await http().post(`/v1/sbg/agents/${kisumu.did}/door-handovers/${id}`).set(kisumu.token).send({ badge: 'NOBODY' }).expect(400)).body.detail).toMatch(/No driver has taken load/);
    const before = vendors.balanceOf(till.vendorId);
    const rider = aRiderTakes(load.freightId);
    // Billed when taken: the driver's price, never above the most.
    expect(before - vendors.balanceOf(till.vendorId)).toBeGreaterThan(0);
    expect(before - vendors.balanceOf(till.vendorId)).toBeLessThanOrEqual(most + 0.001);
    // Its driver cannot take the load over before the shop hands the box.
    expect(() => dispatch.pickupFreight(load.freightId, rider.did, {})).toThrow(/show your pass at its counter/);
    const other = app.get(DriverService).register({ displayName: 'Stranger', fullName: 'S', nationalId: `ID-BPO-S-${digits()}`, mobile: `+2547${digits()}2`.slice(0, 13), licenceClasses: ['motorcycle'] } as never);
    expect((await http().post(`/v1/sbg/agents/${kisumu.did}/door-handovers/${id}`).set(kisumu.token).send({ badge: app.get(DriverService).get(other.did).badgeId }).expect(403)).body.detail).toMatch(/That pass is not the driver of load/);
    await http().post(`/v1/sbg/agents/${kisumu.did}/door-handovers/${id}`).set(operator).send({ badge: rider.badge }).expect(403);
    // A box not on the shelf is handed to nobody — and nothing is written for the load.
    Object.assign(app.get(ParcelService).get(id), { status: 'At_MDP' });
    expect((await http().post(`/v1/sbg/agents/${kisumu.did}/door-handovers/${id}`).set(kisumu.token).send({ badge: rider.badge }).expect(400)).body.detail).toMatch(/is not on this shop's shelf/);
    expect(dispatch.requireFreightPublic(load.freightId).deliversParcel?.handedAt).toBeUndefined();
    Object.assign(app.get(ParcelService).get(id), { status: 'Ready_For_Pickup' });
    expect(await http().post(`/v1/sbg/agents/${kisumu.did}/door-handovers/${id}`).set(kisumu.token).send({ badge: rider.badge }).expect(201).then((r) => r.body)).toEqual([]);
    const handed = app.get(ParcelService).get(id);
    expect(handed).toMatchObject({ status: 'Delivered', doorLoad: { freightId: load.freightId, code: load.code } });
    expect(handed.custody!.at(-1)).toMatchObject({ holderKind: 'driver', holderId: rider.did });
    expect((await http().get(`/v1/sbg/business/me/parcels/${id}`).set(biz.token).expect(200)).body.toOwnPlace).toMatchObject({ state: 'handed', driverName: expect.stringMatching(/^Otieno/) });

    // Delivered at its door: signed for; the chain ends there; its system hears both steps.
    const store = (dispatch as unknown as { freights: { get(id: string): Record<string, unknown>; set(id: string, f: Record<string, unknown>): void } }).freights;
    const at = new Date().toISOString();
    store.set(load.freightId, { ...store.get(load.freightId), status: 'delivered', deliveredAt: at, proofOfDelivery: { receiverName: 'Nurse Achieng', at } });
    await app.get(EventBus).publish(GlosEvent.Pudo.FreightDelivered, { freightId: load.freightId }, { source: 'test' });
    expect((await http().get(`/v1/sbg/business/me/parcels/${id}`).set(biz.token).expect(200)).body.toOwnPlace).toMatchObject({ state: 'delivered', receivedBy: 'Nurse Achieng' });
    const chain = app.get(ParcelService).get(id).custody!;
    expect(chain.at(-1)).toMatchObject({ holderKind: 'receiver', note: 'at its own door, received by Nurse Achieng', to: expect.any(String) });
    const heard = app.get(BusinessHookService).view(biz.entityId).messages.map((m) => m.event);
    expect(heard).toEqual(expect.arrayContaining(['parcel.paid', 'parcel.ready', 'parcel.to_your_door', 'parcel.at_your_door']));
    expect(heard).not.toContain('parcel.collected');
  });

  it('collected at the shop with its code instead: the load is withdrawn; short of money: nothing posted, the business told, posted once it can', async () => {
    const biz = await aBusiness('Lakeside Pharmacy');
    const vendors = app.get(VendorService);
    await http().post('/v1/sbg/business/me/parcels/account').set(biz.token).expect(201);
    await http().post('/v1/sbg/business/me/parcels/top-up').set(biz.token).send({ amount: 400 }).expect(201);
    const till = vendors.forBusiness(biz.entityId)!;
    await simulate(app.get(FundingService).openFor(till.vendorId)!.fundingId, 400);
    const clinic = (await http().post(`/v1/sbg/entities/${biz.entityId}/sites`).set(biz.token).send({ kind: 'delivery', name: 'Kondele store', location: { lat: -0.09, lng: 34.77 } }).expect(201)).body.siteId as string;
    const photo = async () => (await http().post('/v1/sbg/media').set(biz.token).send({ kind: 'content', dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
    const send = async (maxSpend: number) => (await http().post('/v1/sbg/business/me/parcels').set(biz.token).send({ originPudoDid: nairobi, receiverMobile: '+254744000666', dimensionsCm: { l: 20, w: 20, h: 10 }, weightKg: 1, contentPhotoRef: await photo(), toOwnPlace: { siteId: clinic, maxSpend } }).expect(201)).body.parcel;
    const door = async (id: string) => (await http().get(`/v1/sbg/business/me/parcels/${id}`).set(biz.token).expect(200)).body.toOwnPlace;
    const dispatch = app.get(DispatchService);

    // Collected at the shop with its code before any driver came: the load is withdrawn, nothing billed for it.
    const first = await send(100);
    await readyAtShop(first.parcelId);
    const load = dispatch.deliversParcelLoads().find((f) => f.deliversParcel?.parcelId === first.parcelId)!;
    const balance = vendors.balanceOf(till.vendorId);
    app.get(ParcelService).collectConfirm(first.parcelId, kisumu.did, app.get(ParcelService).get(first.parcelId).collectionCode!);
    await new Promise((r) => setTimeout(r, 20));
    expect(dispatch.requireFreightPublic(load.freightId).status).toBe('cancelled');
    expect((await door(first.parcelId)).state).toBe('collected');
    expect(vendors.balanceOf(till.vendorId)).toBeCloseTo(balance, 2);

    // The most it allows is more than its balance holds: nothing is posted, and its bell says so.
    const second = await send(10_000);
    await readyAtShop(second.parcelId);
    expect(await door(second.parcelId)).toMatchObject({ state: 'short' });
    expect(dispatch.deliversParcelLoads().some((f) => f.deliversParcel?.parcelId === second.parcelId)).toBe(false);
    const told = (await http().get('/v1/sbg/notifications/inbox').set(biz.token).expect(200)).body;
    expect(((told.items ?? told) as Array<{ kind: string; title: string }>).find((n) => n.kind === 'parcel_door_short')?.title).toBe(`Top up so ${second.parcelId} can come to your door`);
    expect((await http().post(`/v1/sbg/business/me/parcels/${second.parcelId}/door/post`).set(biz.token).expect(402)).body.code).toBe('WALLET_INSUFFICIENT');
    // A lower most it can pay: posted at once.
    const raised = (await http().post(`/v1/sbg/business/me/parcels/${second.parcelId}/door/raise`).set(biz.token).send({ maxSpend: 120 }).expect(201)).body;
    expect(raised.toOwnPlace).toMatchObject({ state: 'posted', maxSpend: 120 });
    // Posted, the most only rises; another business cannot touch it.
    expect((await http().post(`/v1/sbg/business/me/parcels/${second.parcelId}/door/raise`).set(biz.token).send({ maxSpend: 110 }).expect(400)).body.detail).toMatch(/can only be raised/);
    const rival = await aBusiness('Mlima Pharmacy');
    await http().post('/v1/sbg/business/me/parcels/account').set(rival.token).expect(201);
    await http().post(`/v1/sbg/business/me/parcels/${second.parcelId}/door/raise`).set(rival.token).send({ maxSpend: 200 }).expect(404);
  });
  it('while a driver is sought its receiver is not told to come, the clock waits, and after a day the business is reminded; kept past its free days, the shop is paid from the balance at the hand-over', async () => {
    const biz = await aBusiness('Lakeside Opticians');
    const vendors = app.get(VendorService);
    await http().post('/v1/sbg/business/me/parcels/account').set(biz.token).expect(201);
    await http().post('/v1/sbg/business/me/parcels/top-up').set(biz.token).send({ amount: 500 }).expect(201);
    const till = vendors.forBusiness(biz.entityId)!;
    await simulate(app.get(FundingService).openFor(till.vendorId)!.fundingId, 500);
    const shopPlace = (await http().post(`/v1/sbg/entities/${biz.entityId}/sites`).set(biz.token).send({ kind: 'delivery', name: 'Kibuye branch', location: { lat: -0.095, lng: 34.76 } }).expect(201)).body.siteId as string;
    // Its receiver at the branch has an account of their own.
    seq += 1;
    const phone = `+2547${digits()}${seq}`.slice(0, 13);
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone });
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `bpdoor-r-${tag}-${seq}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email });
    const receiver = bearer((await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: '48261', email, emailCode: mailed.body.code }).expect(201)).body.token.access_token as string);
    const photo = async () => (await http().post('/v1/sbg/media').set(biz.token).send({ kind: 'content', dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
    const send = async (maxSpend: number) => (await http().post('/v1/sbg/business/me/parcels').set(biz.token).send({ originPudoDid: nairobi, receiverMobile: phone, dimensionsCm: { l: 20, w: 20, h: 10 }, weightKg: 1, contentPhotoRef: await photo(), toOwnPlace: { siteId: shopPlace, maxSpend } }).expect(201)).body.parcel;
    const inbox = async (token: { authorization: string }) => {
      const r = (await http().get('/v1/sbg/notifications/inbox').set(token).expect(200)).body;
      return (r.items ?? r) as Array<{ kind: string; title: string }>;
    };
    const parcels = app.get(ParcelService);
    const doors = app.get(BusinessDoorService);

    // Ready at the shop, its last leg posted: its receiver is told nothing about coming for it.
    const first = await send(60);
    await readyAtShop(first.parcelId);
    await new Promise((r) => setTimeout(r, 20));
    expect((await inbox(receiver)).filter((n) => n.kind === 'parcel_ready')).toEqual([]);
    // Days pass with no driver: no "still waiting", no closing of the window, no return offered.
    const later = Date.now() + 80 * 3_600_000;
    await app.get(NotificationDispatcher).remindUncollected(later);
    expect((await inbox(receiver)).filter((n) => n.kind === 'parcel_ready')).toEqual([]);
    expect(app.get(UnclaimedService).sweep(later).map((p) => p.parcelId)).not.toContain(first.parcelId);
    expect(parcels.get(first.parcelId).status).toBe('Ready_For_Pickup');
    // A day with no driver: its business is told, once — and not before the day is out.
    expect(doors.remindUntaken(Date.now() + 23 * 3_600_000)).not.toContain(first.parcelId);
    expect(doors.remindUntaken(Date.now() + 25 * 3_600_000)).toContain(first.parcelId);
    expect(doors.remindUntaken(Date.now() + 26 * 3_600_000)).not.toContain(first.parcelId);
    await new Promise((r) => setTimeout(r, 20));
    expect((await inbox(biz.token)).find((n) => n.title === `No driver has taken ${first.parcelId} to your door yet`)).toBeDefined();

    // Short of money for days, it passed its free days on the shelf: the shop is owed for keeping it.
    const second = await send(10_000);
    await readyAtShop(second.parcelId);
    expect(doors.viewOf(second.parcelId)?.state).toBe('short');
    Object.assign(parcels.get(second.parcelId), { readyAt: new Date(Date.now() - 80 * 3_600_000).toISOString() });
    expect(app.get(UnclaimedService).sweep().map((p) => p.parcelId)).toContain(second.parcelId);
    Object.assign(parcels.get(second.parcelId), { unclaimedAt: new Date(Date.now() - 3 * 86_400_000 + 3_600_000).toISOString() });
    const owed = parcels.holdingOwed(parcels.get(second.parcelId)).amount;
    expect(owed).toBeGreaterThan(0);
    // Posted once the most is one the balance holds — with what the shop is owed on top.
    vendors.billShipment(till.vendorId, 'test-drain-1', vendors.balanceOf(till.vendorId) - (40 + owed / 2));
    expect((await http().post(`/v1/sbg/business/me/parcels/${second.parcelId}/door/raise`).set(biz.token).send({ maxSpend: 40 }).expect(201)).body.toOwnPlace.state).toBe('short');
    const posted = (await http().post(`/v1/sbg/business/me/parcels/${second.parcelId}/door/raise`).set(biz.token).send({ maxSpend: 30 }).expect(201)).body;
    expect(posted.toOwnPlace.state).toBe('posted');
    const load = app.get(DispatchService).deliversParcelLoads().find((f) => f.deliversParcel?.parcelId === second.parcelId)!;
    const rider = aRiderTakes(load.freightId);
    // Its balance drained: the hand-over waits, the shop is not left unpaid, and the business is told.
    const left = vendors.balanceOf(till.vendorId);
    vendors.billShipment(till.vendorId, 'test-drain', Math.max(0, left - owed / 2));
    expect((await http().post(`/v1/sbg/agents/${kisumu.did}/door-handovers/${second.parcelId}`).set(kisumu.token).send({ badge: rider.badge }).expect(402)).body.detail).toMatch(/owes this shop .* for keeping it past its free days/);
    expect(app.get(DispatchService).requireFreightPublic(load.freightId).deliversParcel?.handedAt).toBeUndefined();
    await new Promise((r) => setTimeout(r, 20));
    expect((await inbox(biz.token)).find((n) => n.title === `Top up so Kisumu BPO ${tag} can hand over ${second.parcelId}`)).toBeDefined();
    // Topped up: handed over, the shop paid what it was owed, from the business's balance.
    await http().post('/v1/sbg/business/me/parcels/top-up').set(biz.token).send({ amount: 200 }).expect(201);
    await simulate(app.get(FundingService).openFor(till.vendorId)!.fundingId, 200);
    const before = vendors.balanceOf(till.vendorId);
    await http().post(`/v1/sbg/agents/${kisumu.did}/door-handovers/${second.parcelId}`).set(kisumu.token).send({ badge: rider.badge }).expect(201);
    expect(before - vendors.balanceOf(till.vendorId)).toBeCloseTo(owed, 1);
    expect(app.get(WalletGateService).entries({ did: kisumu.did }).some((e) => e.reference === second.parcelId && Math.abs(e.amount - owed) < 0.01)).toBe(true);
    expect(parcels.holdingOwed(parcels.get(second.parcelId)).amount).toBe(0);
  });
});
