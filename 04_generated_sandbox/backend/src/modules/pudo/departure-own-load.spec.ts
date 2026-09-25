import { DepartureService } from './departure.service';
import { CorridorService } from './corridor.service';
import { CargoService } from './cargo.service';
import type { MediaService } from './media.service';

/** A photo store that only remembers what it was asked to adopt. */
const adoptions: Array<{ mediaId: string; by: string; role: string }> = [];
const anchored: string[] = [];
const held: string[] = [];
const adopted = () =>
  ({
    adopt: (mediaId: string, by: string, _subject: unknown, role: string) => {
      adoptions.push({ mediaId, by, role });
    },
    // Retention: a run now starts and holds its evidence clock the way the board has since S33.
    anchorFreightTerminal: (id: string) => void anchored.push(id),
    holdFreightForDispute: (id: string) => void held.push(id),
  }) as unknown as MediaService;
import type { DriverService } from './driver.service';
import type { FleetManagerService } from './fleet-manager.service';
import type { PresenceService } from '../../foundation/presence/presence.service';
import type { EventBus } from '../../foundation/events/event-bus.service';
import type { VehicleService } from './vehicle.service';

/** Papers and the country are their own tests (departure-gates.spec.ts); here they simply say yes. */
const clearDrivers = { canOperate: () => true, offRoadReasons: () => [] } as unknown as DriverService;
const openEverywhere = { can: () => true } as unknown as PresenceService;
/** Events are their own test (departure-events.spec.ts); here they go nowhere. */
const silentBus = { publish: async () => undefined } as unknown as EventBus;

/**
 * F4 — THE WORK THE FLEET ALREADY HAD.
 *
 * The claim this file has to prove is not "a field can be set". It is that an own load is INDISTINGUISHABLE
 * FROM A SOLD ONE where it matters physically — it takes up space, it refuses the next booking when the
 * truck is full, it can be clocked at a gate — and distinguishable everywhere it matters commercially: no
 * quote, no price of ours, nothing to waive, and not a word of it on the shipper's side of the glass.
 *
 * The interesting test is the first one. If own loads did not consume capacity, every other assertion here
 * would still pass and F3 would go on advertising space that is not there.
 */
