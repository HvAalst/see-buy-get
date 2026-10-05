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
    let seq = 0;
    const settle = async () => {
      for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
    };

    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
          GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService,
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
      new NotificationDispatcher(events, notifications, moduleRef.get(ParcelService), moduleRef.get(PersonService), moduleRef.get(AgentService), fleet, moduleRef.get(ToteService), moduleRef.get(MdpService), dispatch, { sweep: () => [] } as unknown as UnclaimedService, moduleRef.get(VendorService)).onModuleInit();
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
    const tomorrow = () => new Date(Date.now() + DAY).toISOString().slice(0, 10);
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
      expect(out).toMatchObject({ done: [f.code, g.code], to: ['Pwani Haulage', 'Rift Carriers'] });
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
      expect(rowFor(a.did, f.freightId)!.handOn).toMatchObject({ state: 'offered', offeredTo: [{ fleetName: 'Pwani Haulage' }, { fleetName: 'Rift Carriers' }] });
      expect(rowFor(a.did, f.freightId)).toMatchObject({ role: 'own', handOn: { state: 'offered', by: 'Amina', offeredTo: [{ fleetName: 'Pwani Haulage' }, { fleetName: 'Rift Carriers' }] } });
      // One message a partner for the batch — not one an order.
      await settle();
      expect(heard).toEqual([expect.objectContaining({ what: 'offered', count: 2, weightKg: 6000, days: [tomorrow()], toFleetDids: [b.did, c.did] })]);
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
