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
import { RouteConstraintService } from './route-constraint.service';
import { WalletGateService } from './wallet-gate.service';
import { CargoService } from './cargo.service';
import { MediaService } from './media.service';
import { MarketPulseStore } from './market-pulse.store';
import { MarketPulseService } from './market-pulse.service';
import { RatingService, MIN_PUBLIC_RATINGS } from './rating.service';
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
import { ReturnService } from './return.service';
import { UnclaimedService } from './unclaimed.service';
import { MerchantRatingService } from './merchant-rating.service';
import { DigitalTwinService } from '../m7/digital-twin.service';
import { TrackingService } from '../m4/tracking.service';
import { TrackingContextService } from '../m4/tracking-context.service';
import { NormalizationService } from '../m4/normalization.service';
import { ConnectorRegistry, MobileSdkConnector, RestCarrierConnector } from '../m4/connectors/connectors';
import { WalletService } from '../m1/wallet/wallet.service';
import { DidService } from '../../foundation/did/did.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { PresenceService } from '../../foundation/presence/presence.service';
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
 * A merchant's reputation, out of things we watched.
 *
 * THE THESIS being tested: we carried the parcel, so we know what no review site can compute — when it
 * was sold, when it reached a counter, whether it ever arrived, and how its claims ended. A star average
 * from strangers is a crowded market entered late; the measured half is the part nobody can fake.
 *
 * THE RULE the feature lives or dies by: we publish only what we measured, identically for everyone, and
 * no merchant may hide it. Which is why the profile is a public page rather than something inside a
 * widget a merchant chooses to install — a score the badly-behaved can opt out of is not a score.
 */