describe('a fleet’s own customers, on a fleet’s own run', () => {
  const MANAGER = 'did:glos:fleet-f4';
  const OTHER_FLEET = 'did:glos:fleet-somebody-else';
  const DRIVER = 'did:glos:driver-f4';
  const SHIPPER = 'did:glos:shipper-f4';

  const managers = { get: () => ({ jurisdiction: 'KE' }) } as unknown as FleetManagerService;

  /** One eight-tonne truck, in date and this fleet's. The vehicle gate is its own test. */

  const oneTruck = { get: () => ({ vehicleId: 'veh_1', plate: 'KDA 001A', vehicleClass: 'truck', capacityKg: 8000, managerDid: MANAGER, status: 'ACTIVE' }), isUsable: () => true, offRoadReasons: () => [] } as unknown as VehicleService;

  /** A published line this fleet owns. Unique zones per call: only one line may hold a lane. */
  let lanes = 0;
  const line = (corridors: CorridorService) => {
    lanes += 1;
    const proposed = corridors.proposeLine({
      managerDid: MANAGER,
      company: 'Fleet F4',
      name: `F4 line ${lanes}`,
      originZone: `F4 origin ${lanes}`,
      destZone: `F4 dest ${lanes}`,
      vehicleType: 'truck',
    });
    return corridors.publish(proposed.corridorId, 'did:glos:network-staff');
  };

  const setUp = (capacity: { capacityKg: number; capacityM3?: number } = { capacityKg: 6000, capacityM3: 40 }) => {
    const corridors = new CorridorService();
    const service = new DepartureService(corridors, managers, clearDrivers, oneTruck, new CargoService(), adopted(), openEverywhere, silentBus);
    const corridor = line(corridors);
    const departure = service.declare({
      managerDid: MANAGER,
      corridorId: corridor.corridorId,
      vehicleId: 'veh_1',
      leavesAt: new Date(Date.now() + 86_400_000).toISOString(),
      basis: 'per_trip',
      amount: 450,
      freeMin: 60,
      waitingPerHour: 40,
      ...capacity,
    });
    return { service, departureId: departure.departureId };
  };

  const OWN = { customer: 'Kariuki Hardware', description: 'Cement, 40 bags', weightKg: 2000, volumeM3: 6 };

  /* ---------------------------------------------------------- the point of the whole slice -- */

  it('takes the space out of what is offered, which is the entire reason it exists', () => {
    const { service, departureId } = setUp();
    expect(service.offers().find((o) => o.departureId === departureId)).toMatchObject({ remainingKg: 6000, remainingM3: 40 });

    service.addOwnLoad(departureId, MANAGER, OWN);

    // The shipper's view of the truck changed, without a shipper having done anything.
    expect(service.offers().find((o) => o.departureId === departureId)).toMatchObject({ remainingKg: 4000, remainingM3: 34, booked: 1 });
  });

  it('refuses the shipper who would not have fitted behind it', () => {
    const { service, departureId } = setUp({ capacityKg: 6000 });
    service.addOwnLoad(departureId, MANAGER, { ...OWN, weightKg: 5000, volumeM3: undefined });

    expect(() => service.book(departureId, { shipperDid: SHIPPER, description: 'Steel', weightKg: 2000 })).toThrow(/Only 1000 kg is left/);
    // And the one that does fit still goes through — the capacity moved, the market did not close.
    expect(service.book(departureId, { shipperDid: SHIPPER, description: 'Steel', weightKg: 900 }).booking.status).toBe('booked');
  });

  it('fills the truck by itself, and then the run is simply not for sale', () => {
    const { service, departureId } = setUp({ capacityKg: 6000 });
    service.addOwnLoad(departureId, MANAGER, { ...OWN, weightKg: 6000, volumeM3: undefined });

    // Not an error and nobody needs telling: a full truck is absent from the offers, like any other.
    expect(service.offers().find((o) => o.departureId === departureId)).toBeUndefined();
  });

  /* ------------------------------------------------------------------ what it is not -- */

  it('is the fleet’s own load and nobody else’s to add', () => {
    const { service, departureId } = setUp();
    expect(() => service.addOwnLoad(departureId, OTHER_FLEET, OWN)).toThrow(/not your departure/i);
    expect(service.require(departureId).bookings).toHaveLength(0);
  });

  it('will not take an unattributed load, because a hole in the capacity is worse than none', () => {
    const { service, departureId } = setUp();
    expect(() => service.addOwnLoad(departureId, MANAGER, { ...OWN, customer: '   ' })).toThrow(/whose load this is/i);
    expect(() => service.addOwnLoad(departureId, MANAGER, { ...OWN, description: '' })).toThrow(/what it is/i);
  });

  it('keeps the fleet’s own price out of what we quoted, and off every ledger', () => {
    const { service, departureId } = setUp();
    const { booking } = service.addOwnLoad(departureId, MANAGER, { ...OWN, charge: 380 });

    expect(booking).toMatchObject({ kind: 'own', customer: 'Kariuki Hardware', price: 380, units: 0, shipperDid: MANAGER });
    // A sold booking on the same run is priced by US, on the departure's basis.
    expect(service.book(departureId, { shipperDid: SHIPPER, description: 'Maize', weightKg: 100 }).booking).toMatchObject({ kind: 'sold', price: 450, units: 1 });
  });

  it('records a load the fleet did not price at all', () => {
    const { service, departureId } = setUp();
    expect(service.addOwnLoad(departureId, MANAGER, OWN).booking.price).toBe(0);
  });

  it('never names the customer on the shipper’s side of the glass', () => {
    const { service, departureId } = setUp();
    service.addOwnLoad(departureId, MANAGER, OWN);

    const offer = service.offers().find((o) => o.departureId === departureId);
    expect(JSON.stringify(offer)).not.toContain('Kariuki');
    // The count is a fact about the truck and stays: five aboard is five stops for the driver.
    expect(offer?.booked).toBe(1);
  });

  /* ------------------------------------------- closed is closed to the market, not to the owner -- */

  it('still goes onto a run the fleet has closed to the market', () => {
    const { service, departureId } = setUp();
    service.setStatus(departureId, 'closed', MANAGER);

    // Closed means "I have stopped selling", not "the truck is full" — and a fleet that closed the offer
    // BECAUSE it is filling the rest itself is the ordinary case.
    expect(service.addOwnLoad(departureId, MANAGER, OWN).booking.kind).toBe('own');
    expect(() => service.book(departureId, { shipperDid: SHIPPER, description: 'Maize', weightKg: 10 })).toThrow(/is closed/);
  });

  it('refuses a run that has gone or was called off, from either side', () => {
    for (const status of ['departed', 'cancelled'] as const) {
      const { service, departureId } = setUp();
      service.setStatus(departureId, status, MANAGER);
      expect(() => service.addOwnLoad(departureId, MANAGER, OWN)).toThrow(new RegExp(`is ${status}`));
    }
  });

  /* ------------------------------------------------------------- the gate clock, half of it -- */

  describe('the gate clock', () => {
    beforeAll(() => jest.useFakeTimers({ doNotFake: ['nextTick'] }));
    afterAll(() => jest.useRealTimers());

    it('runs on an own load and puts no price on it', () => {
      const { service, departureId } = setUp();
      const { booking } = service.addOwnLoad(departureId, MANAGER, OWN);
      service.assignDriver(departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' });

      service.arrive(departureId, booking.bookingId, 'loading', DRIVER);
      jest.advanceTimersByTime(150 * 60_000); // two and a half hours against a one-hour free window
      const { record } = service.freeToGo(departureId, booking.bookingId, 'loading', DRIVER);

      // The evidence the fleet needs to invoice their own customer: the minutes, attributed.
      expect(record).toMatchObject({ waitedMin: 150, billableMin: 90, bearer: 'shipper' });
      // And not a figure, because the terms on this departure are the ones published to the MARKET and
      // a customer of six years is on whatever they agreed years ago. We were never told it.
      expect(record.amount).toBe(0);
    });

    it('still prices a sold booking on the same run', () => {
      const { service, departureId } = setUp();
      const own = service.addOwnLoad(departureId, MANAGER, OWN).booking;
      const sold = service.book(departureId, { shipperDid: SHIPPER, description: 'Maize', weightKg: 500 }).booking;
      service.assignDriver(departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' });

      for (const id of [own.bookingId, sold.bookingId]) service.arrive(departureId, id, 'loading', DRIVER);
      jest.advanceTimersByTime(150 * 60_000);
      expect(service.freeToGo(departureId, own.bookingId, 'loading', DRIVER).record.amount).toBe(0);
      expect(service.freeToGo(departureId, sold.bookingId, 'loading', DRIVER).record.amount).toBe(60); // 90 min at 40/hr
    });

    it('has nothing to waive, and says so rather than pretending something was forgiven', () => {
      const { service, departureId } = setUp();
      const { booking } = service.addOwnLoad(departureId, MANAGER, OWN);
      service.assignDriver(departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' });
      service.arrive(departureId, booking.bookingId, 'loading', DRIVER);
      jest.advanceTimersByTime(150 * 60_000);
      service.freeToGo(departureId, booking.bookingId, 'loading', DRIVER);

      expect(() => service.waiveWaiting(departureId, booking.bookingId, 'loading', MANAGER, 'goodwill')).toThrow(/nothing here to waive/i);
      // The record survives the refusal: the wait still happened.
      expect(service.require(departureId).bookings[0].waiting[0].billableMin).toBe(90);
    });
  });

  /* ----------------------------------------------------------------- taking it off again -- */

  it('comes off the run the same way anything else does, and gives the space back', () => {
    const { service, departureId } = setUp();
    const { booking } = service.addOwnLoad(departureId, MANAGER, OWN);

    service.cancelBooking(departureId, booking.bookingId, MANAGER);
    expect(service.offers().find((o) => o.departureId === departureId)).toMatchObject({ remainingKg: 6000, booked: 0 });
  });
});
