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
import { FleetService, HOURS_NEAR_LIMIT_H, MAX_ON_DUTY_HOURS, MIN_REST_HOURS, REST_NOTICE_LATE_MS } from './fleet.service';
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
import { PersonService } from './person.service';
import { NotificationService } from './notification.service';
import { NotificationDispatcher } from './notification-dispatcher.service';
import { UnclaimedService } from './unclaimed.service';
import { ReturnService } from './return.service';
import { OutboxPushSender } from './push-sender';
import { PUSH_SENDER } from './notification.types';
import { GazetteerGeocoder, GEOCODER } from './geocoder';
import { HeuristicRouter, ROUTER } from './router';
import { DigitalTwinService } from '../m7/digital-twin.service';
import { TrackingService } from '../m4/tracking.service';
import { TrackingContextService } from '../m4/tracking-context.service';
import { NormalizationService } from '../m4/normalization.service';
import { ConnectorRegistry, MobileSdkConnector, RestCarrierConnector } from '../m4/connectors/connectors';
import { WalletService } from '../m1/wallet/wallet.service';
import { DidService } from '../../foundation/did/did.service';
import { AuthService } from '../../foundation/auth/auth.service';
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
import { PayoutService } from '../../foundation/payouts/payout.service';
import { SandboxPayoutRail } from '../../foundation/payouts/sandbox-rail.adapter';
import { PAYOUT_RAIL } from '../../foundation/payouts/payout.types';

/**
 * A DRIVER IS TOLD ABOUT THEIR HOURS — by the clock, on the real fleet, driver, vehicle and notification services,
 * and read where it arrives: the driver's inbox, and their office's.
 *
 * The user's question, and the answer was no: "Nothing TELLS a driver they have hit the shift limit, or that their
 * rest is over." Everything about the limit waited to be asked — a line on the home screen, a marked row on the
 * board, offers that dried up, a claim that was refused. A driver at the wheel learned of it by being turned away.
 */
