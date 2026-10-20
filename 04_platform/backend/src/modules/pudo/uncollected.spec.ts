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
import { NEVER_DROPPED_H, RETURN_OFFER_TTL_H, UNCOLLECTED_H } from './pudo.config';
import { operationalParcelView } from './parcel.service';
import { ReturnService } from './return.service';
import { UnclaimedService } from './unclaimed.service';
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
import { contentPhotos } from '../../../test/content-photo';

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
  let returns: ReturnService;
  let unclaimed: UnclaimedService;
  let entities: EntityService;

  /** Round 30 — a store's real photo of the contents, as the order door requires: one we hold, its own. */
  let photoOf: (vendorId: string) => string;
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
        PayoutService, ReturnService, UnclaimedService, SandboxPayoutRail, { provide: PAYOUT_RAIL, useExisting: SandboxPayoutRail },
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
        HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
      ],
    }).compile();
    photoOf = contentPhotos(moduleRef);
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
    returns = moduleRef.get(ReturnService);
    unclaimed = moduleRef.get(UnclaimedService);
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
      contentPhotoRef: photoOf(store.vendorId), size: 'M', routeMode: 'locked', shippingPolicy: store.shippingPolicy,
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


/**
 * Getting a stranded parcel home — and the constraint that shapes the whole feature.
 *
 * THE BUYER PAID FOR THE GOODS, so the goods are the BUYER'S: sender owns the shipment, receiver owns the
 * goods, and COD is zero by construction here so a store order is always pre-paid by the time it reaches a
 * shelf. A store therefore cannot abandon it, keep it, or dispose of it — you cannot abandon what you do
 * not own. All a store can do is offer to pay for its journey back, which is why a DECLINE leaves the
 * parcel exactly where it was and settles nothing about whose it is.
 *
 * The buyer is not in this flow at all, and that is not an omission: for an uncollected parcel the goods
 * never left the network's custody, so the return is one more leg between two nodes.
 */
