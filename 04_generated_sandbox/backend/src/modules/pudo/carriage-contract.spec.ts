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

const DAY = 86_400_000;
const HOUR = 3_600_000;

/**
 * P1 — A FLEET THAT CARRIES UNDER A CONTRACT.
 *
 * The user, 2026-10-05: a webshop selling bricks has next-day orders carried by the fleet it has an agreement with,
 * and the fleet's office plans them. These pin the two halves: the contract and the code that links the shipper's
 * business to it (one holder, unguessable, every try limited, undoable), and the order itself — that fleet's, on no
 * market, put on a truck by that fleet's office alone, and late when its day has gone by.
 */
describe('a standing contract of carriage', () => {
  const contracts = () => new CarriageContractService();
  const FLEET = { did: 'did:glos:fleet-bricks', name: 'Kilima Logistics' };
  const SHOP = { entityId: 'biz_bricks', name: 'Jenga Bricks Ltd' };

  describe('the contract, and the code that links it', () => {
    it('is recorded by the fleet with the shipper’s name, and refuses dates that are not days', () => {
      const svc = contracts();
      expect(() => svc.create(FLEET, { shipperName: '  ' }, 'Amina')).toThrow(/Name who you carry for/);
      expect(() => svc.create(FLEET, { shipperName: 'Jenga', startsOn: '2026-02-30' }, 'Amina')).toThrow(/calendar day/);
      expect(() => svc.create(FLEET, { shipperName: 'Jenga', startsOn: '2026-11-01', endsOn: '2026-10-01' }, 'Amina')).toThrow(/cannot end before it starts/);
      const c = svc.create(FLEET, { shipperName: 'Jenga', reference: 'KL-2026-07', startsOn: '2026-10-01' }, 'Amina');
      expect(c).toMatchObject({ status: 'active', fleetName: 'Kilima Logistics', shipper: { name: 'Jenga' }, reference: 'KL-2026-07', createdBy: 'Amina' });
      expect(isDay('2026-02-28')).toBe(true);
      expect(isDay('2026-13-01')).toBe(false);
    });

    it('shows the code once, keeps only its hash, and a new code cancels the last', () => {
      const svc = contracts();
      const c = svc.create(FLEET, { shipperName: 'Jenga' }, 'Amina');
      const first = svc.issueInvite(FLEET.did, c.contractId);
      expect(first.code).toMatch(/^[A-HJ-NP-Z2-9]{5}-[A-HJ-NP-Z2-9]{5}$/);
      expect(JSON.stringify(first.contract)).not.toContain(first.code.replace('-', ''));
      expect(first.contract).not.toHaveProperty('invite');
      expect(first.contract.inviteExpiresAt).toBe(first.expiresAt);
      const second = svc.issueInvite(FLEET.did, c.contractId);
      expect(() => svc.link(SHOP, first.code, 'Baraka')).toThrow(/does not match/);
      // Typed by a person: lower case, no dash.
      const linked = svc.link(SHOP, second.code.toLowerCase().replace('-', ''), 'Baraka');
      expect(linked.shipper).toMatchObject({ entityId: SHOP.entityId, name: 'Jenga Bricks Ltd', linkedBy: 'Baraka' });
    });

    it('is single use, and dies with its fortnight', () => {
      const svc = contracts();
      const now = Date.now();
      const a = svc.create(FLEET, { shipperName: 'Jenga' }, 'Amina');
      const code = svc.issueInvite(FLEET.did, a.contractId, now).code;
      svc.link(SHOP, code, 'Baraka', now);
      expect(() => svc.link({ entityId: 'biz_other', name: 'Other' }, code, 'X', now)).toThrow(/does not match/);
      expect(() => svc.issueInvite(FLEET.did, a.contractId)).toThrow(/already linked/);

      const b = svc.create(FLEET, { shipperName: 'Late Ltd' }, 'Amina');
      const stale = svc.issueInvite(FLEET.did, b.contractId, now).code;
      expect(() => svc.link({ entityId: 'biz_late', name: 'Late Ltd' }, stale, 'Y', now + 15 * DAY)).toThrow(/does not match/);
    });

    it('limits wrong codes per business to five an hour — the right one included — and forgives after the hour', () => {
      const svc = contracts();
      const now = Date.now();
      const c = svc.create(FLEET, { shipperName: 'Jenga' }, 'Amina');
      const code = svc.issueInvite(FLEET.did, c.contractId, now).code;
      for (let i = 0; i < CONTRACT_LINK_TRIES_PER_HOUR; i++) expect(() => svc.link(SHOP, 'AAAAA-AAAAA', 'B', now + i)).toThrow(/does not match/);
      expect(() => svc.link(SHOP, code, 'B', now + 10)).toThrow(/Too many codes/);
      // Another business is not held back by this one's guessing.
      expect(() => svc.link({ entityId: 'biz_x', name: 'X' }, 'AAAAA-AAAAA', 'X', now + 10)).toThrow(/does not match/);
      expect(svc.link(SHOP, code, 'B', now + HOUR + 1).shipper.entityId).toBe(SHOP.entityId);
    });

    it('is the fleet’s or the shipper’s to read — nobody else’s id resolves', () => {
      const svc = contracts();
      const c = svc.create(FLEET, { shipperName: 'Jenga' }, 'Amina');
      svc.link(SHOP, svc.issueInvite(FLEET.did, c.contractId).code, 'B');
      expect(() => svc.requireForFleet('did:glos:other-fleet', c.contractId)).toThrow(/No such contract/);
      expect(() => svc.requireForShipper('biz_other', c.contractId)).toThrow(/No such contract/);
      expect(svc.forShipper(SHOP.entityId).map((x) => x.contractId)).toEqual([c.contractId]);
    });

    it('takes orders only while it stands and inside its period; ending it stops new ones', () => {
      const svc = contracts();
      const c = svc.create(FLEET, { shipperName: 'Jenga', startsOn: '2026-10-01', endsOn: '2026-12-31' }, 'Amina');
      expect(() => svc.orderable(c, '2026-09-30')).toThrow(/starts on 2026-10-01/);
      expect(() => svc.orderable(c, '2027-01-01')).toThrow(/ran until 2026-12-31/);
      expect(svc.orderable(c, '2026-10-06')).toMatchObject({ contractId: c.contractId, fleetDid: FLEET.did, shipperName: 'Jenga' });
      svc.end(c, 'shipper', 'Baraka', 'Moved to our own trucks');
      expect(c.ended).toMatchObject({ side: 'shipper', by: 'Baraka', reason: 'Moved to our own trucks' });
      expect(() => svc.orderable(c, '2026-10-06')).toThrow(/has ended/);
      expect(() => svc.end(c, 'fleet', 'Amina', undefined)).toThrow(/already ended/);
    });
  });

  /* ------------------------------------------------------------- the order -- */

  describe('an order under it', () => {
    let dispatch: DispatchService;
    let drivers: DriverService;
    let vehicles: VehicleService;
    let fleet: FleetService;
    let managers: FleetManagerService;
    let notes: ConsignmentNoteService;
    let events: EventBus;
    let seq = 0;

    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
          GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService,
          BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
          DriverService, FleetService, DispatchService, RouteConstraintService, MarketPulseStore, MarketPulseService, FleetManagerService,
          DepartureService, MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
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
      const none = {} as never;
      events = moduleRef.get(EventBus);
      notes = new ConsignmentNoteService(dispatch, drivers, managers, none as Agents, moduleRef.get(VendorService), events, none as ImportService);
    });

    function aFleet(name: string) {
      seq += 1;
      const m = managers.register({
        companyName: name, contactPhone: `+25480020${seq}0`, ownerFullName: 'O O', ownerNationalId: `MGR-CT-${seq}`,
        location: { lat: -1.2, lng: 36.8 },
        requirements: { businessRegistrationNo: `BRN-CT-${seq}`, transportOperatorLicence: `TOL-CT-${seq}`, taxId: `TAX-CT-${seq}` },
      });
      managers.submitKyc(m.did, { businessRegCertRef: 'reg.pdf', operatorLicenceRef: 'lic.pdf', ownerIdRef: 'id.pdf', proofOfAddressRef: 'addr.pdf' });
      managers.decideKyc(m.did, true);
      managers.recordBond(m.did);
      return managers.get(m.did);
    }

    /** A cleared truck driver of `managerDid`, on a shift in one of that fleet's trucks. */
    function onShift(managerDid?: string) {
      seq += 1;
      const d = drivers.register({
        displayName: `Driver ${seq}`, fullName: `D ${seq}`, nationalId: `ID-CT-${seq}`, mobile: `+2547820${seq}00`,
        licenceClasses: ['truck'], licenceNumber: `L-CT-${seq}`, licenceExpiresAt: new Date(Date.now() + 365 * DAY).toISOString(), criminalRecordClear: true,
        ...(managerDid ? { managerDid } : {}),
      });
      drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
      drivers.decideKyc(d.did, true);
      const truck = vehicles.register({ plate: `CT-${seq}`, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 20_000, ownerName: 'X', equipment: ['TLT', 'FLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, ...(managerDid ? { managerDid } : {}) } as never);
      fleet.couple(d.did, truck.vehicleId);
      return drivers.get(d.did);
    }

    const yard = { lat: -1.3, lng: 36.85 };
    const site = { lat: -1.25, lng: 36.9 };
    const tomorrow = () => new Date(Date.now() + DAY).toISOString().slice(0, 10);
    const order = (contract: ContractRef, deliverOn = tomorrow()) =>
      dispatch.registerFreight({ description: 'Bricks, 4 pallets', pickupLocation: yard, pickupLabel: 'Jenga yard', destLabel: 'Kitengela site', destLocation: site, weightKg: 4000, packaging: 'palletised', postedByDid: 'did:glos:biz-bricks', postedByName: 'Baraka', contract, deliverOn, commitMode: 'negotiate' });
    const refFor = (fleetDid: string, fleetName: string): ContractRef => ({ contractId: 'ctr_test', fleetDid, fleetName, shipperName: 'Jenga Bricks Ltd' });

    it('is ordered, not available: settled between the parties, for a day, and pings nobody', () => {
      const kilima = aFleet('Kilima Logistics');
      const told = jest.spyOn(events, 'publish');
      const f = order(refFor(kilima.did, kilima.companyName));
      // Nobody nearby is told a load has been posted: it is not for whoever is nearby. (The same call for an open load IS.)
      expect(told.mock.calls.filter(([name]) => name === GlosEvent.Pudo.FreightPosted)).toHaveLength(0);
      dispatch.registerFreight({ description: 'open', pickupLocation: yard, pickupLabel: 'a', destLabel: 'b', weightKg: 10 });
      expect(told.mock.calls.filter(([name]) => name === GlosEvent.Pudo.FreightPosted)).toHaveLength(1);
      expect(f).toMatchObject({ status: 'ordered', settlement: 'between_parties', deliverOn: tomorrow(), contract: { fleetDid: kilima.did } });
      // Posted with the form's 'negotiate' left on: the price is the contract's, so it is never negotiable, or it could not be assigned.
      expect(f.commitMode).toBeUndefined();
      expect(() => dispatch.registerFreight({ description: 'x', pickupLocation: yard, pickupLabel: 'a', destLabel: 'b', weightKg: 10, contract: refFor(kilima.did, 'K') })).toThrow(/which day it must arrive/);
    });

    it('is on no board, no market, no list of offers and no market series — for any driver, its own fleet’s included', () => {
      const kilima = aFleet('Kilima Logistics');
      const own = onShift(kilima.did);
      const outsider = onShift();
      const window = { since: Date.now() - DAY, until: Date.now() + DAY };
      const before = JSON.stringify(dispatch.marketSeries(window));
      const f = order(refFor(kilima.did, kilima.companyName));
      for (const d of [own, outsider]) {
        expect(dispatch.board({ driverDid: d.did, from: yard }).map((r) => r.freightId)).not.toContain(f.freightId);
        expect(JSON.stringify(dispatch.suggestNearby(d.did, yard, 50))).not.toContain(f.freightId);
        expect(() => dispatch.propose({ freightId: f.freightId, driverDid: d.did, from: yard, price: 100 })).toThrow();
      }
      expect(dispatch.publicMarket({ from: yard })).toHaveLength(0);
      expect(JSON.stringify(dispatch.marketSeries(window))).toBe(before);
    });

    it('goes on a truck by the office of the fleet it was ordered from, and by nobody else', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const own = onShift(kilima.did);
      const rival = onShift(pwani.did);
      const f = order(refFor(kilima.did, kilima.companyName));
      expect(() => dispatch.assign(f.freightId, rival.did, { managerDid: pwani.did })).toThrow(/only the fleet it was ordered from/);
      expect(dispatch.listFreight().find((x) => x.freightId === f.freightId)!.status).toBe('ordered');
      const taken = dispatch.assign(f.freightId, own.did, { managerDid: kilima.did, name: 'Amina' });
      expect(taken).toMatchObject({ status: 'claimed', claimedBy: own.did, assignedBy: { managerDid: kilima.did, name: 'Amina' } });
      // And the queue says who has it and in which truck — before pickup, the one its driver is out in now.
      const row = dispatch.ordersForFleet(kilima.did).find((r) => r.freightId === f.freightId)!;
      expect(row).toMatchObject({ status: 'claimed', driverName: own.displayName });
      expect(row.plate).toMatch(/^CT-/);
    });

    it('is in its fleet’s queue by delivery day, says when it is late, and is in no other fleet’s', () => {
      const kilima = aFleet('Kilima Logistics');
      const pwani = aFleet('Pwani Haulage');
      const later = order(refFor(kilima.did, kilima.companyName), new Date(Date.now() + 2 * DAY).toISOString().slice(0, 10));
      const sooner = order(refFor(kilima.did, kilima.companyName));
      const rows = dispatch.ordersForFleet(kilima.did);
      expect(rows.map((r) => r.freightId)).toEqual([sooner.freightId, later.freightId]);
      expect(rows[0]).toMatchObject({ status: 'ordered', late: false, postedByName: 'Baraka', packaging: 'palletised', contract: { shipperName: 'Jenga Bricks Ltd' } });
      expect(rows[0].trackingUrl).toContain(`?track=${sooner.trackingKey}`);
      expect(dispatch.ordersForFleet(pwani.did)).toHaveLength(0);
      // Two days on, tomorrow's order is behind its day and has not arrived.
      expect(dispatch.ordersForFleet(kilima.did, {}, Date.now() + 2 * DAY)[0].late).toBe(true);
      expect(dispatch.ordersForFleet(kilima.did, { from: rows[1].deliverOn }).map((r) => r.freightId)).toEqual([later.freightId]);
    });

    it('tracks from the moment it is ordered, with the fleet named as its carrier', () => {
      const kilima = aFleet('Kilima Logistics');
      const f = order(refFor(kilima.did, kilima.companyName));
      const view = notes.trackView(f);
      expect(view.steps[0].status).toBe('ordered');
      expect(view.carrier).toEqual({ name: 'Kilima Logistics' });
    });

    it('can still be withdrawn by whoever ordered it while it waits in the queue', () => {
      const kilima = aFleet('Kilima Logistics');
      const f = order(refFor(kilima.did, kilima.companyName));
      expect(dispatch.cancelFreight(f.freightId, { did: 'did:glos:biz-bricks', role: 'shipper' }, 'Customer changed the date').status).toBe('cancelled');
    });
  });
});