describe('a driver is told about their hours, by the clock', () => {
  let fleet: FleetService;
  let drivers: DriverService;
  let vehicles: VehicleService;
  let managers: FleetManagerService;
  let notifications: NotificationService;
  let dispatcher: NotificationDispatcher;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        AgentService, WalletGateService, CorridorService, ParcelService, MonitorService, RatingService,
        GraduationService, VendorService, VendorCallbackService, ShelfService, RoutingService, MdpService, BagClosureService,
        BagPlanService, ForthcomingService, DockService, ToteService, ConsignmentService, VehicleService,
        DriverService, FleetService, DispatchService, RouteConstraintService, MarketPulseStore, MarketPulseService, FleetManagerService,
        PersonService, AuthService,
        NotificationService, OutboxPushSender, { provide: PUSH_SENDER, useExisting: OutboxPushSender },
        NotificationDispatcher, UnclaimedService, ReturnService,
        MediaService, CargoService, DigitalTwinService, TrackingService, TrackingContextService, NormalizationService,
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
    fleet = moduleRef.get(FleetService);
    drivers = moduleRef.get(DriverService);
    vehicles = moduleRef.get(VehicleService);
    managers = moduleRef.get(FleetManagerService);
    notifications = moduleRef.get(NotificationService);
    dispatcher = moduleRef.get(NotificationDispatcher);
  });

  afterEach(() => dispatcher.onModuleDestroy());

  const H = 3_600_000;
  const MIN = 60_000;
  let seq = 0;

  function aFleet() {
    seq += 1;
    const m = managers.register({ companyName: `Hours Haulage ${seq}`, contactPhone: `+25480077${seq}0`, ownerFullName: 'O O', ownerNationalId: `MGR-HR-${seq}`, location: { lat: -1.2, lng: 36.8 }, requirements: { businessRegistrationNo: `BRN-HR-${seq}`, transportOperatorLicence: `TOL-HR-${seq}`, taxId: `TAX-HR-${seq}` } });
    managers.submitKyc(m.did, { businessRegCertRef: 'r', operatorLicenceRef: 'l', ownerIdRef: 'i', proofOfAddressRef: 'a' });
    managers.decideKyc(m.did, true);
    managers.recordBond(m.did);
    return m.did;
  }
  /** A driver on a truck — their fleet's, or their own when they drive for themselves. Not on shift yet. */
  function aDriver(managerDid?: string) {
    seq += 1;
    const d = drivers.register({ displayName: `Driver ${seq}`, fullName: `D ${seq}`, nationalId: `ID-HR-${seq}`, mobile: `+2547550${String(seq).padStart(5, '0')}`, licenceClasses: ['truck'], licenceNumber: `L-HR-${seq}`, licenceExpiresAt: new Date(Date.now() + 365 * 86_400_000).toISOString(), criminalRecordClear: true, ...(managerDid ? { managerDid } : {}) } as never);
    drivers.submitKyc(d.did, { idCopyRef: 'i', licenceCopyRef: 'l' });
    drivers.decideKyc(d.did, true);
    const truck = vehicles.register({ plate: `HR-${seq}`, vehicleClass: 'truck', truckSubtype: 'flatbed', capacityKg: 10_000, ownerName: 'X', equipment: ['TLT'], baseFee: 10, pricePerKm: 0.5, minMultiplier: 0.8, maxMultiplier: 1.5, ...(managerDid ? { managerDid } : {}) } as never);
    return { did: d.did, name: `Driver ${seq}`, vehicleId: truck.vehicleId, plate: `HR-${seq}`, managerDid };
  }
  /** On shift since that long ago. Returns the moment "now" is, so the clock can be moved from it. */
  function onShiftFor(d: { did: string; vehicleId: string }, hours: number, now = Date.now()) {
    fleet.couple(d.did, d.vehicleId);
    fleet.activeForDriver(d.did)!.startedAt = new Date(now - hours * H).toISOString();
    return now;
  }
  /** A working day done: a shift of that many hours, ended at \`endedAt\`. */
  function aDayDone(d: { did: string; vehicleId: string }, hours: number, endedAt = Date.now()) {
    fleet.couple(d.did, d.vehicleId);
    const shift = fleet.activeForDriver(d.did)!;
    fleet.uncouple(d.did);
    shift.startedAt = new Date(endedAt - hours * H).toISOString();
    shift.endedAt = new Date(endedAt).toISOString();
    return endedAt;
  }
  const told = (did: string) => notifications.inboxFor(did).filter((n) => n.kind === 'shift_hours');
  const titles = (did: string) => told(did).map((n) => n.title);

  /* ------------------------------------------------------------------ the shift limit -- */

  describe('on shift', () => {
    it('says nothing for most of the day — and an hour before the limit, once, says what is coming', async () => {
      const office = aFleet();
      const d = aDriver(office);
      const now = onShiftFor(d, MAX_ON_DUTY_HOURS - HOURS_NEAR_LIMIT_H - 0.05);
      expect(await dispatcher.sweepHours(now)).toBe(0);
      expect(told(d.did)).toEqual([]);
      // Their own screen draws the same hour, and is told it by the same place: it does no arithmetic of its own.
      expect(fleet.hoursFor(d.did, now).near).toBeUndefined();
      expect(fleet.hoursFor(d.did, now + 5 * MIN)).toMatchObject({ near: true, over: false });
      expect(fleet.hoursFor(d.did, now + 2 * H)).toMatchObject({ over: true });
      expect(fleet.hoursFor(d.did, now + 2 * H).near).toBeUndefined();

      expect(await dispatcher.sweepHours(now + 5 * MIN)).toBe(1);
      expect(told(d.did)).toHaveLength(1);
      expect(told(d.did)[0]).toMatchObject({ kind: 'shift_hours', title: 'Less than an hour until the shift limit' });
      expect(told(d.did)[0].body).toBe('You have been on shift 12 hours; the limit is 13. After that no new load is offered or can be taken. What is already aboard you still deliver.');
      // Once. And nothing has changed for anybody else yet: the office is not told of a limit nobody has passed.
      expect(await dispatcher.sweepHours(now + 10 * MIN)).toBe(0);
      expect(await dispatcher.sweepHours(now + 40 * MIN)).toBe(0);
      expect(told(d.did)).toHaveLength(1);
      expect(told(office)).toEqual([]);
    });

    it('at the limit says what is still theirs to do, what is not, and when they may start again — and their office hears it', async () => {
      const office = aFleet();
      const d = aDriver(office);
      const now = onShiftFor(d, MAX_ON_DUTY_HOURS - 0.5);
      await dispatcher.sweepHours(now);
      // Thirteen hours to the minute is not past it: the same line the claim and the board draw.
      expect(await dispatcher.sweepHours(now + 30 * MIN)).toBe(0);
      expect(fleet.overHours(d.did, now + 30 * MIN)).toBe(false);

      expect(await dispatcher.sweepHours(now + 31 * MIN)).toBe(1);
      expect(fleet.overHours(d.did, now + 31 * MIN)).toBe(true);
      expect(titles(d.did).sort()).toEqual(['Less than an hour until the shift limit', 'You have reached the shift limit']);
      const over = told(d.did).find((n) => n.title === 'You have reached the shift limit')!;
      expect(over.body).toBe('You have been on shift 13 hours; the limit is 13. Deliver what is aboard: no new load is offered or can be taken. Then end your shift and rest. You can start again 9 hours after you end it.');

      // The office would otherwise go on planning loads for them.
      expect(told(office)).toHaveLength(1);
      expect(told(office)[0]).toMatchObject({ kind: 'shift_hours', title: `${d.name} has reached the shift limit` });
      expect(told(office)[0].body).toBe(`On shift 13 hours with ${d.plate}; the limit is 13. They deliver what is aboard and take nothing new, then rest 9 hours. Plan no new load for them until they have.`);

      // Said once, to each, however long the shift goes on.
      expect(await dispatcher.sweepHours(now + 2 * H)).toBe(0);
      expect(await dispatcher.sweepHours(now + 9 * H)).toBe(0);
      expect(told(d.did)).toHaveLength(2);
      expect(told(office)).toHaveLength(1);
    });

    it('a courier who drives for themselves is told the same, and no office is', async () => {
      const office = aFleet();
      const own = aDriver();
      const now = onShiftFor(own, MAX_ON_DUTY_HOURS + 0.1);
      expect(await dispatcher.sweepHours(now)).toBe(1);
      expect(titles(own.did)).toEqual(['You have reached the shift limit']);
      expect(told(office)).toEqual([]);
    });

    it('a shift first seen already past the limit is told the one thing that is true — not the hour-before as well', async () => {
      const d = aDriver();
      const now = onShiftFor(d, 15.4);
      expect(await dispatcher.sweepHours(now)).toBe(1);
      expect(await dispatcher.sweepHours(now + 5 * MIN)).toBe(0);
      expect(titles(d.did)).toEqual(['You have reached the shift limit']);
      expect(told(d.did)[0].body).toContain('You have been on shift 15 hours; the limit is 13.');
    });

    it('each driver is told for their own shift, and a new shift is a new clock', async () => {
      const a = aDriver();
      const b = aDriver();
      const now = onShiftFor(a, 12.2);
      onShiftFor(b, 3, now);
      expect(await dispatcher.sweepHours(now)).toBe(1);
      expect(titles(a.did)).toEqual(['Less than an hour until the shift limit']);
      expect(told(b.did)).toEqual([]);

      // The first ends their day, rests, and starts again: twelve hours into THAT shift they are told again.
      const first = fleet.activeForDriver(a.did)!;
      fleet.uncouple(a.did);
      first.endedAt = new Date(now - 10 * H).toISOString();
      first.startedAt = new Date(now - 22 * H).toISOString();
      onShiftFor(a, 12.5, now);
      expect(await dispatcher.sweepHours(now)).toBe(1);
      expect(titles(a.did)).toEqual(['Less than an hour until the shift limit', 'Less than an hour until the shift limit']);
    });
  });

  /* ------------------------------------------------------------------ the rest -- */

  describe('after a working day', () => {
    it('their own screen says until when they rest — without their having to try and be turned away', () => {
      const d = aDriver();
      expect(fleet.hoursFor(d.did).restUntil).toBeUndefined();
      const ended = aDayDone(d, 10);
      expect(fleet.hoursFor(d.did, ended + H)).toMatchObject({ onDuty: 0, over: false, restHours: 9, restUntil: new Date(ended + MIN_REST_HOURS * H).toISOString() });
      expect(fleet.hoursFor(d.did, ended + H).tellWhenRested).toBeUndefined();
      // The rest over, there is nothing to wait for.
      expect(fleet.hoursFor(d.did, ended + MIN_REST_HOURS * H + MIN).restUntil).toBeUndefined();

      // A five-minute coupling was not a working day: nothing is owed after it.
      const short = aDriver();
      aDayDone(short, 5 / 60);
      expect(fleet.hoursFor(short.did).restUntil).toBeUndefined();
      // And on shift there is a limit to watch, not a rest — though the shift itself knows whether ending it now
      // would owe one, so the sheet that ends it does not promise "start again any time".
      const working = aDriver();
      const now = onShiftFor(working, 2);
      expect(fleet.hoursFor(working.did, now).restUntil).toBeUndefined();
      expect(fleet.hoursFor(working.did, now).restOwed).toBeUndefined();
      expect(fleet.hoursFor(working.did, now + 2 * H).restOwed).toBe(true);
      expect(fleet.hoursFor(d.did, ended + H).restOwed).toBeUndefined();
    });

    it('“your rest is over” is told to somebody who ASKED, at the minute it is true — and to nobody who did not', async () => {
      const waiting = aDriver();
      const asleep = aDriver();
      const ended = aDayDone(waiting, 10);
      aDayDone(asleep, 10, ended);
      const until = new Date(ended + MIN_REST_HOURS * H).toISOString();

      expect(fleet.askRestNotice(waiting.did, ended + H)).toEqual({ restUntil: until, tellWhenRested: true });
      expect(fleet.hoursFor(waiting.did, ended + H)).toMatchObject({ restUntil: until, tellWhenRested: true });
      expect(fleet.hoursFor(asleep.did, ended + H).tellWhenRested).toBeUndefined();

      expect(await dispatcher.sweepHours(ended + MIN_REST_HOURS * H - MIN)).toBe(0);
      expect(await dispatcher.sweepHours(ended + MIN_REST_HOURS * H + MIN)).toBe(1);
      expect(told(waiting.did)).toHaveLength(1);
      expect(told(waiting.did)[0]).toMatchObject({ kind: 'shift_hours', title: 'Your rest is over', body: 'It is 9 hours since your last shift ended. You can start a shift again.' });
      // Nine hours after most working days is the small hours: a driver who did not ask is not woken to be told.
      expect(told(asleep.did)).toEqual([]);
      // Once.
      expect(await dispatcher.sweepHours(ended + MIN_REST_HOURS * H + 6 * MIN)).toBe(0);
      expect(told(waiting.did)).toHaveLength(1);
    });

    it('somebody turned away at the start has asked, by trying', async () => {
      const d = aDriver();
      const ended = aDayDone(d, 10);
      expect(() => fleet.couple(d.did, d.vehicleId)).toThrow(/Rest first: .* 9 h needed before the next\. We will tell you when you can start\./);
      expect(fleet.hoursFor(d.did).tellWhenRested).toBe(true);
      expect(await dispatcher.sweepHours(ended + MIN_REST_HOURS * H + MIN)).toBe(1);
      expect(titles(d.did)).toEqual(['Your rest is over']);
    });

    it('asking twice is asking once; and there is nothing to ask for when there is nothing to wait for', async () => {
      const d = aDriver();
      const code = (fn: () => unknown) => {
        try {
          fn();
          return 'DID NOT REFUSE';
        } catch (e) {
          return `${(e as { code?: string }).code}: ${(e as Error).message}`;
        }
      };
      expect(code(() => fleet.askRestNotice(d.did))).toBe('INVALID_STATE: You are not resting: you can start a shift now');
      onShiftFor(d, 2);
      expect(code(() => fleet.askRestNotice(d.did))).toBe('INVALID_STATE: You are on shift: there is no rest to wait for');

      const resting = aDriver();
      const ended = aDayDone(resting, 10);
      fleet.askRestNotice(resting.did, ended + H);
      fleet.askRestNotice(resting.did, ended + 2 * H);
      expect(await dispatcher.sweepHours(ended + MIN_REST_HOURS * H + MIN)).toBe(1);
      expect(told(resting.did)).toHaveLength(1);
    });

    it('is not told late: a moment that passed while nobody was looking is not announced afterwards', async () => {
      const d = aDriver();
      const ended = aDayDone(d, 10);
      fleet.askRestNotice(d.did, ended + H);
      // The server was away through the moment, and comes back more than half an hour after it.
      expect(await dispatcher.sweepHours(ended + MIN_REST_HOURS * H + REST_NOTICE_LATE_MS + MIN)).toBe(0);
      expect(told(d.did)).toEqual([]);
      // …and the asking is spent: it is not said later still.
      expect(fleet.hoursFor(d.did, ended + H).tellWhenRested).toBeUndefined();
      // Inside the half hour it is still news.
      const e = aDriver();
      const endedE = aDayDone(e, 10);
      fleet.askRestNotice(e.did, endedE + H);
      expect(await dispatcher.sweepHours(endedE + MIN_REST_HOURS * H + REST_NOTICE_LATE_MS - MIN)).toBe(1);
    });

    it('is not told once they are back on shift: starting is the answer to the question', async () => {
      const d = aDriver();
      // Their day ended nine hours and a minute ago; they asked while resting, and have just started again.
      const ended = aDayDone(d, 10, Date.now() - MIN_REST_HOURS * H - MIN);
      fleet.askRestNotice(d.did, ended + H);
      fleet.couple(d.did, d.vehicleId);
      expect(await dispatcher.sweepHours()).toBe(0);
      expect(told(d.did)).toEqual([]);
    });
  });

  /* ------------------------------------------------------------------ the clock itself -- */

  describe('the clock', () => {
    it('is looked at every five minutes while the server runs, with nobody calling anything — and not after it stops', async () => {
      const office = aFleet();
      const d = aDriver(office);
      jest.useFakeTimers({ now: Date.parse('2026-11-02T05:00:00.000Z') });
      try {
        dispatcher.onApplicationBootstrap();
        // A shift that does not start on the stroke of anything: it is told within five minutes of its own hour.
        await jest.advanceTimersByTimeAsync(2 * MIN);
        fleet.couple(d.did, d.vehicleId);
        await jest.advanceTimersByTimeAsync(11 * H + 59 * MIN);
        expect(titles(d.did)).toEqual([]);
        await jest.advanceTimersByTimeAsync(6 * MIN);
        expect(titles(d.did)).toEqual(['Less than an hour until the shift limit']);
        await jest.advanceTimersByTimeAsync(H);
        expect(titles(d.did).sort()).toEqual(['Less than an hour until the shift limit', 'You have reached the shift limit']);
        expect(titles(office)).toEqual([`${d.name} has reached the shift limit`]);

        // They end the day, ask, and are told nine hours later — by the same clock.
        fleet.uncouple(d.did);
        fleet.askRestNotice(d.did);
        await jest.advanceTimersByTimeAsync(MIN_REST_HOURS * H - 5 * MIN);
        expect(titles(d.did)).not.toContain('Your rest is over');
        await jest.advanceTimersByTimeAsync(10 * MIN);
        expect(titles(d.did)).toContain('Your rest is over');

        dispatcher.onModuleDestroy();
        expect(jest.getTimerCount()).toBe(0);
      } finally {
        jest.useRealTimers();
      }
    });
  });
});
