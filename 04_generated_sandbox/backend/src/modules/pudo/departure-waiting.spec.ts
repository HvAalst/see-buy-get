import { DepartureService } from './departure.service';
import { CorridorService } from './corridor.service';
import type { FleetManagerService } from './fleet-manager.service';

/**
 * WAITING TIME, DRIVEN THROUGH THE SERVICE — because the arithmetic being right proves nothing on its own.
 *
 * `departure.spec.ts` tests `waitingCharge` as the pure function it is, and every one of those assertions
 * would still pass if nothing ever called it. The wire test cannot close that gap either: a driver taps
 * arrive and taps free-to-go a millisecond later, so the charge is zero — and zero is also what a
 * completely unwired clock returns. That is the vacuous assertion this file exists to avoid.
 *
 * So the clock is moved instead. The driver arrives, ninety minutes pass, and the charge that comes back
 * has to be a real number attributed to a real place.
 */
describe('the waiting clock, from arrival to a charge somebody owes', () => {
  const MANAGER = 'did:glos:fleet-under-test';
  const DRIVER = 'did:glos:driver-under-test';
  const SHIPPER = 'did:glos:shipper-under-test';

  /** A fleet whose only interesting property is the country it stands in — the charge needs a currency. */
  const managers = { get: () => ({ jurisdiction: 'KE' }) } as unknown as FleetManagerService;

  /** A published line this fleet owns. Unique zones per call: only one line may hold a lane. */
  let lanes = 0;
  const line = (corridors: CorridorService) => {
    lanes += 1;
    const proposed = corridors.proposeLine({
      managerDid: MANAGER,
      company: 'Fleet Under Test',
      name: `Line ${lanes}`,
      originZone: `Origin ${lanes}`,
      destZone: `Dest ${lanes}`,
      vehicleType: 'truck',
    });
    return corridors.publish(proposed.corridorId, 'did:glos:network-staff');
  };

  const setUp = () => {
    const corridors = new CorridorService();
    const service = new DepartureService(corridors, managers);
    const corridor = line(corridors);

    const departure = service.declare({
      managerDid: MANAGER,
      corridorId: corridor.corridorId,
      leavesAt: new Date(Date.now() + 86_400_000).toISOString(),
      capacityKg: 6000,
      capacityM3: 40,
      basis: 'per_trip',
      amount: 450,
      // An hour of loading is simply the job; after that the driver's day is being spent.
      freeMin: 60,
      waitingPerHour: 40,
    });
    const { booking } = service.book(departure.departureId, { shipperDid: SHIPPER, description: 'Maize', weightKg: 2000, volumeM3: 8 });
    service.assignDriver(departure.departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' });
    return { service, departureId: departure.departureId, bookingId: booking.bookingId };
  };

  /** Arrive, let `min` minutes of the world go by, then be free to go. */
  const waitFor = (service: DepartureService, departureId: string, bookingId: string, where: 'loading' | 'delivery', min: number, by = DRIVER) => {
    jest.useFakeTimers().setSystemTime(new Date('2026-09-25T08:00:00Z'));
    service.arrive(departureId, bookingId, where, by);
    jest.setSystemTime(new Date(Date.parse('2026-09-25T08:00:00Z') + min * 60_000));
    const { record } = service.freeToGo(departureId, bookingId, where, by);
    jest.useRealTimers();
    return record;
  };

  it('bills a real wait at the loading gate TO THE SHIPPER, free hour deducted', () => {
    const { service, departureId, bookingId } = setUp();
    // Ninety minutes at the bay. Sixty of them were the job; thirty were the delay.
    const record = waitFor(service, departureId, bookingId, 'loading', 90);

    expect(record.waitedMin).toBe(90);
    expect(record.billableMin).toBe(30);
    expect(record.amount).toBe(20); // half an hour at 40
    // THE ATTRIBUTION, which is the whole feature: a truck kept standing at the collection gate was kept
    // there by the shipper, and the charge says so rather than landing on whoever holds the contract.
    expect(record.bearer).toBe('shipper');
  });

  it('bills a wait at the delivery gate TO THE CONSIGNEE instead, on the same clock', () => {
    const { service, departureId, bookingId } = setUp();
    const record = waitFor(service, departureId, bookingId, 'delivery', 150);
    expect(record.billableMin).toBe(90);
    expect(record.amount).toBe(60);
    // The receiver's warehouse kept the truck; the shipper who loaded on time pays nothing for it.
    expect(record.bearer).toBe('consignee');
  });

  it('adds the two gates up, each against the side that caused it', () => {
    const { service, departureId, bookingId } = setUp();
    waitFor(service, departureId, bookingId, 'loading', 90);
    waitFor(service, departureId, bookingId, 'delivery', 120);

    const booking = service.require(departureId).bookings[0];
    const owed = service.waitingOwed(booking);
    expect(owed.total).toBe(60); // 20 at loading, 40 at delivery
    expect(owed.byPlace).toEqual([
      { where: 'loading', bearer: 'shipper', amount: 20 },
      { where: 'delivery', bearer: 'consignee', amount: 40 },
    ]);
  });

  it('charges nothing at all on a departure whose fleet never published waiting terms', () => {
    // The same ninety-minute wait, on a run where nobody was told about a clock. Absent means free.
    const corridors = new CorridorService();
    const service = new DepartureService(corridors, managers);
    const corridor = line(corridors);
    const departure = service.declare({
      managerDid: MANAGER, corridorId: corridor.corridorId, leavesAt: new Date(Date.now() + 86_400_000).toISOString(),
      capacityKg: 6000, basis: 'per_trip', amount: 450,
    });
    const { booking } = service.book(departure.departureId, { shipperDid: SHIPPER, description: 'Maize', weightKg: 2000 });
    service.assignDriver(departure.departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' });

    const record = waitFor(service, departure.departureId, booking.bookingId, 'loading', 90);
    expect(record.waitedMin).toBe(90); // it HAPPENED, and is recorded
    expect(record.amount).toBe(0); // and it cost nothing, because no clock was published
  });

  describe('who is allowed to hold the stopwatch', () => {
    it('refuses the SHIPPER, who is the one being charged', () => {
      const { service, departureId, bookingId } = setUp();
      // The single most important guard here. A shipper who can start and stop the clock that bills them
      // can make every wait on the network cost nothing.
      expect(() => service.arrive(departureId, bookingId, 'loading', SHIPPER)).toThrow(/driver on this run or the fleet/);
    });

    it('refuses a driver who is not on this run', () => {
      const { service, departureId, bookingId } = setUp();
      expect(() => service.arrive(departureId, bookingId, 'loading', 'did:glos:some-other-driver')).toThrow(/driver on this run or the fleet/);
    });

    it('lets the fleet that sold the run record it, for the driver whose phone is flat', () => {
      const { service, departureId, bookingId } = setUp();
      expect(() => service.arrive(departureId, bookingId, 'loading', MANAGER)).not.toThrow();
    });
  });

  describe('what it refuses to invent', () => {
    it('will not end a wait that never began', () => {
      const { service, departureId, bookingId } = setUp();
      // A stop with an end and no beginning would price against whatever the default was — which is how a
      // shipper gets billed for a wait nobody witnessed.
      expect(() => service.freeToGo(departureId, bookingId, 'loading', DRIVER)).toThrow(/record the arrival first/);
    });

    it('does not restart the clock when the arrival tap lands twice', () => {
      const { service, departureId, bookingId } = setUp();
      jest.useFakeTimers().setSystemTime(new Date('2026-09-25T08:00:00Z'));
      service.arrive(departureId, bookingId, 'loading', DRIVER);
      // An hour later, a flaky signal re-sends the tap. If this reset `arrivedAt`, an hour of real waiting
      // would vanish — and it is the one failure mode the shipper being charged can never detect.
      jest.setSystemTime(new Date('2026-09-25T09:00:00Z'));
      service.arrive(departureId, bookingId, 'loading', DRIVER);
      jest.setSystemTime(new Date('2026-09-25T09:30:00Z'));
      const { record } = service.freeToGo(departureId, bookingId, 'loading', DRIVER);
      jest.useRealTimers();

      expect(record.waitedMin).toBe(90); // from the FIRST arrival, not the second
      expect(record.amount).toBe(20);
      /*
       * AND EXACTLY ONE RECORD FOR THAT STOP — which is a separate assertion for a reason worth keeping.
       *
       * With the double-tap guard removed this test still passed: a second arrival appended a second
       * record, and `freeToGo` looks the stop up with `find`, which returns the first. The charge came out
       * right by accident while the booking quietly carried two loading rows for one stop at the bay.
       * Caught by inverting the guard and watching nothing fail.
       */
      expect(service.require(departureId).bookings[0].waiting.filter((w) => w.where === 'loading')).toHaveLength(1);
    });

    it('does not re-end a wait that has already ended', () => {
      const { service, departureId, bookingId } = setUp();
      const first = waitFor(service, departureId, bookingId, 'loading', 90);
      jest.useFakeTimers().setSystemTime(new Date('2026-09-25T12:00:00Z'));
      const { record } = service.freeToGo(departureId, bookingId, 'loading', DRIVER);
      jest.useRealTimers();
      // Four hours later the driver taps again. The wait was ninety minutes and stays ninety minutes.
      expect(record.freeAt).toBe(first.freeAt);
      expect(record.amount).toBe(20);
    });
  });

  describe('waiving it', () => {
    it('zeroes the charge, keeps the record, and demands a reason', () => {
      const { service, departureId, bookingId } = setUp();
      waitFor(service, departureId, bookingId, 'loading', 90);

      expect(() => service.waiveWaiting(departureId, bookingId, 'loading', MANAGER, '  ')).toThrow(/Say why/);

      service.waiveWaiting(departureId, bookingId, 'loading', MANAGER, 'Our bay, our fault');
      const record = service.require(departureId).bookings[0].waiting[0];
      expect(record.amount).toBe(0);
      expect(record.waivedReason).toBe('Our bay, our fault');
      // The WAIT is still on the record. Deleting it would make the charge unarguable in the other
      // direction: a shipper could never show that a fleet kept writing off its own delays.
      expect(record.waitedMin).toBe(90);
      expect(record.billableMin).toBe(30);
    });

    it('is the FLEET’s to give away, never the shipper’s to take', () => {
      const { service, departureId, bookingId } = setUp();
      waitFor(service, departureId, bookingId, 'loading', 90);
      expect(() => service.waiveWaiting(departureId, bookingId, 'loading', SHIPPER, 'I would rather not')).toThrow(/not your departure/);
    });
  });
});
