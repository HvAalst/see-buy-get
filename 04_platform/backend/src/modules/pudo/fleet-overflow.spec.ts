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
import { DepartureService } from './departure.service';
import { ConsignmentNoteService } from './consignment-note.service';
import { CarriageContractService, CONTRACT_LINK_TRIES_PER_HOUR, isDay } from './carriage-contract.service';
import { GazetteerGeocoder, GEOCODER, type Geocoder } from './geocoder';
import { OrderImportService } from './order-import.service';
import { HeuristicRouter, ROUTER } from './router';
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
import { GlosEvent } from '../../foundation/events/glos-events';
import { PayoutService } from '../../foundation/payouts/payout.service';
import { SandboxPayoutRail } from '../../foundation/payouts/sandbox-rail.adapter';
import { PAYOUT_RAIL } from '../../foundation/payouts/payout.types';
import type { AgentService as Agents } from './agent.service';
import type { ImportService } from './import.service';
import type { ContractRef } from './carriage-contract.types';

import { FleetPartnerService, PARTNER_LINK_TRIES_PER_HOUR } from './fleet-partner.service';
import { FleetOverflowService } from './fleet-overflow.service';
import { NotificationService } from './notification.service';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { OutboxPushSender } from './push-sender';
import { PUSH_SENDER } from './notification.types';
import { PersonService } from './person.service';
import { OtpService } from './otp.service';
import { AuthService } from '../../foundation/auth/auth.service';
import type { UnclaimedService } from './unclaimed.service';
import type { OrderHandedOn } from './fleet-overflow.types';
import { clockAt } from './fleet-clock';
import { requiredLoadKeys, requiredUnloadKeys } from './heavy-cargo';
import { evidencePhotos } from '../../../test/content-photo';

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * P4 — WHAT A FLEET CANNOT CARRY GOES TO ITS PARTNERS FIRST, THEN TO THE OPEN BOARD.
 *
 * The user, 2026-10-05: "partner fleets, then board". Pinned here: a partner is made by a code the other office
 * enters; an offer shows a partner what it needs to decide and not whose customer it is; the first to take an order
 * carries it and everything that asks "whose is this" moves with it; every step has a way back while nobody has acted
 * on it; and whoever did not do a thing is told.
 */
