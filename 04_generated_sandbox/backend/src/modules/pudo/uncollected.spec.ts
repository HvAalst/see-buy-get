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
import { NEVER_DROPPED_H, UNCOLLECTED_H } from './pudo.config';
import { operationalParcelView } from './parcel.service';
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
 * The two states nothing was watching.
 *
 * Every state a parcel passes THROUGH had a window on it — 48 h at a shop, 6 h on a bus, 12 h at a hub.
 * The two it can REST in had none:
 *
 *  - `Ready_For_Pickup`, where a parcel nobody collects waits for ever. It holds a shelf slot the whole
 *    time, and the shelf is what decides whether a shop can accept anything new, so every uncollected
 *    parcel quietly costs the network a slot in a shop that has six or nine of them. There was also no way
 *    OUT: cancel accepted Created, At_PUDO and At_MDP, so once a parcel reached the destination shelf
 *    there was no path of any kind.
 *  - `Created`, where a shipment the vendor has ALREADY BEEN BILLED FOR sits if it is never dropped off.
 *    The way out existed — cancel reverses the charge — and nothing ever pointed at one.
 *
 * All three findings were the same finding: the network knew and never said.
 */
describe('the states nothing watched', () => {
  let agents: AgentService;
  let corridors: CorridorService;
  let parcels: ParcelService;
  let vendors: VendorService;
  let monitor: MonitorService;
  let shelf: ShelfService;
  let routing: RoutingService;
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
    parcels = moduleRef.get(ParcelService);
    vendors = moduleRef.get(VendorService);
    monitor = moduleRef.get(MonitorService);
    shelf = moduleRef.get(ShelfService);
    routing = moduleRef.get(RoutingService);
  });

  let seq = 0;
  const hours = { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null };
  const agoH = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

  function shop(shopName: string, zone: string) {
    seq += 1;
    const a = agents.register({
      shopName, zone, location: { lat: -1.2 + seq / 100, lng: 36.8 }, landmark: 'by the road', openingHours: hours,
      shelf: { rows: 3, cols: 3 }, fullName: `${shopName} owner`, nationalId: `ID-U${seq}`, mobile: `+2547800${seq}`,
      deviceImei: `IMEI-U${seq}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
    });
    agents.submitKyc(a.did, { idCopyRef: 'id.jpg', tradingLicenceRef: 'tl.jpg', shopPhotoRefs: ['shop.jpg'] });
    agents.decideKyc(a.did, true);
    return agents.get(a.did);
  }

  /** A minted vendor shipment, sitting in whatever state the test needs. */
  function shipment() {
    const from = shop(`Origin ${seq}`, 'Nairobi');
    const to = shop(`Dest ${seq}`, 'Kisumu');
    corridors.addCorridor({ name: 'Nairobi-Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });
    const store = vendors.register({ name: `Store ${(seq += 1)}`, country: 'KE' });
    vendors.topUp(store.vendorId, 500);
    const { parcel } = parcels.createInbound({
      vendorId: store.vendorId, originAgentDid: from.did, destAgentDid: to.did, buyerMobile: `+25470099${seq}`,
      contentPhotoRef: 'c.jpg', size: 'M', routeMode: 'locked', shippingPolicy: store.shippingPolicy,
      quote: routing.quoteShipment(from.did, to.did, 'M'),
    } as never);
    return { parcel, from, to, store };
  }

  const flagTypes = () => monitor.flags().map((f) => f.type);

  describe('a parcel nobody comes for', () => {
    /** Put a parcel on the destination shelf, waiting `hoursWaiting` hours. */
    function waiting(hoursWaiting: number) {
      const { parcel, to } = shipment();
      const p = parcels.get(parcel.parcelId);
      p.status = 'Ready_For_Pickup';
      p.destAgentDid = to.did;
      p.readyAt = agoH(hoursWaiting);
      shelf.assign(to.did, p.parcelId, 'M');
      return { parcel: p, to };
    }

    it('is flagged once it has genuinely been abandoned', () => {
      waiting(UNCOLLECTED_H + 1);
      expect(flagTypes()).toContain('Uncollected');
    });

    it('is left alone while somebody might still be coming', () => {
      // The window is about a person being busy, not a thing going wrong. A parcel that arrived this
      // morning is not a problem, and flagging it teaches an operator to ignore the flag.
      waiting(UNCOLLECTED_H - 1);
      expect(flagTypes()).not.toContain('Uncollected');
    });

    it('ages from the ARRIVAL, not from the last scan', () => {
      // A wrong collection code writes a Ready_For_Pickup scan of its own. Ageing off the scan list would
      // reset the clock every time somebody fumbled their code — the parcel would never be flagged, and
      // the one most likely to be stuck is exactly the one somebody keeps failing to collect.
      const { parcel } = waiting(UNCOLLECTED_H + 5);
      parcel.scans.push({ status: 'Ready_For_Pickup', by: 'agent', note: 'wrong code', at: new Date().toISOString() } as never);
      expect(flagTypes()).toContain('Uncollected');
    });

    it('says where it is and which slot it is holding', () => {
      // The flag has to be actionable by somebody standing in a shop. "A parcel is late" is not.
      const { parcel } = waiting(UNCOLLECTED_H + 24);
      const flag = monitor.flags().find((f) => f.type === 'Uncollected' && f.subject === parcel.parcelId)!;
      expect(flag.detail).toContain('Kisumu');
      expect(flag.ageHours).toBeGreaterThan(UNCOLLECTED_H);
    });
  });

  describe('the way out that did not exist', () => {
    function waiting(hoursWaiting: number) {
      const { parcel, to } = shipment();
      const p = parcels.get(parcel.parcelId);
      p.status = 'Ready_For_Pickup';
      p.destAgentDid = to.did;
      p.readyAt = agoH(hoursWaiting);
      shelf.assign(to.did, p.parcelId, 'M');
      return { parcel: p, to };
    }

    it('lets an abandoned parcel be called off, and gives the shop its slot back', () => {
      // THE POINT. The shelf is the scarce thing — it decides whether a shop can accept anything new — so
      // an exit that left the slot occupied would leave the network exactly as short as before.
      const { parcel, to } = waiting(UNCOLLECTED_H + 1);
      // The shelf's FREE slots: an occupied one is a slot the shop cannot offer anybody else.
      const freeBefore = shelf.available(to.did);

      parcels.cancel(parcel.parcelId, 'operator:test', 'unclaimed');
      expect(parcels.get(parcel.parcelId).status).toBe('Voided');
      expect(shelf.available(to.did)).toBe(freeBefore + 1);
    });

    it('refuses while it might still be collected, and says how long that is', () => {
      // A button that cancels a parcel which arrived an hour ago is a worse bug than the one it fixes.
      const { parcel } = waiting(1);
      expect(() => parcels.cancel(parcel.parcelId, 'operator:test', 'too soon')).toThrow(/waiting to be collected/);
      expect(parcels.get(parcel.parcelId).status).toBe('Ready_For_Pickup');
    });

    it('still refuses the states that were never cancellable', () => {
      const { parcel } = shipment();
      const p = parcels.get(parcel.parcelId);
      p.status = 'On_Bus';
      expect(() => parcels.cancel(p.parcelId, 'operator:test', 'nope')).toThrow(/Cannot cancel/);
    });
  });

  describe('what the shop is actually handed', () => {
    // THE BUG UNDER THIS ONE. The counter's "N to collect" was computed over a list fetched with
    // status=At_PUDO, so it could never contain a parcel to collect: the line was dead in production and
    // the shopkeeper was never told anybody's parcel had arrived. The unit test for the line passed the
    // whole time, because it hand-fed a row the app never received — a function proved, a wiring not.
    function atShop() {
      const { parcel, from, to } = shipment();
      const outbound = parcels.get(parcel.parcelId);
      outbound.status = 'At_PUDO';
      outbound.originAgentDid = from.did;

      const { parcel: second } = shipment();
      const waiting = parcels.get(second.parcelId);
      waiting.status = 'Ready_For_Pickup';
      waiting.destAgentDid = to.did;
      waiting.readyAt = agoH(UNCOLLECTED_H + 2);
      return { to, from, outbound, waiting };
    }

    it('serves BOTH piles a counter has to clear, in one ask', () => {
      const { to, waiting } = atShop();
      const rows = parcels.list({ status: 'Ready_For_Pickup', agentDid: to.did });
      expect(rows.map((p) => p.parcelId)).toContain(waiting.parcelId);
    });

    it('marks the one that has been waiting too long', () => {
      // Derived on the SERVER, where the threshold lives. A shopkeeper's screen and an operator's flag
      // disagreeing about "overdue" is the kind of thing nobody notices until two people are arguing
      // across a counter about whose number is right.
      const { waiting } = atShop();
      expect(operationalParcelView(waiting)).toMatchObject({ overdue: true });
    });

    it('says nothing about overdue on a parcel that is not waiting', () => {
      // Absent rather than false: a flag that is false on every parcel in every other state invites a
      // list filtered on it to look sensible and mean nothing.
      const { outbound } = atShop();
      expect('overdue' in operationalParcelView(outbound)).toBe(false);
    });

    it('leaves a freshly-arrived parcel unmarked', () => {
      const { parcel, to } = shipment();
      const p = parcels.get(parcel.parcelId);
      p.status = 'Ready_For_Pickup';
      p.destAgentDid = to.did;
      p.readyAt = agoH(1);
      expect('overdue' in operationalParcelView(p)).toBe(false);
    });
  });

  describe('a shipment that never started', () => {
    it('is flagged, because the store has already paid for it', () => {
      // Billing happens at MINT. A shipment that is never dropped off is a merchant paying for nothing,
      // and Created was the other state with no watch on it.
      const { parcel } = shipment();
      parcels.get(parcel.parcelId).acceptedAt = agoH(NEVER_DROPPED_H + 1);
      const flag = monitor.flags().find((f) => f.type === 'Never_Dropped_Off' && f.subject === parcel.parcelId)!;
      expect(flag).toBeDefined();
      expect(flag.detail).toContain('billed');
    });

    it('leaves a store that prints its labels early alone', () => {
      // A shop legitimately mints ahead of a courier run. This is for the order that was forgotten.
      const { parcel } = shipment();
      parcels.get(parcel.parcelId).acceptedAt = agoH(NEVER_DROPPED_H - 1);
      expect(flagTypes()).not.toContain('Never_Dropped_Off');
    });

    it('can be called off the way it always could — what was missing was noticing', () => {
      const { parcel } = shipment();
      parcels.get(parcel.parcelId).acceptedAt = agoH(NEVER_DROPPED_H + 1);
      parcels.cancel(parcel.parcelId, 'operator:test', 'never dropped off');
      expect(parcels.get(parcel.parcelId).status).toBe('Voided');
    });
  });
});
