import { Test } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { BagClosureService } from './bag-closure.service';
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
import { MAX_NUDGE_MIN_EARN } from './pudo.config';
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
import { IdentityVault } from '../../foundation/data-firewall/identity-vault.service';
import { OperationalStore } from '../../foundation/data-firewall/operational-store.service';
import { FieldEncryption } from '../../foundation/data-firewall/field-encryption.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';
import { evidencePhotos } from '../../../test/content-photo';

/**
 * ITEM 10 — the driver's own floor, on the one surface that speaks first.
 *
 * A minimum earning has existed for a while, but only as a box typed into a search and sent along as a
 * query parameter. `offerNear` is triggered by a GPS fix and has no request behind it, so it had nowhere to
 * read one from and applied none. A driver could set a minimum, watch the list obey it, and still be
 * interrupted at the wheel for a job beneath it — which is precisely the interruption that teaches somebody
 * to turn notifications off, after which they hear nothing at all.
 *
 * So the floor moved onto the DRIVER. Three surfaces, three relationships to the market, and only one of
 * them is an interruption: the standing floor silences the phone, the list keeps its own typed filter
 * because a driver reading a list is already looking, and the open board keeps no filter at all.
 *
 * These tests also pin a second defect found while reading, older than item 10 and never covered: this
 * function chose the NEAREST load and then returned null if that one failed a check — so a driver heard
 * silence while a load two streets further on was perfectly takeable.
 */
