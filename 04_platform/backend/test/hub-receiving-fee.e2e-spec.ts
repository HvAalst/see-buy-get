import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { contentPhotoOver, CONTENTS_PNG } from './content-photo';
import { declared } from './declared';
import { AGREED } from './agreed';
import { HubArrivalService } from '../src/modules/pudo/hub-arrival.service';
import { VendorService } from '../src/modules/pudo/vendor.service';
import { FiscalInvoiceService } from '../src/modules/pudo/fiscal-invoice.service';
import { BooksService } from '../src/foundation/books/books.service';
import { ACCOUNT_CODES } from '../src/foundation/books/books.types';
import { EntityService } from '../src/foundation/entity/entity.service';

/**
 * A HUB'S RECEIVING FEE PER HANDLING UNIT, over the wire (assessment.html D12; the user, 2026-10-26: "Its own fee"). The hub
 * declares what it charges to take in a pallet, a carton, a cage or a sack — its own fee, in its own money. A store pays for
 * the units it books when it books them, with its company's fee and tax on top as for a parcel, or is refused before
 * anything is written. At the door the hub is paid its own fee for the units it counts; units booked and not counted go
 * back to the store, and units beyond the booking are charged then, or not taken in. Nothing taken in — withdrawn, or it
 * did not come — and all of it goes back. The books balance; the sale is a Kenyan tax invoice like a parcel's.
 */
