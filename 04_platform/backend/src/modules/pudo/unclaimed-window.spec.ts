import { Test } from '@nestjs/testing';
import { AgentService } from './agent.service';
import { MdpService } from './mdp.service';
import { BagClosureService } from './bag-closure.service';
import { RoutingService } from './routing.service';
import { CorridorService } from './corridor.service';
import { ShelfService } from './shelf.service';
import { VendorService } from './vendor.service';
import { ParcelService, operationalParcelView } from './parcel.service';
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
import { ReturnService } from './return.service';
import { UnclaimedService } from './unclaimed.service';
import {
  FREE_EXTENSIONS,
  HOLDING_FEE_MAX_DAYS,
  HOLDING_FEE_PER_DAY,
  PICKUP_FEE,
  RELEASE_FEE,
  SHELVING_FEE,
  UNCOLLECTED_H,
  holdingFeeFor,
} from './pudo.config';
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
 * When nobody comes: the terms change, and the parcel does not move.
 *
 * The gap this closes had three halves, one per party. The STORE could not tell an order that had gone
 * quiet from one still in transit. The RECEIVER was told once, at arrival, and then nothing ever again
 * said their window had run out or that it now cost something. And the SHOP — which had received,
 * scanned and given up one of its six or nine shelf slots — earned nothing at all for any of that unless
 * a stranger eventually turned up, because every unit of its pay sat behind somebody else's decision.
 *
 * THE CONSTRAINT THAT SHAPES EVERY TEST BELOW: 'Unclaimed' marks a change in TERMS, never in
 * availability. The box is still on the shelf and the code still opens it. A status that locked the door
 * would build a system that punishes the one person who eventually did the right thing.
 */