describe('handing orders on', () => {
  const A = { fleetDid: 'did:glos:fleet-a', fleetName: 'Kilima Logistics' };
  const B = { fleetDid: 'did:glos:fleet-b', fleetName: 'Pwani Haulage' };
  const C = { fleetDid: 'did:glos:fleet-c', fleetName: 'Rift Carriers' };

  describe('a fleet’s partners', () => {
    const linked = (svc: FleetPartnerService, from = A, to = B) => svc.link(to, svc.invite(from, { partnerName: 'Pwani' }, 'Amina').code, 'Baraka');

    it('is made by a code the partner’s own office enters — shown once, kept as a hash, single use', () => {
      const svc = new FleetPartnerService();
      expect(() => svc.invite(A, { partnerName: ' ' }, 'Amina')).toThrow(/Name the fleet/);
      const issued = svc.invite(A, { partnerName: 'Pwani' }, 'Amina');
      expect(issued.code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
      expect(issued.partnership).toMatchObject({ status: 'invited', partnerName: 'Pwani', fromFleetName: 'Kilima Logistics' });
      expect(JSON.stringify(issued.partnership)).not.toContain('codeHash');
      // Until the partner's office enters it, nobody can be offered anything.
      expect(svc.activePartners(A.fleetDid)).toEqual([]);
      const p = svc.link(B, issued.code.toLowerCase(), 'Baraka');
      expect(p).toMatchObject({ status: 'active', toFleetDid: B.fleetDid, partnerName: 'Pwani Haulage', linkedBy: 'Baraka' });
      expect(svc.activePartners(A.fleetDid)).toEqual([B]);
      // One direction: A may offer to B. B has not named A.
      expect(svc.activePartners(B.fleetDid)).toEqual([]);
      expect(() => svc.link(C, issued.code, 'X')).toThrow(/does not match/);
      expect(svc.lists(A.fleetDid).offeringTo).toHaveLength(1);
      expect(svc.lists(B.fleetDid)).toMatchObject({ offeringTo: [], offeredBy: [{ fromFleetName: 'Kilima Logistics' }] });
    });

    it('refuses a fleet its own code, the same partner twice, a stale code, and guessing', () => {
      const svc = new FleetPartnerService();
      const now = Date.now();
      const own = svc.invite(A, { partnerName: 'Pwani' }, 'Amina', now);
      expect(() => svc.link(A, own.code, 'Amina', now)).toThrow(/your own code/);
      svc.link(B, own.code, 'Baraka', now);
      const again = svc.invite(A, { partnerName: 'Pwani again' }, 'Amina', now);
      expect(() => svc.link(B, again.code, 'Baraka', now)).toThrow(/already has you as a partner/);
      const stale = svc.invite(A, { partnerName: 'Late' }, 'Amina', now);
      expect(() => svc.link(C, stale.code, 'X', now + 15 * DAY)).toThrow(/does not match/);
      const fresh = svc.invite(A, { partnerName: 'Rift' }, 'Amina', now);
      const guesser = { fleetDid: 'did:glos:guesser', fleetName: 'Guess Co' };
      for (let i = 0; i < PARTNER_LINK_TRIES_PER_HOUR; i++) expect(() => svc.link(guesser, 'AAAAA-AAAAA', 'X', now + i)).toThrow(/does not match/);
      expect(() => svc.link(guesser, fresh.code, 'X', now + 10)).toThrow(/Too many codes/);
      expect(svc.link(guesser, fresh.code, 'X', now + HOUR + 1).status).toBe('active');
    });

    it('issues a new code that cancels the last, and is ended by either side', () => {
      const svc = new FleetPartnerService();
      const first = svc.invite(A, { partnerName: 'Pwani' }, 'Amina');
      const second = svc.reissue(A.fleetDid, first.partnership.partnershipId);
      expect(() => svc.link(B, first.code, 'Baraka')).toThrow(/does not match/);
      expect(() => svc.reissue(B.fleetDid, first.partnership.partnershipId)).toThrow(/No such partner/);
      const p = svc.link(B, second.code, 'Baraka');
      expect(() => svc.reissue(A.fleetDid, p.partnershipId)).toThrow(/already linked/);
      expect(() => svc.end(C.fleetDid, p.partnershipId, 'X')).toThrow(/No such partner/);
      expect(svc.end(B.fleetDid, p.partnershipId, 'Baraka').ended).toMatchObject({ side: 'to', by: 'Baraka' });
      expect(svc.activePartners(A.fleetDid)).toEqual([]);
      expect(() => svc.end(A.fleetDid, p.partnershipId, 'Amina')).toThrow(/already ended/);
      expect(linked(new FleetPartnerService()).status).toBe('active');
    });
  });

  /* ----------------------------------------------------------- the orders -- */

  describe('an order handed on', () => {
    let dispatch: DispatchService;
    let drivers: DriverService;
    let vehicles: VehicleService;
    let fleet: FleetService;
    let managers: FleetManagerService;
    let notes: ConsignmentNoteService;
    let events: EventBus;
    let notifications: NotificationService;
    let partners: FleetPartnerService;
    let overflow: FleetOverflowService;
    let heard: OrderHandedOn[];
    let dispatcher: NotificationDispatcher;
    let seq = 0;
    const settle = async () => {
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    };

    /** Round 31 — an evidence photo we hold, uploaded by the party the act checks. */
    let photoBy: (ownerDid: string) => string;
    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
          GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService, BagClosureService,
          BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
          DriverService, FleetService, DispatchService, RouteConstraintService, MarketPulseStore, MarketPulseService, FleetManagerService,
          DepartureService, PersonService, OtpService, AuthService, NotificationService, OutboxPushSender, { provide: PUSH_SENDER, useExisting: OutboxPushSender }, MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
          ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
          WalletService, DidService, IdentityVault, OperationalStore, FieldEncryption, LedgerService, EventBus,
          EntityService, PresenceService, BooksService, FxService,
          PayoutService, SandboxPayoutRail, { provide: PAYOUT_RAIL, useExisting: SandboxPayoutRail },
          { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
          GazetteerGeocoder, { provide: GEOCODER, useExisting: GazetteerGeocoder },
          HeuristicRouter, { provide: ROUTER, useExisting: HeuristicRouter },
        ],
      }).compile();
      photoBy = evidencePhotos(moduleRef);
      moduleRef.get(EntityService).seed();
      moduleRef.get(FxService).seed();
      dispatch = moduleRef.get(DispatchService);
      drivers = moduleRef.get(DriverService);
      vehicles = moduleRef.get(VehicleService);
      fleet = moduleRef.get(FleetService);
      managers = moduleRef.get(FleetManagerService);
      events = moduleRef.get(EventBus);
      notifications = moduleRef.get(NotificationService);
      const none = {} as never;
      notes = new ConsignmentNoteService(dispatch, drivers, managers, none as Agents, moduleRef.get(VendorService), events, none as ImportService);
      partners = new FleetPartnerService();
      overflow = new FleetOverflowService(dispatch, partners, events);
      heard = [];
      events.subscribe<OrderHandedOn>(GlosEvent.Pudo.OrderHandedOn, (e) => void heard.push(e.payload));
      dispatcher = new NotificationDispatcher(events, notifications, moduleRef.get(ParcelService), moduleRef.get(PersonService), moduleRef.get(AgentService), fleet, moduleRef.get(ToteService), moduleRef.get(MdpService), dispatch, { sweep: () => [] } as unknown as UnclaimedService, moduleRef.get(VendorService));
      dispatcher.onModuleInit();
    });

    function aFleet(name: string) {
      seq += 1;
      const m = managers.register({
        companyName: name, contactPhone: `+25480040${seq}0`, ownerFullName: 'O O', ownerNationalId: `MGR-OV-${seq}`,
        location: { lat: -1.2, lng: 36.8 },
        requirements: { businessRegistrationNo: `BRN-OV-${seq}`, transportOperatorLicence: `TOL-OV-${seq}`, taxId: `TAX-OV-${seq}` },
      });
      managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
      managers.decideKyc(m.did, true);
      managers.recordBond(m.did);
      const got = managers.get(m.did);
      return { did: got.did, name: got.companyName };
    }
    function onShift(managerDid?: string) {
      seq += 1;
      const d = drivers.register({
        displayName: `Driver ${seq}`, fullName: `D ${seq}`, nationalId: `ID-OV-${seq}`, mobile: `+2547840${seq}00`,
        licenceClasses: ['truck'], licenceNumber: `L-OV-${seq}`, licenceExpiresAt: new Date(Date.now() + 365 * DAY).toISOString(), criminalRecordClear: true,
        ...(managerDid ? { managerDid } : {}),
      });
      drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
      drivers.decideKyc(d.did, true);
      const truck = vehicles.register({ plate: `OV-${seq}`, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 20_000, ownerName: 'X', equipment: ['TLT', 'FLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, ...(managerDid ? { managerDid } : {}) } as never);
      fleet.couple(d.did, truck.vehicleId);
      return drivers.get(d.did);
    }
    const yard = { lat: -1.3, lng: 36.85 };
    const site = { lat: -1.25, lng: 36.9 };
    // The fleets here are Kenyan: their days are Nairobi's, which for three hours of every day are not UTC's.
    const tomorrow = () => clockAt(Date.now() + DAY, 'Africa/Nairobi').day;
    const anOrder = (a: { did: string; name: string }, kg = 4000) => {
      seq += 1;
      return dispatch.registerFreight({ description: `Bricks ${seq}`, pickupLocation: yard, pickupLabel: 'Jenga yard', destLabel: 'Kitengela site', destLocation: site, weightKg: kg, packaging: 'palletised', postedByDid: a.did, postedByName: 'Amina', contract: { contractId: 'ctr_ov', fleetDid: a.did, fleetName: a.name, shipperName: 'Jenga Bricks', reference: 'KL-07' }, deliverOn: tomorrow(), orderRef: `WS-${seq}` });
    };
    /** Three fleets: A offers to B and C. */
    function threeFleets() {
      const a = aFleet('Kilima Logistics');
      const b = aFleet('Pwani Haulage');
      const c = aFleet('Rift Carriers');
      for (const to of [b, c]) partners.link({ fleetDid: to.did, fleetName: to.name }, partners.invite({ fleetDid: a.did, fleetName: a.name }, { partnerName: to.name }, 'Amina').code, 'Office');
      return { a, b, c };
    }
    const rowFor = (fleetDid: string, freightId: string) => dispatch.ordersForFleet(fleetDid).find((r) => r.freightId === freightId);

    it('cannot be offered by a fleet with no partner, nor by a fleet it was not ordered from', () => {
      const a = aFleet('Kilima Logistics');
      const other = aFleet('Pwani Haulage');
      const f = anOrder(a);
      expect(() => overflow.offer(a, [f.freightId], 'Amina')).toThrow(/no partner fleet/);
      partners.link({ fleetDid: other.did, fleetName: other.name }, partners.invite({ fleetDid: a.did, fleetName: a.name }, { partnerName: 'Pwani' }, 'Amina').code, 'Baraka');
      expect(() => overflow.offer(a, [], 'Amina')).toThrow(/at least one order/);
      // B has no partner of its own to offer to; and A's order is not B's to offer.
      partners.link({ fleetDid: a.did, fleetName: a.name }, partners.invite({ fleetDid: other.did, fleetName: other.name }, { partnerName: 'Kilima' }, 'Baraka').code, 'Amina');
      expect(overflow.offer(other, [f.freightId], 'Baraka')).toMatchObject({ done: [], refused: [{ freightId: f.freightId, why: 'No such order' }] });
    });

    it('shows a partner what it needs to decide — and not whose customer it is', async () => {
      const { a, b, c } = threeFleets();
      const stranger = aFleet('Stranger Trucks');
      const f = anOrder(a);
      const g = anOrder(a, 2000);
      const out = overflow.offer(a, [f.freightId, g.freightId, 'frt_nonsense'], 'Amina');
      expect(out).toMatchObject({ done: [f.code, g.code] });
      // Both partners, in whichever order they were linked: two links made in the same millisecond have no order.
      expect([...out.to].sort()).toEqual(['Pwani Haulage', 'Rift Carriers']);
      expect(out.refused).toEqual([{ freightId: 'frt_nonsense', why: expect.stringMatching(/not found|No such/i) }]);
      for (const p of [b, c]) {
        const row = rowFor(p.did, f.freightId)!;
        expect(row).toMatchObject({ role: 'offered', fromFleetName: 'Kilima Logistics', description: f.description, weightKg: 4000, pickupLabel: 'Jenga yard', destLabel: 'Kitengela site', deliverOn: tomorrow(), uploaded: false });
        // The offering fleet's name stands where its customer's would be; nothing else names the customer.
        expect(JSON.stringify(row)).not.toContain('Jenga Bricks');
        expect(JSON.stringify(row)).not.toContain('KL-07');
        expect(row.orderRef).toBeUndefined();
        expect(row.postedByName).toBeUndefined();
        // And each partner sees only itself on the offer, not who else was asked.
        expect(row.handOn!.offeredTo).toEqual([{ fleetDid: p.did, fleetName: p.name }]);
      }
      expect(rowFor(stranger.did, f.freightId)).toBeUndefined();
      // And cannot take what it cannot see: an open offer answers only the fleets it was made to.
      expect(() => overflow.answer(stranger, f.freightId, true, 'Stranger')).toThrow(/No such offer/);
      expect(() => overflow.answer(stranger, f.freightId, false, 'Stranger')).toThrow(/No such offer/);
      // Offered to BOTH — read as the set it is: two partners linked in the same millisecond are listed either way round.
      const offer = rowFor(a.did, f.freightId)!.handOn as { state: string; offeredTo?: Array<{ fleetName: string }> };
      expect([offer.state, (offer.offeredTo ?? []).map((o) => o.fleetName).sort()]).toEqual(['offered', ['Pwani Haulage', 'Rift Carriers']]);
      expect(rowFor(a.did, f.freightId)).toMatchObject({ role: 'own', handOn: { state: 'offered', by: 'Amina' } });
      // One message a partner for the batch — not one an order.
      await settle();
      expect(heard).toEqual([expect.objectContaining({ what: 'offered', count: 2, weightKg: 6000, days: [tomorrow()] })]);
      // To both partners, whichever way round they were linked.
      expect([...(heard[0] as { toFleetDids: string[] }).toFleetDids].sort()).toEqual([b.did, c.did].sort());
      expect(notifications.inboxFor(b.did).map((n) => n.title)).toEqual(['Kilima Logistics offers you 2 orders']);
      expect(notifications.inboxFor(c.did)).toHaveLength(1);
    });

    it('is in nobody’s plan and on nobody’s truck while it is on offer', () => {
      const { a } = threeFleets();
      const own = onShift(a.did);
      const f = anOrder(a);
      expect(dispatch.contractOrdersForDay(a.did, tomorrow()).map((x) => x.freightId)).toEqual([f.freightId]);
      overflow.offer(a, [f.freightId], 'Amina');
      expect(dispatch.contractOrdersForDay(a.did, tomorrow())).toEqual([]);
      expect(() => dispatch.assign(f.freightId, own.did, { managerDid: a.did })).toThrow(/on offer to your partners/);
      // Taking the offer back puts it back in the fleet's own hands — and plan.
      overflow.withdrawOffer(a, f.freightId);
      expect(dispatch.contractOrdersForDay(a.did, tomorrow())).toHaveLength(1);
      expect(dispatch.assign(f.freightId, own.did, { managerDid: a.did }).status).toBe('claimed');
    });

    it('goes to the first partner to take it — whose queue, plan and office it then is', async () => {
      const { a, b, c } = threeFleets();
      const ofA = onShift(a.did);
      const ofB = onShift(b.did);
      const f = anOrder(a);
      overflow.offer(a, [f.freightId], 'Amina');
      overflow.answer(b, f.freightId, true, 'Baraka');
      // The other partner is told nothing is there: taken, or never offered, is the same answer.
      expect(() => overflow.answer(c, f.freightId, true, 'Chege')).toThrow(/No such offer/);
      expect(rowFor(c.did, f.freightId)).toBeUndefined();
      // B carries it, and now reads whose goods they are: the consignment note needs it.
      expect(rowFor(b.did, f.freightId)).toMatchObject({ role: 'partner', fromFleetName: 'Kilima Logistics', contract: { shipperName: 'Jenga Bricks' }, orderRef: f.orderRef });
      expect(rowFor(a.did, f.freightId)).toMatchObject({ role: 'own', handOn: { state: 'partner', partner: { fleetName: 'Pwani Haulage' }, takenBy: 'Baraka' } });
      expect(dispatch.contractOrdersForDay(b.did, tomorrow()).map((x) => x.freightId)).toEqual([f.freightId]);
      expect(dispatch.contractOrdersForDay(a.did, tomorrow())).toEqual([]);
      expect(() => dispatch.assign(f.freightId, ofA.did, { managerDid: a.did })).toThrow(/only the fleet carrying it/);
      expect(dispatch.assign(f.freightId, ofB.did, { managerDid: b.did, name: 'Baraka' })).toMatchObject({ status: 'claimed', claimedBy: ofB.did });
      // The fleet it was ordered from cannot hand on what a partner has taken.
      expect(() => dispatch.releaseToBoard(a.did, f.freightId, 'Amina')).toThrow(/has taken this order/);
      await settle();
      expect(heard.map((h) => h.what)).toEqual(['offered', 'taken']);
      expect(notifications.inboxFor(a.did).map((n) => n.title)).toEqual([`Pwani Haulage took ${f.code}`]);
    });

    it('says a partner has it to whoever holds the tracking link', () => {
      const { a, b } = threeFleets();
      const f = anOrder(a);
      overflow.offer(a, [f.freightId], 'Amina');
      expect(notes.trackView(dispatch.listFreight().find((x) => x.freightId === f.freightId)!).carrier).toEqual({ name: 'Kilima Logistics' });
      overflow.answer(b, f.freightId, true, 'Baraka');
      expect(notes.trackView(dispatch.listFreight().find((x) => x.freightId === f.freightId)!).carrier).toEqual({ name: 'Pwani Haulage' });
    });

    it('is back with its own fleet when the last partner leaves it — and only then is that news', async () => {
      const { a, b, c } = threeFleets();
      const f = anOrder(a);
      overflow.offer(a, [f.freightId], 'Amina');
      overflow.answer(b, f.freightId, false, 'Baraka');
      expect(rowFor(b.did, f.freightId)).toBeUndefined();
      expect(rowFor(c.did, f.freightId)!.role).toBe('offered');
      await settle();
      expect(heard.map((h) => h.what)).toEqual(['offered']);
      overflow.answer(c, f.freightId, false, 'Chege');
      expect(rowFor(a.did, f.freightId)!.handOn).toBeUndefined();
      expect(dispatch.contractOrdersForDay(a.did, tomorrow())).toHaveLength(1);
      await settle();
      expect(heard.map((h) => h.what)).toEqual(['offered', 'ran_out']);
      expect(notifications.inboxFor(a.did).map((n) => n.title)).toEqual([`No partner took ${f.code}`]);
    });

    it('tells the partners when an offer is taken back', async () => {
      const { a, b, c } = threeFleets();
      const f = anOrder(a);
      overflow.offer(a, [f.freightId], 'Amina');
      overflow.withdrawOffer(a, f.freightId);
      expect(rowFor(b.did, f.freightId)).toBeUndefined();
      expect(() => overflow.withdrawOffer(a, f.freightId)).toThrow(/not on offer/);
      await settle();
      expect(heard.map((h) => h.what)).toEqual(['offered', 'withdrawn']);
      expect(notifications.inboxFor(c.did).map((n) => n.title)).toEqual(['Kilima Logistics took back an offer', 'Kilima Logistics offers you an order']);
    });

    it('can be given back by the partner that took it, with a reason — until it is on a truck', async () => {
      const { a, b, c } = threeFleets();
      const ofB = onShift(b.did);
      const f = anOrder(a);
      const g = anOrder(a);
      overflow.offer(a, [f.freightId, g.freightId], 'Amina');
      overflow.answer(b, f.freightId, true, 'Baraka');
      overflow.answer(b, g.freightId, true, 'Baraka');
      expect(() => overflow.handBack(c, f.freightId, 'Not ours')).toThrow(/No such order/);
      expect(() => overflow.handBack(b, f.freightId, ' ')).toThrow(/Say why/);
      overflow.handBack(b, f.freightId, 'Our flatbed broke down');
      expect(rowFor(b.did, f.freightId)).toBeUndefined();
      expect(rowFor(a.did, f.freightId)).toMatchObject({ role: 'own', handedBack: { fleetName: 'Pwani Haulage', reason: 'Our flatbed broke down' } });
      expect(rowFor(a.did, f.freightId)!.handOn).toBeUndefined();
      // The other one is on a truck: it is carried.
      dispatch.assign(g.freightId, ofB.did, { managerDid: b.did });
      expect(() => overflow.handBack(b, g.freightId, 'Changed our mind')).toThrow(/on a truck, and is carried/);
      await settle();
      expect(heard.filter((h) => h.what === 'handed_back')).toEqual([expect.objectContaining({ partnerName: 'Pwani Haulage', reason: 'Our flatbed broke down', code: f.code })]);
      expect(notifications.inboxFor(a.did).find((n) => /gave/.test(n.title))!.body).toMatch(/They said: Our flatbed broke down/);
    });

    it('goes on the open board for any carrier when released — and comes back off while nobody has it', async () => {
      const { a } = threeFleets();
      const outsider = onShift();
      const f = anOrder(a);
      const posted = jest.spyOn(events, 'publish');
      expect(dispatch.board({ driverDid: outsider.did, from: yard }).map((r) => r.freightId)).not.toContain(f.freightId);
      expect(dispatch.isPrivateOrder(f)).toBe(true);
      const out = overflow.release(a, [f.freightId], 'Amina');
      expect(out).toMatchObject({ done: [f.code], refused: [], to: [] });
      const released = dispatch.listFreight().find((x) => x.freightId === f.freightId)!;
      expect(released).toMatchObject({ status: 'available', handOn: { state: 'board', by: 'Amina' }, settlement: 'between_parties' });
      expect(dispatch.isPrivateOrder(released)).toBe(false);
      expect(posted.mock.calls.filter(([name]) => name === GlosEvent.Pudo.FreightPosted)).toHaveLength(1);
      expect(dispatch.board({ driverDid: outsider.did, from: yard }).map((r) => r.freightId)).toContain(f.freightId);
      expect(rowFor(a.did, f.freightId)).toMatchObject({ role: 'own', status: 'available', handOn: { state: 'board' } });
      // To the receiver it is still an order with its carrier: where it is being found a truck is not their concern.
      expect(notes.trackView(released)).toMatchObject({ status: 'ordered', carrier: { name: 'Kilima Logistics' } });
      expect(() => overflow.release(a, [f.freightId], 'Amina')).not.toThrow();
      expect(overflow.release(a, [f.freightId], 'Amina').refused[0].why).toMatch(/already on the open board/);

      overflow.takeBack(a, f.freightId);
      expect(dispatch.listFreight().find((x) => x.freightId === f.freightId)).toMatchObject({ status: 'ordered' });
      expect(dispatch.board({ driverDid: outsider.did, from: yard }).map((r) => r.freightId)).not.toContain(f.freightId);
      expect(() => overflow.takeBack(a, f.freightId)).toThrow(/No such order on the board/);
    });

    it('tells the shipper its order comes in loads — where the shipper is somebody here to tell — and shows every load to whoever holds a link', async () => {
      const { a } = threeFleets();
      const placed = (postedByDid: string) => dispatch.registerFreight({ description: 'Blocks', pickupLocation: yard, pickupLabel: 'Jenga yard', destLabel: 'Machakos junction', destLocation: site, weightKg: 12000, packaging: 'palletised', postedByDid, postedByName: 'Wanjiru', contract: { contractId: 'ctr_ov', fleetDid: a.did, fleetName: a.name, shipperName: 'Jenga Bricks' }, deliverOn: tomorrow(), orderRef: 'WS-BLOCKS-' + postedByDid.length });
      const theirs = placed('did:glos:jenga-bricks');
      const [first, second] = dispatch.splitOrder(a.did, theirs.freightId, [8000, 4000], 'Amina');
      await settle();
      const inbox = () => notifications.inboxFor('did:glos:jenga-bricks');
      expect(inbox().map((n) => n.title)).toEqual(['Kilima Logistics will bring ' + theirs.code + ' in 2 loads']);
      expect(inbox()[0].body).toMatch(/12 t for .* It is more than one vehicle carries, so it comes in 2 deliveries; each is signed for on its own/);
      // Whoever holds the link of either load sees both, and which one this is.
      const seen = notes.trackView(dispatch.listFreight().find((x) => x.freightId === second.freightId)!);
      expect(seen.partOf).toMatchObject({ no: 2, of: 2, rootCode: theirs.code, orderKg: 12000 });
      expect(seen.loads).toEqual([
        { no: 1, code: first.code, weightKg: 8000, status: 'ordered' },
        { no: 2, code: second.code, weightKg: 4000, status: 'ordered' },
      ]);
      expect(notes.trackView(dispatch.listFreight().find((x) => x.freightId === first.freightId)!).loads).toHaveLength(2);
      // The shipper's own list of what it ordered shows both loads as loads.
      expect(dispatch.postedBy('did:glos:jenga-bricks').map((r) => [r.code, r.partOf?.no, r.partOf?.of]).sort()).toEqual([[first.code, 1, 2], [second.code, 2, 2]].sort());

      // Put back together: the shipper is told that too; the link of the load that is no more says what became of it.
      dispatch.rejoinOrder(a.did, theirs.freightId, 'Amina');
      await settle();
      expect(inbox().map((n) => n.title)).toContain('Kilima Logistics will bring ' + theirs.code + ' in one load after all');
      const gone = notes.trackView(dispatch.listFreight().find((x) => x.freightId === second.freightId)!);
      expect(gone).toMatchObject({ rejoined: true, status: 'cancelled' });
      expect([gone.partOf, gone.loads]).toEqual([undefined, undefined]);
      expect(dispatch.postedBy('did:glos:jenga-bricks').map((r) => [r.code, r.weightKg, r.partOf])).toEqual([[theirs.code, 12000, undefined]]);
      const whole = notes.trackView(dispatch.listFreight().find((x) => x.freightId === theirs.freightId)!);
      expect([whole.partOf, whole.loads, whole.rejoined]).toEqual([undefined, undefined, undefined]);

      // An order the fleet's own office typed in has nobody here to tell: nobody is told, least of all the fleet itself.
      const typed = placed(a.did);
      dispatch.splitOrder(a.did, typed.freightId, [6000, 6000], 'Amina');
      await settle();
      expect(notifications.inboxFor(a.did).some((n) => /will bring/.test(n.title))).toBe(false);
    });

    /**
     * A PLAN THAT MISSES THE WINDOW. Until this, an order planned to arrive after the window its shipper asked for was
     * said to be late to the carrier's office and to nobody else. Pinned here: the shipper is told when the plan is
     * accepted, not every time it is accepted again; told again when it has moved; told when it is inside after all;
     * and its own list of what it ordered says the same as long as the order is still on its way.
     */
    it('tells the shipper when the plan its carrier accepted misses the window it asked for — and not again until that changes', async () => {
      const { a } = threeFleets();
      const day = tomorrow();
      const shipper = 'did:glos:jenga-bricks';
      const placed = (postedByDid: string, ref: string) => dispatch.registerFreight({ description: 'Blocks', pickupLocation: yard, pickupLabel: 'Jenga yard', destLabel: 'Machakos junction', destLocation: site, weightKg: 2000, packaging: 'palletised', postedByDid, postedByName: 'Wanjiru', contract: { contractId: 'ctr_ov', fleetDid: a.did, fleetName: a.name, shipperName: 'Jenga Bricks' }, deliverOn: day, orderRef: ref, deliveryWindow: '8-12' });
      const theirs = placed(shipper, 'WS-WIN-1');
      type Over = { arrive: string; lateMin?: number; earlyMin?: number };
      const stamp = (over: Over) => ({ day, vehicleId: 'veh_1', plate: 'KPL 008T', tripNo: 1, seq: 1, window: '08:00 to 12:00', at: new Date().toISOString(), ...over });
      const accept = async (over: Over, more: Array<[string, Over]> = []) => {
        dispatch.stampPlan(a.did, day, new Map([[theirs.freightId, stamp(over)], ...more.map(([id, o]) => [id, stamp(o)] as [string, ReturnType<typeof stamp>])]));
        await settle();
      };
      const told = () => notifications.inboxFor(shipper).filter((n) => n.kind === 'order_window');
      const titles = () => told().map((n) => n.title);
      const row = (did = shipper, id = theirs.freightId) => dispatch.postedBy(did).find((r) => r.freightId === id)!;
      const plans = 'Kilima Logistics plans ' + theirs.code + ' for about ';

      // Inside its window: nothing to say, and nothing shown.
      await accept({ arrive: '10:10' });
      expect(titles()).toEqual([]);
      expect(row().outsideWindow).toBeUndefined();

      // Forty minutes after it closes: said, in words that keep a plan a plan.
      await accept({ arrive: '12:40', lateMin: 40 });
      expect(titles()).toEqual([plans + '12:40 — 40 minutes after your window']);
      expect(told()[0].body).toBe('You asked for 08:00 to 12:00 on ' + day + '. Its plan for that day has ' + theirs.code + ' at the door about 12:40, 40 minutes after that. A plan’s time is an estimate, and the day can still be planned again. If this cannot work, speak to Kilima Logistics now.');
      expect(row().outsideWindow).toEqual({ day, arrive: '12:40', window: '08:00 to 12:00', lateMin: 40 });

      // Accepted again, much the same: nothing new is said. The list follows the plan all the same.
      await accept({ arrive: '13:09', lateMin: 69 });
      expect(titles()).toHaveLength(1);
      expect(row().outsideWindow).toMatchObject({ arrive: '13:09', lateMin: 69 });
      // Half an hour or more from what was SAID (forty minutes), not from the last plan: said again.
      await accept({ arrive: '13:10', lateMin: 70 });
      expect(titles()).toHaveLength(2);
      expect(titles()).toContain(plans + '13:10 — 1 hour 10 minutes after your window');
      // The other side of the window is news whatever the figure.
      await accept({ arrive: '06:50', earlyMin: 70 });
      expect(titles()).toHaveLength(3);
      expect(titles()).toContain(plans + '06:50 — 1 hour 10 minutes before your window');
      expect(told().find((n) => /before your window/.test(n.title))!.body).toMatch(/1 hour 10 minutes before that: the day does not leave its vehicle room to wait./);
      expect(row().outsideWindow).toEqual({ day, arrive: '06:50', window: '08:00 to 12:00', earlyMin: 70 });

      // Inside after all: said once, and the list says nothing more about it.
      await accept({ arrive: '09:30' });
      expect(titles()).toHaveLength(4);
      expect(titles()).toContain('Kilima Logistics now plans ' + theirs.code + ' inside your window');
      expect(told().find((n) => /inside your window/.test(n.title))!.body).toMatch(/now has .* at the door about 09:30. A plan’s time is an estimate/);
      expect(row().outsideWindow).toBeUndefined();
      await accept({ arrive: '09:45' });
      expect(titles()).toHaveLength(4);
      // And late again after that is news again.
      await accept({ arrive: '12:05', lateMin: 5 });
      expect(titles()).toHaveLength(5);

      // An order the carrier's own office typed in has nobody here to tell — its list, read by the office, still says it.
      const typed = placed(a.did, 'WS-WIN-2');
      await accept({ arrive: '12:05', lateMin: 5 }, [[typed.freightId, { arrive: '13:30', lateMin: 90 }]]);
      expect(notifications.inboxFor(a.did).some((n) => n.kind === 'order_window')).toBe(false);
      expect(titles()).toHaveLength(5);
      expect(row(a.did, typed.freightId).outsideWindow).toMatchObject({ lateMin: 90 });

      // Withdrawn: a plan that no longer matters is not shown against it.
      dispatch.cancelFreight(theirs.freightId, { did: shipper, role: 'shipper' }, 'Not needed any more');
      expect(dispatch.listFreight().find((x) => x.freightId === theirs.freightId)!.planned).toMatchObject({ lateMin: 5 });
      expect(row().outsideWindow).toBeUndefined();
    });

    it('does not carry what was said of an order onto the loads it is split into: each new load starts unsaid', async () => {
      const { a } = threeFleets();
      const day = tomorrow();
      const shipper = 'did:glos:jenga-bricks';
      const theirs = dispatch.registerFreight({ description: 'Blocks', pickupLocation: yard, pickupLabel: 'Jenga yard', destLabel: 'Machakos junction', destLocation: site, weightKg: 12000, packaging: 'palletised', postedByDid: shipper, postedByName: 'Wanjiru', contract: { contractId: 'ctr_ov', fleetDid: a.did, fleetName: a.name, shipperName: 'Jenga Bricks' }, deliverOn: day, orderRef: 'WS-WIN-SPLIT', deliveryWindow: '8-12' });
      const stamp = (over: { arrive: string; lateMin?: number }) => ({ day, vehicleId: 'veh_1', plate: 'KPL 008T', tripNo: 1, seq: 1, window: '08:00 to 12:00', at: new Date().toISOString(), ...over });
      const titles = () => notifications.inboxFor(shipper).filter((n) => n.kind === 'order_window').map((n) => n.title);
      dispatch.stampPlan(a.did, day, new Map([[theirs.freightId, stamp({ arrive: '12:40', lateMin: 40 })]]));
      await settle();
      expect(titles()).toHaveLength(1);
      const [first, second] = dispatch.splitOrder(a.did, theirs.freightId, [8000, 4000], 'Amina');
      expect(second.windowTold).toBeUndefined();
      // The second load, planned inside the window: nothing was ever said of it, so there is nothing to take back.
      // The first is the order itself, under the code the shipper was told about — it IS news that it is inside now.
      dispatch.stampPlan(a.did, day, new Map([[first.freightId, stamp({ arrive: '10:00' })], [second.freightId, stamp({ arrive: '10:30' })]]));
      await settle();
      expect(titles()).toHaveLength(2);
      expect(titles()).toContain('Kilima Logistics now plans ' + first.code + ' inside your window');
      expect(titles().some((x) => x.includes(second.code))).toBe(false);
      // And late, the new load is said to be late in its own right — forty minutes was said of the order, not of it.
      dispatch.stampPlan(a.did, day, new Map([[first.freightId, stamp({ arrive: '10:00' })], [second.freightId, stamp({ arrive: '12:45', lateMin: 45 })]]));
      await settle();
      expect(titles()).toHaveLength(3);
      expect(titles()).toContain('Kilima Logistics plans ' + second.code + ' for about 12:45 — 45 minutes after your window');
    });

    /**
     * ON NO VEHICLE. The user, 2026-10-06: "It's commonly a phonecall away, but he needs at least a notification."
     * Pinned here: the shipper of an order an accepted plan leaves out is told, once for a day and a reason; told that
     * it is on a vehicle after all, with about when; and its own list says the same for as long as the plan does — and,
     * quietly, about when an order that IS planned is at the door.
     */
    describe('an order the accepted plan leaves on no vehicle', () => {
      const shipper = 'did:glos:jenga-bricks';
      type Over = { arrive: string; lateMin?: number };
      function aDay() {
        const { a } = threeFleets();
        const day = tomorrow();
        const placed = (postedByDid: string, ref: string, kg = 2000) => dispatch.registerFreight({ description: 'Blocks', pickupLocation: yard, pickupLabel: 'Jenga yard', destLabel: 'Machakos junction', destLocation: site, weightKg: kg, packaging: 'palletised', postedByDid, postedByName: 'Wanjiru', contract: { contractId: 'ctr_ov', fleetDid: a.did, fleetName: a.name, shipperName: 'Jenga Bricks' }, deliverOn: day, orderRef: ref, deliveryWindow: '8-12' });
        const stamp = (over: Over) => ({ day, vehicleId: 'veh_1', plate: 'KPL 008T', tripNo: 1, seq: 1, window: '08:00 to 12:00', at: new Date().toISOString(), ...over });
        const accept = async (on: Array<[string, Over]>, left?: Array<[string, string]>) => {
          dispatch.stampPlan(a.did, day, new Map(on.map(([id, o]) => [id, stamp(o)] as [string, ReturnType<typeof stamp>])), Date.now(), left ? new Map(left) : undefined);
          await settle();
        };
        const inbox = () => notifications.inboxFor(shipper).filter((n) => n.kind === 'order_left_out' || n.kind === 'order_window');
        const row = (did: string, id: string) => dispatch.postedBy(did).find((r) => r.freightId === id)!;
        return { a, day, placed, accept, inbox, titles: () => inbox().map((n) => n.title), row };
      }

      it('is said to its shipper once for a day and a reason, and said to be on a vehicle after all — and the list follows the plan', async () => {
        const { day, placed, accept, inbox, titles, row } = aDay();
        const theirs = placed(shipper, 'WS-LEFT-1');
        const mine = () => row(shipper, theirs.freightId);

        // Planned, inside its window: nothing is said — and its list says, quietly, about when.
        await accept([[theirs.freightId, { arrive: '10:10' }]], []);
        expect(titles()).toEqual([]);
        expect(mine().plannedAbout).toEqual({ day, arrive: '10:10', window: '08:00 to 12:00' });
        expect([mine().leftOut, mine().outsideWindow]).toEqual([undefined, undefined]);

        // The day is accepted again and it is on no vehicle: said, with why as a shipper is told it.
        await accept([], [[theirs.freightId, 'no_time']]);
        expect(titles()).toEqual(['Kilima Logistics has not put ' + theirs.code + ' on a vehicle for ' + day]);
        expect(inbox()[0].kind).toBe('order_left_out');
        expect(inbox()[0].body).toBe('Its plan for ' + day + ' has no room for it: the vehicles going out are full, or the day is too short. As its plan stands, ' + theirs.code + ' is on no vehicle. The day can still be planned again: speak to Kilima Logistics now.');
        expect(mine().leftOut).toEqual({ day, why: 'room' });
        expect(mine().plannedAbout).toBeUndefined();
        // Still out — for want of a driver, or of any truck, which is the same thing to a shipper: not said again,
        // and the carrier's drivers are nobody's business but the carrier's.
        await accept([], [[theirs.freightId, 'no_driver']]);
        await accept([], [[theirs.freightId, 'no_trucks']]);
        expect(titles()).toHaveLength(1);
        expect(JSON.stringify(inbox())).not.toMatch(/driver/i);
        // Another reason is news, each in its own words.
        await accept([], [[theirs.freightId, 'too_heavy']]);
        await accept([], [[theirs.freightId, 'no_truck_can_carry']]);
        await accept([], [[theirs.freightId, 'no_pin']]);
        expect(titles()).toHaveLength(4);
        const bodies = inbox().map((n) => n.body).join(' | ');
        expect(bodies).toContain('It is heavier than its largest vehicle carries. It may bring it in several loads, and you are told if it does.');
        expect(bodies).toContain('None of the vehicles in its plan for ' + day + ' can carry it as it was ordered.');
        expect(bodies).toContain('The place it goes to has no point on the map, so it could not be planned. A fuller address will help.');
        expect(mine().leftOut).toEqual({ day, why: 'place' });

        // On a vehicle after all, inside its window: said as news about a time, with about when — and the list follows.
        await accept([[theirs.freightId, { arrive: '09:40' }]], []);
        expect(titles()).toHaveLength(5);
        const back = inbox().find((n) => /now has/.test(n.title))!;
        expect([back.kind, back.title]).toEqual(['order_window', 'Kilima Logistics now has ' + theirs.code + ' on a vehicle for ' + day]);
        expect(back.body).toBe('Its plan has ' + theirs.code + ' at the door about 09:40, inside the window you asked for (08:00 to 12:00). A plan’s time is an estimate, and the day can still be planned again.');
        expect(mine().leftOut).toBeUndefined();
        expect(mine().plannedAbout).toMatchObject({ arrive: '09:40' });
        // Accepted again as it is: nothing more. And left out again after that is news again.
        await accept([[theirs.freightId, { arrive: '09:45' }]], []);
        expect(titles()).toHaveLength(5);
        await accept([], [[theirs.freightId, 'no_time']]);
        expect(titles()).toHaveLength(6);
      });

      it('is said to be back on a vehicle as LATE when it is late — even a lateness that was said before it was left out', async () => {
        const { placed, accept, titles, row } = aDay();
        const theirs = placed(shipper, 'WS-LEFT-2');
        await accept([[theirs.freightId, { arrive: '12:40', lateMin: 40 }]], []);
        await accept([], [[theirs.freightId, 'no_time']]);
        expect(titles()).toHaveLength(2);
        // Back, forty-five minutes late: five minutes from what was once said, which on its own would not be news.
        await accept([[theirs.freightId, { arrive: '12:45', lateMin: 45 }]], []);
        expect(titles()).toHaveLength(3);
        expect(titles()).toContain('Kilima Logistics plans ' + theirs.code + ' for about 12:45 — 45 minutes after your window');
        expect(titles().some((x) => /now has/.test(x))).toBe(false);
        expect(row(shipper, theirs.freightId)).toMatchObject({ outsideWindow: { lateMin: 45 }, plannedAbout: { arrive: '12:45' } });
        expect(row(shipper, theirs.freightId).leftOut).toBeUndefined();
      });

      it('tells nobody of an order the carrier’s own office typed in, shows it all the same, and stops showing what no longer holds', async () => {
        const { a, day, placed, accept, inbox, row } = aDay();
        const typed = placed(a.did, 'WS-LEFT-3');
        const theirs = placed(shipper, 'WS-LEFT-4');
        await accept([], [[typed.freightId, 'no_time'], [theirs.freightId, 'no_time']]);
        expect(notifications.inboxFor(a.did).some((n) => n.kind === 'order_left_out')).toBe(false);
        expect(inbox()).toHaveLength(1);
        expect(row(a.did, typed.freightId).leftOut).toEqual({ day, why: 'room' });
        // A plan that says nothing of what it left out — an older caller — says nothing, and takes nothing back.
        await accept([]);
        expect(inbox()).toHaveLength(1);
        expect(row(shipper, theirs.freightId).leftOut).toEqual({ day, why: 'room' });
        // Withdrawn: it is on no vehicle because it is going nowhere, and the list does not say a plan left it out.
        dispatch.cancelFreight(theirs.freightId, { did: shipper, role: 'shipper' }, 'Not needed any more');
        expect(row(shipper, theirs.freightId).leftOut).toBeUndefined();
        // Put on a driver by hand, outside any plan: it is on a vehicle.
        const own = onShift(a.did);
        dispatch.assign(typed.freightId, own.did, { managerDid: a.did, name: 'Amina' });
        expect(row(a.did, typed.freightId).leftOut).toBeUndefined();
      });

      it('is not carried onto the loads of a split: the plan was about the order as it was', async () => {
        const { a, day, placed, accept, titles, row } = aDay();
        const heavy = placed(shipper, 'WS-LEFT-5', 12000);
        await accept([], [[heavy.freightId, 'too_heavy']]);
        expect(titles()).toHaveLength(1);
        const [first, second] = dispatch.splitOrder(a.did, heavy.freightId, [8000, 4000], 'Amina');
        expect([first.planLeft, second.planLeft]).toEqual([undefined, undefined]);
        expect([row(shipper, first.freightId).leftOut, row(shipper, second.freightId).leftOut]).toEqual([undefined, undefined]);
        // Both loads planned: the notice that it comes in loads said what became of the order; nothing is "after all".
        await accept([[first.freightId, { arrive: '09:00' }], [second.freightId, { arrive: '11:00' }]], []);
        expect(titles()).toHaveLength(1);
        expect(row(shipper, second.freightId).plannedAbout).toEqual({ day, arrive: '11:00', window: '08:00 to 12:00' });
        // A load left out is said of that load, in its own right.
        await accept([[first.freightId, { arrive: '09:00' }]], [[second.freightId, 'no_time']]);
        expect(titles()).toHaveLength(2);
        expect(titles()).toContain('Kilima Logistics has not put ' + second.code + ' on a vehicle for ' + day);
      });

      it('shows about when a planned order is at the door only while that is still to come', async () => {
        const { a, day, placed, accept, row } = aDay();
        const theirs = placed(shipper, 'WS-LEFT-6');
        const mine = () => row(shipper, theirs.freightId);
        expect(mine().plannedAbout).toBeUndefined();
        await accept([[theirs.freightId, { arrive: '10:10' }]], []);
        expect(mine().plannedAbout).toEqual({ day, arrive: '10:10', window: '08:00 to 12:00' });
        // Its trip came up and it could not be loaded: no time is claimed for it while that stands.
        dispatch.holdPlanned(theirs.freightId, 'The truck is full');
        expect(mine().plannedAbout).toBeUndefined();
        dispatch.holdPlanned(theirs.freightId, undefined);
        expect(mine().plannedAbout).toMatchObject({ arrive: '10:10' });
        // On its driver and on the road it is still to come; delivered, it is not.
        const own = onShift(a.did);
        dispatch.assign(theirs.freightId, own.did, { managerDid: a.did, name: 'Amina' });
        expect(mine().plannedAbout).toMatchObject({ arrive: '10:10' });
        const f = dispatch.listFreight().find((x) => x.freightId === theirs.freightId)!;
        dispatch.pickupFreight(theirs.freightId, own.did, { confirmed: requiredLoadKeys(f), securementPhotoId: photoBy(own.did) });
        expect(mine().plannedAbout).toMatchObject({ arrive: '10:10' });
        dispatch.deliverFreight(theirs.freightId, own.did, { confirmed: requiredUnloadKeys(), receiverName: 'Wanjiru at the gate', podPhotoId: photoBy(own.did) });
        expect(mine().plannedAbout).toBeUndefined();
      });
    });

    /**
     * DELIVERED. The shipper of a run was always told its goods reached the other end; whoever sent a load — onto the
     * open board, or to its contract carrier — was told nothing, at any point of a delivery that went to plan.
     */
    it('tells whoever sent a load that it was delivered, and to whom — not the carrier’s own office, and not the driver', async () => {
      const { a } = threeFleets();
      const own = onShift(a.did);
      const shipper = 'did:glos:jenga-bricks';
      const placed = (postedByDid: string, ref: string, description: string) => dispatch.registerFreight({ description, pickupLocation: yard, pickupLabel: 'Jenga yard', destLabel: 'Machakos junction', destLocation: site, weightKg: 2000, packaging: 'palletised', postedByDid, postedByName: 'Wanjiru', contract: { contractId: 'ctr_ov', fleetDid: a.did, fleetName: a.name, shipperName: 'Jenga Bricks' }, deliverOn: tomorrow(), orderRef: ref });
      const carry = (freightId: string) => {
        dispatch.assign(freightId, own.did, { managerDid: a.did, name: 'Amina' });
        const f = dispatch.listFreight().find((x) => x.freightId === freightId)!;
        dispatch.pickupFreight(freightId, own.did, { confirmed: requiredLoadKeys(f), securementPhotoId: photoBy(own.did) });
        dispatch.deliverFreight(freightId, own.did, { confirmed: requiredUnloadKeys(), receiverName: 'Wanjiru at the gate', podPhotoId: photoBy(own.did) });
      };
      const delivered = (did: string) => notifications.inboxFor(did).filter((n) => n.kind === 'freight_delivered');
      const theirs = placed(shipper, 'WS-DEL-1', 'Bricks, 4 pallets.');
      // Nothing is said before it is delivered.
      dispatch.assign(theirs.freightId, own.did, { managerDid: a.did, name: 'Amina' });
      await settle();
      expect(delivered(shipper)).toEqual([]);
      const f = dispatch.listFreight().find((x) => x.freightId === theirs.freightId)!;
      dispatch.pickupFreight(theirs.freightId, own.did, { confirmed: requiredLoadKeys(f), securementPhotoId: photoBy(own.did) });
      dispatch.deliverFreight(theirs.freightId, own.did, { confirmed: requiredUnloadKeys(), receiverName: 'Wanjiru at the gate', podPhotoId: photoBy(own.did) }, Date.parse(tomorrow() + 'T10:30:00+03:00'));
      await settle();
      // On its day, with no window asked for: when, to whom, where, what — and nothing held against it.
      expect(delivered(shipper).map((n) => [n.title, n.body])).toEqual([[theirs.code + ' was delivered', 'Handed over at 10:30 to Wanjiru at the gate at Machakos junction: Bricks, 4 pallets.']]);
      // An order the carrier's own office typed in: its customer is not ours to write to, and the office saw it done.
      const typed = placed(a.did, 'WS-DEL-2', 'Cement');
      carry(typed.freightId);
      await settle();
      expect(delivered(a.did)).toEqual([]);
      expect(delivered(own.did)).toEqual([]);
      expect(delivered(shipper)).toHaveLength(1);
    });

    /**
     * WHEN, ON THE TRACKING PAGE. The user, 2026-10-06: "Day always, time once on its way." The page is read by
     * anybody holding the link, and nobody tells them when a plan changes — so the day is there from the start, and
     * the hour only once the goods are on the road, from the plan they went out on.
     */
    it('shows whoever holds the link the day from the start, and about when only once the load is on the road', () => {
      const { a } = threeFleets();
      const own = onShift(a.did);
      const day = tomorrow();
      const placed = (ref: string) => dispatch.registerFreight({ description: 'Blocks', pickupLocation: yard, pickupLabel: 'Jenga yard', destLabel: 'Machakos junction', destLocation: site, weightKg: 2000, packaging: 'palletised', postedByDid: 'did:glos:jenga-bricks', postedByName: 'Wanjiru', contract: { contractId: 'ctr_ov', fleetDid: a.did, fleetName: a.name, shipperName: 'Jenga Bricks' }, deliverOn: day, orderRef: ref, deliveryWindow: '8-12' });
      const seen = (id: string) => notes.trackView(dispatch.listFreight().find((x) => x.freightId === id)!);
      const when = (id: string) => [seen(id).expectedOn, seen(id).expectedAbout];
      const stamp = (arrive: string, on = day) => ({ day: on, vehicleId: 'veh_1', plate: 'KPL 008T', tripNo: 1, seq: 1, arrive, window: '08:00 to 12:00', at: new Date().toISOString() });
      const plan = (id: string, arrive: string, on = day) => dispatch.stampPlan(a.did, day, new Map([[id, stamp(arrive, on)]]));
      const collect = (id: string) => {
        dispatch.assign(id, own.did, { managerDid: a.did, name: 'Amina' });
        const f = dispatch.listFreight().find((x) => x.freightId === id)!;
        dispatch.pickupFreight(id, own.did, { confirmed: requiredLoadKeys(f), securementPhotoId: photoBy(own.did) });
      };
      const hand = (id: string) => dispatch.deliverFreight(id, own.did, { confirmed: requiredUnloadKeys(), receiverName: 'Wanjiru at the gate', podPhotoId: photoBy(own.did) });

      const theirs = placed('WS-WHEN-1');
      // Ordered: the day, and no hour — planned or not. A plan can still be made again, and nobody would tell them.
      expect(when(theirs.freightId)).toEqual([day, undefined]);
      dispatch.stampPlan(a.did, day, new Map([[theirs.freightId, stamp('10:10')]]));
      expect(when(theirs.freightId)).toEqual([day, undefined]);
      // On its driver, not yet collected: still no hour.
      dispatch.assign(theirs.freightId, own.did, { managerDid: a.did, name: 'Amina' });
      expect(when(theirs.freightId)).toEqual([day, undefined]);
      // On the road: about when, from the plan it went out on.
      const f = dispatch.listFreight().find((x) => x.freightId === theirs.freightId)!;
      dispatch.pickupFreight(theirs.freightId, own.did, { confirmed: requiredLoadKeys(f), securementPhotoId: photoBy(own.did) });
      expect(when(theirs.freightId)).toEqual([day, '10:10']);
      // A door nobody answered: the plan's hour has passed, and is not shown as if it were still to come.
      dispatch.failDelivery(theirs.freightId, own.did, { outcome: 'absent' });
      expect(when(theirs.freightId)).toEqual([day, undefined]);
      // Delivered: nothing is expected any more; who received it is what the page says.
      hand(theirs.freightId);
      expect(when(theirs.freightId)).toEqual([undefined, undefined]);
      expect(seen(theirs.freightId).receiverName).toBe('Wanjiru at the gate');

      // Put on a driver by hand, in no plan: on the road, and no hour is made up.
      const byHand = placed('WS-WHEN-2');
      collect(byHand.freightId);
      expect(when(byHand.freightId)).toEqual([day, undefined]);
      hand(byHand.freightId);
      // A plan for another day than it was ordered for says nothing about the day it is expected.
      const otherDay = placed('WS-WHEN-3');
      plan(otherDay.freightId, '10:10', '2020-01-01');
      collect(otherDay.freightId);
      expect(when(otherDay.freightId)).toEqual([day, undefined]);
      hand(otherDay.freightId);
      // It missed its trip and went out by hand later: the hour of the trip it missed is not shown.
      const missed = placed('WS-WHEN-4');
      plan(missed.freightId, '10:10');
      dispatch.holdPlanned(missed.freightId, 'The truck is full');
      collect(missed.freightId);
      expect(when(missed.freightId)).toEqual([day, undefined]);
      hand(missed.freightId);
      // Withdrawn: it is not expected.
      const gone = placed('WS-WHEN-5');
      dispatch.cancelFreight(gone.freightId, { did: 'did:glos:jenga-bricks', role: 'shipper' }, 'Not needed any more');
      expect(when(gone.freightId)).toEqual([undefined, undefined]);
      // A load off the open board was ordered for no day: the page says nothing of one.
      const board = dispatch.registerFreight({ description: 'Sand', pickupLocation: yard, pickupLabel: 'Jenga yard', destLabel: 'Kitengela site', destLocation: site, weightKg: 500, packaging: 'palletised', postedByDid: 'did:glos:jenga-bricks' });
      expect(when(board.freightId)).toEqual([undefined, undefined]);
    });

    /**
     * ON THE CARRIER’S OWN CLOCK. The user, 2026-10-07: "so time zone first you say, that would work." With a clock,
     * two things can be said that could not: where a handover fell against the day and the window asked for — read at
     * the handover and kept — and that a load which should have arrived has not.
     */
    describe('on the carrier’s own clock', () => {
      const shipper = 'did:glos:jenga-bricks';
      const dayAfter = (day: string) => new Date(Date.parse(day + 'T12:00:00Z') + DAY).toISOString().slice(0, 10);
      const dayBefore = (day: string) => new Date(Date.parse(day + 'T12:00:00Z') - DAY).toISOString().slice(0, 10);
      // A moment on the carrier's clock, which is Nairobi's: three hours ahead of UTC, all year.
      const nairobi = (day: string, hhmm: string) => Date.parse(day + 'T' + hhmm + ':00+03:00');
      function aCarrier() {
        const { a } = threeFleets();
        const own = onShift(a.did);
        const day = tomorrow();
        const placed = (postedByDid: string, ref: string, window?: string) => dispatch.registerFreight({ description: 'Blocks', pickupLocation: yard, pickupLabel: 'Jenga yard', destLabel: 'Machakos junction', destLocation: site, weightKg: 2000, packaging: 'palletised', postedByDid, postedByName: 'Wanjiru', contract: { contractId: 'ctr_ov', fleetDid: a.did, fleetName: a.name, shipperName: 'Jenga Bricks' }, deliverOn: day, orderRef: ref, ...(window ? { deliveryWindow: window } : {}) });
        const handOver = (id: string, at: number) => {
          dispatch.assign(id, own.did, { managerDid: a.did, name: 'Amina' });
          const f = dispatch.listFreight().find((x) => x.freightId === id)!;
          // Taken over before it is handed over, at whatever hour the suite runs: a handover is never dated before its
          // pickup (round 22), so a pickup at the real time and a handover at 10:30 today read 10:30 only before 10:30.
          f.claimedAt = new Date(at - 2 * 3_600_000).toISOString();
          dispatch.pickupFreight(id, own.did, { confirmed: requiredLoadKeys(f), securementPhotoId: photoBy(own.did) }, at - 3_600_000);
          return dispatch.deliverFreight(id, own.did, { confirmed: requiredUnloadKeys(), receiverName: 'Wanjiru at the gate', podPhotoId: photoBy(own.did) }, at);
        };
        const row = (id: string, at?: number) => dispatch.postedBy(shipper, at).find((r) => r.freightId === id)!;
        const told = (kind: string) => notifications.inboxFor(shipper).filter((n) => n.kind === kind);
        const stamp = (arrive: string) => ({ day, vehicleId: 'veh_1', plate: 'KPL 008T', tripNo: 1, seq: 1, arrive, at: new Date().toISOString() });
        return { a, own, day, placed, handOver, row, told, stamp };
      }

      it('reads a handover against the window at the handover: inside it, after it, before it', async () => {
        const { day, placed, handOver, row, told } = aCarrier();
        const said = async (ref: string, hhmm: string) => {
          const o = placed(shipper, ref, '8-12');
          handOver(o.freightId, nairobi(day, hhmm));
          await settle();
          return { timing: row(o.freightId).deliveryTiming, body: told('freight_delivered').find((n) => n.title.startsWith(o.code))!.body };
        };
        const inside = await said('WS-CLK-1', '10:30');
        expect(inside.timing).toEqual({ timeZone: 'Africa/Nairobi', day, at: '10:30', window: '08:00–12:00' });
        expect(inside.body).toBe('Handed over at 10:30 to Wanjiru at the gate at Machakos junction: Blocks. That is inside the window you asked for (08:00–12:00).');
        // The last minute of the window is inside it; the minute after is one minute late.
        expect((await said('WS-CLK-2', '12:00')).timing).toEqual({ timeZone: 'Africa/Nairobi', day, at: '12:00', window: '08:00–12:00' });
        expect((await said('WS-CLK-3', '12:01')).timing).toMatchObject({ at: '12:01', lateMin: 1 });
        const late = await said('WS-CLK-4', '13:10');
        expect(late.timing).toEqual({ timeZone: 'Africa/Nairobi', day, at: '13:10', window: '08:00–12:00', lateMin: 70 });
        expect(late.body).toBe('Handed over at 13:10 to Wanjiru at the gate at Machakos junction: Blocks. That is 1 hour 10 minutes after the window you asked for (08:00–12:00).');
        const early = await said('WS-CLK-5', '07:10');
        expect(early.timing).toEqual({ timeZone: 'Africa/Nairobi', day, at: '07:10', window: '08:00–12:00', earlyMin: 50 });
        expect(early.body).toMatch(/That is 50 minutes before the window you asked for/);
        expect((await said('WS-CLK-6', '08:00')).timing).toEqual({ timeZone: 'Africa/Nairobi', day, at: '08:00', window: '08:00–12:00' });
      });

      it('reads the day before the window: on another day than it was ordered for, the hour is beside the point', async () => {
        const { day, placed, handOver, row, told } = aCarrier();
        const nextDay = placed(shipper, 'WS-CLK-7', '8-12');
        handOver(nextDay.freightId, nairobi(dayAfter(day), '10:30'));
        const dayEarly = placed(shipper, 'WS-CLK-8', '8-12');
        handOver(dayEarly.freightId, nairobi(dayBefore(day), '10:30'));
        await settle();
        expect(row(nextDay.freightId).deliveryTiming).toEqual({ timeZone: 'Africa/Nairobi', day: dayAfter(day), at: '10:30', otherDay: 'late', window: '08:00–12:00' });
        expect(row(dayEarly.freightId).deliveryTiming).toEqual({ timeZone: 'Africa/Nairobi', day: dayBefore(day), at: '10:30', otherDay: 'early', window: '08:00–12:00' });
        const body = (code: string) => told('freight_delivered').find((n) => n.title.startsWith(code))!.body;
        expect(body(nextDay.code)).toBe('Handed over at 10:30 to Wanjiru at the gate at Machakos junction: Blocks. It was ordered for ' + day + ' and arrived on ' + dayAfter(day) + '.');
        expect(body(dayEarly.code)).toBe('Handed over at 10:30 to Wanjiru at the gate at Machakos junction: Blocks. It was ordered for ' + day + ' and arrived early, on ' + dayBefore(day) + '.');
        // Half past midnight in Nairobi is the next day there, though in UTC it is still the evening of its day.
        const justAfter = placed(shipper, 'WS-CLK-9');
        handOver(justAfter.freightId, Date.parse(day + 'T21:30:00Z'));
        expect(row(justAfter.freightId).deliveryTiming).toEqual({ timeZone: 'Africa/Nairobi', day: dayAfter(day), at: '00:30', otherDay: 'late' });
      });

      it('claims nothing it did not read: no window, a window not written as hours, a carrier with no clock', async () => {
        const { a, day, placed, handOver, row, told } = aCarrier();
        const plain = placed(shipper, 'WS-CLK-10');
        handOver(plain.freightId, nairobi(day, '10:30'));
        const words = placed(shipper, 'WS-CLK-11', 'in the morning, call first');
        handOver(words.freightId, nairobi(day, '10:30'));
        await settle();
        expect(row(plain.freightId).deliveryTiming).toEqual({ timeZone: 'Africa/Nairobi', day, at: '10:30' });
        expect(row(words.freightId).deliveryTiming).toEqual({ timeZone: 'Africa/Nairobi', day, at: '10:30' });
        expect(told('freight_delivered').find((n) => n.title.startsWith(plain.code))!.body).toBe('Handed over at 10:30 to Wanjiru at the gate at Machakos junction: Blocks.');
        // A carrier in a country of several zones that has not chosen: no time is put on the wrong clock.
        managers.get(a.did).jurisdiction = 'CD';
        const noClock = placed(shipper, 'WS-CLK-12', '8-12');
        handOver(noClock.freightId, nairobi(day, '10:30'));
        await settle();
        expect(row(noClock.freightId).deliveryTiming).toBeUndefined();
        expect(told('freight_delivered').find((n) => n.title.startsWith(noClock.code))!.body).toBe('Handed over to Wanjiru at the gate at Machakos junction: Blocks.');
      });

      it('keeps what it read: the fleet changing its clock afterwards does not move a delivery', () => {
        const { a, day, placed, handOver, row } = aCarrier();
        const o = placed(shipper, 'WS-CLK-13', '8-12');
        handOver(o.freightId, nairobi(day, '10:30'));
        managers.setTimeZone(a.did, 'America/Los_Angeles');
        expect(row(o.freightId).deliveryTiming).toEqual({ timeZone: 'Africa/Nairobi', day, at: '10:30', window: '08:00–12:00' });
        // The carrier's own queue shows its own deliveries the same way.
        expect(dispatch.ordersForFleet(a.did).find((r) => r.freightId === o.freightId)!.deliveryTiming).toMatchObject({ at: '10:30' });
      });

      it('calls a load late once the hour its plan had it at the door is half an hour gone — or its whole day', () => {
        const { a, own, day, placed, row, stamp } = aCarrier();
        const o = placed(shipper, 'WS-CLK-14');
        const f = () => dispatch.listFreight().find((x) => x.freightId === o.freightId)!;
        const late = (hhmm: string, on = day) => dispatch.lateOf(f(), nairobi(on, hhmm));
        // In no plan: nothing is late by the hour. On its day it is on no vehicle, and then its day goes.
        expect([late('23:59'), late('00:00', dayAfter(day))]).toEqual(['unplanned', 'day']);
        dispatch.stampPlan(a.did, day, new Map([[o.freightId, stamp('10:40')]]));
        expect([late('10:40'), late('11:10'), late('11:11'), late('23:59')]).toEqual([undefined, undefined, 'hour', 'hour']);
        // The day before its day nothing is late, whatever the hour.
        expect(late('23:00', dayBefore(day))).toBeUndefined();
        expect(late('00:00', dayAfter(day))).toBe('day');
        // The shipper's list says the same at the moment it is read.
        expect([row(o.freightId, nairobi(day, '10:40')).runningLate, row(o.freightId, nairobi(day, '11:30')).runningLate, row(o.freightId, nairobi(dayAfter(day), '06:00')).runningLate]).toEqual([undefined, 'hour', 'day']);
        // It missed its trip: the hour of that trip says nothing any more. It is on no vehicle, and the day still will go.
        dispatch.holdPlanned(o.freightId, 'The truck is full');
        expect([late('12:00'), late('06:00', dayAfter(day))]).toEqual(['unplanned', 'day']);
        dispatch.holdPlanned(o.freightId, undefined);
        // Delivered or withdrawn, it is not late.
        dispatch.assign(o.freightId, own.did, { managerDid: a.did, name: 'Amina' });
        expect(late('12:00')).toBe('hour');
        dispatch.pickupFreight(o.freightId, own.did, { confirmed: requiredLoadKeys(f()), securementPhotoId: photoBy(own.did) });
        expect(late('12:00')).toBe('hour');
        dispatch.deliverFreight(o.freightId, own.did, { confirmed: requiredUnloadKeys(), receiverName: 'Wanjiru at the gate', podPhotoId: photoBy(own.did) }, nairobi(day, '12:30'));
        expect([late('13:00'), late('06:00', dayAfter(day))]).toEqual([undefined, undefined]);
        const gone = placed(shipper, 'WS-CLK-15');
        dispatch.cancelFreight(gone.freightId, { did: shipper, role: 'shipper' }, 'Not needed any more');
        expect(dispatch.lateOf(dispatch.listFreight().find((x) => x.freightId === gone.freightId)!, nairobi(dayAfter(day), '06:00'))).toBeUndefined();
        // A carrier with no clock is not judged on somebody else's.
        const other = placed(shipper, 'WS-CLK-16');
        managers.get(a.did).jurisdiction = 'CD';
        expect(dispatch.lateOf(dispatch.listFreight().find((x) => x.freightId === other.freightId)!, nairobi(dayAfter(day), '06:00'))).toBeUndefined();
      });

      it('tells the shipper when the day’s work has begun and its order is on no vehicle — the day nobody planned, the order placed after the plan', async () => {
        const { a, own, day, placed, row, told, stamp } = aCarrier();
        const f = (id: string) => dispatch.listFreight().find((x) => x.freightId === id)!;
        // Placed at noon the day before, on the carrier's clock: well over an hour before any of the moments below.
        const aged = (ref: string, postedByDid = shipper, at = nairobi(dayBefore(day), '12:00')) => {
          const o = placed(postedByDid, ref);
          f(o.freightId).createdAt = new Date(at).toISOString();
          return o;
        };
        const inNoPlan = aged('WS-CLK-30');
        const planned = aged('WS-CLK-31');
        const leftOut = aged('WS-CLK-32');
        aged('WS-CLK-33', a.did);
        const byHand = aged('WS-CLK-34');
        // The office accepts a plan: one order on a vehicle, one left out (and said so then); a third came too late for it.
        dispatch.stampPlan(a.did, day, new Map([[planned.freightId, stamp('16:00')]]), nairobi(dayBefore(day), '15:00'), new Map([[leftOut.freightId, 'no_time']]));
        dispatch.assign(byHand.freightId, own.did, { managerDid: a.did, name: 'Amina' });
        await settle();
        const leftOutTold = () => told('order_left_out').map((n) => n.title);
        const onVehicleTold = () => told('order_window').map((n) => n.title);
        expect(leftOutTold()).toEqual(['Kilima Logistics has not put ' + leftOut.code + ' on a vehicle for ' + day]);
        // Put on a driver by hand before anybody was told anything of it: nothing is said of that.
        expect(onVehicleTold()).toEqual([]);
        const late = (id: string, hhmm: string, on = day) => dispatch.lateOf(f(id), nairobi(on, hhmm));
        // The evening before, and through the night of its day: no office is at work, and nobody is woken to be told so.
        expect([late(inNoPlan.freightId, '23:59', dayBefore(day)), late(inNoPlan.freightId, '00:05'), late(inNoPlan.freightId, '06:59')]).toEqual([undefined, undefined, undefined]);
        expect(await dispatcher.sweepLate(nairobi(day, '06:59'))).toBe(0);
        // Seven, the hour a planned day starts: on no vehicle. Planned, or on a driver by hand, it is not.
        expect([late(inNoPlan.freightId, '07:00'), late(planned.freightId, '07:00'), late(byHand.freightId, '07:00'), late(leftOut.freightId, '07:00')]).toEqual(['unplanned', undefined, undefined, 'unplanned']);
        // Its shipper is told once — not the one who was told when the plan left its order out, not the carrier's own office.
        expect(await dispatcher.sweepLate(nairobi(day, '07:00'))).toBe(1);
        expect(leftOutTold()).toHaveLength(2);
        const said = told('order_left_out').find((n) => n.title.includes(inNoPlan.code))!;
        expect([said.title, said.body]).toEqual(['Kilima Logistics has not put ' + inNoPlan.code + ' on a vehicle, and it is for today', inNoPlan.code + ' was ordered for ' + day + '. The day’s work has begun, and Kilima Logistics has it on no vehicle. Speak to Kilima Logistics now.']);
        expect(notifications.inboxFor(a.did).some((n) => n.kind === 'order_left_out')).toBe(false);
        expect(await dispatcher.sweepLate(nairobi(day, '08:00'))).toBe(0);
        // The shipper's list says so too; the tracking page does not — that is between the shipper and the carrier.
        expect(row(inNoPlan.freightId, nairobi(day, '08:00')).runningLate).toBe('unplanned');
        expect(notes.trackView(f(inNoPlan.freightId), nairobi(day, '08:00')).late).toBeUndefined();

        // An order placed ON its day is left alone for its first hour, and said after it. One placed before the day's
        // work begins waits for both: the hour, and seven.
        const early = aged('WS-CLK-35', shipper, nairobi(day, '06:30'));
        const sameDay = aged('WS-CLK-36', shipper, nairobi(day, '09:00'));
        expect([late(early.freightId, '07:00'), late(early.freightId, '07:29'), late(early.freightId, '07:30')]).toEqual([undefined, undefined, 'unplanned']);
        expect([late(sameDay.freightId, '09:30'), late(sameDay.freightId, '09:59'), late(sameDay.freightId, '10:00')]).toEqual([undefined, undefined, 'unplanned']);
        expect(await dispatcher.sweepLate(nairobi(day, '09:59'))).toBe(1);
        expect(await dispatcher.sweepLate(nairobi(day, '10:00'))).toBe(1);

        // WHAT HAPPENS AFTER. It is planned after all: told by the clock that it was on no vehicle, its shipper is told
        // it is on one, and about when.
        dispatch.stampPlan(a.did, day, new Map([[planned.freightId, stamp('16:00')], [inNoPlan.freightId, stamp('13:00')]]), nairobi(day, '11:00'));
        await settle();
        expect(onVehicleTold()).toEqual(['Kilima Logistics now has ' + inNoPlan.code + ' on a vehicle for ' + day]);
        expect(late(inNoPlan.freightId, '12:00')).toBeUndefined();
        // Put on a driver by the office's own hand — after the clock said it was on none, and after a plan left it
        // out: each shipper is told, with no hour, because nothing planned one.
        dispatch.assign(early.freightId, own.did, { managerDid: a.did, name: 'Amina' });
        dispatch.assign(leftOut.freightId, own.did, { managerDid: a.did, name: 'Amina' });
        await settle();
        const byHandSaid = told('order_window').filter((n) => !n.title.includes(' for ' + day));
        expect(byHandSaid.map((n) => n.title).sort()).toEqual(['Kilima Logistics now has ' + early.code + ' on a vehicle', 'Kilima Logistics now has ' + leftOut.code + ' on a vehicle'].sort());
        expect(byHandSaid[0].body.endsWith(' on a vehicle. There is no planned hour for it; you are told when it is delivered.')).toBe(true);
        expect(byHandSaid.some((n) => n.body.includes('Amina') || n.body.includes(own.did))).toBe(false);
        // Said, and over: neither is on no vehicle any more, to the list or to the clock.
        expect([row(early.freightId, nairobi(day, '12:00')).runningLate, row(leftOut.freightId, nairobi(day, '12:00')).leftOut]).toEqual([undefined, undefined]);
        expect(await dispatcher.sweepLate(nairobi(day, '12:00'))).toBe(0);

        // The hour its plan gave it passes: told it is late. Then it misses its trip and is on no vehicle again — and
        // is not told that: never back down the ladder.
        expect(await dispatcher.sweepLate(nairobi(day, '14:00'))).toBe(1);
        expect(told('order_late').map((n) => n.title)).toEqual([inNoPlan.code + ' is running late']);
        dispatch.holdPlanned(inNoPlan.freightId, 'The truck is full');
        expect(late(inNoPlan.freightId, '15:00')).toBe('unplanned');
        expect(await dispatcher.sweepLate(nairobi(day, '15:00'))).toBe(0);
        // But one told it was on a vehicle, which then misses its trip before its hour, IS told: it believes it is coming.
        dispatch.stampPlan(a.did, day, new Map([[planned.freightId, stamp('16:00')], [inNoPlan.freightId, stamp('13:00')], [sameDay.freightId, stamp('17:00')]]), nairobi(day, '15:05'));
        await settle();
        expect(onVehicleTold()).toContain('Kilima Logistics now has ' + sameDay.code + ' on a vehicle for ' + day);
        dispatch.holdPlanned(sameDay.freightId, 'The truck is full');
        expect(await dispatcher.sweepLate(nairobi(day, '15:30'))).toBe(1);
        expect(leftOutTold().filter((t) => t.includes(sameDay.code))).toHaveLength(2);
        // The ladder goes up. What stopped it comes off, so it has its planned hour again; that hour passes, and it
        // is told — being told it was on no vehicle does not stand in the way of being told it is late.
        dispatch.holdPlanned(sameDay.freightId, undefined);
        expect([late(sameDay.freightId, '17:30'), late(sameDay.freightId, '17:31')]).toEqual([undefined, 'hour']);
        await dispatcher.sweepLate(nairobi(day, '17:31'));
        expect(told('order_late').map((n) => n.title)).toContain(sameDay.code + ' is running late');
        // And up again: its day goes. Each rung once.
        await dispatcher.sweepLate(nairobi(dayAfter(day), '00:01'));
        expect(told('order_late').filter((n) => n.title.startsWith(sameDay.code)).map((n) => n.title).sort()).toEqual([sameDay.code + ' did not arrive on ' + day, sameDay.code + ' is running late']);
        expect(await dispatcher.sweepLate(nairobi(dayAfter(day), '09:00'))).toBe(0);
      });

      it('tells the shipper a load is running late once for its hour and once more for its day — nobody else, and never twice', async () => {
        const { a, day, placed, told, stamp } = aCarrier();
        const theirs = placed(shipper, 'WS-CLK-17');
        const typed = placed(a.did, 'WS-CLK-18');
        const fine = placed(shipper, 'WS-CLK-19');
        dispatch.stampPlan(a.did, day, new Map([[theirs.freightId, stamp('10:40')], [typed.freightId, stamp('10:40')], [fine.freightId, stamp('16:00')]]));
        expect(await dispatcher.sweepLate(nairobi(day, '11:00'))).toBe(0);
        expect(await dispatcher.sweepLate(nairobi(day, '11:30'))).toBe(1);
        expect(told('order_late').map((n) => [n.title, n.body])).toEqual([[theirs.code + ' is running late', 'Kilima Logistics planned to be at the door about 10:40 and has not delivered it. It has not gone out yet. A plan’s time is an estimate; speak to Kilima Logistics if you need to know more.']]);
        // Swept again and again through the day: said once.
        expect(await dispatcher.sweepLate(nairobi(day, '11:40'))).toBe(0);
        expect(await dispatcher.sweepLate(nairobi(day, '15:00'))).toBe(0);
        // The other one's hour goes too, and each is said for itself.
        expect(await dispatcher.sweepLate(nairobi(day, '17:00'))).toBe(1);
        // The day goes: said once more for each, in the day's own words, and then never again.
        expect(await dispatcher.sweepLate(nairobi(dayAfter(day), '00:05'))).toBe(2);
        expect(told('order_late').find((n) => n.title === theirs.code + ' did not arrive on ' + day)!.body).toBe('It was ordered for that day, and Kilima Logistics has not delivered it. It has not gone out yet. Speak to Kilima Logistics now.');
        expect(await dispatcher.sweepLate(nairobi(dayAfter(day), '09:00'))).toBe(0);
        expect(await dispatcher.sweepLate(nairobi(dayAfter(dayAfter(day)), '09:00'))).toBe(0);
        expect(told('order_late')).toHaveLength(4);
        // The carrier's own office is told nothing about an order it typed in itself.
        expect(notifications.inboxFor(a.did).some((n) => n.kind === 'order_late')).toBe(false);
      });

      it('says where a late load is, and says the day straight away when nobody looked while its hour passed', async () => {
        const { a, own, day, placed, told, stamp } = aCarrier();
        const onRoad = placed(shipper, 'WS-CLK-20');
        const onDriver = placed(shipper, 'WS-CLK-21');
        dispatch.stampPlan(a.did, day, new Map([[onRoad.freightId, stamp('10:40')], [onDriver.freightId, stamp('10:50')]]));
        dispatch.assign(onRoad.freightId, own.did, { managerDid: a.did, name: 'Amina' });
        dispatch.pickupFreight(onRoad.freightId, own.did, { confirmed: requiredLoadKeys(dispatch.listFreight().find((x) => x.freightId === onRoad.freightId)!), securementPhotoId: photoBy(own.did) });
        dispatch.assign(onDriver.freightId, own.did, { managerDid: a.did, name: 'Amina' });
        expect(await dispatcher.sweepLate(nairobi(day, '12:00'))).toBe(2);
        const body = (code: string) => told('order_late').find((n) => n.title.startsWith(code))!.body;
        expect(body(onRoad.code)).toContain('has not delivered it. It is on the road. A plan’s time');
        expect(body(onDriver.code)).toContain('has not delivered it. It is with its driver and has not been collected yet. A plan’s time');
        // An order nobody swept for while its hour passed is told of its day, once — not of an hour that is history.
        const unseen = placed(shipper, 'WS-CLK-22');
        dispatch.stampPlan(a.did, day, new Map([[unseen.freightId, stamp('10:40')]]));
        expect(await dispatcher.sweepLate(nairobi(dayAfter(day), '08:00'))).toBe(3);
        expect(told('order_late').filter((n) => n.title.startsWith(unseen.code)).map((n) => n.title)).toEqual([unseen.code + ' did not arrive on ' + day]);
      });

      it('stops the tracking page saying "expected" of a day that is over, and says a passed hour only where the hour is shown', () => {
        const { a, own, day, placed, stamp } = aCarrier();
        const o = placed(shipper, 'WS-CLK-23');
        const seen = (hhmm: string, on = day) => {
          const v = notes.trackView(dispatch.listFreight().find((x) => x.freightId === o.freightId)!, nairobi(on, hhmm));
          return [v.expectedOn, v.expectedAbout, v.late];
        };
        dispatch.stampPlan(a.did, day, new Map([[o.freightId, stamp('10:40')]]));
        // Not on the road: the hour is not on the page, so its passing is not said either. The day going is.
        expect(seen('12:00')).toEqual([day, undefined, undefined]);
        expect(seen('06:00', dayAfter(day))).toEqual([day, undefined, 'day']);
        dispatch.assign(o.freightId, own.did, { managerDid: a.did, name: 'Amina' });
        dispatch.pickupFreight(o.freightId, own.did, { confirmed: requiredLoadKeys(dispatch.listFreight().find((x) => x.freightId === o.freightId)!), securementPhotoId: photoBy(own.did) });
        expect(seen('10:50')).toEqual([day, '10:40', undefined]);
        expect(seen('11:30')).toEqual([day, '10:40', 'hour']);
        expect(seen('06:00', dayAfter(day))).toEqual([day, '10:40', 'day']);
      });
    });

    /**
     * PASSED ON. The user, 2026-10-06, asked whether a partner that took an order may pass it on to a fleet of its
     * own: "Only if I allowed that partner". So it is a switch on the arrangement, the offering fleet's alone, off
     * until it is turned on — asked when the order is offered on AND when it is taken; one step and no further; and
     * every fleet in the chain sees who is carrying.
     */
    describe('passed on to a fleet of the partner’s own', () => {
      /** A offers to B and C. B has partners of its own: C, D — and A, which is never asked to take its own order back. */
      function chain() {
        const { a, b, c } = threeFleets();
        const d = aFleet('Delta Freight');
        for (const to of [a, c, d]) partners.link({ fleetDid: to.did, fleetName: to.name }, partners.invite({ fleetDid: b.did, fleetName: b.name }, { partnerName: to.name }, 'Baraka').code, 'Office');
        return { a, b, c, d };
      }
      const arrangement = (from: { did: string }, to: { did: string }) => partners.lists(from.did).offeringTo.find((p) => p.toFleetDid === to.did)!.partnershipId;
      const allow = (from: { did: string; name: string }, to: { did: string }, allowed = true) => overflow.setPassOn(from, arrangement(from, to), allowed);
      /** An order of A's that B has taken. */
      const takenBy = (a: { did: string; name: string }, b: { did: string; name: string }) => {
        const f = anOrder(a);
        overflow.offer(a, [f.freightId], 'Amina');
        overflow.answer(b, f.freightId, true, 'Baraka');
        return f;
      };
      const titles = (fleet: { did: string }) => notifications.inboxFor(fleet.did).map((n) => n.title);
      /** What the message with this title said — found by its title, not its place in the list. */
      const bodyOf = (fleet: { did: string }, title: RegExp) => notifications.inboxFor(fleet.did).find((n) => title.test(n.title))?.body ?? '';

      it('is the offering fleet’s to allow, partner by partner, and off until it does', () => {
        const { a, b, c, d } = chain();
        const f = takenBy(a, b);
        // Nothing said: no.
        expect(partners.lists(a.did).offeringTo.every((p) => !p.mayPassOn)).toBe(true);
        expect(overflow.passOn(b, [f.freightId], 'Baraka')).toMatchObject({ done: [], refused: [{ freightId: f.freightId, why: expect.stringMatching(/Kilima Logistics has not said its orders may be passed on/) }] });
        // Leave given to ANOTHER partner is not leave for this one.
        allow(a, c);
        expect(overflow.passOn(b, [f.freightId], 'Baraka').done).toEqual([]);
        // Nor is leave that ANOTHER fleet gave this partner, for that fleet's own orders.
        partners.link({ fleetDid: b.did, fleetName: b.name }, partners.invite({ fleetDid: d.did, fleetName: d.name }, { partnerName: b.name }, 'Dalia').code, 'Baraka');
        allow(d, b);
        expect(partners.mayPassOn(d.did, b.did)).toBe(true);
        expect(overflow.passOn(b, [f.freightId], 'Baraka')).toMatchObject({ done: [], refused: [{ why: expect.stringMatching(/Kilima Logistics has not said/) }] });
        // The partner cannot give itself leave: the arrangement is the other fleet's to change.
        expect(() => partners.setPassOn(b.did, arrangement(a, b), true)).toThrow(/No such partner/);
        expect(partners.mayPassOn(a.did, b.did)).toBe(false);

        expect(partners.view(allow(a, b))).toMatchObject({ mayPassOn: true, partnerName: 'Pwani Haulage' });
        const out = overflow.passOn(b, [f.freightId, 'frt_nonsense'], 'Baraka');
        expect(out.done).toEqual([f.code]);
        // To the partner's own partners — never back to the fleet the order came from.
        expect([...out.to].sort()).toEqual(['Delta Freight', 'Rift Carriers']);
        expect(out.refused).toEqual([{ freightId: 'frt_nonsense', why: 'No such order' }]);
        // An order that is not the partner's to pass on is "no such order", whoever asks.
        const own = anOrder(a);
        expect(overflow.passOn(b, [own.freightId], 'Baraka').refused[0].why).toBe('No such order');
        expect(overflow.passOn(a, [own.freightId], 'Amina').refused[0].why).toBe('No such order');
      });

      it('is on offer to the partner’s own partners — who see it comes from the partner, not where it was ordered or for whom', async () => {
        const { a, b, c, d } = chain();
        const driver = onShift(b.did);
        const f = takenBy(a, b);
        allow(a, b);
        expect(dispatch.contractOrdersForDay(b.did, tomorrow()).map((x) => x.freightId)).toEqual([f.freightId]);
        overflow.passOn(b, [f.freightId], 'Baraka');
        for (const third of [c, d]) {
          const row = rowFor(third.did, f.freightId)!;
          expect(row).toMatchObject({ role: 'offered', fromFleetName: 'Pwani Haulage', description: f.description, weightKg: 4000, destLabel: 'Kitengela site' });
          expect(row.contract).toMatchObject({ fleetName: 'Pwani Haulage', shipperName: 'Pwani Haulage', fleetDid: b.did });
          expect(JSON.stringify(row)).not.toContain('Jenga Bricks');
          expect(JSON.stringify(row)).not.toContain('Kilima');
          expect(JSON.stringify(row)).not.toContain('KL-07');
          // Each sees only itself on the offer.
          expect(row.handOn!.onward!.offeredTo).toEqual([{ fleetDid: third.did, fleetName: third.name }]);
        }
        // The partner sees its own offer whole; so does the fleet the order was ordered from, which allowed it.
        expect(rowFor(b.did, f.freightId)).toMatchObject({ role: 'partner', fromFleetName: 'Kilima Logistics' });
        expect(rowFor(b.did, f.freightId)!.handOn!.onward!.offeredTo.map((p) => p.fleetName).sort()).toEqual(['Delta Freight', 'Rift Carriers']);
        expect(rowFor(a.did, f.freightId)!.handOn).toMatchObject({ state: 'partner', partner: { fleetName: 'Pwani Haulage' }, onward: { by: 'Baraka' } });
        // While it is on offer it is in nobody's plan and goes on nobody's truck.
        expect(dispatch.contractOrdersForDay(b.did, tomorrow())).toEqual([]);
        expect(() => dispatch.assign(f.freightId, driver.did, { managerDid: b.did })).toThrow(/on offer to your partners/);
        expect(() => overflow.passOn(b, [f.freightId], 'Baraka')).not.toThrow();
        expect(overflow.passOn(b, [f.freightId], 'Baraka').refused[0].why).toMatch(/already on offer/);
        await settle();
        expect(titles(d)).toEqual(['Pwani Haulage offers you an order']);
        // Taking its offer back makes it the partner's to carry again, and the fleets that were asked are told.
        overflow.withdrawOffer(b, f.freightId);
        expect(rowFor(d.did, f.freightId)).toBeUndefined();
        expect(rowFor(b.did, f.freightId)!.handOn!.onward).toBeUndefined();
        expect(dispatch.assign(f.freightId, driver.did, { managerDid: b.did }).status).toBe('claimed');
        await settle();
        expect(titles(d)).toContain('Pwani Haulage took back an offer');
      });

      it('goes to the first of them to take it: carried by that fleet, seen by all three, and the first fleet is told', async () => {
        const { a, b, c, d } = chain();
        const f = takenBy(a, b);
        allow(a, b);
        overflow.passOn(b, [f.freightId], 'Baraka');
        overflow.answer(d, f.freightId, true, 'Dalia');
        expect(dispatch.carrierOfOrderId(f.freightId)).toBe(d.did);
        // The fleet carrying it: it came from the partner, and now it knows whose goods they are.
        expect(rowFor(d.did, f.freightId)).toMatchObject({ role: 'partner', fromFleetName: 'Pwani Haulage', contract: { shipperName: 'Jenga Bricks' }, orderRef: f.orderRef });
        // The partner that passed it on still sees it, and who has it.
        expect(rowFor(b.did, f.freightId)).toMatchObject({ role: 'passed', handOn: { state: 'partner', partner: { fleetName: 'Delta Freight' }, via: { fleetName: 'Pwani Haulage' } } });
        // So does the fleet it was ordered from — the whole chain.
        expect(rowFor(a.did, f.freightId)).toMatchObject({ role: 'own', handOn: { state: 'partner', partner: { fleetDid: d.did, fleetName: 'Delta Freight' }, via: { fleetDid: b.did, fleetName: 'Pwani Haulage' }, takenBy: 'Dalia' } });
        expect(rowFor(a.did, f.freightId)!.handOn!.onward).toBeUndefined();
        // The one that did not take it has nothing left to answer.
        expect(rowFor(c.did, f.freightId)).toBeUndefined();
        expect(() => overflow.answer(c, f.freightId, true, 'Chege')).toThrow(/No such offer/);
        // Whose queue, plan and tracking link it is.
        expect(dispatch.contractOrdersForDay(d.did, tomorrow()).map((x) => x.freightId)).toEqual([f.freightId]);
        expect(dispatch.contractOrdersForDay(b.did, tomorrow())).toEqual([]);
        expect(notes.trackView(dispatch.listFreight().find((x) => x.freightId === f.freightId)!).carrier).toEqual({ name: 'Delta Freight' });
        await settle();
        expect(titles(b)).toContain('Delta Freight took ' + f.code);
        expect(titles(a)).toContain('Pwani Haulage passed ' + f.code + ' on to Delta Freight');
        expect(bodyOf(a, /passed/)).toMatch(/Delta Freight carries it now, as you allowed/);
      });

      it('goes no further: the fleet it was passed on to carries it or gives it back', () => {
        const { a, b, c, d } = chain();
        const e = aFleet('Echo Trucks');
        partners.link({ fleetDid: e.did, fleetName: e.name }, partners.invite({ fleetDid: d.did, fleetName: d.name }, { partnerName: e.name }, 'Dalia').code, 'Office');
        const f = takenBy(a, b);
        allow(a, b);
        overflow.passOn(b, [f.freightId], 'Baraka');
        overflow.answer(d, f.freightId, true, 'Dalia');
        expect(overflow.passOn(d, [f.freightId], 'Dalia')).toMatchObject({ done: [], to: [] });
        // Even with every leave there could be, the order itself says it has gone its one step.
        expect(() => dispatch.passOnOffer(d.did, f.freightId, [{ fleetDid: e.did, fleetName: e.name }], 'Dalia')).toThrow(/Pwani Haulage passed this order on to you — carry it or give it back; it goes no further/);
        expect(rowFor(e.did, f.freightId)).toBeUndefined();
        expect(c.did).not.toBe(d.did);
      });

      it('comes back the way it went: given back by the third fleet it is the partner’s again, and by the partner, the first fleet’s', async () => {
        const { a, b, d } = chain();
        const f = takenBy(a, b);
        allow(a, b);
        overflow.passOn(b, [f.freightId], 'Baraka');
        overflow.answer(d, f.freightId, true, 'Dalia');
        overflow.handBack(d, f.freightId, 'No driver tomorrow');
        expect(dispatch.carrierOfOrderId(f.freightId)).toBe(b.did);
        expect(rowFor(d.did, f.freightId)).toBeUndefined();
        expect(rowFor(b.did, f.freightId)).toMatchObject({ role: 'partner', fromFleetName: 'Kilima Logistics', handedBack: { fleetName: 'Delta Freight', reason: 'No driver tomorrow' } });
        expect([rowFor(b.did, f.freightId)!.handOn!.via, rowFor(b.did, f.freightId)!.handOn!.onward]).toEqual([undefined, undefined]);
        // The first fleet sees its partner has it again. It was not given back to the first fleet, so that is not what its row says.
        expect(rowFor(a.did, f.freightId)!.handOn).toMatchObject({ state: 'partner', partner: { fleetName: 'Pwani Haulage' } });
        expect(rowFor(a.did, f.freightId)!.handedBack).toBeUndefined();
        await settle();
        expect(titles(b)).toContain('Delta Freight gave ' + f.code + ' back');
        expect(titles(a).some((t) => /gave/.test(t))).toBe(false);
        // And from the partner, as it always could.
        overflow.handBack(b, f.freightId, 'Cannot place it');
        expect(rowFor(a.did, f.freightId)).toMatchObject({ role: 'own', handedBack: { fleetName: 'Pwani Haulage', reason: 'Cannot place it' } });
        expect(rowFor(a.did, f.freightId)!.handOn).toBeUndefined();
        expect(rowFor(b.did, f.freightId)).toBeUndefined();
      });

      it('asks the first fleet’s leave again when the order is TAKEN — and with no answer, the answer is no', async () => {
        const { a, b, c, d } = chain();
        const f = takenBy(a, b);
        const id = arrangement(a, b);
        allow(a, b);
        overflow.passOn(b, [f.freightId], 'Baraka');
        // Leave withdrawn behind the offer's back (the switch itself, without the tidying-up that goes with it).
        partners.setPassOn(a.did, id, false);
        expect(() => overflow.answer(d, f.freightId, true, 'Dalia')).toThrow(/Kilima Logistics does not let Pwani Haulage pass its orders on — this offer has lapsed/);
        expect(dispatch.carrierOfOrderId(f.freightId)).toBe(b.did);
        // Leaving an offer needs nobody's leave.
        expect(() => overflow.answer(c, f.freightId, false, 'Chege')).not.toThrow();
        // Asked without anybody to answer for the first fleet: no.
        partners.setPassOn(a.did, id, true);
        expect(() => dispatch.answerOffer(d.did, f.freightId, true, 'Dalia')).toThrow(/this offer has lapsed/);
        expect(dispatch.carrierOfOrderId(f.freightId)).toBe(b.did);
        // With leave standing, it is taken.
        overflow.answer(d, f.freightId, true, 'Dalia');
        expect(dispatch.carrierOfOrderId(f.freightId)).toBe(d.did);
      });

      it('takes open offers back when the leave goes — by the switch, or with the arrangement — and leaves alone what is already being carried', async () => {
        const { a, b, c, d } = chain();
        const carried = takenBy(a, b);
        const open = takenBy(a, b);
        const also = takenBy(a, b);
        allow(a, b);
        overflow.passOn(b, [carried.freightId, open.freightId], 'Baraka');
        overflow.answer(d, carried.freightId, true, 'Dalia');
        await settle();
        allow(a, b, false);
        // The open offer is gone from the fleets that were asked; the partner holds the order as before.
        expect(rowFor(c.did, open.freightId)).toBeUndefined();
        expect(rowFor(d.did, open.freightId)).toBeUndefined();
        expect(rowFor(b.did, open.freightId)).toMatchObject({ role: 'partner' });
        expect(rowFor(b.did, open.freightId)!.handOn!.onward).toBeUndefined();
        // What was already passed on is being carried, and stays.
        expect(dispatch.carrierOfOrderId(carried.freightId)).toBe(d.did);
        await settle();
        expect(titles(c)).toContain('Pwani Haulage took back an offer');
        expect(titles(b)).toContain('Kilima Logistics no longer lets you pass its orders on');
        expect(bodyOf(b, /no longer lets/)).toMatch(/still yours to carry, or to give back/);

        // And the same when the two fleets part: the leave was part of the arrangement.
        allow(a, b);
        overflow.passOn(b, [also.freightId], 'Baraka');
        expect(rowFor(c.did, also.freightId)).toMatchObject({ role: 'offered' });
        overflow.endPartnership(b.did, arrangement(a, b), 'Baraka');
        expect(rowFor(c.did, also.freightId)).toBeUndefined();
        expect(dispatch.carrierOfOrderId(also.freightId)).toBe(b.did);
        expect(() => allow(a, b)).toThrow(/has ended/);
        // The leave was the arrangement's: it does not outlive it, whatever the record still says.
        expect(partners.lists(a.did).offeringTo.find((p) => p.toFleetDid === b.did)).toMatchObject({ status: 'ended', mayPassOn: true });
        expect(partners.mayPassOn(a.did, b.did)).toBe(false);
      });

      it('is still the partner’s when none of them takes it — and the partner is told that, not sent to the open board', async () => {
        const { a, b, c, d } = chain();
        const f = takenBy(a, b);
        allow(a, b);
        overflow.passOn(b, [f.freightId], 'Baraka');
        await settle();
        overflow.answer(c, f.freightId, false, 'Chege');
        expect(rowFor(b.did, f.freightId)!.handOn!.onward!.offeredTo.map((p) => p.fleetName)).toEqual(['Delta Freight']);
        expect(titles(b).some((t) => /No partner took/.test(t))).toBe(false);
        overflow.answer(d, f.freightId, false, 'Dalia');
        expect(rowFor(b.did, f.freightId)).toMatchObject({ role: 'partner', handOn: { state: 'partner', partner: { fleetName: 'Pwani Haulage' } } });
        expect(rowFor(b.did, f.freightId)!.handOn!.onward).toBeUndefined();
        expect(dispatch.contractOrdersForDay(b.did, tomorrow()).map((x) => x.freightId)).toEqual([f.freightId]);
        await settle();
        expect(titles(b)).toContain('No partner took ' + f.code);
        expect(bodyOf(b, /No partner took/)).toMatch(/still yours to carry — or to give back to the fleet you took it from/);
        expect(bodyOf(b, /No partner took/)).not.toMatch(/open board/);
        // The first fleet hears nothing of an offer that came to nothing.
        expect(titles(a).some((t) => /No partner took/.test(t))).toBe(false);
        // And it cannot be given back while its own offer to pass it on is still open: those fleets would be left
        // answering an offer that had ceased to exist.
        overflow.passOn(b, [f.freightId], 'Baraka');
        expect(() => overflow.handBack(b, f.freightId, 'No truck after all')).toThrow(/take that offer back before giving it back/);
        overflow.withdrawOffer(b, f.freightId);
        // The open board is the first fleet's alone.
        expect(overflow.release(b, [f.freightId], 'Baraka').refused[0].why).toMatch(/No such order/);
      });
    });

    it('cannot be taken back off the board once a carrier has it, nor by a fleet it was not ordered from', () => {
      const { a, b } = threeFleets();
      const outsider = onShift();
      const f = anOrder(a);
      overflow.release(a, [f.freightId], 'Amina');
      expect(() => overflow.takeBack(b, f.freightId)).toThrow(/No such order on the board/);
      // An outside carrier takes it off the board the ordinary way.
      const [offer] = dispatch.suggestNearby(outsider.did, yard, 50).filter((o) => o.ref === f.freightId);
      expect(offer).toBeTruthy();
      dispatch.claim(offer.offerId);
      expect(() => overflow.takeBack(a, f.freightId)).toThrow(/A carrier has it/);
      expect(rowFor(a.did, f.freightId)).toMatchObject({ status: 'claimed', driverName: outsider.displayName });
    });
  });
});