describe('D12: a hub’s fee per handling unit, charged to the store that booked', () => {
  let app: INestApplication;
  let http: () => ReturnType<typeof request>;
  let operator: { authorization: string };
  const bearer = (token: string) => ({ authorization: `Bearer ${token}` });
  const digits = () => String(Math.floor(Math.random() * 9_000_000) + 1_000_000);
  const tag = digits();
  const kenyaDay = (ms: number) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms);
  const cents = (n: number) => Math.round(n * 100) / 100;

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

  async function aShop(shopName: string, zone: string, location: { lat: number; lng: number }): Promise<string> {
    const u = digits();
    const hours = { open: '00:00', close: '23:59' };
    const reg = await http()
      .post('/v1/sbg/agents')
      .set(operator)
      .send({
        shopName, zone, country: 'KE', location, landmark: 'by the market', shelf: { rows: 3, cols: 3 },
        openingHours: { mon: hours, tue: hours, wed: hours, thu: hours, fri: hours, sat: hours, sun: hours },
        fullName: `${shopName} owner`, nationalId: `ID-FEE-${u}`, mobile: `+2547${u}8`, deviceImei: `IMEI-FEE-${u}`,
        requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
      })
      .expect(201);
    const did = reg.body.did as string;
    const token = bearer((await http().post('/v1/auth/token').send({ role: 'agent', did }).expect(201)).body.access_token);
    const shopPhoto = async (kind: string) => (await http().post('/v1/sbg/media').set(token).send({ kind, dataUrl: CONTENTS_PNG }).expect(201)).body.mediaId as string;
    await http().post(`/v1/sbg/agents/${did}/submit-kyc`).set(token).send({ idCopyRef: await shopPhoto('kyc_id'), tradingLicenceRef: await shopPhoto('kyc_licence'), shopPhotoRefs: [await shopPhoto('shop')] }).expect(201);
    await http().post(`/v1/sbg/agents/${did}/kyc-decision`).set(operator).send({ approve: true, licenceExpiresAt: '2099-12-31' }).expect(201);
    declared(app, 'shop', did);
    return did;
  }

  it('the hub declares its fee per unit; the store pays for what it books, is given back what was not counted, and pays at the door for more — the hub is paid its own fee for what it counted', async () => {
    const zone = `FeeZone${tag}`;
    const dest = await aShop(`Fee Dest ${tag}`, zone, { lat: -1.32, lng: 36.92 });
    const made = (await http().post('/v1/sbg/vendors').set(operator).send({ ...AGREED, name: `Fee Store ${tag}`, callbackUrl: 'https://store.example/hook' }).expect(201)).body;
    const store = bearer((await http().post('/v1/sbg/vendors/login').send({ vendorId: made.vendorId, secret: made.secret }).expect(201)).body.token.access_token);
    const funded = await http().post(`/v1/sbg/vendors/${made.vendorId}/top-up`).set(store).send({ amount: 5000 }).expect(201);
    await http().post(`/v1/rails/funding/${funded.body.fundingId}/simulate`).set(operator).send({ providerRef: `MPX${digits()}`, amount: 5000 }).expect(201);
    const hub = (await http().post('/v1/sbg/mdps').set(operator).send({ name: `Fee Hub ${tag}`, zones: [zone], location: { lat: -1.25, lng: 36.88 } }).expect(201)).body;
    const asHub = bearer((await http().post('/v1/auth/token').send({ role: 'mdp', did: hub.did }).expect(201)).body.access_token);
    declared(app, 'hub', hub.did);
    const vendors = app.get(VendorService);
    const balance = () => vendors.balanceOf(made.vendorId);

    // THE HUB'S FEE: its own word — not staff's; known kinds only; a sum of money.
    const allDay = { open: '00:00', close: '23:59' };
    const everyDay = Object.fromEntries(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'].map((d) => [d, allDay]));
    const bulk = (who: { authorization: string }, body: Record<string, unknown>) => http().put(`/v1/sbg/mdps/${hub.mdpId}/bulk`).set(who).send({ open: true, hours: everyDay, ...body });
    await bulk(operator, { fees: { pallet: 150 } }).expect(403);
    expect((await bulk(asHub, { fees: { crate: 5 } }).expect(400)).body.detail).toMatch(/crate is not a kind of unit/);
    expect((await bulk(asHub, { fees: { pallet: -1 } }).expect(400)).body.detail).toMatch(/A fee is a sum of money/);
    const said = (await bulk(asHub, { fees: { pallet: 150, carton: 20, cage: 0 } }).expect(200)).body.bulk;
    expect(said).toMatchObject({ fees: { pallet: 150, carton: 20 }, feeCurrency: 'KES' });
    expect(said.fees.cage).toBeUndefined();

    // A STORE SEES WHAT A UNIT COSTS IT: the hub's fee with its company's fee and tax, in its own money.
    const options = (await http().get(`/v1/sbg/vendors/${made.vendorId}/hubs?dest=${dest}&size=M`).set(store).expect(200)).body.hubs;
    const here = options.find((o: { mdpId: string }) => o.mdpId === hub.mdpId);
    expect(here).toMatchObject({ fees: { pallet: 150, carton: 20 }, feeCurrency: 'KES', receiving: { pallet: { currency: 'KES' }, carton: { currency: 'KES' } } });
    const pallet = here.receiving.pallet.gross as number;
    const carton = here.receiving.carton.gross as number;
    expect(pallet).toBeGreaterThanOrEqual(150);
    expect(carton).toBeGreaterThanOrEqual(20);

    const mint = async () =>
      (await http().post('/v1/sbg/inbound/orders').set(store).send({ vendorId: made.vendorId, destPudoDid: dest, handInMdpId: hub.mdpId, buyerMobile: `+2547${digits()}1`, size: 'M', weightKg: 2, contentPhotoRef: await contentPhotoOver(app.getHttpServer(), store) }).expect(201)).body.parcel.parcelId as string;
    const ids: string[] = [];
    for (let i = 0; i < 7; i += 1) ids.push(await mint());
    const today = kenyaDay(Date.now());
    const book = (body: Record<string, unknown>) => http().post(`/v1/sbg/vendors/${made.vendorId}/hub-arrivals`).set(store).send({ mdpId: hub.mdpId, unitKind: 'pallet', units: 1, expectedOn: today, ...body });

    // MORE THAN ITS BALANCE CARRIES: refused before anything is written.
    const before = balance();
    expect((await book({ parcelIds: [ids[6]], units: 100 }).expect(402)).body.detail).toMatch(/Top up first — taking in 100 pallets at Fee Hub .* costs KES/);
    expect(balance()).toBe(before);
    expect((await http().get(`/v1/sbg/vendors/${made.vendorId}/hub-arrivals`).set(store).expect(200)).body.arrivals).toHaveLength(0);

    // BOOKED: two pallets, paid now.
    const a = (await book({ parcelIds: [ids[0], ids[1]], units: 2 }).expect(201)).body;
    expect(a.fee).toMatchObject({ perUnit: 150, currency: 'KES', storeCurrency: 'KES', unitGross: pallet, charged: cents(2 * pallet), chargedUnits: 2 });
    expect(cents(before - balance())).toBe(cents(2 * pallet));

    // THE HUB READS ITS OWN FEE — never what the store paid.
    const atHub = (await http().get(`/v1/sbg/mdps/${hub.mdpId}/arrivals`).set(asHub).expect(200)).body.arrivals.find((x: { arrivalId: string }) => x.arrivalId === a.arrivalId);
    expect(atHub.fee).toEqual({ perUnit: 150, currency: 'KES' });

    // AT THE DOOR, ONE PALLET OF TWO: one given back to the store; the hub paid its own fee for the one it counted.
    const receive = (arrivalId: string, units: number) => http().post(`/v1/sbg/mdps/${hub.mdpId}/arrivals/${arrivalId}/receive`).set(asHub).send({ units });
    const afterBooking = balance();
    const doorA = (await receive(a.arrivalId, 1).expect(201)).body;
    expect(doorA.fee).toEqual({ perUnit: 150, currency: 'KES', paid: 150, paidUnits: 1 });
    expect(cents(balance() - afterBooking)).toBe(cents(pallet));

    // ONE CARTON BOOKED, THREE CAME: two more charged at the door, at the fee it booked at; the hub paid for three.
    const b = (await book({ parcelIds: [ids[2]], unitKind: 'carton', units: 1 }).expect(201)).body;
    const beforeDoorB = balance();
    expect((await receive(b.arrivalId, 3).expect(201)).body.fee).toMatchObject({ paid: 60, paidUnits: 3 });
    expect(cents(beforeDoorB - balance())).toBe(cents(2 * carton));
    const bForStore = (await http().get(`/v1/sbg/vendors/${made.vendorId}/hub-arrivals`).set(store).expect(200)).body.arrivals.find((x: { arrivalId: string }) => x.arrivalId === b.arrivalId);
    expect(bForStore.fee).toMatchObject({ charged: carton, chargedUnits: 1, extra: cents(2 * carton), extraUnits: 2 });
    expect(bForStore.fee.paid).toBeUndefined();

    // MORE THAN THE STORE CAN PAY FOR: not taken in — the hub counts in what was booked.
    const c = (await book({ parcelIds: [ids[3]] }).expect(201)).body;
    const beforeDoorC = balance();
    expect((await receive(c.arrivalId, 100).expect(402)).body.detail).toMatch(/booked and paid for 1 pallet, and cannot pay for 99 more: take in the 1 it booked/);
    expect(balance()).toBe(beforeDoorC);
    await receive(c.arrivalId, 1).expect(201);

    // IT DID NOT COME: all of it back. WITHDRAWN: all of it back.
    const d = (await book({ parcelIds: [ids[4]] }).expect(201)).body;
    const arrivals = (app.get(HubArrivalService) as unknown as { arrivals: Map<string, { expectedOn: string }> }).arrivals;
    arrivals.set(d.arrivalId, { ...arrivals.get(d.arrivalId)!, expectedOn: kenyaDay(Date.now() - 86_400_000) });
    const beforeMissed = balance();
    await http().post(`/v1/sbg/mdps/${hub.mdpId}/arrivals/${d.arrivalId}/missed`).set(asHub).expect(201);
    expect(cents(balance() - beforeMissed)).toBe(cents(pallet));
    const e = (await book({ parcelIds: [ids[5]] }).expect(201)).body;
    const beforeWithdrawn = balance();
    const withdrawn = (await http().post(`/v1/sbg/vendors/${made.vendorId}/hub-arrivals/${e.arrivalId}/withdraw`).set(store).expect(201)).body;
    expect(withdrawn.fee).toMatchObject({ refunded: pallet, refundedUnits: 1 });
    expect(cents(balance() - beforeWithdrawn)).toBe(cents(pallet));

    // THE BOOKS: the hub is owed its own fee for every unit it counted (1 + 3 + 1 at 150, 20, 150), and they balance.
    const ke = app.get(EntityService).requireForJurisdiction('KE').entityId;
    const books = app.get(BooksService);
    expect(-books.balance(ke, ACCOUNT_CODES.PAYABLE_PROVIDER, undefined, hub.mdpId)).toBe(150 + 60 + 150);
    expect(books.balances(ke)).toEqual({ balanced: true, drift: 0 });
    // The store's register says what it was: receiving at the hub, and what came back.
    const rows = (await http().get(`/v1/sbg/vendors/${made.vendorId}/ledger`).set(store).expect(200)).body;
    const notes = JSON.stringify(rows);
    expect(notes).toMatch(/receiving at Fee Hub/);
    expect(notes).toMatch(/given back/);
    // A Kenyan sale like a parcel's: a tax invoice for the receiving, named for the arrival.
    const invoices = app.get(FiscalInvoiceService).forBuyer('store', made.vendorId);
    expect(invoices.some((i) => i.kind === 'sale' && i.line.description === `Receiving service at a hub, arrival ${a.arrivalId}`)).toBe(true);
  });
});
