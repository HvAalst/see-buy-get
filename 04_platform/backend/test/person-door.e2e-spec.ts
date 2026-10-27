import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { BooksService } from '../src/foundation/books/books.service';
import { ACCOUNT_CODES } from '../src/foundation/books/books.types';
import { EntityService } from '../src/foundation/entity/entity.service';
import { EventBus } from '../src/foundation/events/event-bus.service';
import { GlosEvent } from '../src/foundation/events/glos-events';
import { FundingService } from '../src/foundation/funding/funding.service';
import { DispatchService } from '../src/modules/pudo/dispatch.service';
import { DriverService } from '../src/modules/pudo/driver.service';
import { FleetService } from '../src/modules/pudo/fleet.service';
import { MdpService } from '../src/modules/pudo/mdp.service';
import { ParcelService } from '../src/modules/pudo/parcel.service';
import { PersonDoorService } from '../src/modules/pudo/person-door.service';
import { PersonService } from '../src/modules/pudo/person.service';
import { VehicleService } from '../src/modules/pudo/vehicle.service';
import { shopPhotoOver } from './content-photo';
import { declared } from './declared';
import { AGREED } from './agreed';

/**
 * A PERSON'S OWN DOOR, PAID FIRST BY MOBILE MONEY, over the wire (the user, 2026-10-27: "Mobile money first"). Their goods,
 * withdrawn at a hub and coming back to them, may come to their door instead of the shop: they are asked by M-Pesa for the
 * most they allow; once it is paid the load is posted; a driver takes it at their price, billed out of what was paid; once
 * delivered what was not used is owed back, and the payout run pays it to the number it came from. A payment that comes
 * too late goes back whole; a load no driver took goes to the shop instead, all of it back. Never a balance.
 */