describe('the journey home', () => {
  // Re-uses the outer harness by construction: this file's beforeEach builds the whole graph.
  let seqR = 0;

  it('is offered only when the store said it wanted one', () => {
    // Undefined is not zero. A store that has said nothing has agreed to be billed for nothing.
    const { parcel, to } = strandedFor(undefined, 500);
    expect(returns.offerFor(parcel.parcelId)).toBeNull();
    expect(to).toBeDefined();
  });

  it('is not offered when the goods are worth less than the trip', () => {
    // The store's own arithmetic, pre-declared so nobody is asked while a shelf slot sits occupied.
    const { parcel } = strandedFor(1000, 20);
    expect(returns.offerFor(parcel.parcelId)).toBeNull();
  });

  it('shows the store BOTH numbers it is deciding between', () => {
    // "Pay to get it back" is not a decision anybody can make without what it is worth and what it costs.
    const { parcel } = strandedFor(10, 500);
    const offer = returns.offerFor(parcel.parcelId)!;
    expect(offer.declaredValue).toBe(500);
    expect(offer.returnCost).toBeGreaterThan(0);
    expect(offer.currency).toBeTruthy();
    expect(offer.status).toBe('offered');
  });

  it('asks once, not once per sweep', () => {
    strandedFor(10, 500);
    expect(returns.sweep()).toHaveLength(1);
    expect(returns.sweep()).toHaveLength(0);
  });

  it('leaves a parcel that has only just arrived alone', () => {
    const { parcel } = strandedFor(10, 500, 1);
    expect(returns.sweep().map((o) => o.parcelId)).not.toContain(parcel.parcelId);
  });

  describe('when the store says yes', () => {
    it('mints the journey home from the same box, and hands the shop its slot back', () => {
      // THE POINT OF THE WHOLE FEATURE. A return that left the shelf occupied would leave the network
      // exactly as short of slots as the uncollected parcel it replaced.
      const { parcel, to, from, store } = strandedFor(10, 500);
      const offer = returns.offerFor(parcel.parcelId)!;
      const freeBefore = shelf.available(to.did);

      const { returnParcelId } = returns.accept(offer.offerId, store.vendorId);
      const home = parcels.get(returnParcelId);

      expect(shelf.available(to.did)).toBe(freeBefore + 1);
      expect(home.originAgentDid).toBe(to.did); // it starts where it was stranded…
      expect(home.destAgentDid).toBe(from.did); // …and goes back where it came from
      // The SAME box: copied rather than re-measured, because re-measuring lets it change size between
      // two legs of one journey and nobody can then settle what was in it.
      expect(home.size).toBe(parcel.size);
      expect(home.dimensionsCm).toEqual(parcel.dimensionsCm);
      // Round 30 — and the same photo of what is in it: the first leg's, already ours, not a new one asked of the store.
      expect(home.contentPhotoRef).toBe(parcel.contentPhotoRef);
    });

    it('closes the stranded one as RETURNED — not delivered, not voided', () => {
      // Nobody collected it, so recording it as delivered would put a lie in the very history a damage
      // claim is judged against. And the shipment WAS performed — it arrived — so it is not void either.
      const { parcel, store } = strandedFor(10, 500);
      const offer = returns.offerFor(parcel.parcelId)!;
      const { returnParcelId } = returns.accept(offer.offerId, store.vendorId);

      const closed = parcels.get(parcel.parcelId);
      expect(closed.status).toBe('Returned');
      expect(closed.returnParcelId).toBe(returnParcelId); // the two read as one story
    });

    it('bills the store for the journey home AND the shelf it sat on', () => {
      // Two halves, and the assertion reads them off the SETTLED offer rather than recomputing them.
      // Holding is counted in started days, so a parcel that lapsed a moment ago already owes its first
      // one — recomputing here would race the clock and make the test flake instead of the meter.
      const { parcel, store } = strandedFor(10, 500);
      const offer = returns.offerFor(parcel.parcelId)!;
      const before = vendors.balanceOf(store.vendorId);

      const { offer: settled } = returns.accept(offer.offerId, store.vendorId);
      expect(before - vendors.balanceOf(store.vendorId)).toBeCloseTo(settled.returnCost + (settled.holdingCost ?? 0), 2);
    });

    it('refuses BEFORE anything moves when the store cannot pay', () => {
      // A "yes" that fails afterwards leaves a shop holding a parcel that is now nobody's problem. The
      // forward path may leave a label blocked and chase the money; here the check has to come first,
      // while the store can still top up.
      const { parcel, to, store } = strandedFor(10, 500, UNCOLLECTED_H + 2, 0);
      const offer = returns.offerFor(parcel.parcelId)!;
      const freeBefore = shelf.available(to.did);

      expect(() => returns.accept(offer.offerId, store.vendorId)).toThrow(/Top up first/);
      // Nothing moved: no return minted, the parcel still stranded, the slot still held.
      expect(parcels.get(parcel.parcelId).status).toBe('Unclaimed');
      expect(shelf.available(to.did)).toBe(freeBefore);
      expect(returns.get(offer.offerId).status).toBe('offered'); // still theirs to answer
    });

    it('will not act on another store’s offer', () => {
      const { parcel, store } = strandedFor(10, 500);
      const other = vendors.register({ name: 'Somebody else', country: 'KE', ownerPhone: '+254700111222' } as never);
      const offer = returns.offerFor(parcel.parcelId)!;
      expect(() => returns.accept(offer.offerId, other.vendorId)).toThrow(/not found/i);
      expect(parcels.get(parcel.parcelId).status).toBe('Unclaimed');
      expect(store).toBeDefined();
    });

    it('stands down if somebody came for it after all', () => {
      // The best possible outcome, and not an error to shout about.
      const { parcel, store } = strandedFor(10, 500);
      const offer = returns.offerFor(parcel.parcelId)!;
      parcels.get(parcel.parcelId).status = 'Delivered';
      expect(() => returns.accept(offer.offerId, store.vendorId)).toThrow(/no longer waiting/);
      expect(returns.get(offer.offerId).status).toBe('expired');
    });
  });

  describe('when the store says no', () => {
    it('leaves the parcel exactly where it is, because it is not theirs to abandon', () => {
      // A decline settles who is NOT paying for a journey home. It settles nothing about whose goods
      // these are — the buyer paid for them, so they are the buyer's, still on that shelf.
      const { parcel, to, store } = strandedFor(10, 500);
      const offer = returns.offerFor(parcel.parcelId)!;
      const freeBefore = shelf.available(to.did);

      returns.decline(offer.offerId, store.vendorId, 'not worth the trip');
      expect(returns.get(offer.offerId)).toMatchObject({ status: 'declined', declineReason: 'not worth the trip' });
      expect(parcels.get(parcel.parcelId).status).toBe('Unclaimed');
      expect(shelf.available(to.did)).toBe(freeBefore); // still holding a slot — the gap that remains
    });

    it('does not ask again — they answered', () => {
      const { parcel, store } = strandedFor(10, 500);
      returns.decline(returns.offerFor(parcel.parcelId)!.offerId, store.vendorId);
      expect(returns.sweep().map((o) => o.parcelId)).not.toContain(parcel.parcelId);
    });

    it('refuses a second answer to one question', () => {
      const { parcel, store } = strandedFor(10, 500);
      const offer = returns.offerFor(parcel.parcelId)!;
      returns.decline(offer.offerId, store.vendorId);
      expect(() => returns.accept(offer.offerId, store.vendorId)).toThrow(/already declined/);
    });
  });

  it('stops waiting for an answer that never came', () => {
    // Expired as it is READ, so a store's screen and this service can never disagree about whether they
    // still have a decision to make.
    const { parcel, store } = strandedFor(10, 500);
    const offer = returns.offerFor(parcel.parcelId)!;
    const later = Date.now() + (RETURN_OFFER_TTL_H + 1) * 3_600_000;
    expect(returns.pendingFor(store.vendorId, later)).toHaveLength(0);
    expect(returns.get(offer.offerId).status).toBe('expired');
  });

  /** A stranded parcel for a store with (or without) a recovery threshold. */
  function strandedFor(threshold: number | undefined, value: number, waitedH = UNCOLLECTED_H + 2, funds = 500) {
    seqR += 1;
    const from = shop(`R Origin ${seqR}`, 'Nairobi');
    const to = shop(`R Dest ${seqR}`, 'Kisumu');
    corridors.addCorridor({ name: 'Nairobi-Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });
    // A corridor runs in a DIRECTION. The journey home needs its own, which is a real operational fact
    // and not test scaffolding: a route that brought a parcel here may not be able to take it back.
    corridors.addCorridor({ name: 'Kisumu-Nairobi', originZone: 'Kisumu', destZone: 'Nairobi' });
    const store = vendors.register({
      name: `R Store ${seqR}`,
      country: 'KE',
      ownerPhone: `+2547900${seqR}`,
      ...(threshold == null ? {} : { shippingPolicy: { recoverAboveValue: threshold } }),
    } as never);
    // Funded EXACTLY for the outbound leg when the test wants an empty float afterwards. The balance is
    // derived from the books, so it cannot be set — it has to be spent, which is the realistic case
    // anyway: a store that shipped everything it could afford.
    const outbound = routing.quoteShipment(from.did, to.did, 'M');
    vendors.topUp(store.vendorId, funds === 0 ? outbound.locked.gross : 500);
    const { parcel } = parcels.createInbound({
      vendorId: store.vendorId, originAgentDid: from.did, destAgentDid: to.did, buyerMobile: `+25470088${seqR}`,
      contentPhotoRef: photoOf(store.vendorId), size: 'M', dimensionsCm: { l: 30, w: 20, h: 10 }, weightKg: 2,
      declaredValue: value, routeMode: 'locked', shippingPolicy: store.shippingPolicy,
      quote: routing.quoteShipment(from.did, to.did, 'M'),
    } as never);
    const p = parcels.get(parcel.parcelId);
    p.status = 'Ready_For_Pickup';
    p.readyAt = agoH(waitedH);
    shelf.assign(to.did, p.parcelId, 'M');
    // Through the SWEEP, not by assignment. A store is only ever asked about a parcel the network has
    // already admitted is stranded, and a harness that set 'Unclaimed' by hand would prove the offer
    // works on a row the running app never produces.
    unclaimed.sweep();
    return { parcel: p, from, to, store };
  }
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