describe('the nudge floor', () => {
  let agents: AgentService;
  let corridors: CorridorService;
  let drivers: DriverService;
  let vehicles: VehicleService;
  let fleet: FleetService;
  let dispatch: DispatchService;
  let entities: EntityService;
  let totes: ToteService;
  let parcels: ParcelService;
  let mdps: MdpService;
  let gate: WalletGateService;

  /** Round 31 — an evidence photo we hold, uploaded by the party the act checks. */
  let photoBy: (ownerDid: string) => string;
  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService, BagClosureService,
        BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
        DriverService, FleetService, DispatchService, RouteConstraintService, MarketPulseStore, MarketPulseService, FleetManagerService,
        MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
        ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
        WalletService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus,
        EntityService, PresenceService, BooksService, FxService,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
        HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
      ],
    }).compile();
    photoBy = evidencePhotos(moduleRef);
    entities = moduleRef.get(EntityService);
    entities.seed();
    moduleRef.get(FxService).seed();
    moduleRef.get(BooksService).reset();
    agents = moduleRef.get(AgentService);
    corridors = moduleRef.get(CorridorService);
    drivers = moduleRef.get(DriverService);
    vehicles = moduleRef.get(VehicleService);
    fleet = moduleRef.get(FleetService);
    dispatch = moduleRef.get(DispatchService);
    totes = moduleRef.get(ToteService);
    parcels = moduleRef.get(ParcelService);
    mdps = moduleRef.get(MdpService);
    gate = moduleRef.get(WalletGateService);
  });

  let seq = 0;
  const HERE = { lat: -1.2, lng: 36.8 };
  /** A point roughly `km` east of HERE — near enough to stay inside the nudge radius. */
  const near = (km: number) => ({ lat: HERE.lat, lng: HERE.lng + km / 111 });

  /** A coupled bike rider, taking work, standing at HERE. */
  function rider() {
    seq += 1;
    const d = drivers.register({ displayName: `R${seq}`, fullName: `R ${seq}`, nationalId: `ID-N${seq}`, mobile: `+2547300${seq}`, licenceClasses: ['motorcycle'] });
    const bike = vehicles.register({ plate: `NF-${seq}`, vehicleClass: 'motorcycle', ownerName: 'R' });
    fleet.couple(d.did, bike.vehicleId);
    return d;
  }

  /** A PUDO shop at a point — where a bag stands, and where it is going. */
  function shop(shopName: string, location: { lat: number; lng: number }) {
    seq += 1;
    const a = agents.register({
      shopName: `${shopName} ${seq}`, zone: 'Nairobi', location, landmark: 'by the road',
      openingHours: { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null },
      shelf: { rows: 3, cols: 3 }, fullName: 'Shopkeeper', nationalId: `ID-S${seq}`, mobile: `+2547310${seq}`,
      deviceImei: `IMEI-N${seq}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
    });
    agents.submitKyc(a.did, { idCopyRef: 'id.jpg', tradingLicenceRef: 'tl.jpg', shopPhotoRefs: ['shop.jpg'] });
    agents.decideKyc(a.did, true);
    gate.topUp(a.did, 50); // an active shop — a counter take-in bills its float
    return agents.get(a.did);
  }

  /**
   * A freight load whose pickup is `km` away and whose haul is `tripKm` long.
   *
   * The pickup must stay inside NUDGE_RADIUS_KM (3) or the nudge never considers it at all — that radius is
   * about whether it is worth interrupting somebody, and it is not what these tests are about. The HAUL is
   * what makes one load pay more than another, which is what the floor is comparing.
   */
  function load(label: string, km: number, opts: { tripKm?: number; weightKg?: number; maxSpend?: number } = {}) {
    return dispatch.registerFreight({
      description: label, pickupLocation: near(km), pickupLabel: label, destLabel: `${label} drop`,
      destLocation: near(km + (opts.tripKm ?? 1)), weightKg: opts.weightKg ?? 5, packaging: 'piece', maxSpend: opts.maxSpend,
    });
  }

  const offerFor = (did: string) => dispatch.offerNear(did, HERE);
  /** What a load would actually pay this driver — read off the offer the network itself would make. */
  const earnOf = (did: string, ref: string) => dispatch.suggestNearby(did, HERE, 15).find((o) => o.ref === ref)?.earn;

  describe('what the floor does', () => {
    it('says nothing at all when the only work pays less than the driver asked for', () => {
      const d = rider();
      const only = load('Cheap', 1);
      const pay = earnOf(d.did, only.freightId)!;
      expect(pay).toBeGreaterThan(0); // the load is real and takeable…

      drivers.setNudgeMinEarn(d.did, pay + 1); // …and one shilling above what it pays
      expect(offerFor(d.did)).toBeNull();
    });

    it('still offers the work that DOES clear it', () => {
      const d = rider();
      // Both pickups sit well inside the nudge radius — which is ROAD distance, so a straight-line 2.5 km
      // is already 3.4 km of road and outside it. What separates these two is the haul, not the fetch.
      const cheap = load('Cheap', 0.5, { tripKm: 1 });
      const worthIt = load('Worth it', 1.5, { tripKm: 40 }); // not the nearest, and a real day's haul
      const cheapPay = earnOf(d.did, cheap.freightId)!;
      const goodPay = earnOf(d.did, worthIt.freightId)!;
      expect(goodPay).toBeGreaterThan(cheapPay);

      drivers.setNudgeMinEarn(d.did, cheapPay + 0.01);
      // THE FIX: the nearest load fails, and the search steps past it instead of ending. Before this, the
      // driver heard silence while a load a few streets on was exactly what they had asked to hear about.
      expect(offerFor(d.did)?.ref).toBe(worthIt.freightId);
    });

    it('leaves a driver who has set no floor exactly as they were', () => {
      // The regression guard. Nothing about the nudge changes for the drivers who never touch this.
      const d = rider();
      const only = load('Anything', 1);
      expect(offerFor(d.did)?.ref).toBe(only.freightId);
    });

    it('treats zero as NO floor rather than a floor of nothing', () => {
      // Two ways of saying the same thing is how a setting screen ends up with a state nobody can leave.
      const d = rider();
      const only = load('Anything', 1);
      drivers.setNudgeMinEarn(d.did, 500);
      expect(offerFor(d.did)).toBeNull();
      drivers.setNudgeMinEarn(d.did, 0);
      expect(drivers.get(d.did).nudgeMinEarn).toBeUndefined();
      expect(offerFor(d.did)?.ref).toBe(only.freightId);
      drivers.setNudgeMinEarn(d.did, 500);
      drivers.setNudgeMinEarn(d.did, undefined); // …and omitting it clears it the same way
      expect(offerFor(d.did)?.ref).toBe(only.freightId);
    });

    it('refuses a floor that would silence the phone for good', () => {
      const d = rider();
      expect(() => drivers.setNudgeMinEarn(d.did, -1)).toThrow(/between 0 and/);
      expect(() => drivers.setNudgeMinEarn(d.did, MAX_NUDGE_MIN_EARN + 1)).toThrow(/between 0 and/);
      expect(() => drivers.setNudgeMinEarn(d.did, Number.NaN)).toThrow(/between 0 and/);
    });
  });

  describe('the older defect underneath it', () => {
    it('steps past a load the shipper cannot afford instead of going quiet', () => {
      // This never needed a floor to bite. offerNear took the closest load and then returned null when it
      // failed the shipper's budget — one rejection ending the whole search. The budget check is unchanged;
      // what changed is that failing it costs the load its turn rather than costing the driver the nudge.
      const d = rider();
      const overBudget = load('Skinflint', 1, { maxSpend: 0.01 });
      const fine = load('Fine', 2);
      expect(offerFor(d.did)?.ref).toBe(fine.freightId);
      expect(offerFor(d.did)?.ref).not.toBe(overBudget.freightId);
    });
  });

  describe('the half the old filter never covered', () => {
    it('applies the floor to a BAG as well as to freight', () => {
      // The list-view filter only ever compared a freight price, so every bag went through whatever a
      // driver had asked for. That was defensible while a bag paid a flat handling fee and nothing else;
      // since a bag started earning for the road too it has had a real all-in number, and a driver who
      // said "not below this" meant it about bags as well.
      const d = rider();
      const from = shop('Nudge Origin', near(1));
      const to = shop('Nudge Drop', near(4));
      corridors.addCorridor({ name: 'Nudge corridor', originZone: 'Nairobi', destZone: 'Nairobi' });

      const bag = bagAt(from.did, to.did);
      const pay = earnOf(d.did, bag)!;
      expect(pay).toBeGreaterThan(0);

      drivers.setNudgeMinEarn(d.did, pay + 1);
      const offered = offerFor(d.did);
      expect(offered?.ref).not.toBe(bag); // …and before this, it was offered
    });

    /** A published bag standing at a shop with a real parcel in it, ready to be collected. */
    function bagAt(locationId: string, destId: string): string {
      seq += 1;
      const bag = totes.register(locationId);
      totes.assign(bag.code, destId, 'Somewhere');
      const pid = `NUDGE-${seq}`;
      parcels.accept({ agentDid: locationId, parcelId: pid, size: 'M', destZone: 'Nairobi', senderMobile: '+254700001', receiverMobile: '+254700002', dropoffPhotoRef: photoBy(locationId) } as never);
      mdps.fillTote(bag.code, pid);
      dispatch.release(bag.code);
      return bag.code;
    }
  });

  describe('why it was quiet, split by cause', () => {
    // Silence has three explanations needing three different answers: there was no work, your own floor
    // stopped it, or shippers would not pay what you charge. Two of those the network knew all along and
    // never said, and a driver who cannot tell them apart reaches for the wrong lever or for none.

    it('counts what the driver\'s OWN FLOOR kept quiet', () => {
      // The price of putting the floor on the driver rather than on the shift is that it can starve
      // somebody without saying so — the exact failure the snooze was written to avoid. This is what pays
      // for it: the setting and its effect travel together, so a driver can see it working and undo it.
      const d = rider();
      load('Cheap A', 0.5);
      load('Cheap B', 1);
      expect(dispatch.quietReport(d.did)).toMatchObject({ floor: undefined, belowFloor: 0, overBudget: 0 });

      drivers.setNudgeMinEarn(d.did, 10_000);
      expect(offerFor(d.did)).toBeNull();
      expect(dispatch.quietReport(d.did)).toMatchObject({ floor: 10_000, belowFloor: 2, overBudget: 0 });
    });

    it('counts what the driver\'s OWN RATE kept quiet, separately', () => {
      // The other silence, and the one nobody was ever told about: priced above what shippers will pay.
      // It is a different lever with a different fix, so it is a different number — one warning blending
      // them would hide the only thing the driver needs in order to act.
      const d = rider();
      load('Skinflint A', 0.3, { maxSpend: 0.01 });
      load('Skinflint B', 0.5, { maxSpend: 0.01 });
      load('Skinflint C', 0.7, { maxSpend: 0.01 });
      const takeable = load('Fine', 1.5);

      expect(offerFor(d.did)?.ref).toBe(takeable.freightId); // still offered the one that works…
      const report = dispatch.quietReport(d.did);
      expect(report).toMatchObject({ belowFloor: 0, overBudget: 3 }); // …and told why the others were not
      expect(report.rateIsYours).toBe(true);
      expect(report.ratePerKm).toBeGreaterThan(0);
      expect(report.rateLooksHigh).toBe(true);
    });

    it('will not call a rate high on the strength of one refusal', () => {
      // A cell with two loads says nothing — the same discipline the market pulse already applies before
      // it will call anywhere busy or quiet. A warning built on one load is noise, and noise is what
      // teaches somebody to ignore the warning that matters.
      const d = rider();
      load('Skinflint', 0.5, { maxSpend: 0.01 });
      load('Fine', 1.5);
      expect(offerFor(d.did)).not.toBeNull();
      const report = dispatch.quietReport(d.did);
      expect(report.overBudget).toBe(1); // counted, honestly…
      expect(report.rateLooksHigh).toBe(false); // …and not yet worth telling anybody
    });

    it('reports ABSOLUTE counts, never a fraction of the loads about', () => {
      // The search stops at the first load worth offering, so everything behind it was never classified.
      // "6 of 14" would be a denominator nobody counted, and a made-up denominator in a number a driver
      // uses to set their price is worse than no number at all.
      const d = rider();
      load('Skinflint', 0.3, { maxSpend: 0.01 });
      load('Fine', 0.5);
      load('Never reached A', 1.2, { maxSpend: 0.01 });
      load('Never reached B', 1.5, { maxSpend: 0.01 });
      expect(offerFor(d.did)).not.toBeNull();
      // Only the one it actually stepped over is counted — the two behind the offer are not guessed at.
      expect(dispatch.quietReport(d.did).overBudget).toBe(1);
    });

    it('does not tell a FLEET driver about a lever the manager holds', () => {
      // pricePerKm lives on the vehicle, and a fleet-attached driver's vehicle is the manager's. Telling
      // them their price is costing them work would be telling somebody about a control they cannot reach.
      const d = rider();
      // Attached AFTER registration rather than through it: registering under a manager means onboarding a
      // whole fleet company, and none of that is what this asserts. The read under test is one field.
      const employed = rider();
      drivers.get(employed.did).managerDid = 'did:glos:some-fleet';
      expect(dispatch.quietReport(d.did).rateIsYours).toBe(true); // an independent owns their rate…
      expect(dispatch.quietReport(employed.did).rateIsYours).toBe(false); // …a fleet driver does not
    });
  });

  describe('what the floor deliberately does NOT touch', () => {
    it('leaves the LIST alone — a driver reading one is already looking', () => {
      // Three surfaces, three relationships to the market. The standing floor answers "is this worth
      // interrupting you for"; the list answers "what is out there", and a driver who set a floor this
      // morning must still be able to look below it when they are the one asking.
      const d = rider();
      const cheap = load('Cheap', 1);
      drivers.setNudgeMinEarn(d.did, 10_000);
      expect(offerFor(d.did)).toBeNull();
      expect(dispatch.suggestNearby(d.did, HERE, 15).map((o) => o.ref)).toContain(cheap.freightId);
    });

    it('never speaks over a snooze, whatever the floor says', () => {
      const d = rider();
      load('Anything', 1);
      fleet.snooze(d.did, 30);
      expect(offerFor(d.did)).toBeNull();
      drivers.setNudgeMinEarn(d.did, 0); // clearing the floor must not wake a snoozed phone
      expect(offerFor(d.did)).toBeNull();
    });
  });
});
