import { Test } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { RoutingService } from './routing.service';
import { CorridorService } from './corridor.service';
import { ShelfService } from './shelf.service';
import { VendorService } from './vendor.service';
import { ParcelService, parcelCurrency, vendorOrderRowOf } from './parcel.service';
import { ToteService } from './tote.service';
import { VehicleService } from './vehicle.service';
import { DriverService } from './driver.service';
import { FleetService } from './fleet.service';
import { DispatchService } from './dispatch.service';
import { RouteConstraintService } from './route-constraint.service';
import { WalletGateService } from './wallet-gate.service';
import { CargoService } from './cargo.service';
import { MediaService } from './media.service';
import { MarketPulseStore } from './market-pulse.store';
import { MarketPulseService } from './market-pulse.service';
import { RatingService } from './rating.service';
import { MonitorService } from './monitor.service';
import { GraduationService } from './graduation.service';
import { VendorCallbackService } from './vendor-callback.service';
import { ConsignmentService } from './consignment.service';
import { BagPlanService } from './bag-plan.service';
import { ForthcomingService } from './forthcoming.service';
import { DockService } from './dock.service';
import { FleetManagerService } from './fleet-manager.service';
import { GazetteerGeocoder, GEOCODER } from './geocoder';
import { HeuristicRouter, ROUTER } from './router';
import { countryOfSite, crossingsOn, requireCountryCode } from './country';
import { BORDER_DWELL_H, NETWORK_JURISDICTION } from './pudo.config';
import { DigitalTwinService } from '../m7/digital-twin.service';
import { TrackingService } from '../m4/tracking.service';
import { TrackingContextService } from '../m4/tracking-context.service';
import { NormalizationService } from '../m4/normalization.service';
import { ConnectorRegistry, MobileSdkConnector, RestCarrierConnector } from '../m4/connectors/connectors';
import { WalletService } from '../m1/wallet/wallet.service';
import { DidService } from '../../foundation/did/did.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { BooksService } from '../../foundation/books/books.service';
import { ACCOUNT_CODES } from '../../foundation/books/books.types';
import { FX_SPREAD_PCT, FxService } from '../../foundation/money/fx.service';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';

/**
 * Crossing a border — the fact the network could not previously state.
 *
 * Every site used to resolve to the deployment's own jurisdiction by construction, so a shop in Addis
 * Ababa came out contracted to the Kenyan sister and a route to it looked exactly like a route across
 * town. These tests pin the three things that changed: a site says which country it is in, the sister
 * follows from THAT, and a journey between two countries says where it crosses — and refuses to invent
 * a price when the two ends are paid in different money.
 */
