import { DepartureService } from './departure.service';
import { CorridorService } from './corridor.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import type { DriverService } from './driver.service';
import type { FleetManagerService } from './fleet-manager.service';
import type { PresenceService } from '../../foundation/presence/presence.service';
import type { EventBus } from '../../foundation/events/event-bus.service';
import type { VehicleService } from './vehicle.service';

/**
 * THE LIFE OF A BOOKING AFTER THE MOMENT OF SALE — which it did not have.
 *
 * A run went open → departed and then stopped. Three things followed from that and they are one hole:
 *
 *  - Nothing downstream could react to anything, because DepartureService published NO EVENTS AT ALL.
 *  - A run could be called off with five shippers aboard and not one of them could be told, even though
 *    the type said in as many words that everybody booked on it has to be.
 *  - The goods reached a door, somebody took them, and no record of that existed. The waiting clock made
 *    it look finished: the driver taps at the DELIVERY gate, which proves the truck arrived and says
 *    nothing about whether the load came off it.
 *
 * What is asserted here is the WIRING, not the arithmetic. A test that only checked a status field would
 * pass against a service that tells nobody, which is precisely the state this file exists to leave.
 */
describe('a booking’s life after it is sold', () => {
  const MANAGER = 'did:glos:fleet-life';
  const DRIVER = 'did:glos:driver-life';
  const SHIPPER = 'did:glos:shipper-life';
  const OTHER = 'did:glos:shipper-other';

  const managers = { get: () => ({ jurisdiction: 'KE' }) } as unknown as FleetManagerService;

  /** One eight-tonne truck, in date and this fleet's. The vehicle gate is its own test. */

  const oneTruck = { get: () => ({ vehicleId: 'veh_1', plate: 'KDA 001A', vehicleClass: 'truck', capacityKg: 8000, managerDid: MANAGER, status: 'ACTIVE' }), isUsable: () => true, offRoadReasons: () => [] } as unknown as VehicleService;
  const clearDrivers = { canOperate: () => true, offRoadReasons: () => [] } as unknown as DriverService;
  const openEverywhere = { can: () => true } as unknown as PresenceService;

  let lanes = 0;
  const setUp = () => {
    lanes += 1;
    const corridors = new CorridorService();
    const heard: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const bus = {
      publish: async (name: string, payload: Record<string, unknown>) => {
        heard.push({ name, payload });
      },
    } as unknown as EventBus;
    const service = new DepartureService(corridors, managers, clearDrivers, oneTruck, openEverywhere, bus);
    const proposed = corridors.proposeLine({
      managerDid: MANAGER,
      company: 'Life Haulage',
      name: `Life line ${lanes}`,
      originZone: `Life origin ${lanes}`,
      destZone: `Life dest ${lanes}`,
      vehicleType: 'truck',
    });
    const corridor = corridors.publish(proposed.corridorId, 'did:glos:network-staff');
    const departure = service.declare({
      managerDid: MANAGER,
      corridorId: corridor.corridorId,
      vehicleId: 'veh_1',
      leavesAt: new Date(Date.now() + 86_400_000).toISOString(),
      capacityKg: 6000,
      capacityM3: 40,
      basis: 'per_trip',
      amount: 450,
    });
    const of = (name: string) => heard.filter((e) => e.name === name);
    return { service, departureId: departure.departureId, heard, of };
  };

  const book = (service: DepartureService, departureId: string, shipperDid = SHIPPER) =>
    service.book(departureId, { shipperDid, description: 'Maize', weightKg: 500 }).booking;

  /* ------------------------------------------------------------ calling it off -- */

  describe('calling a run off', () => {
    it('refuses without a reason once somebody is aboard', () => {
      const { service, departureId } = setUp();
      book(service, departureId);
      expect(() => service.setStatus(departureId, 'cancelled', MANAGER)).toThrow(/Say why you are calling it off/);
      // And the run is untouched: a refused cancellation must not half-cancel anything.
      expect(service.require(departureId).status).toBe('open');
    });

    it('lets an EMPTY run be tidied away without ceremony', () => {
      // Nobody planned anything around it. Demanding a reason here is a form for its own sake.
      const { service, departureId } = setUp();
      expect(service.setStatus(departureId, 'cancelled', MANAGER).status).toBe('cancelled');
    });

    it('does not ask a reason for closing or departing, which promise nothing', () => {
      const { service, departureId } = setUp();
      book(service, departureId);
      expect(service.setStatus(departureId, 'closed', MANAGER).status).toBe('closed');
      expect(service.setStatus(departureId, 'departed', MANAGER).status).toBe('departed');
    });

    it('tells everybody aboard, once each, and carries the reason to them', () => {
      const { service, departureId, of } = setUp();
      book(service, departureId, SHIPPER);
      book(service, departureId, OTHER);
      book(service, departureId, SHIPPER); // the same shipper twice: one notice, not two

      service.setStatus(departureId, 'cancelled', MANAGER, '  The truck threw a rod  ');

      const [event] = of(GlosEvent.Pudo.DepartureCancelled);
      expect(event.payload.shippers).toEqual([SHIPPER, OTHER]);
      expect(event.payload.reason).toBe('The truck threw a rod');
    });

    it('keeps the reason on the run, because the notice goes out once and the screen is read later', () => {
      const { service, departureId } = setUp();
      book(service, departureId);
      service.setStatus(departureId, 'cancelled', MANAGER, 'The truck threw a rod');
      expect(service.require(departureId).cancelledReason).toBe('The truck threw a rod');
    });

    it('does not address the fleet’s own customers — they are the ones doing the telling', () => {
      const { service, departureId, of } = setUp();
      service.addOwnLoad(departureId, MANAGER, { customer: 'Kariuki Hardware', description: 'Cement', weightKg: 500 });
      service.setStatus(departureId, 'cancelled', MANAGER);
      // An own load carries the FLEET as its shipperDid, so a naive list would notify them about their
      // own decision. It also means no reason was demanded: nobody outside was promised anything.
      expect(of(GlosEvent.Pudo.DepartureCancelled)[0].payload.shippers).toEqual([]);
    });

    it('says it once, not on every subsequent save', () => {
      const { service, departureId, of } = setUp();
      service.setStatus(departureId, 'cancelled', MANAGER);
      service.setStatus(departureId, 'cancelled', MANAGER);
      expect(of(GlosEvent.Pudo.DepartureCancelled)).toHaveLength(1);
    });
  });

  /* ------------------------------------------------------------ the ending -- */

  describe('handing the goods over', () => {
    it('records who took it, and when, on the server’s clock', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      service.assignDriver(departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' });

      const { booking: done } = service.deliver(departureId, booking.bookingId, DRIVER, '  Joseph at the gate  ');
      expect(done.status).toBe('delivered');
      expect(done.receivedBy).toBe('Joseph at the gate');
      expect(Date.parse(done.deliveredAt as string)).toBeLessThanOrEqual(Date.now());
    });

    it('takes a delivery nobody put a name to', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      const { booking: done } = service.deliver(departureId, booking.bookingId, MANAGER);
      expect(done.status).toBe('delivered');
      expect(done.receivedBy).toBeUndefined();
    });

    it('is the carrier’s to record and not the shipper’s', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      // A delivery the receiving side can mark itself is a record of nothing.
      expect(() => service.deliver(departureId, booking.bookingId, SHIPPER)).toThrow(/Only the driver on this run or the fleet/);
    });

    it('is idempotent — a second tap is not a second delivery', () => {
      const { service, departureId, of } = setUp();
      const booking = book(service, departureId);
      const first = service.deliver(departureId, booking.bookingId, MANAGER).booking.deliveredAt;
      const second = service.deliver(departureId, booking.bookingId, MANAGER).booking.deliveredAt;
      expect(second).toBe(first);
      expect(of(GlosEvent.Pudo.DepartureDelivered)).toHaveLength(1);
    });

    it('tells the shipper their goods arrived', () => {
      const { service, departureId, of } = setUp();
      const booking = book(service, departureId);
      service.deliver(departureId, booking.bookingId, MANAGER, 'Joseph');

      expect(of(GlosEvent.Pudo.DepartureDelivered)[0].payload).toMatchObject({
        shipperDid: SHIPPER,
        kind: 'sold',
        description: 'Maize',
        receivedBy: 'Joseph',
      });
    });

    it('refuses a load that was never aboard, and one on a run that was called off', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      service.cancelBooking(departureId, booking.bookingId, SHIPPER);
      expect(() => service.deliver(departureId, booking.bookingId, MANAGER)).toThrow(/never aboard/);

      const second = setUp();
      const other = book(second.service, second.departureId);
      second.service.setStatus(second.departureId, 'cancelled', MANAGER, 'off');
      expect(() => second.service.deliver(second.departureId, other.bookingId, MANAGER)).toThrow(/called off/);
    });

    it('will not let a delivered load be given back', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      service.deliver(departureId, booking.bookingId, MANAGER);
      expect(() => service.cancelBooking(departureId, booking.bookingId, SHIPPER)).toThrow(/handed over/);
    });

    it('frees the space it was taking, because the goods are off the truck', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      expect(service.remaining(service.require(departureId)).kg).toBe(5500);
      service.deliver(departureId, booking.bookingId, MANAGER);
      expect(service.remaining(service.require(departureId)).kg).toBe(6000);
    });
  });

  /* ------------------------------------------------------------ what I booked -- */

  describe('the shipper reading back what they booked', () => {
    it('finds it at all, which was the hole', () => {
      // Three ways existed to read a departure and none of them was this one, so a shop took space and
      // the booking left their world: no time, no company, no way to give it back.
      const { service, departureId } = setUp();
      book(service, departureId);
      expect(service.forShipper(SHIPPER)).toHaveLength(1);
      expect(service.forShipper(SHIPPER)[0]).toMatchObject({
        departureId,
        company: 'Life Haulage',
        description: 'Maize',
        price: 450,
        currency: 'KES',
        bookingStatus: 'booked',
        runStatus: 'open',
        cancellable: true,
      });
    });

    it('shows nobody else’s load, on their own truck or anywhere else', () => {
      const { service, departureId } = setUp();
      book(service, departureId, SHIPPER);
      book(service, departureId, OTHER);
      service.addOwnLoad(departureId, MANAGER, { customer: 'Kariuki Hardware', description: 'Cement', weightKg: 100 });

      expect(service.forShipper(SHIPPER)).toHaveLength(1);
      expect(JSON.stringify(service.forShipper(SHIPPER))).not.toContain('Kariuki');
      // And a fleet manager opening this does not find their own customers filed as things they booked.
      expect(service.forShipper(MANAGER)).toHaveLength(0);
    });

    it('tells a shipper their run was called off, and why', () => {
      const { service, departureId } = setUp();
      book(service, departureId);
      service.setStatus(departureId, 'cancelled', MANAGER, 'The truck threw a rod');

      const [mine] = service.forShipper(SHIPPER);
      // The BOOKING is still 'booked' and the RUN is cancelled, which is the whole point of carrying both:
      // goods somebody gave back and goods stranded by a fleet are not the same thing to look back on.
      expect(mine).toMatchObject({ bookingStatus: 'booked', runStatus: 'cancelled', cancelledReason: 'The truck threw a rod', cancellable: false });
    });

    it('keeps a booking the shipper themselves withdrew, and says which happened', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      service.cancelBooking(departureId, booking.bookingId, SHIPPER);
      expect(service.forShipper(SHIPPER)[0]).toMatchObject({ bookingStatus: 'cancelled', runStatus: 'open', cancellable: false });
    });

    it('shows the delivery, with who took it', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      service.deliver(departureId, booking.bookingId, MANAGER, 'Joseph at the gate');
      expect(service.forShipper(SHIPPER)[0]).toMatchObject({ bookingStatus: 'delivered', receivedBy: 'Joseph at the gate', cancellable: false });
    });

    it('keeps history rather than tidying it away', () => {
      // "Did I book that Tuesday truck or only think about it" is a real question, and a list of live
      // rows only answers it wrongly and confidently.
      const { service, departureId } = setUp();
      const a = book(service, departureId);
      book(service, departureId);
      service.cancelBooking(departureId, a.bookingId, SHIPPER);
      service.setStatus(departureId, 'departed', MANAGER);
      expect(service.forShipper(SHIPPER)).toHaveLength(2);
    });

    it('says a departed run can no longer be given back, which is what the button reads', () => {
      const { service, departureId } = setUp();
      book(service, departureId);
      service.setStatus(departureId, 'departed', MANAGER);
      expect(service.forShipper(SHIPPER)[0].cancellable).toBe(false);
      // And the flag is not decoration: the service refuses it for the same reason.
      const id = service.forShipper(SHIPPER)[0].bookingId;
      expect(() => service.cancelBooking(departureId, id, SHIPPER)).toThrow(/has gone/);
    });

    it('carries their own waits and not the truck’s', () => {
      const { service, departureId } = setUp();
      const mine = book(service, departureId, SHIPPER);
      const theirs = book(service, departureId, OTHER);
      service.assignDriver(departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' });
      service.arrive(departureId, theirs.bookingId, 'loading', DRIVER);

      // Three loads on one truck and the two-hour stand at the second gate belongs to one shipper.
      expect(service.forShipper(SHIPPER)[0].waits).toHaveLength(0);
      expect(service.forShipper(OTHER)[0].waits).toHaveLength(1);
      expect(mine.bookingId).not.toBe(theirs.bookingId);
    });
  });

  /* ------------------------------------------------------------ the rest of the spine -- */

  describe('the events that had no consumers and now have a spine', () => {
    it('tells the fleet when its space goes', () => {
      const { service, departureId, of } = setUp();
      book(service, departureId);
      expect(of(GlosEvent.Pudo.DepartureBooked)[0].payload).toMatchObject({ managerDid: MANAGER, shipperDid: SHIPPER, price: 450 });
    });

    it('tells the fleet when space comes back', () => {
      const { service, departureId, of } = setUp();
      const booking = book(service, departureId);
      service.cancelBooking(departureId, booking.bookingId, SHIPPER);
      expect(of(GlosEvent.Pudo.DepartureBookingCancelled)[0].payload).toMatchObject({ managerDid: MANAGER, by: SHIPPER });
    });

    it('says when the truck has gone — the moment after which nothing can change', () => {
      const { service, departureId, of } = setUp();
      book(service, departureId);
      service.setStatus(departureId, 'departed', MANAGER);
      expect(of(GlosEvent.Pudo.DepartureDeparted)[0].payload).toMatchObject({ shippers: [SHIPPER] });
    });

    it('never lets a failed publish undo a fleet’s decision', async () => {
      // Fire-and-forget on purpose: a notification service being down must not stop a truck being
      // marked gone. The rejection is swallowed, and this test would fail on an unhandled one.
      const corridors = new CorridorService();
      const angry = { publish: async () => { throw new Error('bus down'); } } as unknown as EventBus;
      const service = new DepartureService(corridors, managers, clearDrivers, oneTruck, openEverywhere, angry);
      const proposed = corridors.proposeLine({ managerDid: MANAGER, company: 'Life Haulage', name: 'Angry line', originZone: 'Angry A', destZone: 'Angry B', vehicleType: 'truck' });
      const corridor = corridors.publish(proposed.corridorId, 'did:glos:network-staff');
      const run = service.declare({ managerDid: MANAGER, corridorId: corridor.corridorId, vehicleId: 'veh_1', leavesAt: new Date(Date.now() + 86_400_000).toISOString(), capacityKg: 6000, basis: 'per_trip', amount: 450 });

      expect(service.setStatus(run.departureId, 'departed', MANAGER).status).toBe('departed');
      await new Promise((r) => setImmediate(r));
    });
  });
});