describe('a person’s own door, paid first by mobile money, over the wire', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const PIN = '48261';
  let operator: Record<string, string> = {};
  const near = { lat: -1.27, lng: 36.86 };

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

  async function aShop(zone: string): Promise<{ did: string; owner: Record<string, string>; name: string }> {
    const u = digits();
    const day = { open: '00:00', close: '23:59' };
    const name = `Duka ${u}`;
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({ shopName: name, zone, location: { lat: -1.28, lng: 36.83 }, landmark: 'by the market', shelf: { rows: 3, cols: 3 }, openingHours: { mon: day, tue: day, wed: day, thu: day, fri: day, sat: day, sun: day }, fullName: `Duka ${u} owner`, nationalId: `ID-${u}`, mobile: `+2547${u}1`, deviceImei: `IMEI-${u}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true } })
      .expect(201);
    const did = reg.body.did as string;
    const owner = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const photo = async (kind: string) => (await http().post('/v1/sbg/media').set(owner).send({ kind, dataUrl: `data:image/png;base64,${Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from(`${kind}:${did}`)]).toString('base64')}` }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(owner).send({ idCopyRef: await photo('kyc_id'), tradingLicenceRef: await photo('kyc_licence'), shopPhotoRefs: [await photo('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(operator).send({ approve: true, licenceExpiresAt: '2099-12-31' }).expect(201);
    declared(app, 'shop', did);
    const asked = await http().post(`/v1/sbg/agents/${did}/top-up`).set(owner).send({ amount: 50 }).expect(201);
    await http().post(`/v1/rails/funding/${asked.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 50 }).expect(201);
    return { did, owner, name };
  }

  async function aPerson(phone: string): Promise<Record<string, string>> {
    const asked = await http().post('/v1/sbg/auth/phone/request').send({ phone }).expect(201);
    await http().post('/v1/sbg/auth/phone/verify').send({ phone, code: asked.body.code }).expect(201);
    const email = `door${digits()}@example.com`;
    const mailed = await http().post('/v1/sbg/identity/email/request').send({ email }).expect(201);
    const enrolled = await http().post('/v1/sbg/identity/enroll').send({ ...AGREED, phone, pin: PIN, email, emailCode: mailed.body.code }).expect(201);
    return bearer(enrolled.body.token.access_token as string);
  }

  /** Their goods, handed in at a shop, withdrawn by staff at a hub: coming back to them, at the hub. */
  async function goodsComingBack(): Promise<{ sender: Record<string, string>; senderPhone: string; personDid: string; receiver: Record<string, string>; backId: string; hubId: string; shop: { name: string } }> {
    const zone = `ZD${digits()}`;
    const shop = await aShop(zone);
    const hub = app.get(MdpService).register({ name: `Ghala ${digits()}`, zones: [zone, 'FarTown'], location: { lat: -1.25, lng: 36.85 } }, { approvedBy: 'staff' });
    const senderPhone = `+2547${digits()}5`;
    const receiverPhone = `+2547${digits()}6`;
    const sender = await aPerson(senderPhone);
    const receiver = await aPerson(receiverPhone);
    const id = `DOOR-${digits()}`;
    await http().post('/v1/sbg/parcels/accept').set(shop.owner).send({ agentDid: shop.did, parcelId: id, size: 'S', destZone: 'FarTown', senderMobile: senderPhone, receiverMobile: receiverPhone, dropoffPhotoRef: await shopPhotoOver(app.getHttpServer(), shop.did) }).expect(201);
    Object.assign(app.get(ParcelService).get(id), { status: 'At_MDP', atMdpId: hub.mdpId });
    const done = (await http().post(`/v1/sbg/parcels/${id}/withdraw`).set(operator).send({ reason: 'The sender asked, by phone', by: 'Achieng' }).expect(201)).body;
    return { sender, senderPhone, personDid: app.get(PersonService).findByPhone(senderPhone)!.personDid, receiver, backId: done.returnParcelId, hubId: hub.mdpId, shop };
  }

  const fundingOf = (personDid: string) => app.get(FundingService).list({ payerDid: personDid, purpose: 'door' }).sort((a, b) => (a.openedAt < b.openedAt ? 1 : -1))[0];
  const pay = async (personDid: string, amount: number) => {
    const f = fundingOf(personDid);
    await http().post(`/v1/rails/funding/${f.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount }).expect(201);
  };
  const owed = (code: string, personDid: string) => {
    const entityId = app.get(EntityService).requireForJurisdiction('KE').entityId;
    return -app.get(BooksService).balance(entityId, code as never, 'KES', personDid);
  };
  const inbox = async (who: Record<string, string>) => ((await http().get('/v1/sbg/notifications/inbox').set(who).expect(200)).body.items ?? []) as Array<{ kind: string; title: string; body: string }>;
  const settle = () => new Promise((r) => setTimeout(r, 50));

  it('asked, paid, taken, delivered — and what it did not use paid back to the number it came from', async () => {
    const { sender, senderPhone, personDid, receiver, backId, hubId } = await goodsComingBack();

    // Said first, with the most to allow suggested — and not for anybody else, nor somewhere too far.
    const said = (await http().get(`/v1/sbg/identity/parcels/${backId}/door`).query(near).set(sender).expect(200)).body;
    expect(said).toMatchObject({ outcome: 'door', currency: 'KES', maxKm: 100, suggestedMax: expect.any(Number) });
    expect((await http().get(`/v1/sbg/identity/parcels/${backId}/door`).query({ lat: 0.5, lng: 34.5 }).set(sender).expect(200)).body).toMatchObject({ outcome: 'no', why: expect.stringMatching(/no further than 100 km/) });
    await http().get(`/v1/sbg/identity/parcels/${backId}/door`).set(receiver).expect(404);
    await http().get(`/v1/sbg/identity/parcels/${backId}/door`).set(operator).expect(403);

    // Asked: the box is held at the hub, and M-Pesa asks them — nothing is posted before the money comes.
    await http().post(`/v1/sbg/identity/parcels/${backId}/door`).set(sender).send({ ...near, label: 'Gate 4, Riverside Drive', maxSpend: said.suggestedMax, phone: 'nope' }).expect(400);
    const asked = (await http().post(`/v1/sbg/identity/parcels/${backId}/door`).set(sender).send({ ...near, label: 'Gate 4, Riverside Drive', maxSpend: said.suggestedMax, phone: senderPhone }).expect(201)).body;
    expect(asked).toMatchObject({ state: 'awaiting', label: 'Gate 4, Riverside Drive', maxSpend: said.suggestedMax, currency: 'KES', until: expect.any(String), reference: expect.any(String) });
    expect(app.get(ParcelService).get(backId).doorHold).toBeDefined();
    expect(() => app.get(MdpService).sortParcel(hubId, backId)).toThrow(/waits for its sender to pay for a load to their door/);
    expect((await http().post(`/v1/sbg/identity/parcels/${backId}/door`).set(sender).send({ ...near, label: 'Gate 4', maxSpend: said.suggestedMax, phone: senderPhone })).body.detail).toMatch(/paying for its door already/);
    expect(app.get(DispatchService).bringsBackLoads().some((f) => f.bringsBack?.parcelId === backId)).toBe(false);

    // Paid: the load is posted, nobody's id on it, sold by the company of the hub's country, at most what was paid.
    await pay(personDid, said.suggestedMax);
    await settle();
    const posted = (await http().get(`/v1/sbg/identity/parcels/${backId}`).set(sender).expect(200)).body.door;
    expect(posted).toMatchObject({ state: 'posted', paid: said.suggestedMax, loadCode: expect.stringMatching(/^FRT-/), canSendToShop: true });
    // Their own goods, coming to them: never told they will not come.
    expect((await http().get(`/v1/sbg/identity/parcels/${backId}`).set(sender).expect(200)).body.wentBack).toBeUndefined();
    const load = app.get(DispatchService).bringsBackLoads().find((f) => f.bringsBack?.parcelId === backId)!;
    expect(load).toMatchObject({ status: 'available', maxSpend: said.suggestedMax, sellerEntityId: app.get(EntityService).requireForJurisdiction('KE').entityId, instructions: expect.objectContaining({ contactPhone: senderPhone }) });
    expect(load.shipperDid).toBeUndefined();
    expect(load.settlement).toBeUndefined(); // billed through us: not a match
    expect(JSON.stringify(load)).not.toContain(personDid);
    expect(app.get(ParcelService).get(backId)).toMatchObject({ status: 'Returned', returnLoad: { freightId: load.freightId } });
    expect(app.get(ParcelService).get(backId).payAtCollection).toBeUndefined();
    expect(owed(ACCOUNT_CODES.DEPOSIT_PERSON, personDid)).toBeCloseTo(said.suggestedMax, 2);
    expect(await inbox(sender)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'door_delivery', title: 'Paid: a driver brings it to your door' })]));

    // A driver takes it at their price: billed out of what was paid — a sale of carriage, the rest still held.
    const driver = app.get(DriverService).register({ displayName: 'Door', fullName: 'Door Driver', nationalId: `ID-DD-${digits()}`, mobile: `+2547${digits()}7`, licenceClasses: ['truck'], licenceNumber: `L-${digits()}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true });
    app.get(DriverService).submitKyc(driver.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    app.get(DriverService).decideKyc(driver.did, true);
    app.get(FleetService).couple(driver.did, app.get(VehicleService).register({ plate: `KDD ${digits().slice(0, 3)}D`, vehicleClass: 'truck', truckSubtype: 'tipper', capacityKg: 10_000, ownerName: 'X', baseFee: 0.5, pricePerKm: 0.1 }).vehicleId);
    declared(app, 'driver', driver.did);
    const dispatch = app.get(DispatchService);
    const offer = dispatch.suggest(driver.did, { from: load.pickupLocation, to: load.pickupLocation }).find((o) => o.ref === load.freightId)!;
    expect(offer.paidByShipper).toBeUndefined(); // SeeBuyGet pays this driver
    dispatch.claim(offer.offerId);
    const taken = dispatch.requireFreightPublic(load.freightId);
    expect(taken).toMatchObject({ status: 'claimed', paidStatus: 'billed' });
    const billed = taken.billed!.gross;
    expect(billed).toBeLessThanOrEqual(said.suggestedMax);
    expect((await http().get(`/v1/sbg/identity/parcels/${backId}`).set(sender).expect(200)).body.door).toMatchObject({ state: 'taken', billed });
    expect(owed(ACCOUNT_CODES.DEPOSIT_PERSON, personDid)).toBeCloseTo(said.suggestedMax - billed, 2);

    // Delivered at their door: the rest owed back, rounded up to the shilling in their favour.
    await app.get(EventBus).publish(GlosEvent.Pudo.FreightDelivered, { freightId: load.freightId }, { source: 'test' });
    await settle();
    const back = Math.ceil(said.suggestedMax - billed - 1e-9);
    const delivered = (await http().get(`/v1/sbg/identity/parcels/${backId}`).set(sender).expect(200)).body.door;
    expect(delivered).toMatchObject({ state: 'delivered', owedBack: back });
    expect(owed(ACCOUNT_CODES.DEPOSIT_PERSON, personDid)).toBeCloseTo(0, 2);
    expect(owed(ACCOUNT_CODES.PAYABLE_PERSON, personDid)).toBeCloseTo(back, 2);

    // The payout run pays it to the number it came from — raised by one member of staff, approved by another.
    if (back >= 1) {
      const entityId = app.get(EntityService).requireForJurisdiction('KE').entityId;
      const run = (await http().post(`/v1/sbg/entities/${entityId}/payouts/run`).set(operator).send({ by: 'Achieng' }).expect(201)).body;
      const mine = (run.raised as Array<{ payoutId: string; payeeDid: string; owed?: string; amount: number; destination?: { masked: string } }>).find((p) => p.payeeDid === personDid)!;
      expect(mine).toMatchObject({ owed: 'payable.person', amount: back });
      await http().post(`/v1/sbg/payouts/${mine.payoutId}/submit`).set(operator).send({ by: 'Baraka' }).expect(201);
      await http().post(`/v1/sbg/payouts/${mine.payoutId}/settle`).set(operator).send({ providerRef: `SBX${digits()}` }).expect(201);
      expect(owed(ACCOUNT_CODES.PAYABLE_PERSON, personDid)).toBeCloseTo(0, 2);
    }
    expect(app.get(BooksService).balances(app.get(EntityService).requireForJurisdiction('KE').entityId)).toEqual({ balanced: true, drift: 0 });
  });

  it('paid too late: the box went on to the shop, and the payment goes back whole', async () => {
    const { sender, senderPhone, personDid, backId } = await goodsComingBack();
    const said = (await http().get(`/v1/sbg/identity/parcels/${backId}/door`).query(near).set(sender).expect(200)).body;
    await http().post(`/v1/sbg/identity/parcels/${backId}/door`).set(sender).send({ ...near, label: 'Gate 9', maxSpend: said.suggestedMax, phone: senderPhone }).expect(201);
    const funding = fundingOf(personDid);
    // The window runs out: it carries on to the shop as its label says, and the request is closed.
    app.get(PersonDoorService).sweep(Date.now() + 16 * 60_000);
    expect(app.get(ParcelService).get(backId).doorHold).toBeUndefined();
    expect(app.get(FundingService).get(funding.fundingId).status).toBe('expired');
    expect((await http().get(`/v1/sbg/identity/parcels/${backId}`).set(sender).expect(200)).body.door).toMatchObject({ state: 'lapsed' });
    // The money comes after all: credited, and owed back whole — no load posted for it.
    await http().post(`/v1/rails/funding/${funding.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: said.suggestedMax }).expect(201);
    await settle();
    expect(owed(ACCOUNT_CODES.PAYABLE_PERSON, personDid)).toBeCloseTo(said.suggestedMax, 2);
    expect(app.get(DispatchService).bringsBackLoads().some((f) => f.bringsBack?.parcelId === backId)).toBe(false);
    expect(await inbox(sender)).toEqual(expect.arrayContaining([expect.objectContaining({ kind: 'door_delivery', title: 'Your payment goes back to you' })]));
  });

  it('no driver has taken it: to the shop instead — a new parcel paid there in cash, all of it back', async () => {
    const { sender, senderPhone, personDid, backId, shop } = await goodsComingBack();
    const said = (await http().get(`/v1/sbg/identity/parcels/${backId}/door`).query(near).set(sender).expect(200)).body;
    await http().post(`/v1/sbg/identity/parcels/${backId}/door`).set(sender).send({ ...near, label: 'Gate 2', maxSpend: said.suggestedMax, phone: senderPhone }).expect(201);
    await pay(personDid, said.suggestedMax);
    await settle();
    const load = app.get(DispatchService).bringsBackLoads().find((f) => f.bringsBack?.parcelId === backId)!;
    const sent = (await http().post(`/v1/sbg/identity/parcels/${backId}/door/cancel`).set(sender).expect(201)).body;
    expect(sent).toMatchObject({ state: 'to_shop', shopName: shop.name, owedBack: said.suggestedMax, shopParcelId: expect.stringMatching(/^PUD-/) });
    expect(app.get(DispatchService).requireFreightPublic(load.freightId).status).toBe('cancelled');
    expect(app.get(ParcelService).get(sent.shopParcelId)).toMatchObject({ status: 'At_MDP', payAtCollection: expect.objectContaining({ amount: expect.any(Number) }) });
    expect(owed(ACCOUNT_CODES.PAYABLE_PERSON, personDid)).toBeCloseTo(said.suggestedMax, 2);
    expect(owed(ACCOUNT_CODES.DEPOSIT_PERSON, personDid)).toBeCloseTo(0, 2);
    // Not twice.
    expect((await http().post(`/v1/sbg/identity/parcels/${backId}/door/cancel`).set(sender)).status).toBeGreaterThanOrEqual(400);
  });
});