describe('the collection window closing', () => {
  let agents: AgentService;
  let corridors: CorridorService;
  let parcels: ParcelService;
  let vendors: VendorService;
  let shelf: ShelfService;
  let routing: RoutingService;
  let returns: ReturnService;
  let unclaimed: UnclaimedService;
  let gate: WalletGateService;
  let entities: EntityService;
  let fx: FxService;

  /** Round 30 — a store's real photo of the contents, as the order door requires: one we hold, its own. */
  let photoOf: (vendorId: string) => string;
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
        PayoutService, ReturnService, UnclaimedService, SandboxPayoutRail, { provide: PAYOUT_RAIL, useExisting: SandboxPayoutRail },
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
        GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
        HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
      ],
    }).compile();
    photoOf = contentPhotos(moduleRef);
    entities = moduleRef.get(EntityService);
    entities.seed();
    fx = moduleRef.get(FxService);
    fx.seed();
    moduleRef.get(BooksService).reset();
    agents = moduleRef.get(AgentService);
    corridors = moduleRef.get(CorridorService);
    parcels = moduleRef.get(ParcelService);
    vendors = moduleRef.get(VendorService);
    shelf = moduleRef.get(ShelfService);
    routing = moduleRef.get(RoutingService);
    returns = moduleRef.get(ReturnService);
    unclaimed = moduleRef.get(UnclaimedService);
    gate = moduleRef.get(WalletGateService);
  });

  const DAY = 86_400_000;
  // Deliberately NOT a whole number of days. Holding is counted in STARTED days, so a stamp sitting
  // exactly on a day boundary rounds up or down depending on which millisecond the assertion runs in —
  // a flake in the test, not in the meter, and one worth designing out rather than re-running past.
  const daysAgo = (d: number) => new Date(Date.now() - (d * DAY + 3_600_000)).toISOString();
  let seq = 0;
  const hours = { mon: { open: '08:00', close: '18:00' }, tue: { open: '08:00', close: '18:00' }, wed: { open: '08:00', close: '18:00' }, thu: { open: '08:00', close: '18:00' }, fri: { open: '08:00', close: '18:00' }, sat: { open: '08:00', close: '18:00' }, sun: null };

  function shop(shopName: string, zone: string) {
    seq += 1;
    const a = agents.register({
      shopName, zone, location: { lat: -1.2 + seq / 100, lng: 36.8 }, landmark: 'by the road', openingHours: hours,
      shelf: { rows: 3, cols: 3 }, fullName: `${shopName} owner`, nationalId: `ID-W${seq}`, mobile: `+2547810${seq}`,
      deviceImei: `IMEI-W${seq}`, requirements: { androidVersion: 13, reliablePower: true, tradingLicence: 'TL-1', criminalRecordClear: true },
    });
    agents.submitKyc(a.did, { idCopyRef: 'id.jpg', tradingLicenceRef: 'tl.jpg', shopPhotoRefs: ['shop.jpg'] });
    agents.decideKyc(a.did, true, undefined, undefined, '2099-12-31');
    return agents.get(a.did);
  }

  /**
   * A parcel sitting on a destination shelf, having waited `waitedH` hours.
   *
   * It reaches the shelf through arrive(), not by assignment — that is the difference between proving the
   * shelving fee is paid and proving a function would pay it if anybody called it.
   */
  function onShelf(opts: { waitedH?: number; value?: number; threshold?: number; funds?: number } = {}) {
    seq += 1;
    const from = shop(`W Origin ${seq}`, 'Nairobi');
    const to = shop(`W Dest ${seq}`, 'Kisumu');
    corridors.addCorridor({ name: 'Nairobi-Kisumu', originZone: 'Nairobi', destZone: 'Kisumu' });
    corridors.addCorridor({ name: 'Kisumu-Nairobi', originZone: 'Kisumu', destZone: 'Nairobi' });
    const store = vendors.register({
      name: `W Store ${seq}`, country: 'KE', ownerPhone: `+2547910${seq}`,
      ...(opts.threshold == null ? {} : { shippingPolicy: { recoverAboveValue: opts.threshold } }),
    } as never);
    vendors.topUp(store.vendorId, opts.funds ?? 500);
    const { parcel } = parcels.createInbound({
      vendorId: store.vendorId, originAgentDid: from.did, destAgentDid: to.did, buyerMobile: `+25470077${seq}`,
      contentPhotoRef: photoOf(store.vendorId), size: 'M', dimensionsCm: { l: 30, w: 20, h: 10 }, weightKg: 2,
      declaredValue: opts.value ?? 500, routeMode: 'locked', shippingPolicy: store.shippingPolicy,
      quote: routing.quoteShipment(from.did, to.did, 'M'),
    } as never);
    const p = parcels.get(parcel.parcelId);
    p.status = 'On_Bus';
    parcels.arrive(p.parcelId, to.did); // the real path onto the shelf — and the real shelving payment
    if (opts.waitedH != null) p.readyAt = new Date(Date.now() - opts.waitedH * 3_600_000).toISOString();
    return { parcel: p, from, to, store };
  }

  /** Past its window and swept, which is how every parcel actually gets there. */
  function stranded(opts: Parameters<typeof onShelf>[0] = {}) {
    const made = onShelf({ waitedH: UNCOLLECTED_H + 2, ...opts });
    unclaimed.sweep();
    return made;
  }

  // ---------------------------------------------------------------------------------------------
  describe('the status', () => {
    it('closes the window on a parcel nobody came for', () => {
      const { parcel } = onShelf({ waitedH: UNCOLLECTED_H + 2 });
      expect(unclaimed.sweep().map((p) => p.parcelId)).toContain(parcel.parcelId);
      expect(parcels.get(parcel.parcelId).status).toBe('Unclaimed');
      expect(parcels.get(parcel.parcelId).unclaimedAt).toBeTruthy();
    });

    it('leaves one that is still inside its window alone', () => {
      const { parcel } = onShelf({ waitedH: UNCOLLECTED_H - 1 });
      expect(unclaimed.sweep().map((p) => p.parcelId)).not.toContain(parcel.parcelId);
      expect(parcels.get(parcel.parcelId).status).toBe('Ready_For_Pickup');
    });

    it('closes it once, not once per sweep', () => {
      stranded();
      expect(unclaimed.sweep()).toHaveLength(0);
    });

    it('STILL RELEASES to the person holding the code', () => {
      // The single most important assertion in this file. If this ever goes red the feature has become a
      // way of confiscating parcels from people who were late, which is the opposite of the intent.
      const { parcel, to } = stranded();
      const released = parcels.collectConfirm(parcel.parcelId, to.did, parcel.collectionCode!);
      expect(released.status).toBe('Delivered');
    });

    it('is still findable at the counter by its code', () => {
      // The lookup and the release are separate calls, and a lookup that stopped finding unclaimed
      // parcels would fail the customer one screen earlier with a more confusing message.
      const { parcel, to } = stranded();
      expect(parcels.collect(parcel.collectionCode!, to.did).parcel.parcelId).toBe(parcel.parcelId);
    });

    it('still shows the receiver their own collection code', () => {
      // Telling somebody to come and collect while hiding what opens the door is not a notice, it is a taunt.
      const { parcel } = stranded();
      const view = parcels.consumerParcel(parcel.parcelId, parcel.receiverPhoneHash!);
      expect(view.collectToken?.code).toBe(parcel.collectionCode);
    });

    it('reports overdue and what is owed on the operational view', () => {
      const { parcel } = stranded();
      const view = operationalParcelView(parcels.get(parcel.parcelId));
      expect(view.overdue).toBe(true);
      expect(view.unclaimedAt).toBeTruthy();
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('what the shop earns', () => {
    it('pays the shelving half when the parcel lands, before anybody has collected anything', () => {
      // THE REGRESSION THIS FIXES. Before the split, a destination shop that received, scanned and
      // shelved a parcel earned nothing for any of it until a stranger turned up — and nothing at all if
      // one never did.
      const { to } = onShelf();
      expect(agents.balance(to.did)).toBeCloseTo(SHELVING_FEE, 2);
    });

    it('pays the release half on handover, and the two together are what the single fee was', () => {
      // No new money enters the system. The sender already paid for a whole journey, last leg included;
      // what changed is only WHEN the shop sees its share, and that half of it is no longer contingent.
      const { parcel, to } = onShelf();
      parcels.collectConfirm(parcel.parcelId, to.did, parcel.collectionCode!);
      expect(agents.balance(to.did)).toBeCloseTo(PICKUP_FEE, 2);
      expect(SHELVING_FEE + RELEASE_FEE).toBeCloseTo(PICKUP_FEE, 2);
    });

    it('leaves the shop paid for a parcel that is never collected at all', () => {
      const { to } = stranded();
      expect(agents.balance(to.did)).toBeGreaterThan(0);
    });

    it('accrues holding per started day once the window has closed', () => {
      const { parcel } = stranded();
      const at = new Date(parcels.get(parcel.parcelId).unclaimedAt!).getTime();
      expect(unclaimed.owed(parcel.parcelId, at + 1)).toBeCloseTo(HOLDING_FEE_PER_DAY, 2); // a started day
      expect(unclaimed.owed(parcel.parcelId, at + 2 * DAY)).toBeCloseTo(2 * HOLDING_FEE_PER_DAY, 2);
    });

    it('owes nothing while the window is still open', () => {
      const { parcel } = onShelf({ waitedH: 1 });
      expect(unclaimed.owed(parcel.parcelId)).toBe(0);
    });

    it('stops at the ceiling rather than out-growing the goods', () => {
      // An uncapped meter turns a forgotten small parcel into a bill larger than what is inside it, and
      // asking somebody for more than a thing is worth is how you manufacture the abandonment you were
      // trying to prevent.
      const { parcel } = stranded();
      const at = new Date(parcels.get(parcel.parcelId).unclaimedAt!).getTime();
      const forever = unclaimed.owed(parcel.parcelId, at + 400 * DAY);
      expect(forever).toBeLessThanOrEqual(HOLDING_FEE_MAX_DAYS * HOLDING_FEE_PER_DAY + 0.001);
      expect(forever).toBeLessThanOrEqual(parcels.get(parcel.parcelId).shipmentCost ?? Infinity);
    });

    it('never bills for a slot twice', () => {
      // Whatever has already been settled comes off, wherever it was settled from. Two recovery paths
      // both crediting the same shop is the failure this guards.
      const p = parcels.get(stranded().parcel.parcelId);
      const at = new Date(p.unclaimedAt!).getTime();
      const first = holdingFeeFor({ unclaimedAt: p.unclaimedAt, now: at + DAY, shipmentCost: p.shipmentCost });
      expect(holdingFeeFor({ unclaimedAt: p.unclaimedAt, now: at + DAY, shipmentCost: p.shipmentCost, settled: first })).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('when the receiver answers', () => {
    it('"I am coming" buys more time, free the first time', () => {
      // Charging somebody for telling us the truth teaches them that silence is cheaper — and silence is
      // what costs this network a shelf slot and a store a return nobody wanted.
      const { parcel } = stranded();
      const { outcome } = unclaimed.respond(parcel.parcelId, 'coming', 'I am ill this week');
      const after = parcels.get(parcel.parcelId);
      expect(outcome).toBe('extended');
      expect(after.status).toBe('Ready_For_Pickup'); // a fresh window, not a discount on the old one
      expect(after.unclaimedAt).toBeUndefined(); // …so nothing is accruing
      expect(unclaimed.owed(parcel.parcelId)).toBe(0);
      expect(after.receiverResponse).toMatchObject({ choice: 'coming', note: 'I am ill this week' });
    });

    it('restarts every watcher that had gone quiet', () => {
      // readyAt + status is the pair the monitor flag, the reminder and the return sweep all key off.
      // An extension that reset one and not the others would leave a parcel nobody was watching again.
      const { parcel } = stranded();
      unclaimed.respond(parcel.parcelId, 'coming');
      const after = parcels.get(parcel.parcelId);
      expect(Date.now() - new Date(after.readyAt!).getTime()).toBeLessThan(5_000);
      expect(after.uncollectedRemindedAt).toBeUndefined();
      expect(returns.sweep()).toHaveLength(0); // no longer stranded, so no store is asked
    });

    it('prices the second extension, having given the first away', () => {
      const { parcel } = stranded();
      for (let i = 0; i <= FREE_EXTENSIONS; i += 1) {
        unclaimed.extend(parcel.parcelId);
        parcels.get(parcel.parcelId).status = 'Unclaimed'; // it lapses again between asks
      }
      expect(parcels.get(parcel.parcelId).unclaimedAt).toBeTruthy(); // the meter is running now
      expect(parcels.get(parcel.parcelId).extensionsUsed).toBe(FREE_EXTENSIONS + 1);
    });

    it('lets a named neighbour collect it — and lets the receiver still collect it themselves', () => {
      // The workaround this replaces is reading your own code down the phone, which we cannot see and
      // cannot afterwards tell apart from a stranger who guessed.
      const { parcel, to } = stranded();
      unclaimed.respond(parcel.parcelId, 'proxy');
      const { code } = unclaimed.nominate(parcel.parcelId, 'Mama Njeri');
      expect(code).not.toBe(parcel.collectionCode);
      expect(parcels.collect(parcel.collectionCode!, to.did).parcel.parcelId).toBe(parcel.parcelId); // still theirs
      const released = parcels.collectConfirm(parcel.parcelId, to.did, code);
      expect(released.status).toBe('Delivered');
    });

    it('records WHO took it, which a shared code never could', () => {
      const { parcel, to } = stranded();
      const { code } = unclaimed.nominate(parcel.parcelId, 'Mama Njeri');
      parcels.collectConfirm(parcel.parcelId, to.did, code);
      const trail = parcels.get(parcel.parcelId).scans.map((s) => s.note).join(' | ');
      expect(trail).toContain('proxy');
      expect(trail).toContain('Mama Njeri');
    });

    it('keeps the proxy code out of the trail the shop can read', () => {
      // The standing invariant: the shop that releases a parcel never learns what opens it.
      const { parcel } = stranded();
      const { code } = unclaimed.nominate(parcel.parcelId, 'Mama Njeri');
      expect(parcels.get(parcel.parcelId).scans.map((s) => s.note).join(' | ')).not.toContain(code);
    });

    it('counts as an ANSWER, and buys the same time any other answer buys', () => {
      // Found in the friction pass, by reading the screen rather than by a failing test. Naming a
      // neighbour used to mint a code and nothing else: the receiver had told us somebody was coming,
      // and the network went on treating the parcel as one nobody had spoken for — still lapsing, still
      // being offered back to the store while that neighbour was travelling to the shop.
      const { parcel } = stranded();
      unclaimed.nominate(parcel.parcelId, 'Mama Njeri');
      const after = parcels.get(parcel.parcelId);
      expect(after.receiverResponse?.choice).toBe('proxy');
      expect(after.status).toBe('Ready_For_Pickup');
      expect(unclaimed.owed(parcel.parcelId)).toBe(0);
    });

    it('does not spend the free extension twice on one decision', () => {
      // 'proxy' then a name is two calls about ONE decision, and a second grant here would quietly use
      // up the free extension the first one already gave them.
      const { parcel } = stranded();
      unclaimed.respond(parcel.parcelId, 'proxy');
      unclaimed.nominate(parcel.parcelId, 'Mama Njeri');
      expect(parcels.get(parcel.parcelId).extensionsUsed).toBe(1);
    });

    it('refuses a nomination with nobody in it', () => {
      const { parcel } = stranded();
      expect(() => unclaimed.nominate(parcel.parcelId, '  ')).toThrow(/Name the person/);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('when the receiver gives it up', () => {
    it('does not make the box disappear', () => {
      // There is a real parcel in a real shop. It is not 'Voided' — the shipment was performed, all the
      // way — and it is not disposed of either, because disposal is a legal shape rather than a button.
      const { parcel, to } = stranded();
      const freeBefore = shelf.available(to.did);
      unclaimed.respond(parcel.parcelId, 'relinquish', 'I do not want it');
      const after = parcels.get(parcel.parcelId);
      expect(after.status).toBe('Unclaimed');
      expect(after.relinquishedAt).toBeTruthy();
      expect(shelf.available(to.did)).toBe(freeBefore); // still occupying a slot, honestly
    });

    it('puts it in front of a person', () => {
      const { parcel } = stranded();
      unclaimed.respond(parcel.parcelId, 'relinquish');
      expect(unclaimed.awaitingDisposal().map((r) => r.parcelId)).toContain(parcel.parcelId);
    });

    it('names the shop holding it — the console printed its DID in that column', () => {
      const { parcel } = stranded();
      unclaimed.respond(parcel.parcelId, 'relinquish');
      const row = unclaimed.awaitingDisposal().find((r) => r.parcelId === parcel.parcelId)!;
      // An operator reads this column to know whose shelf it is and who is owed. The screen cannot
      // resolve a name it was never sent, so the server sends it.
      expect(row.shopName).toMatch(/^W Dest \d+$/);
      expect(row.shopName).not.toContain('did:');
      // What the shop is owed, with its money — the console printed it bare, the screen expecting a currency the server
      // never sent (2026-10-25). The parcel's own, as the counter says it.
      expect(row.currency).toBe('KES');
    });

    it('lets a store that is standing ready to pay have it instead', () => {
      // THE ORDERING RULE. The receiver said they did not want it, not that it should be destroyed, and
      // disposing of goods somebody is willing to pay to recover is the one outcome nobody asked for.
      const { parcel } = stranded({ threshold: 10, value: 500 });
      expect(returns.offerFor(parcel.parcelId)).toBeTruthy();
      unclaimed.respond(parcel.parcelId, 'relinquish');
      expect(unclaimed.awaitingDisposal().map((r) => r.parcelId)).not.toContain(parcel.parcelId);
      expect(() => unclaimed.writeOff(parcel.parcelId, 'ops', 'no')).toThrow(/still has an open offer/);
    });

    it('will not close out a parcel nobody gave up', () => {
      const { parcel } = stranded();
      expect(() => unclaimed.writeOff(parcel.parcelId, 'ops')).toThrow(/given up their claim/);
    });

    it('"I never ordered this" is NOT giving it up', () => {
      // The one answer after which disposing of it is the last thing we may do.
      const { parcel } = stranded();
      const { outcome } = unclaimed.respond(parcel.parcelId, 'not-mine', 'never bought this');
      expect(outcome).toBe('raised-with-sender');
      expect(parcels.get(parcel.parcelId).relinquishedAt).toBeUndefined();
      expect(unclaimed.awaitingDisposal().map((r) => r.parcelId)).not.toContain(parcel.parcelId);
    });
  });

  // ---------------------------------------------------------------------------------------------
  describe('who ends up paying for the shelf', () => {
    it('the receiver, when they collect late', () => {
      const { parcel, to } = stranded();
      const p = parcels.get(parcel.parcelId);
      p.unclaimedAt = daysAgo(3);
      const owed = unclaimed.owed(parcel.parcelId);
      expect(owed).toBeGreaterThan(0);
      // The counter learns it at the LOOKUP, not after the box has changed hands — asking for money back
      // across a counter is the one conversation nobody wins.
      expect(parcels.collect(parcel.collectionCode!, to.did).holdingOwed).toBeCloseTo(owed, 2);
      // Said in this shop's own money, which the receiver pays it in here — and the receiver's own app says the same
      // figure in the same money before they walk in (2026-10-25: it said the figure bare).
      expect(parcels.collect(parcel.collectionCode!, to.did).currency).toBe('KES');
      const told = parcels.consumerParcel(parcel.parcelId, parcel.receiverPhoneHash!);
      expect(told.holdingOwed).toBeCloseTo(owed, 2);
      expect(told.holdingCurrency).toBe('KES');
      parcels.collectConfirm(parcel.parcelId, to.did, parcel.collectionCode!);
      expect(parcels.get(parcel.parcelId).holdingSettled).toBeCloseTo(owed, 2);
      expect(unclaimed.owed(parcel.parcelId)).toBe(0); // and the network does not then pay it again
    });

    it('the store, when it brings the parcel home', () => {
      const { parcel, to, store } = stranded({ threshold: 10, value: 500 });
      const p = parcels.get(parcel.parcelId);
      p.unclaimedAt = daysAgo(3);
      const owed = unclaimed.owed(parcel.parcelId);
      const offer = returns.offerFor(parcel.parcelId)!;
      const shopBefore = agents.balance(to.did)!;
      const storeBefore = vendors.balanceOf(store.vendorId);

      returns.accept(offer.offerId, store.vendorId);
      // Both halves or neither: the shop is paid, and the store that agreed to it is billed for it.
      expect(agents.balance(to.did)!).toBeCloseTo(shopBefore + owed, 2);
      expect(storeBefore - vendors.balanceOf(store.vendorId)).toBeCloseTo(offer.returnCost + owed, 2);
    });

    /*
     * THE HOLDING SHOP'S MONEY (the user, 2026-10-25: a parcel sold in one country and held in another is charged in the
     * holding shop's money). The daily rate is that shop's company's; the ceiling — never more than the journey cost —
     * is the journey's price converted at today's rate; a store elsewhere pays the converted sum, the shop its own.
     */
    it('a parcel sold in another money is charged in the holding shop’s, its ceiling converted at today’s rate', () => {
      const { parcel, to } = stranded();
      const p = parcels.get(parcel.parcelId);
      p.unclaimedAt = daysAgo(3);
      const domestic = unclaimed.owed(parcel.parcelId);
      expect(domestic).toBeGreaterThan(0);
      p.currency = 'ETB'; // sold in birr, held on a Kenyan shelf
      // The days run at the Kenyan company's rate, in shillings: what they cost at home.
      expect(parcels.collect(parcel.collectionCode!, to.did)).toMatchObject({ holdingOwed: domestic, currency: 'KES' });
      expect(parcels.consumerParcel(parcel.parcelId, parcel.receiverPhoneHash!)).toMatchObject({ holdingOwed: domestic, holdingCurrency: 'KES' });
      // A journey that cost half the shelf, in birr: the ceiling is that, in shillings.
      p.shipmentCost = Math.round((domestic / 2 / fx.convert(1, 'ETB', 'KES')) * 100) / 100;
      const ceiling = fx.convert(p.shipmentCost, 'ETB', 'KES');
      expect(ceiling).toBeLessThan(domestic); // the guard reads a ceiling that binds
      expect(ceiling).not.toBeCloseTo(p.shipmentCost, 2); // …and one that was converted, not read as shillings
      expect(parcels.holdingOwed(p)).toEqual({ amount: ceiling, currency: 'KES' });
      expect(unclaimed.owed(parcel.parcelId)).toBe(ceiling);
      expect(unclaimed.awaitingDisposal().find((r) => r.parcelId === parcel.parcelId)).toBeUndefined(); // not given up: no row
    });

    it('a store selling in another money pays the shelf converted, and the shop is paid its own', () => {
      const { parcel, to, store } = stranded({ threshold: 10, value: 500, funds: 1_000_000 });
      const p = parcels.get(parcel.parcelId);
      p.unclaimedAt = daysAgo(3);
      const owed = unclaimed.owed(parcel.parcelId); // shillings: the Kenyan shop's
      // The journey home quoted in birr, as a store selling in birr would be quoted it.
      const real = routing.quoteShipment.bind(routing);
      jest.spyOn(routing, 'quoteShipment').mockImplementation((...a: Parameters<RoutingService['quoteShipment']>) => ({ ...real(...a), currency: 'ETB' }));
      const offer = returns.offerFor(parcel.parcelId)!;
      const billed = fx.convertForQuote(owed, 'KES', 'ETB');
      expect(offer.currency).toBe('ETB');
      expect(offer.holdingCost).toBeCloseTo(billed, 2);
      expect(billed).not.toBeCloseTo(owed, 2); // the guard reads a conversion

      const shopBefore = agents.balance(to.did)!;
      const storeBefore = vendors.balanceOf(store.vendorId);
      returns.accept(offer.offerId, store.vendorId);
      expect(agents.balance(to.did)!).toBeCloseTo(shopBefore + owed, 2); // the shop: what it is owed, in shillings
      expect(storeBefore - vendors.balanceOf(store.vendorId)).toBeCloseTo(offer.returnCost + billed, 2); // the store: in birr
      expect(parcels.get(parcel.parcelId).holdingSettled).toBeCloseTo(owed, 2); // settled in the shop's money
    });

    it('shows the store a meter, not a fixed price, for the shelf half', () => {
      // The transport half is a held price they are billed exactly what they were shown. This half grows
      // while they think about it, and showing it as fixed would be the one dishonest number on screen.
      const { parcel, store } = stranded({ threshold: 10, value: 500 });
      const p = parcels.get(parcel.parcelId);
      returns.offerFor(parcel.parcelId);
      p.unclaimedAt = daysAgo(5);
      const [pending] = returns.pendingFor(store.vendorId);
      expect(pending.holdingCost).toBeCloseTo(unclaimed.owed(parcel.parcelId), 2);
      expect(pending.holdingCost).toBeGreaterThan(0);
    });

    it('refuses a store that can afford the trip but not the shelf', () => {
      // Checked against the TOTAL. A store billed for a half it never saw coming would be right to stop
      // trusting every number this network gives it.
      const { parcel, store } = stranded({ threshold: 10, value: 500, funds: 500 });
      const p = parcels.get(parcel.parcelId);
      const offer = returns.offerFor(parcel.parcelId)!;
      p.unclaimedAt = daysAgo(10);
      // Spend the store down to exactly the transport cost, leaving nothing for the shelf.
      const spare = vendors.balanceOf(store.vendorId) - offer.returnCost;
      if (spare > 0) vendors.billShipment(store.vendorId, 'drain', spare);
      expect(() => returns.accept(offer.offerId, store.vendorId)).toThrow(/Top up first/);
      expect(parcels.get(parcel.parcelId).status).toBe('Unclaimed'); // nothing moved
    });

    it('the network, when nobody ends it at all', () => {
      // The honest place for the loss. A shortfall settling quietly on a shopkeeper who did the work and
      // had no say in any of it is the trust asymmetry this network refuses everywhere else.
      const { parcel, to } = stranded();
      const p = parcels.get(parcel.parcelId);
      p.unclaimedAt = daysAgo(4);
      unclaimed.respond(parcel.parcelId, 'relinquish');
      const owed = unclaimed.owed(parcel.parcelId);
      const before = agents.balance(to.did)!;
      const freeBefore = shelf.available(to.did);

      const { paidToShop, currency } = unclaimed.writeOff(parcel.parcelId, 'ops', 'disposed under KE rules');
      expect(paidToShop).toBeCloseTo(owed, 2);
      expect(currency).toBe('KES'); // said with its money, as the queue said it before the button
      expect(agents.balance(to.did)!).toBeCloseTo(before + owed, 2);
      expect(shelf.available(to.did)).toBe(freeBefore + 1); // and the slot finally comes back
      expect(gate).toBeDefined();
    });
  });

  // ---------------------------------------------------------------------------------------------
  /**
   * The daily rate was a constant. It is the company's own figure now (amounts.ts), and it is FIXED on the parcel at
   * the moment it starts to run: days already owed are not re-priced when the list changes afterwards.
   */
  describe('what a day of holding costs is the company’s to say, and is fixed when the free time ends', () => {
    const KE = () => entities.requireForJurisdiction('KE').entityId;
    const at = (parcelId: string) => new Date(parcels.get(parcelId).unclaimedAt!).getTime();

    // Figures kept under what the journey cost: the meter stops there whatever the rate (see "stops at the ceiling").
    it('runs at the figure of the company whose shop holds the parcel', () => {
      entities.setAmounts(KE(), { holdingFeePerDay: 0.3 }, 'Amina Otieno');
      const { parcel } = stranded();
      expect(parcels.get(parcel.parcelId).holdingFeePerDay).toBe(0.3);
      expect(unclaimed.owed(parcel.parcelId, at(parcel.parcelId) + 1)).toBe(0.3);
      expect(unclaimed.owed(parcel.parcelId, at(parcel.parcelId) + 2 * DAY)).toBe(0.6);
      expect(parcels.holdingTermsOf(parcels.get(parcel.parcelId))).toEqual({ perDay: 0.3, currency: 'KES' });
      // …and still never more than the journey cost, at any rate.
      expect(unclaimed.owed(parcel.parcelId, at(parcel.parcelId) + 10 * DAY)).toBe(parcels.get(parcel.parcelId).shipmentCost);
    });

    it('does not re-price the days already owed when the figure changes — only parcels whose time ends afterwards', () => {
      entities.setAmounts(KE(), { holdingFeePerDay: 0.3 }, 'Amina Otieno');
      const first = stranded().parcel;
      entities.setAmounts(KE(), { holdingFeePerDay: 0.5 }, 'Amina Otieno');
      const later = stranded().parcel;
      expect(unclaimed.owed(first.parcelId, at(first.parcelId) + 2 * DAY)).toBe(0.6);
      expect(parcels.holdingTermsOf(parcels.get(first.parcelId)).perDay).toBe(0.3);
      expect(unclaimed.owed(later.parcelId, at(later.parcelId) + 2 * DAY)).toBe(1);
      expect(parcels.holdingTermsOf(parcels.get(later.parcelId)).perDay).toBe(0.5);
      // What the counter is told to collect is read off the same rate (a day into the wait; not "now", which is
      // the same millisecond the free time ended in and owes nothing yet).
      const aDayIn = { ...parcels.get(later.parcelId), unclaimedAt: daysAgo(0) };
      expect(operationalParcelView(aDayIn).holdingOwed).toBe(0.5);
    });

    it('a shop no company of ours contracts: the list of whoever SOLD the shipment, who buys the work — else the starting figures', () => {
      entities.setAmounts(KE(), { holdingFeePerDay: 0.3 }, 'Amina Otieno');
      const { parcel } = onShelf();
      const elsewhere = { ...parcels.get(parcel.parcelId), destAgentDid: 'did:glos:a-shop-nobody-of-ours-contracts' };
      expect(parcels.holdingRateNow({ ...elsewhere, sellerEntityId: KE() })).toEqual({ perDay: 0.3, currency: 'KES' });
      // Nobody's company at either end: what every company starts from, in the network's own money.
      expect(parcels.holdingRateNow({ ...elsewhere, sellerEntityId: undefined, collectingEntityId: undefined })).toEqual({ perDay: HOLDING_FEE_PER_DAY, currency: 'KES' });
    });

    it('a parcel from before the rate was kept runs at what every company started from', () => {
      const { parcel } = stranded();
      parcels.get(parcel.parcelId).holdingFeePerDay = undefined;
      entities.setAmounts(KE(), { holdingFeePerDay: 0.5 }, 'Amina Otieno');
      expect(unclaimed.owed(parcel.parcelId, at(parcel.parcelId) + 2 * DAY)).toBeCloseTo(2 * HOLDING_FEE_PER_DAY, 2);
    });

    it('more time given free owes nothing at any rate; more time BOUGHT runs at the rate of the day it is bought, and says so', () => {
      entities.setAmounts(KE(), { holdingFeePerDay: 0.3 }, 'Amina Otieno');
      const { parcel } = stranded();
      unclaimed.extend(parcel.parcelId); // the first is free
      expect(parcels.get(parcel.parcelId).unclaimedAt).toBeUndefined();
      expect(parcels.get(parcel.parcelId).holdingFeePerDay).toBeUndefined();

      parcels.get(parcel.parcelId).status = 'Unclaimed'; // it lapses again
      entities.setAmounts(KE(), { holdingFeePerDay: 0.4 }, 'Amina Otieno');
      unclaimed.extend(parcel.parcelId); // the second is bought, today
      const p = parcels.get(parcel.parcelId);
      expect(p.holdingFeePerDay).toBe(0.4);
      // Said as money on the parcel's own trail: an amount, and what it is an amount of.
      expect(p.scans.map((s) => s.note).filter(Boolean).join(' | ')).toContain('KES 0.40 per day');
    });
  });

  describe('silence', () => {
    it('reaches an ending with no answer from anybody', () => {
      // The common case, and the one the whole design has to survive. Nothing here waits on a person:
      // the window closes on its own, the store is asked on its own, and an operator can always finish it.
      const { parcel } = stranded({ threshold: 10, value: 500 });
      expect(parcels.get(parcel.parcelId).status).toBe('Unclaimed');
      expect(returns.sweep().map((o) => o.parcelId)).toContain(parcel.parcelId);
      expect(parcels.get(parcel.parcelId).receiverResponse).toBeUndefined();
    });

    it('does not ask a store about a parcel its owner has already let go', () => {
      const { parcel } = stranded({ threshold: 10, value: 500 });
      unclaimed.respond(parcel.parcelId, 'relinquish');
      expect(returns.sweep().map((o) => o.parcelId)).not.toContain(parcel.parcelId);
    });

    it('refuses every choice once the parcel has actually gone', () => {
      const { parcel, to } = stranded();
      parcels.collectConfirm(parcel.parcelId, to.did, parcel.collectionCode!);
      expect(() => unclaimed.respond(parcel.parcelId, 'coming')).toThrow(/no longer waiting/);
      expect(() => unclaimed.nominate(parcel.parcelId, 'Mama Njeri')).toThrow(/no longer waiting/);
      expect(() => unclaimed.relinquish(parcel.parcelId)).toThrow(/no longer waiting/);
    });
  });
});