describe('crossing a border', () => {
  let agents: AgentService;
  let mdps: MdpService;
  let routing: RoutingService;
  let corridors: CorridorService;
  let vendors: VendorService;
  let entities: EntityService;
  let fx: FxService;
  let parcels: ParcelService;
  let gate: WalletGateService;
  let books: BooksService;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService,
        BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
        DriverService, FleetService, DispatchService, RouteConstraintService, MarketPulseStore, MarketPulseService, FleetManagerService,
        MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
        ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
        WalletService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus,
        EntityService, BooksService, FxService,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
        HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
      ],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed(); // compile() runs no lifecycle hooks — the sisters are seeded by hand, as at boot
    fx = moduleRef.get(FxService);
    fx.seed();
    agents = moduleRef.get(AgentService);
    mdps = moduleRef.get(MdpService);
    routing = moduleRef.get(RoutingService);
    corridors = moduleRef.get(CorridorService);
    vendors = moduleRef.get(VendorService);
    parcels = moduleRef.get(ParcelService);
    gate = moduleRef.get(WalletGateService);
    books = moduleRef.get(BooksService);
    books.reset(); // each test starts on clean books — the money is derived from them
  });

  let seq = 0;
  const hours = { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null };

  function shop(shopName: string, zone: string, location: { lat: number; lng: number }, country?: string, pricePerParcel?: number) {
    seq += 1;
    return agents.register({
      shopName, zone, country, location, pricePerParcel, landmark: 'by the road', openingHours: hours, shelf: { rows: 3, cols: 3 },
      fullName: `${shopName} owner`, nationalId: `ID-${seq}`, mobile: `+2547000${seq}`, deviceImei: `IMEI-${seq}`,
      requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
    });
  }

  const NAIROBI = { lat: -1.286, lng: 36.817 };
  const ADDIS = { lat: 9.03, lng: 38.74 };
  const MOYALE_KE = { lat: 3.52, lng: 39.05 }; // the Kenyan side of the border post
  const HAWASSA = { lat: 7.06, lng: 38.48 };

  describe('a site says which country it is in', () => {
    it('reads a two-letter code, and refuses anything that is not one', () => {
      expect(requireCountryCode('et')).toBe('ET');
      expect(requireCountryCode('  ke  ')).toBe('KE');
      expect(requireCountryCode(undefined)).toBe(NETWORK_JURISDICTION);
      expect(requireCountryCode('', 'ET')).toBe('ET'); // an explicit fallback, for a dock inheriting its store's
      expect(() => requireCountryCode('Ethiopia')).toThrow(/two-letter code/);
      expect(() => requireCountryCode('E')).toThrow(/two-letter code/);
    });

    it('reads a record written before sites had a country as being in the home country', () => {
      // The truth at the time: one jurisdiction, every site inside it. Defaulting on READ means an old
      // record and a new one answer the same question the same way, with nothing to backfill.
      expect(countryOfSite({})).toBe(NETWORK_JURISDICTION);
      expect(countryOfSite({ country: 'et' })).toBe('ET');
    });
  });

  describe('the sister follows from the country, not from the deployment', () => {
    it('contracts an Ethiopian shop to the Ethiopian sister and a Kenyan one to the Kenyan sister', () => {
      const ke = shop('Mama Sarah', 'Nairobi', NAIROBI);
      const et = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
      expect(ke.country).toBe('KE');
      expect(et.country).toBe('ET');
      expect(agents.entityIdOf(ke)).toBe(entities.requireForJurisdiction('KE').entityId);
      expect(agents.entityIdOf(et)).toBe(entities.requireForJurisdiction('ET').entityId);
      expect(agents.entityIdOf(et)).not.toBe(agents.entityIdOf(ke)); // the whole point
    });

    it('refuses a shop in a country the network has no company in, by name', () => {
      // Better than approving it and discovering at the first payout that nobody was party to the deal.
      expect(() => shop('Dar Duka', 'DarEsSalaam', { lat: -6.79, lng: 39.21 }, 'TZ')).toThrow(/No daughter company operates in TZ/);
    });

    it('still resolves a shop registered before sites had a country', () => {
      const a = shop('Old Shop', 'Nairobi', NAIROBI);
      delete (a as { country?: string }).country;
      delete (a as { entityId?: string }).entityId;
      expect(agents.countryOf(a)).toBe('KE');
      expect(agents.entityIdOf(a)).toBe(entities.requireForJurisdiction('KE').entityId);
    });

    it('asks a hub the same question — a hub may serve zones across a border, but it stands in one country', () => {
      const hub = mdps.register({ name: 'Addis Sort', zones: ['AddisAbaba', 'Hawassa'], country: 'ET', location: ADDIS });
      expect(mdps.countryOf(hub)).toBe('ET');
      expect(mdps.entityIdOf(hub)).toBe(entities.requireForJurisdiction('ET').entityId);
      expect(() => mdps.register({ name: 'Dar Sort', zones: ['DarEsSalaam'], country: 'TZ', location: { lat: -6.79, lng: 39.21 } })).toThrow(/TZ/);
    });

    it('lets a store put its dock in another country than the one it is registered in', () => {
      // A dock earns nothing and invoices nobody, so no sister is needed where it stands — but the goods
      // are physically there, and a border is a fact about goods.
      const v = vendors.register({ name: 'Cross Trader', country: 'KE' });
      vendors.setCollectionPoint(v.vendorId, { label: 'Addis warehouse, gate 2', zone: 'AddisAbaba', country: 'et', location: ADDIS });
      expect(vendors.dockCountryOf(vendors.get(v.vendorId))).toBe('ET');

      const home = vendors.register({ name: 'Home Trader', country: 'KE' });
      vendors.setCollectionPoint(home.vendorId, { label: 'Yard', zone: 'Nairobi', location: NAIROBI });
      expect(vendors.dockCountryOf(vendors.get(home.vendorId))).toBe('KE'); // unstated = the store's own
    });
  });

  describe('a journey says where it crosses', () => {
    it('leaves a domestic route exactly as it was', () => {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI);
      const to = shop('Mombasa Road', 'MombasaRd', { lat: -1.32, lng: 36.85 });
      corridors.addCorridor({ name: 'CBD–Mombasa Rd', originZone: 'Nairobi', destZone: 'MombasaRd' });

      const quote = routing.quoteShipment(from.did, to.did);
      expect(quote.crossesBorder).toBe(false);
      expect(quote.crossings).toEqual([]);
      expect(quote.currency).toBe('KES');
      expect(quote.nodes.map((n) => n.country)).toEqual(['KE', 'KE']);
      expect(quote.nodes.every((n) => n.currency === 'KES')).toBe(true);
      expect(quote.entityIds).toHaveLength(1);
      expect(quote.locked.total).toBeGreaterThan(0);
    });

    it('names the crossing on the LEG that drives over it, not on a stop', () => {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI);
      const to = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
      corridors.addCorridor({ name: 'Nairobi–Addis', originZone: 'Nairobi', destZone: 'AddisAbaba' });

      const plan = routing.planJourney({ originAgentDid: from.did, destAgentDid: to.did });
      expect(plan.crossesBorder).toBe(true);
      expect(plan.hops.map((h) => h.country)).toEqual(['KE', 'ET']);
      expect(plan.crossings).toEqual([{ legIndex: 0, from: 'Nairobi CBD', to: "Bambi's Super Market", fromCountry: 'KE', toCountry: 'ET' }]);
      expect(plan.legs[0].crossesBorder).toBe(true);
      expect(plan.legs[0].fromCountry).toBe('KE');
      expect(plan.legs[0].toCountry).toBe('ET');
    });

    it('puts the crossing on the hub-to-hub leg when the route runs through sort centres', () => {
      // The realistic shape of the run the network is actually for: local collection, a national trunk to
      // the border, the crossing, then the other country's own last mile. Only ONE leg is international.
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI);
      const to = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
      mdps.register({ name: 'Moyale Hub', zones: ['Nairobi'], location: MOYALE_KE }); // KE by default
      mdps.register({ name: 'Hawassa Hub', zones: ['AddisAbaba'], country: 'ET', location: HAWASSA });

      const plan = routing.planJourney({ originAgentDid: from.did, destAgentDid: to.did });
      expect(plan.hops.map((h) => h.country)).toEqual(['KE', 'KE', 'ET', 'ET']);
      expect(plan.legs.map((l) => l.crossesBorder)).toEqual([false, true, false]);
      expect(plan.crossings).toHaveLength(1);
      expect(plan.crossings[0]).toMatchObject({ legIndex: 1, from: 'Moyale Hub', to: 'Hawassa Hub', fromCountry: 'KE', toCountry: 'ET' });
    });

    it('is a pure reading of the stops', () => {
      expect(crossingsOn([{ label: 'a', country: 'KE' }, { label: 'b', country: 'KE' }])).toEqual([]);
      expect(crossingsOn([{ label: 'a', country: 'KE' }])).toEqual([]);
      expect(crossingsOn([{ label: 'a', country: 'KE' }, { label: 'b', country: 'ET' }, { label: 'c', country: 'KE' }])).toHaveLength(2);
    });
  });

  describe('and states one price across it, at a rate it will show you', () => {
    it('converts a foreign stop into the quote currency, and keeps both numbers', () => {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI, 'KE', 55);
      const to = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET', 60);
      corridors.addCorridor({ name: 'Nairobi–Addis', originZone: 'Nairobi', destZone: 'AddisAbaba' });

      const quote = routing.quoteShipment(from.did, to.did);
      expect(quote.crossesBorder).toBe(true);
      expect(quote.currency).toBe('KES'); // the SELLING sister's money — here, the origin shop's

      // The Kenyan shop is owed shillings and quoted in shillings: one number, unconverted, unbuffered.
      expect(quote.nodes[0]).toMatchObject({ currency: 'KES', nativeFee: 55, fee: 55 });
      // Bambi's is owed 60 BIRR and always will be. What the buyer's price carries is that 60 expressed
      // in shillings at the BUFFERED rate — the seeded mid (129.0 / 118.5 to the dollar) is 65.32, and the
      // 1.5% buffer against the rate moving before settlement makes it 66.30. The buyer carries that, not
      // the shop and not the sister that has to hand the shop exactly what it asked for.
      expect(quote.nodes[1]).toMatchObject({ currency: 'ETB', nativeFee: 60, fee: 66.3 });
      expect(quote.nodeFees).toBe(121.3);
      expect(quote.fx!.buffer).toBe(0.98); // 66.30 charged − 65.32 the sisters settle at
    });

    it('shows the rate it used, where it came from, and how long the price is good for', () => {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI, 'KE', 55);
      const to = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET', 60);
      corridors.addCorridor({ name: 'Nairobi–Addis', originZone: 'Nairobi', destZone: 'AddisAbaba' });

      const fxUsed = routing.quoteShipment(from.did, to.did).fx!;
      expect(fxUsed.base).toBe('KES');
      expect(fxUsed.rates).toHaveLength(1);
      expect(fxUsed.rates[0]).toMatchObject({ from: 'ETB', to: 'KES', via: 'USD', source: 'seed/seed', stale: false, spreadPct: FX_SPREAD_PCT });
      // BOTH numbers ride along, and that is the policy made visible: `mid` is what the two sisters will
      // settle between themselves at, `rate` is what the buyer was charged. The gap is the buffer, and it
      // is booked as a buffer rather than kept as margin — SBG does not profit from exchange rates.
      expect(fxUsed.rates[0].mid).toBeCloseTo(129.0 / 118.5, 6);
      expect(fxUsed.rates[0].rate).toBeCloseTo((129.0 / 118.5) * (1 + FX_SPREAD_PCT), 6);
      // A price built on a rate has a shelf life, even when the rate itself is fresh.
      expect(new Date(fxUsed.expiresAt).getTime()).toBeGreaterThan(new Date(fxUsed.quotedAt).getTime());
    });

    it('leaves a domestic quote with no fx block at all — nothing was converted, so nothing expires', () => {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI);
      const to = shop('Kisumu Duka', 'Kisumu', { lat: -0.09, lng: 34.77 });
      corridors.addCorridor({ name: 'Nairobi–Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });
      const quote = routing.quoteShipment(from.did, to.did);
      expect(quote.fx).toBeUndefined();
      expect(quote.nodes.every((n) => n.fee === n.nativeFee)).toBe(true);
    });

    it('follows the rate when the rate moves', () => {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI, 'KE', 55);
      const to = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET', 60);
      corridors.addCorridor({ name: 'Nairobi–Addis', originZone: 'Nairobi', destZone: 'AddisAbaba' });
      const before = routing.quoteShipment(from.did, to.did).nodes[1].fee;

      fx.setRate('ETB', 237.0, 'central-bank'); // the birr halves against the dollar
      const after = routing.quoteShipment(from.did, to.did);
      expect(after.nodes[1].nativeFee).toBe(60); // the shop's own price did not change
      expect(after.nodes[1].fee).toBeLessThan(before); // what it costs a Kenyan buyer did
      expect(after.fx!.rates[0].source).toBe('central-bank/seed'); // the ETB leg is the fresh one
    });

    it('stamps the rates onto the parcel, so a price can always be traced back to them', () => {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI, 'KE', 55);
      const to = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET', 60);
      corridors.addCorridor({ name: 'Nairobi–Addis', originZone: 'Nairobi', destZone: 'AddisAbaba' });
      const store = vendors.register({ name: 'Nairobi Store', country: 'KE' });
      const quote = routing.quoteShipment(from.did, to.did);

      const { parcel } = parcels.createInbound({
        vendorId: store.vendorId, originAgentDid: from.did, destAgentDid: to.did, buyerMobile: '+254700999',
        contentPhotoRef: 'contents.jpg', size: 'M', shippingPolicy: store.shippingPolicy, quote,
        items: [{ name: 'Ankara shirt', qty: 2 }], subtotal: 3400, // it crosses a border, so it must declare
      });
      // Same reason the margin rate is stamped: a price is a promise made at a moment, and both the rate
      // and the knob behind it move. Without this the sister that collected could not later prove what it
      // owed the sister that performed the leg.
      expect(parcel.currency).toBe('KES');
      expect(parcel.fx?.rates).toEqual(quote.fx!.rates);
      expect(parcelCurrency(parcel)).toBe('KES');
      expect(vendorOrderRowOf(parcel).currency).toBe('KES');
    });

    it('leaves a domestic parcel with no rates at all, and reads an old parcel as the home currency', () => {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI);
      const to = shop('Kisumu Duka', 'Kisumu', { lat: -0.09, lng: 34.77 });
      corridors.addCorridor({ name: 'Nairobi–Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });
      const store = vendors.register({ name: 'Nairobi Store', country: 'KE' });
      const { parcel } = parcels.createInbound({
        vendorId: store.vendorId, originAgentDid: from.did, destAgentDid: to.did, buyerMobile: '+254700998',
        contentPhotoRef: 'contents.jpg', size: 'M', shippingPolicy: store.shippingPolicy, quote: routing.quoteShipment(from.did, to.did),
      });
      expect(parcel.fx).toBeUndefined();
      expect(parcelCurrency({ ...parcel, currency: undefined })).toBe('KES'); // written before prices named a unit
    });

    it('books the buffer as a buffer, never as margin', () => {
      // SBG is not a bank profiting from exchange rates (user, 2026-08-26). What the buffer absorbs is
      // split out of revenue at billing, so a buffer that is systematically too fat shows up as a growing
      // FX number somebody has to answer for rather than quietly padding the margin.
      const store = vendors.register({ name: 'Nairobi Store', country: 'KE' });
      vendors.topUp(store.vendorId, 500);
      vendors.billShipment(store.vendorId, 'PUD-FX', 121.3, 0.98);

      const ke = entities.requireForJurisdiction('KE').entityId;
      expect(books.balance(ke, ACCOUNT_CODES.REVENUE)).toBe(-120.32); // credit: what we actually sold
      expect(books.balance(ke, ACCOUNT_CODES.FX_GAINLOSS)).toBe(-0.98); // and what was only ever a hedge
      expect(books.balances(ke).balanced).toBe(true);
    });

    it('cannot be told the buffer was bigger than the price', () => {
      const store = vendors.register({ name: 'Nairobi Store', country: 'KE' });
      vendors.topUp(store.vendorId, 500);
      vendors.billShipment(store.vendorId, 'PUD-ODD', 100, 250); // a caller's arithmetic mistake
      const ke = entities.requireForJurisdiction('KE').entityId;
      expect(books.balance(ke, ACCOUNT_CODES.REVENUE)).toBe(0); // clamped to the whole price, not beyond it
      expect(books.balance(ke, ACCOUNT_CODES.FX_GAINLOSS)).toBe(-100);
      expect(books.balances(ke).balanced).toBe(true);
    });

    it('still refuses when the rate book has never heard of a currency', () => {
      // The old refusal, kept where it is still true. A price that cannot be stated in one currency is
      // not a price, and inventing a rate would be worse than saying so.
      expect(() => fx.rateFor('KES', 'XOF')).toThrow(/No exchange rate for XOF/);
    });

    it('prices a store collected from its own dock at home, border or not', () => {
      // The dock path is the one the SSP quote will run on, so it must stay quotable while it is domestic.
      const to = shop('Kisumu Duka', 'Kisumu', { lat: -0.09, lng: 34.77 });
      corridors.addCorridor({ name: 'Nairobi–Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });
      const v = vendors.register({ name: 'Nairobi Store', country: 'KE' });
      const quote = routing.quoteShipmentFrom(
        { type: 'dock', id: v.did, label: 'Yard', zone: 'Nairobi', country: vendors.dockCountryOf(v), location: NAIROBI },
        to.did,
        'M',
        vendors.entityIdOf(v),
      );
      expect(quote.crossesBorder).toBe(false);
      expect(quote.currency).toBe('KES');
      expect(quote.hops.map((h) => h.type)).toEqual(['dock', 'pudo']);
      expect(quote.nodes).toHaveLength(1); // the dock is on the route and not in the fee stack
      expect(quote.nodeFees).toBe(quote.nodes[0].fee);
    });
  });

  describe('and the crossing is a step, not a line on a route', () => {
    function crossBorderPair() {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI, 'KE', 55);
      const to = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET', 60);
      corridors.addCorridor({ name: 'Nairobi–Addis', originZone: 'Nairobi', destZone: 'AddisAbaba' });
      const store = vendors.register({ name: 'Nairobi Store', country: 'KE' });
      return { from, to, store, quote: routing.quoteShipment(from.did, to.did) };
    }

    const mint = (p: ReturnType<typeof crossBorderPair>, extra: Record<string, unknown> = {}) =>
      parcels.createInbound({
        vendorId: p.store.vendorId, originAgentDid: p.from.did, destAgentDid: p.to.did, buyerMobile: '+254700999',
        contentPhotoRef: 'contents.jpg', size: 'M', shippingPolicy: p.store.shippingPolicy, quote: p.quote, ...extra,
      } as never);

    it('will not sell a shipment that cannot legally travel, and says which part is missing', () => {
      const p = crossBorderPair();
      expect(() => mint(p)).toThrow(/a list of what is in the parcel and what the goods are worth/);
      expect(() => mint(p, { items: [{ name: 'Ankara shirt', qty: 2 }] })).toThrow(/what the goods are worth/);
      expect(() => mint(p, { subtotal: 3400 })).toThrow(/a list of what is in the parcel/);
      // A value of zero is not a declaration — an officer reads it as an undeclared parcel, not a free one.
      expect(() => mint(p, { items: [{ name: 'Ankara shirt', qty: 2 }], subtotal: 0 })).toThrow(/what the goods are worth/);
    });

    it('leaves no trace of the shipment it refused', () => {
      // Checked before an id, a DID or a ledger anchor is spent: a shipment that cannot travel should not
      // leave a half-born parcel behind for somebody to find.
      const p = crossBorderPair();
      const before = parcels.list({}).length;
      expect(() => mint(p)).toThrow();
      expect(parcels.list({}).length).toBe(before);
    });

    it('writes the paperwork from what the store already typed', () => {
      const p = crossBorderPair();
      const { parcel } = mint(p, { items: [{ name: 'Ankara shirt', qty: 2 }, { name: 'Kitenge scarf', qty: 1 }], subtotal: 3400 });
      expect(parcel.customs).toMatchObject({
        contents: 'Ankara shirt ×2, Kitenge scarf',
        itemCount: 3,
        declaredValue: 3400, // what the GOODS are worth — never the shipping price
        currency: 'KES',
        exporterId: p.store.vendorId,
        incoterm: 'DDU', // the importer settles duty; none of it moves through our books
      });
      expect(parcel.customs!.crossings).toEqual(p.quote.crossings);
      expect(parcel.customs!.importerRef).not.toContain('+254'); // the receiver is referenced, never named
    });

    it('asks a domestic parcel for none of it', () => {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI);
      const to = shop('Kisumu Duka', 'Kisumu', { lat: -0.09, lng: 34.77 });
      corridors.addCorridor({ name: 'Nairobi–Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });
      const store = vendors.register({ name: 'Nairobi Store', country: 'KE' });
      const { parcel } = parcels.createInbound({
        vendorId: store.vendorId, originAgentDid: from.did, destAgentDid: to.did, buyerMobile: '+254700998',
        contentPhotoRef: 'contents.jpg', size: 'M', shippingPolicy: store.shippingPolicy, quote: routing.quoteShipment(from.did, to.did),
      });
      expect(parcel.customs).toBeUndefined();
    });

    it('turns a walk-up counter send to another country away, and says who can', () => {
      // The counter asks for a size and a photo, never a contents list and a value. Minting an undeclared
      // international shipment and letting a border post discover it is the worse of the two answers.
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI);
      const to = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
      expect(() =>
        parcels.accept({ parcelId: 'PUD-WALKUP', agentDid: from.did, destPudoDid: to.did, destZone: 'AddisAbaba', size: 'M', senderMobile: '+254700111', receiverMobile: '+251900111', dropoffPhotoRef: 'p.jpg' } as never),
      ).toThrow(/another country/);
    });

    it('makes the leg that stops at a post read as one that stops', () => {
      const p = crossBorderPair();
      const plan = routing.planJourney({ originAgentDid: p.from.did, destAgentDid: p.to.did });
      expect(plan.legs[0].borderDwellH).toBe(BORDER_DWELL_H);

      // The same road, domestically: the wait is the difference, and it is on the leg rather than smeared
      // over the whole journey — the ETA stays optimistic by decision, but not about a queue at a border.
      const home = shop('Kisumu Duka', 'Kisumu', { lat: -0.09, lng: 34.77 });
      corridors.addCorridor({ name: 'Nairobi–Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });
      const domestic = routing.planJourney({ originAgentDid: p.from.did, destAgentDid: home.did });
      expect(domestic.legs[0].borderDwellH).toBe(0);
      expect(plan.totalHours).toBeGreaterThan(BORDER_DWELL_H);
    });
  });

  describe('and the two companies settle at cost', () => {
    /** A shop that can actually be paid — the wallet is provisioned at KYC approval. */
    function activeShop(shopName: string, zone: string, location: { lat: number; lng: number }, country?: string) {
      const a = shop(shopName, zone, location, country);
      agents.submitKyc(a.did, { idCopyRef: 'id.jpg', tradingLicenceRef: 'licence.pdf', shopPhotoRefs: ['shop.jpg'] });
      agents.decideKyc(a.did, true);
      return agents.get(a.did);
    }

    it('makes the performing sister whole and leaves it earning nothing', () => {
      // "We will recover cost only" (user, 2026-08-26). The Ethiopian sister pays its own shop in birr for
      // handling a parcel the Kenyan sister sold, and recovers exactly that — no margin, and no revenue at
      // all, because it did not sell anything. Its expense is REVERSED rather than matched with income.
      const bambi = activeShop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
      const ke = entities.requireForJurisdiction('KE').entityId;
      const et = entities.requireForJurisdiction('ET').entityId;

      gate.payLabour(bambi.did, 0.3, 'PUD-XB', 'parcel', ke); // the collection fee, on a KE-sold parcel

      expect(books.balance(et, ACCOUNT_CODES.EXPENSE_PROVIDER_FEES)).toBe(0); // paid, then recharged
      expect(books.balance(et, ACCOUNT_CODES.REVENUE)).toBe(0); // it sold nothing, so it earned nothing
      expect(books.balance(et, ACCOUNT_CODES.INTERCOMPANY, undefined, ke)).toBe(0.3); // owed, in birr
      expect(books.balance(et, ACCOUNT_CODES.DEPOSIT_AGENT, undefined, bambi.did)).toBe(-0.3); // the shop has its money
    });

    it('puts the cost on the sister that sold the shipment, in its own money, at the MID rate', () => {
      const bambi = activeShop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
      const ke = entities.requireForJurisdiction('KE').entityId;
      const et = entities.requireForJurisdiction('ET').entityId;

      gate.payLabour(bambi.did, 0.3, 'PUD-XB', 'parcel', ke);

      // NOT the same number as the birr side, and that is the design: two entries, one per book, equal in
      // VALUE rather than in digits. The buyer's buffer never enters here — that is what makes it not ours.
      const cost = fx.convert(0.3, 'ETB', 'KES');
      expect(cost).not.toBe(0.3);
      expect(books.balance(ke, ACCOUNT_CODES.EXPENSE_PROVIDER_FEES)).toBe(cost);
      expect(books.balance(ke, ACCOUNT_CODES.INTERCOMPANY, undefined, et)).toBe(-cost); // negative = a payable
      expect(books.balances(ke)).toEqual({ balanced: true, drift: 0 });
      expect(books.balances(et)).toEqual({ balanced: true, drift: 0 });
    });

    it('links the two entries by the same reference, so the pair can be found', () => {
      const bambi = activeShop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
      gate.payLabour(bambi.did, 0.3, 'PUD-XB', 'parcel', entities.requireForJurisdiction('KE').entityId);
      const pair = books.journal({ ref: 'PUD-XB' }).filter((e) => e.kind === 'recharge-at-cost');
      expect(pair).toHaveLength(2);
      expect(new Set(pair.map((e) => e.entityId)).size).toBe(2); // one in each sister's book
    });

    it('recharges nobody inside one company, and nobody at all on an older parcel', () => {
      const duka = activeShop('Nairobi CBD', 'Nairobi', NAIROBI);
      const ke = entities.requireForJurisdiction('KE').entityId;

      gate.payLabour(duka.did, 0.3, 'PUD-KE', 'parcel', ke); // same sister both sides
      gate.payLabour(duka.did, 0.3, 'PUD-OLD', 'parcel'); // minted before parcels named a seller

      // The cost stays where it was paid, both times — which is exactly right for a single-sister world.
      expect(books.balance(ke, ACCOUNT_CODES.EXPENSE_PROVIDER_FEES)).toBe(0.6);
      expect(books.balance(ke, ACCOUNT_CODES.INTERCOMPANY, undefined, ke)).toBe(0);
      expect(books.journal({}).some((e) => e.kind === 'recharge-at-cost')).toBe(false);
    });
  });
});
