import { Test } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { RoutingService, publicQuote } from './routing.service';
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
import { DigitalTwinService } from '../m7/digital-twin.service';
import { TrackingService } from '../m4/tracking.service';
import { TrackingContextService } from '../m4/tracking-context.service';
import { NormalizationService } from '../m4/normalization.service';
import { ConnectorRegistry, MobileSdkConnector, RestCarrierConnector } from '../m4/connectors/connectors';
import { WalletService } from '../m1/wallet/wallet.service';
import { DidService } from '../../foundation/did/did.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { BooksService } from '../../foundation/books/books.service';
import { FxService } from '../../foundation/money/fx.service';
import { PayoutService } from '../../foundation/payouts/payout.service';
import { SandboxPayoutRail } from '../../foundation/payouts/sandbox-rail.adapter';
import { PAYOUT_RAIL } from '../../foundation/payouts/payout.types';
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';

/**
 * A PARCEL PRICE DOES NOT SURGE. Decided by the user, 2026-09-06.
 *
 * The question had been open since 2026-08-27, when the user asked whether the market-pulse engine applies
 * to a buyer clicking the quote button on a merchant's checkout. It does not, and they decided it should
 * not: *a published shipping price is a different promise from a driver's spot offer.* A buyer who is
 * quoted one figure at breakfast and another at lunch reads it as a trick, and it is the MERCHANT who
 * carries that complaint.
 *
 * The behaviour was already right. What it was not was DEFENDED — `quoteJourney` simply never happened to
 * reference the pulse, and nothing would have stopped somebody wiring `freightMultiplier` into it next
 * month in the belief they were finishing an unfinished job. This turns a fact that had to be re-verified
 * by reading into an invariant that fails loudly.
 *
 * THE TRAP THIS FILE HAD TO AVOID: "the price did not change" passes just as well when the surge rule was
 * never active at all. So every test here first proves the rule IS live by watching it move a freight
 * offer, and only then asserts that it left the parcel alone.
 */
