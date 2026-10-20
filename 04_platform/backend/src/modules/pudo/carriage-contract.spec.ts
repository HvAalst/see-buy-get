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
    let geocoder: Geocoder;
    let seq = 0;

    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        providers: [
          AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
          GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService, BagClosureService,
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
      geocoder = moduleRef.get<Geocoder>(GEOCODER);
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
      expect(() => dispatch.assign(f.freightId, rival.did, { managerDid: pwani.did })).toThrow(/only the fleet carrying it/);
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

    /* ------------------------------------------------------ a sheet of orders -- */

    /**
     * P1b — THE FLEET UPLOADS A SHEET. Checked first (every line judged, nothing created), then imported: the good
     * lines become orders, the rest are left out and said why. The shipper's order number makes sending it twice
     * harmless, and an address the map does not know is imported without a point rather than with a made-up one.
     */
    describe('a sheet of orders the fleet uploads', () => {
      const tomorrowIso = () => new Date(Date.now() + DAY).toISOString().slice(0, 10);
      const HEAD = 'Order number,Goods,Weight,Deliver to,Date';
      const setUp = () => {
        const kilima = aFleet('Kilima Logistics');
        const svc = new CarriageContractService();
        const contract = svc.create({ did: kilima.did, name: kilima.companyName }, { shipperName: 'Jenga Bricks' }, 'Amina');
        const imports = new OrderImportService(dispatch, svc, geocoder);
        const fleetRef = { did: kilima.did, name: kilima.companyName };
        const pickup = { pickupLabel: 'Jenga yard', pickupLocation: yard };
        const run = (text: string, dryRun: boolean, where: { pickupLabel?: string; pickupLocation?: { lat: number; lng: number } } = pickup) => imports.run(fleetRef, contract, { text, ...where }, 'Amina', dryRun);
        return { kilima, svc, contract, imports, run };
      };

      it('reads the workbook itself — Excel’s own file: the first sheet, named; each bad line by the number Excel shows', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const workbook: Buffer = require('node:fs').readFileSync(require('node:path').join(__dirname, 'fixtures', 'orders-from-excel.xlsx'));
        const { kilima, contract, imports } = setUp();
        const fleetRef = { did: kilima.did, name: kilima.companyName };
        const where = { pickupLabel: 'Jenga yard', pickupLocation: yard };
        const checked = imports.run(fleetRef, contract, { workbook, ...where }, 'Amina', true);
        expect(checked).toMatchObject({ imported: false, ok: 4, problems: 1, duplicates: 0, sheet: 'Orders', otherSheets: ['Prices'], ignored: ['Internal code'] });
        expect(checked.columns).toMatchObject({ reference: 'Order number', weightKg: 'Weight (kg)', deliverOn: 'Delivery date' });
        // Line 4 of the workbook is empty, so the bad line is the one Excel numbers 7 — not the sixth it happens to be.
        expect(checked.rows.filter((r) => r.verdict === 'problem')).toEqual([expect.objectContaining({ line: 7, problems: ['No order number', '"heavy" is not a weight'] })]);
        expect(dispatch.ordersForFleet(kilima.did)).toHaveLength(0);

        const done = imports.run(fleetRef, contract, { workbook, ...where }, 'Amina', false);
        expect(done).toMatchObject({ imported: true, ok: 4, sheet: 'Orders' });
        const made = dispatch.ordersForFleet(kilima.did);
        expect(made.map((o) => [o.orderRef, o.weightKg, o.deliverOn]).sort()).toEqual([
          ['10432', 3030, '2031-03-10'],
          ['WS-2001', 4000, '2031-03-09'],
          ['WS-2003', 1200, '2031-03-11'],
          ['WS-2004', 2200, '2031-03-12'],
        ]);
        // Sent again, the workbook is as harmless as a sheet sent twice.
        expect(imports.run(fleetRef, contract, { workbook, ...where }, 'Amina', false)).toMatchObject({ ok: 0, duplicates: 4 });
        expect(dispatch.ordersForFleet(kilima.did)).toHaveLength(4);

        // A file the reader refuses is the sheet's refusal, in the reader's words; and it is one or the other, not both.
        expect(imports.run(fleetRef, contract, { workbook: Buffer.from('Order number,Goods'), ...where }, 'Amina', true)).toMatchObject({ refusal: expect.stringMatching(/not an Excel workbook/), rows: [], ok: 0 });
        expect(() => imports.run(fleetRef, contract, { workbook, text: 'Order number,Goods', ...where }, 'Amina', true)).toThrow(/as text or as a workbook, not both/);
        expect(imports.run(fleetRef, contract, { ...where }, 'Amina', true)).toMatchObject({ refusal: 'The sheet is empty' });
      });

      it('checks first and creates nothing; then imports, and each order is the shipper’s, uploaded by the office', () => {
        const { kilima, contract, run } = setUp();
        const sheet = [HEAD, `WS-1,"Bricks, 4 pallets",4000,Nairobi,${tomorrowIso()}`, `WS-2,Cement,1.5 t,Nairobi,${tomorrowIso()}`].join('\n');
        const checked = run(sheet, true);
        expect(checked).toMatchObject({ imported: false, ok: 2, duplicates: 0, problems: 0 });
        expect(checked.rows.every((r) => r.code === undefined)).toBe(true);
        expect(dispatch.ordersForFleet(kilima.did)).toHaveLength(0);
        // A check remembers nothing either: the collection point is kept by an import.
        expect(contract.pickup).toBeUndefined();

        const done = run(sheet, false);
        expect(done).toMatchObject({ imported: true, ok: 2 });
        expect(done.rows.map((r) => r.code)).toEqual([expect.stringMatching(/^FRT-/), expect.stringMatching(/^FRT-/)]);
        const queue = dispatch.ordersForFleet(kilima.did);
        expect(queue).toHaveLength(2);
        expect(queue[0]).toMatchObject({ status: 'ordered', orderRef: 'WS-1', uploaded: true, postedByName: 'Amina', pickupLabel: 'Jenga yard', weightKg: 4000, contract: { shipperName: 'Jenga Bricks' } });
        expect(queue[1].weightKg).toBe(1500);
        expect(contract.pickup).toEqual({ label: 'Jenga yard', location: yard });
        // On the consignment note the SHIPPER is the sender — never the fleet that typed its customer's order in.
        const freight = dispatch.listFreight().find((x) => x.freightId === queue[0].freightId)!;
        expect(notes.build(freight).sender.name).toBe('Jenga Bricks');
      });

      it('leaves an order number it already has exactly as it is — the same sheet twice changes nothing', () => {
        const { kilima, run } = setUp();
        const sheet = [HEAD, `WS-1,Bricks,4000,Nairobi,${tomorrowIso()}`].join('\n');
        run(sheet, false);
        const again = run([HEAD, `ws-1,Bricks CHANGED,9999,Nairobi,${tomorrowIso()}`, `WS-2,Sand,500,Nairobi,${tomorrowIso()}`].join('\n'), false);
        expect(again.rows.map((r) => r.verdict)).toEqual(['duplicate', 'ok']);
        expect(again).toMatchObject({ ok: 1, duplicates: 1 });
        const queue = dispatch.ordersForFleet(kilima.did);
        expect(queue.map((o) => [o.orderRef, o.weightKg])).toEqual([
          ['WS-1', 4000],
          ['WS-2', 500],
        ]);
      });

      it('imports the good lines and says in words what is wrong with the others', () => {
        const { kilima, run } = setUp();
        const done = run([HEAD, `WS-1,Bricks,4000,Nairobi,${tomorrowIso()}`, `WS-2,Sand,heavy,Nairobi,${tomorrowIso()}`, ',Tiles,10,Nairobi,2020-01-01'].join('\n'), false);
        expect(done.rows.map((r) => [r.line, r.verdict])).toEqual([
          [2, 'ok'],
          [3, 'problem'],
          [4, 'problem'],
        ]);
        expect(done.rows[1].problems).toEqual(['"heavy" is not a weight']);
        expect(done.rows[2].problems).toEqual(['No order number', '2020-01-01 has gone by']);
        expect(dispatch.ordersForFleet(kilima.did).map((o) => o.orderRef)).toEqual(['WS-1']);
      });

      it('gives an address the map knows a point, and one it does not NO point — never a made-up one', () => {
        const { kilima, run } = setUp();
        expect(geocoder.geocode('Nairobi').confidence).not.toBe('fallback');
        expect(geocoder.geocode('Plot 12 behind the blue kiosk zzqx').confidence).toBe('fallback');
        const done = run([`${HEAD},Lat,Lng`, `WS-1,Bricks,400,Nairobi,${tomorrowIso()},,`, `WS-2,Bricks,400,Plot 12 behind the blue kiosk zzqx,${tomorrowIso()},,`, `WS-3,Bricks,400,Plot 12 behind the blue kiosk zzqx,${tomorrowIso()},-1.25,36.9`].join('\n'), false);
        expect(done.rows.map((r) => [r.verdict, r.located])).toEqual([
          ['ok', true],
          ['ok', false],
          ['ok', true],
        ]);
        expect(done.unlocated).toBe(1);
        const queue = dispatch.ordersForFleet(kilima.did);
        expect(queue.find((o) => o.orderRef === 'WS-2')!.destLocation).toBeUndefined();
        expect(queue.find((o) => o.orderRef === 'WS-3')!.destLocation).toEqual({ lat: -1.25, lng: 36.9 });
        // The office pins the one the map did not know — its own upload only, and nobody else's order.
        const unpinned = queue.find((o) => o.orderRef === 'WS-2')!;
        const pwani = aFleet('Pwani Haulage');
        expect(() => dispatch.pinOrderDestination(pwani.did, unpinned.freightId, site)).toThrow(/No such order/);
        expect(() => dispatch.pinOrderDestination(kilima.did, unpinned.freightId, { lat: 120, lng: 0 })).toThrow(/latitude and a longitude/);
        dispatch.pinOrderDestination(kilima.did, unpinned.freightId, site);
        expect(dispatch.ordersForFleet(kilima.did).find((o) => o.orderRef === 'WS-2')!.destLocation).toEqual(site);
        const byShipper = order(refFor(kilima.did, kilima.companyName));
        expect(() => dispatch.pinOrderDestination(kilima.did, byShipper.freightId, site)).toThrow(/theirs to say/);
      });

      it('needs a collection point — the upload’s, or the line’s own — and refuses a line with neither', () => {
        const { run } = setUp();
        const bare = run([HEAD, `WS-1,Bricks,400,Nairobi,${tomorrowIso()}`].join('\n'), true, {});
        expect(bare.rows[0]).toMatchObject({ verdict: 'problem', problems: ['No collection point — name where the goods are collected for this sheet'] });
        const own = run([`${HEAD},Collect from,Pickup lat,Pickup lng`, `WS-1,Bricks,400,Nairobi,${tomorrowIso()},North yard,-1.3,36.8`].join('\n'), true, {});
        expect(own.rows[0].verdict).toBe('ok');
        // A name with no coordinates is only good where the map knows it.
        const named = run([`${HEAD},Collect from`, `WS-1,Bricks,400,Nairobi,${tomorrowIso()},Yard zzqx nobody knows`].join('\n'), true, {});
        expect(named.rows[0].problems[0]).toMatch(/not a collection point the map knows/);
      });

      it('holds each line to the contract’s own period, and the whole sheet to the contract standing and being this fleet’s', () => {
        const { kilima, svc, imports, contract } = setUp();
        const pwani = aFleet('Pwani Haulage');
        const dated = svc.create({ did: kilima.did, name: 'Kilima Logistics' }, { shipperName: 'Short Ltd', endsOn: tomorrowIso() }, 'Amina');
        const late = new Date(Date.now() + 5 * DAY).toISOString().slice(0, 10);
        const r = imports.run({ did: kilima.did, name: 'Kilima Logistics' }, dated, { text: [HEAD, `S-1,Bricks,400,Nairobi,${late}`].join('\n'), pickupLabel: 'Yard', pickupLocation: yard }, 'Amina', true);
        expect(r.rows[0]).toMatchObject({ verdict: 'problem' });
        expect(r.rows[0].problems[0]).toMatch(/ran until/);
        const sheet = [HEAD, `WS-1,Bricks,400,Nairobi,${tomorrowIso()}`].join('\n');
        expect(() => imports.run({ did: pwani.did, name: 'Pwani Haulage' }, contract, { text: sheet }, 'X', true)).toThrow(/No such contract/);
        svc.end(contract, 'fleet', 'Amina', undefined);
        expect(() => imports.run({ did: kilima.did, name: 'Kilima Logistics' }, contract, { text: sheet }, 'Amina', true)).toThrow(/has ended/);
      });

      it('refuses a sheet it cannot read as a whole, and creates nothing from it', () => {
        const { kilima, run } = setUp();
        const r = run('Order number,Goods\nWS-1,Bricks', false);
        expect(r.refusal).toMatch(/no column for the weight/);
        expect(r).toMatchObject({ imported: false, rows: [] });
        expect(dispatch.ordersForFleet(kilima.did)).toHaveLength(0);
      });

      it('lets the office withdraw what it uploaded — and only that; the number is then free to be sent again', () => {
        const { kilima, contract, run } = setUp();
        const pwani = aFleet('Pwani Haulage');
        const sheet = [HEAD, `WS-1,Bricks,400,Nairobi,${tomorrowIso()}`].join('\n');
        run(sheet, false);
        const uploaded = dispatch.ordersForFleet(kilima.did)[0];
        const byShipper = order({ contractId: contract.contractId, fleetDid: kilima.did, fleetName: kilima.companyName, shipperName: 'Jenga Bricks' });
        expect(() => dispatch.withdrawUploadedOrder(kilima.did, byShipper.freightId, 'We cannot carry it')).toThrow(/theirs to withdraw/);
        expect(() => dispatch.withdrawUploadedOrder(pwani.did, uploaded.freightId, 'Not ours')).toThrow(/No such order/);
        expect(() => dispatch.withdrawUploadedOrder(kilima.did, uploaded.freightId, '')).toThrow(/Say why/);
        const gone = dispatch.withdrawUploadedOrder(kilima.did, uploaded.freightId, 'Uploaded twice by mistake');
        expect(gone.status).toBe('cancelled');
        // The tracking page says the CARRIER withdrew it: the shipper did not.
        expect(notes.trackView(gone).cancelled).toMatchObject({ by: 'carrier' });
        expect(run(sheet, true).rows[0].verdict).toBe('ok');
      });
    });
  });
});
