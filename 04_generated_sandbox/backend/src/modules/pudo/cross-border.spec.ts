import { Test } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { RoutingService } from './routing.service';
import { CorridorService } from './corridor.service';
import { ShelfService } from './shelf.service';
import { VendorService } from './vendor.service';
import { ParcelService } from './parcel.service';
import { ToteService } from './tote.service';
import { VehicleService } from './vehicle.service';
import { DriverService } from './driver.service';
import { FleetService } from './fleet.service';
import { DispatchService } from './dispatch.service';
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
import { NETWORK_JURISDICTION } from './pudo.config';
import { DigitalTwinService } from '../m7/digital-twin.service';
import { TrackingService } from '../m4/tracking.service';
import { TrackingContextService } from '../m4/tracking-context.service';
import { NormalizationService } from '../m4/normalization.service';
import { ConnectorRegistry, MobileSdkConnector, RestCarrierConnector } from '../m4/connectors/connectors';
import { WalletService } from '../m1/wallet/wallet.service';
import { DidService } from '../../foundation/did/did.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { BooksService } from '../../foundation/books/books.service';
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

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService,
        BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
        DriverService, FleetService, DispatchService, MarketPulseStore, MarketPulseService, FleetManagerService,
        MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
        ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
        WalletService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus,
        EntityService, BooksService,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
        HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
      ],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed(); // compile() runs no lifecycle hooks — the sisters are seeded by hand, as at boot
    agents = moduleRef.get(AgentService);
    mdps = moduleRef.get(MdpService);
    routing = moduleRef.get(RoutingService);
    corridors = moduleRef.get(CorridorService);
    vendors = moduleRef.get(VendorService);
  });

  let seq = 0;
  const hours = { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null };

  function shop(shopName: string, zone: string, location: { lat: number; lng: number }, country?: string) {
    seq += 1;
    return agents.register({
      shopName, zone, country, location, landmark: 'by the road', openingHours: hours, shelf: { rows: 3, cols: 3 },
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

  describe('and refuses to invent a price across it', () => {
    it('will not add shillings to birr and call the sum a quote', () => {
      const from = shop('Nairobi CBD', 'Nairobi', NAIROBI);
      const to = shop("Bambi's Super Market", 'AddisAbaba', ADDIS, 'ET');
      corridors.addCorridor({ name: 'Nairobi–Addis', originZone: 'Nairobi', destZone: 'AddisAbaba' });

      // The route PLANS — a driver could be sent — but the price cannot be stated, and the refusal says
      // exactly which stop is paid in the other money. Lifting this is the FX slice, not a rounding fix.
      expect(() => routing.quoteShipment(from.did, to.did)).toThrow(/KES/);
      expect(() => routing.quoteShipment(from.did, to.did)).toThrow(/ETB/);
      expect(() => routing.quoteShipment(from.did, to.did)).toThrow(/not available yet/);
      expect(routing.planJourney({ originAgentDid: from.did, destAgentDid: to.did }).crossesBorder).toBe(true);
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
});