describe('a parcel price does not surge', () => {
  let agents: AgentService;
  let corridors: CorridorService;
  let routing: RoutingService;
  let dispatch: DispatchService;
  let drivers: DriverService;
  let vehicles: VehicleService;
  let fleet: FleetService;
  let pulse: MarketPulseStore;
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
        EntityService, BooksService, FxService,
        PayoutService, SandboxPayoutRail, { provide: PAYOUT_RAIL, useExisting: SandboxPayoutRail },
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
        HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
      ],
    }).compile();
    entities = moduleRef.get(EntityService);
    entities.seed();
    moduleRef.get(FxService).seed();
    moduleRef.get(BooksService).reset();
    agents = moduleRef.get(AgentService);
    corridors = moduleRef.get(CorridorService);
    routing = moduleRef.get(RoutingService);
    dispatch = moduleRef.get(DispatchService);
    drivers = moduleRef.get(DriverService);
    vehicles = moduleRef.get(VehicleService);
    fleet = moduleRef.get(FleetService);
    pulse = moduleRef.get(MarketPulseStore);
  });

  let seq = 0;
  const NAIROBI = { lat: -1.286, lng: 36.817 };
  const KISUMU = { lat: -0.09, lng: 34.77 };
  const hours = { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null };

  function shop(shopName: string, zone: string, location: { lat: number; lng: number }) {
    seq += 1;
    return agents.register({
      shopName, zone, location, landmark: 'by the road', openingHours: hours, shelf: { rows: 3, cols: 3 },
      fullName: `${shopName} owner`, nationalId: `ID-P${seq}`, mobile: `+2547600${seq}`, deviceImei: `IMEI-P${seq}`,
      requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
    });
  }

  function route() {
    const from = shop(`Nairobi ${seq}`, 'Nairobi', NAIROBI);
    const to = shop(`Kisumu ${seq}`, 'Kisumu', KISUMU);
    corridors.addCorridor({ name: 'Nairobi-Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });
    return { from, to };
  }

  /** A coupled driver who can be offered freight — the witness that a surge rule is really live. */
  function rider() {
    seq += 1;
    const d = drivers.register({ displayName: `S${seq}`, fullName: `S ${seq}`, nationalId: `ID-SD${seq}`, mobile: `+2547700${seq}`, licenceClasses: ['motorcycle'] });
    const bike = vehicles.register({ plate: `SG-${seq}`, vehicleClass: 'motorcycle', ownerName: 'S' });
    fleet.couple(d.did, bike.vehicleId);
    return d;
  }

  /** Double the market in the cell the route starts in — the strongest surge the engine will carry. */
  function surgeAt(geo: { lat: number; lng: number }) {
    pulse.setRule({ cell: MarketPulseStore.cellFor(geo), factor: 2, expiresAt: new Date(Date.now() + 3_600_000).toISOString() } as never);
  }

  /** What a freight load near this point would pay — the LIVE reading of the surge engine. */
  function freightPrice(driverDid: string, at: { lat: number; lng: number }): number {
    const offers = dispatch.suggestNearby(driverDid, at, 15);
    const priced = offers.find((o) => o.kind === 'freight' && o.price);
    if (!priced?.price) throw new Error('no priced freight offer — the witness is broken, not the subject');
    return priced.price.total;
  }

  describe('the witness', () => {
    it('a surge rule really does move a freight price', () => {
      // Everything below asserts that a number did NOT move. That assertion is worthless unless the thing
      // it is being protected from is demonstrably switched on, so this test exists to switch it on and
      // watch it work. If this one ever fails, the others are passing for the wrong reason.
      const at = { lat: NAIROBI.lat, lng: NAIROBI.lng };
      dispatch.registerFreight({ description: 'Boxes', pickupLocation: at, pickupLabel: 'Depot', destLabel: 'Site', destLocation: { lat: at.lat, lng: at.lng + 0.05 }, weightKg: 5, packaging: 'piece' });

      // Two drivers, not one driver asked twice: an offer already made is HELD — makeOffer returns the
      // pending one rather than re-pricing it, which is right, because a figure somebody has already been
      // shown must not move under them. Asking the same driver again would have read that held price back
      // and let this witness pass while proving nothing.
      const calm = freightPrice(rider().did, at);
      surgeAt(at);
      expect(freightPrice(rider().did, at)).toBeGreaterThan(calm);
    });
  });

  describe('and leaves the parcel alone', () => {
    it('quotes a shipment at the same price in a doubled market', () => {
      // The decision, in one assertion. A merchant's checkout shows a figure; the same figure has to be
      // there when the buyer comes back to it.
      const { from, to } = route();
      const before = routing.quoteShipment(from.did, to.did, 'M');
      surgeAt(NAIROBI);
      const during = routing.quoteShipment(from.did, to.did, 'M');

      expect(during.locked).toEqual(before.locked);
      expect(during.flexible).toEqual(before.flexible);
      expect(during.nodeFees).toBe(before.nodeFees);
      expect(during.transportFactor).toBe(before.transportFactor);
    });

    it('holds for the PUBLIC quote — the one a stranger sees on a merchant’s checkout', () => {
      // The surface the decision was actually about. It funnels through the same journey, and this pins
      // that it cannot quietly stop doing so.
      const { from, to } = route();
      const before = publicQuote(routing.quoteShipment(from.did, to.did, 'M'));
      surgeAt(NAIROBI);
      expect(publicQuote(routing.quoteShipment(from.did, to.did, 'M'))).toEqual(before);
    });

    it('holds at the DESTINATION end of the route too', () => {
      // A surge is a property of a place, and a journey has two of them. Pinning only the origin would
      // leave the far end free to move a price the buyer was already shown.
      const { from, to } = route();
      const before = routing.quoteShipment(from.did, to.did, 'M');
      surgeAt(KISUMU);
      expect(routing.quoteShipment(from.did, to.did, 'M').locked).toEqual(before.locked);
    });

    it('holds for every size, not just the reference one', () => {
      const { from, to } = route();
      const before = (['S', 'M', 'L'] as const).map((s) => routing.quoteShipment(from.did, to.did, s).locked.gross);
      surgeAt(NAIROBI);
      expect((['S', 'M', 'L'] as const).map((s) => routing.quoteShipment(from.did, to.did, s).locked.gross)).toEqual(before);
    });
  });
});