describe('what a store earns by shipping', () => {
  let agents: AgentService;
  let corridors: CorridorService;
  let parcels: ParcelService;
  let vendors: VendorService;
  let routing: RoutingService;
  let merchants: MerchantRatingService;
  let entities: EntityService;

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
        EntityService, PresenceService, BooksService, FxService,
        PayoutService, ReturnService, UnclaimedService, MerchantRatingService, SandboxPayoutRail,
        { provide: PAYOUT_RAIL, useExisting: SandboxPayoutRail },
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
    routing = moduleRef.get(RoutingService);
    merchants = moduleRef.get(MerchantRatingService);
  });

  const HOUR = 3_600_000;
  let seq = 0;
  const hours = { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null };

  function shop(shopName: string, zone: string) {
    seq += 1;
    const a = agents.register({
      shopName, zone, location: { lat: -1.2 + seq / 100, lng: 36.8 }, landmark: 'by the road', openingHours: hours,
      shelf: { rows: 3, cols: 3 }, fullName: `${shopName} owner`, nationalId: `ID-M${seq}`, mobile: `+2547820${seq}`,
      deviceImei: `IMEI-M${seq}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
    });
    agents.submitKyc(a.did, { idCopyRef: 'id.jpg', tradingLicenceRef: 'tl.jpg', shopPhotoRefs: ['shop.jpg'] });
    agents.decideKyc(a.did, true);
    return agents.get(a.did);
  }

  /** A store with somewhere to ship from and to. */
  function store(name: string) {
    seq += 1;
    const from = shop(`M Origin ${seq}`, 'Nairobi');
    const to = shop(`M Dest ${seq}`, 'Kisumu');
    corridors.addCorridor({ name: 'Nairobi-Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });
    const v = vendors.register({ name, country: 'KE', ownerPhone: `+2547930${seq}` } as never);
    vendors.topUp(v.vendorId, 900);
    return { vendor: v, from, to };
  }

  /**
   * One shipment, sold `soldHoursAgo` ago and handed to the counter `handoverH` hours after that.
   *
   * The two stamps are backdated on the SCAN TRAIL, because that is where the measurement reads from —
   * intake overwrites `acceptedAt` with the counter's clock, so a test that backdated the field would be
   * measuring something the running service never sees.
   */
  function shipment(ctx: ReturnType<typeof store>, opts: { soldHoursAgo?: number; handoverH?: number; deliver?: boolean } = {}) {
    seq += 1;
    const { parcel } = parcels.createInbound({
      vendorId: ctx.vendor.vendorId, originAgentDid: ctx.from.did, destAgentDid: ctx.to.did,
      buyerMobile: `+25470066${seq}`, contentPhotoRef: 'c.jpg', size: 'M',
      dimensionsCm: { l: 30, w: 20, h: 10 }, weightKg: 2, declaredValue: 100,
      routeMode: 'locked', shippingPolicy: ctx.vendor.shippingPolicy,
      quote: routing.quoteShipment(ctx.from.did, ctx.to.did, 'M'),
    } as never);

    const p = parcels.get(parcel.parcelId);
    const sold = Date.now() - (opts.soldHoursAgo ?? 48) * HOUR;
    p.scans[0].at = new Date(sold).toISOString();
    if (opts.handoverH != null) {
      parcels.intakeInbound(p.parcelId, ctx.from.did);
      const handed = p.scans.find((s) => s.status === 'At_PUDO')!;
      handed.at = new Date(sold + opts.handoverH * HOUR).toISOString();
    }
    if (opts.deliver) p.status = 'Delivered';
    return p;
  }

  // ---------------------------------------------------------------------------------------------
  describe('the measured half', () => {
    it('says how often a store gets a parcel to a counter within a day', () => {
      // The claim nobody can fake, because we hold both ends of it.
      const s = store('Fast Threads');
      shipment(s, { handoverH: 3 });
      shipment(s, { handoverH: 20 });
      shipment(s, { handoverH: 50 }); // the slow one
      const card = merchants.scorecard(s.vendor.vendorId);
      expect(card.shipments).toBe(3);
      expect(card.shipsNextDayRate).toBeCloseTo(2 / 3, 2);
      expect(card.medianHoursToHandover).toBeCloseTo(20, 1);
    });

    it('measures from the SALE, not from the field intake overwrites', () => {
      // acceptedAt holds the sale time until intake replaces it with the counter's clock. A scorecard
      // reading that field would report every merchant as shipping instantly — the most flattering
      // possible lie, and one nothing in the suite would have contradicted.
      const s = store('Overwrite Threads');
      const p = shipment(s, { handoverH: 30 });
      const sold = new Date(p.scans.find((x) => x.status === 'CREATED')!.at).getTime();
      expect(new Date(p.acceptedAt).getTime()).toBeGreaterThan(sold); // the field moved…
      expect(merchants.scorecard(s.vendor.vendorId).medianHoursToHandover).toBeCloseTo(30, 1); // …the measure did not
    });

    it('uses the MIDDLE, so one forgotten parcel does not sink a good store', () => {
      const s = store('Median Threads');
      for (const h of [2, 3, 4, 5]) shipment(s, { handoverH: h });
      shipment(s, { handoverH: 900 }); // forgotten over a long weekend
      const card = merchants.scorecard(s.vendor.vendorId);
      expect(card.medianHoursToHandover).toBeCloseTo(4, 1); // a mean would read ~183
    });

    it('counts what was sold and never handed over at all', () => {
      // The merchant's own failure, billed at mint and invisible before this.
      const s = store('Ghost Threads');
      shipment(s, { handoverH: 4 });
      shipment(s); // minted, never dropped off
      const card = merchants.scorecard(s.vendor.vendorId);
      expect(card.shipments).toBe(1); // only the one that moved
      expect(card.neverDroppedRate).toBeCloseTo(0.5, 2);
    });

    it('says nothing rather than something flattering when there is nothing to measure', () => {
      // A zero rate would read as "never late" for a store that has shipped nothing at all.
      const card = merchants.scorecard(store('Silent Threads').vendor.vendorId);
      expect(card.shipments).toBe(0);
      expect(card.shipsNextDayRate).toBeUndefined();
      expect(card.medianHoursToHandover).toBeUndefined();
      expect(card.upheldDisputeRate).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('what a receiver may say', () => {
    it('takes stars and tags from the person who actually received it', () => {
      const s = store('Rated Threads');
      const p = shipment(s, { handoverH: 4, deliver: true });
      const { rating } = merchants.rate({ parcelId: p.parcelId, phoneHash: p.receiverPhoneHash!, stars: 5, tags: ['WELL_PACKED', 'AS_DESCRIBED'] });
      expect(rating.stars).toBe(5);
      expect(rating.tags).toEqual(['WELL_PACKED', 'AS_DESCRIBED']);
      expect(merchants.scorecard(s.vendor.vendorId).tags.map((t) => t.tag)).toContain('WELL_PACKED');
    });

    it('refuses anybody who was not the receiver, without confirming the parcel exists', () => {
      // The same rule every owner-scoped read here keeps: NOT_FOUND, never FORBIDDEN.
      const s = store('Private Threads');
      const p = shipment(s, { handoverH: 4, deliver: true });
      expect(() => merchants.rate({ parcelId: p.parcelId, phoneHash: 'somebody-else', stars: 1 })).toThrow(/No such parcel/);
    });

    it('refuses a verdict before the parcel has arrived', () => {
      // An opinion about a parcel that has not come is an opinion about waiting, which the measured half
      // already reports better and without asking anybody.
      const s = store('Early Threads');
      const p = shipment(s, { handoverH: 4 });
      expect(() => merchants.rate({ parcelId: p.parcelId, phoneHash: p.receiverPhoneHash!, stars: 1 })).toThrow(/once the parcel is delivered/);
    });

    it('takes one verdict per shipment, so nobody can stack a store either way', () => {
      const s = store('Once Threads');
      const p = shipment(s, { handoverH: 4, deliver: true });
      merchants.rate({ parcelId: p.parcelId, phoneHash: p.receiverPhoneHash!, stars: 5 });
      expect(() => merchants.rate({ parcelId: p.parcelId, phoneHash: p.receiverPhoneHash!, stars: 5 })).toThrow(/already rated/);
    });

    it('drops a tag it has never heard of instead of failing the whole rating', () => {
      // A client one version behind should not lose somebody's verdict over a catalogue key.
      const s = store('Forward Threads');
      const p = shipment(s, { handoverH: 4, deliver: true });
      const { rating } = merchants.rate({ parcelId: p.parcelId, phoneHash: p.receiverPhoneHash!, stars: 4, tags: ['WELL_PACKED', 'NOT_A_TAG' as never] });
      expect(rating.tags).toEqual(['WELL_PACKED']);
    });

    it('has nothing to say about a peer send, which has no store', () => {
      const s = store('N/A Threads');
      const p = shipment(s, { handoverH: 4, deliver: true });
      p.vendorId = undefined;
      expect(() => merchants.rate({ parcelId: p.parcelId, phoneHash: p.receiverPhoneHash!, stars: 5 })).toThrow(/did not come from a store/);
    });

    it('keeps positives and complaints apart, because a scorecard of only complaints is a pillory', () => {
      const s = store('Mixed Threads');
      for (const tags of [['WELL_PACKED'], ['WELL_PACKED'], ['POOR_PACKAGING']] as const) {
        const p = shipment(s, { handoverH: 4, deliver: true });
        merchants.rate({ parcelId: p.parcelId, phoneHash: p.receiverPhoneHash!, stars: 4, tags: [...tags] as never });
      }
      const card = merchants.scorecard(s.vendor.vendorId);
      expect(card.tags[0]).toEqual({ tag: 'WELL_PACKED', count: 2, positive: true }); // most common first
      expect(card.tags.find((t) => t.tag === 'POOR_PACKAGING')?.positive).toBe(false);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('the honesty rules', () => {
    it('shows no headline average until there is enough to average', () => {
      // REP1, inherited unchanged. Telling a shopper a new business is "rated 3.0" on its third order is
      // this network damaging somebody who has done nothing wrong.
      const s = store('New Threads');
      const p = shipment(s, { handoverH: 4, deliver: true });
      merchants.rate({ parcelId: p.parcelId, phoneHash: p.receiverPhoneHash!, stars: 3 });
      const card = merchants.scorecard(s.vendor.vendorId);
      expect(card.rating.count).toBe(1);
      expect(card.rating.isNew).toBe(true);
      expect(MIN_PUBLIC_RATINGS).toBeGreaterThan(1);
    });

    it('stops being new once there is a real sample', () => {
      const s = store('Established Threads');
      for (let i = 0; i < MIN_PUBLIC_RATINGS; i += 1) {
        const p = shipment(s, { handoverH: 4, deliver: true });
        merchants.rate({ parcelId: p.parcelId, phoneHash: p.receiverPhoneHash!, stars: 4 });
      }
      const card = merchants.scorecard(s.vendor.vendorId);
      expect(card.rating.isNew).toBe(false);
      expect(card.rating.average).toBeCloseTo(4, 2);
    });

    it('carries no customer, no order and no parcel out to the public page', () => {
      // A scorecard about a BUSINESS. The profile is public by design, so anything personal on it would
      // be published to the whole internet by that same design.
      const s = store('Public Threads');
      const p = shipment(s, { handoverH: 4, deliver: true });
      merchants.rate({ parcelId: p.parcelId, phoneHash: p.receiverPhoneHash!, stars: 5, tags: ['WELL_PACKED'] });
      const json = JSON.stringify(merchants.scorecard(s.vendor.vendorId));
      expect(json).not.toContain(p.parcelId);
      expect(json).not.toContain(p.receiverPhoneHash!);
      expect(json).not.toContain('+2547');
    });

    it('gives every store the same shape, with nothing that could hide one', () => {
      // The rule the whole feature lives or dies by: publish only what we measured, identically, and no
      // merchant may switch it off. There is no parameter here that could tune one store's numbers —
      // this asserts the SHAPE is the same for a good store and a bad one.
      const good = store('Good Threads');
      shipment(good, { handoverH: 2 });
      const bad = store('Bad Threads');
      shipment(bad, { handoverH: 200 });
      const a = merchants.scorecard(good.vendor.vendorId);
      const b = merchants.scorecard(bad.vendor.vendorId);
      expect(Object.keys(a).sort()).toEqual(Object.keys(b).sort());
      expect(a.shipsNextDayRate).toBe(1);
      expect(b.shipsNextDayRate).toBe(0);
    });
  });
});
