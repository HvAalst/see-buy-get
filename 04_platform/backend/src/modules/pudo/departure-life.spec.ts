import { DepartureService } from './departure.service';
import { CorridorService } from './corridor.service';
import { CargoService } from './cargo.service';
import type { MediaService } from './media.service';

/** A photo store that only remembers what it was asked to adopt. */
const adoptions: Array<{ mediaId: string; by: string; role: string }> = [];
const anchored: string[] = [];
const held: string[] = [];
/** Round 31 — every photo a step asked to be checked: whose, and for what. */
const checked: Array<{ mediaId: string; by: string; link: unknown }> = [];
const adopted = () =>
  ({
    adopt: (mediaId: string, by: string, _subject: unknown, role: string) => {
      adoptions.push({ mediaId, by, role });
    },
    // Round 31 — every photo is held here, and each is remembered: that a step ASKS is what this spec proves; the check
    // itself is the media service's, tested there and over the wire.
    requireHeld: (mediaId: string, by: string, link: unknown) => void checked.push({ mediaId, by, link }),
    // Retention: a run now starts and holds its evidence clock the way the board has since S33.
    anchorFreightTerminal: (id: string) => void anchored.push(id),
    holdFreightForDispute: (id: string) => void held.push(id),
  }) as unknown as MediaService;
import { GlosEvent } from '../../foundation/events/glos-events';
import { requiredLoadKeys, requiredUnloadKeys } from './heavy-cargo';
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

  const managers = { get: () => ({ jurisdiction: 'KE' }), tradingBlocks: () => [], assertMayTakeWork: () => undefined } as unknown as FleetManagerService;

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
    const service = new DepartureService(corridors, managers, clearDrivers, oneTruck, new CargoService(), adopted(), openEverywhere, bus);
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
    /*
     * THE BOARD’S STANDARD, NOT A SOFTER ONE.
     *
     * deliverFreight has refused a delivery without a completed unload checklist, a receiver’s name and a
     * photograph since FP3. This took an optional name and nothing else — the same act, the same driver,
     * the same door, provable on a haul and unprovable on a run. A shipper who found that out after a
     * load went missing would be right to feel misled.
     */
    const proof = (over: Record<string, unknown> = {}) => ({
      receiverName: 'Joseph at the gate',
      photoRef: 'med_pod1',
      confirmed: requiredUnloadKeys(),
      ...over,
    });

    it('records who took it, and when, on the server clock', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      service.assignDriver(departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' });

      const { booking: done } = service.deliver(departureId, booking.bookingId, DRIVER, proof({ receiverName: '  Joseph at the gate  ' }));
      expect(done.status).toBe('delivered');
      expect(done.receivedBy).toBe('Joseph at the gate');
      expect(done.pod).toMatchObject({ receiverName: 'Joseph at the gate', photoRef: 'med_pod1', by: DRIVER });
      expect(Date.parse(done.deliveredAt as string)).toBeLessThanOrEqual(Date.now());
    });

    it('refuses without a receiver’s name, exactly as a board haul does', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      expect(() => service.deliver(departureId, booking.bookingId, MANAGER, proof({ receiverName: 'x' }))).toThrow(/Record who received the goods/);
      // And the booking is untouched: a refused delivery must not half-deliver anything.
      expect(service.require(departureId).bookings[0].status).toBe('booked');
    });

    it('refuses without a photograph of the goods as delivered', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      expect(() => service.deliver(departureId, booking.bookingId, MANAGER, proof({ photoRef: undefined }))).toThrow(/Attach a photo/);
    });

    it('refuses on an unfinished unload checklist, and says how much is left', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      expect(() => service.deliver(departureId, booking.bookingId, MANAGER, proof({ confirmed: [] }))).toThrow(/Complete the unload checklist/);
    });

    it('takes the photograph as the driver’s own, rather than trusting a pointer at one', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      service.assignDriver(departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' });
      adoptions.length = 0;
      service.deliver(departureId, booking.bookingId, DRIVER, proof());
      // Adopt-not-link: only an unattached upload of THEIRS is taken, so a photo of somebody else’s load
      // cannot be pointed at.
      expect(adoptions).toContainEqual({ mediaId: 'med_pod1', by: DRIVER, role: 'pod' });
      // …and before anything was written, asked whether it is one we hold, the driver's, for this load alone (round 31).
      expect(checked).toContainEqual({ mediaId: 'med_pod1', by: DRIVER, link: { type: 'freight', id: booking.bookingId } });
    });

    it('is the carrier’s to record and not the shipper’s', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      // A delivery the receiving side can mark itself is a record of nothing.
      expect(() => service.deliver(departureId, booking.bookingId, SHIPPER, proof())).toThrow(/Only the driver on this run or the fleet/);
    });

    it('is idempotent — a second tap is not a second delivery', () => {
      const { service, departureId, of } = setUp();
      const booking = book(service, departureId);
      const first = service.deliver(departureId, booking.bookingId, MANAGER, proof()).booking.deliveredAt;
      const second = service.deliver(departureId, booking.bookingId, MANAGER, proof()).booking.deliveredAt;
      expect(second).toBe(first);
      expect(of(GlosEvent.Pudo.DepartureDelivered)).toHaveLength(1);
    });

    it('tells the shipper their goods arrived, and who took them', () => {
      const { service, departureId, of } = setUp();
      const booking = book(service, departureId);
      service.deliver(departureId, booking.bookingId, MANAGER, proof());

      expect(of(GlosEvent.Pudo.DepartureDelivered)[0].payload).toMatchObject({
        shipperDid: SHIPPER,
        kind: 'sold',
        description: 'Maize',
        receivedBy: 'Joseph at the gate',
      });
    });

    it('refuses a load that was never aboard, and one on a run that was called off', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      service.cancelBooking(departureId, booking.bookingId, SHIPPER);
      expect(() => service.deliver(departureId, booking.bookingId, MANAGER, proof())).toThrow(/never aboard/);

      const second = setUp();
      const other = book(second.service, second.departureId);
      second.service.setStatus(second.departureId, 'cancelled', MANAGER, 'off');
      expect(() => second.service.deliver(second.departureId, other.bookingId, MANAGER, proof())).toThrow(/called off/);
    });

    it('will not let a delivered load be given back', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      service.deliver(departureId, booking.bookingId, MANAGER, proof());
      expect(() => service.cancelBooking(departureId, booking.bookingId, SHIPPER)).toThrow(/handed over/);
    });

    it('frees the space it was taking, because the goods are off the truck', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      expect(service.remaining(service.require(departureId)).kg).toBe(5500);
      service.deliver(departureId, booking.bookingId, MANAGER, proof());
      expect(service.remaining(service.require(departureId)).kg).toBe(6000);
    });
  });

  /* ------------------------------------------------- the other end of the same standard -- */

  describe('what the driver confirmed before pulling away', () => {
    it('refuses to record securement on an unfinished checklist', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      service.assignDriver(departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' });
      service.arrive(departureId, booking.bookingId, 'loading', DRIVER);
      expect(() => service.secured(departureId, booking.bookingId, DRIVER, { confirmed: [] })).toThrow(/Complete the load-safety checklist/);
    });

    it('asks MORE of a hazardous load than of a pallet of books', () => {
      // The checklist depends on the goods, read from the booking’s own nature — so a drum of solvent is
      // never signed off with the checks for a box of paperbacks.
      const { service, departureId } = setUp();
      const plain = service.book(departureId, { shipperDid: SHIPPER, description: 'Books', weightKg: 100, nature: 'GEN' }).booking;
      const run = service.require(departureId);
      const forBooks = service.loadChecklist(run, plain);
      const forSolvent = requiredLoadKeys({ requiredCapabilities: ['hazmat'], fragile: false, bulk: false });
      expect(forSolvent.length).toBeGreaterThan(forBooks.length);
    });

    it('keeps the photograph as the driver’s own', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      service.assignDriver(departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' });
      service.arrive(departureId, booking.bookingId, 'loading', DRIVER);
      adoptions.length = 0;
      const run = service.require(departureId);
      service.secured(departureId, booking.bookingId, DRIVER, { confirmed: service.loadChecklist(run, booking), securementPhotoRef: 'med_sec1' });
      expect(adoptions).toContainEqual({ mediaId: 'med_sec1', by: DRIVER, role: 'securement' });
      expect(checked).toContainEqual({ mediaId: 'med_sec1', by: DRIVER, link: { type: 'freight', id: booking.bookingId } }); // round 31
      expect(service.require(departureId).bookings[0].loadSafety?.securementPhotoRef).toBe('med_sec1');
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
      service.deliver(departureId, booking.bookingId, MANAGER, { receiverName: 'Joseph at the gate', photoRef: 'med_pod2', confirmed: requiredUnloadKeys() });
      // The proof itself, not only its date: the shipper is the party it exists for.
      expect(service.forShipper(SHIPPER)[0]).toMatchObject({
        bookingStatus: 'delivered',
        receivedBy: 'Joseph at the gate',
        cancellable: false,
        pod: { photoRef: 'med_pod2' },
      });
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
      const service = new DepartureService(corridors, managers, clearDrivers, oneTruck, new CargoService(), adopted(), openEverywhere, angry);
      const proposed = corridors.proposeLine({ managerDid: MANAGER, company: 'Life Haulage', name: 'Angry line', originZone: 'Angry A', destZone: 'Angry B', vehicleType: 'truck' });
      const corridor = corridors.publish(proposed.corridorId, 'did:glos:network-staff');
      const run = service.declare({ managerDid: MANAGER, corridorId: corridor.corridorId, vehicleId: 'veh_1', leavesAt: new Date(Date.now() + 86_400_000).toISOString(), capacityKg: 6000, basis: 'per_trip', amount: 450 });

      expect(service.setStatus(run.departureId, 'departed', MANAGER).status).toBe('departed');
      await new Promise((r) => setImmediate(r));
    });
  });

  /* -------------------------------------------------------- the evidence clock -- */

  /**
   * THE RETENTION PAIR — two holes the archive slice found, and they are a matched pair.
   *
   * The board has anchored a freight's photographs at delivery since S33 and swept both sides' evidence
   * onto one dispute clock since FP3b. A run did neither: every photograph it ever took had no expiry at
   * all (kept FOR EVER, while the board deleted the same evidence at 90 days), and its claim moved only
   * the complainant's own photo onto the case clock. Fixing the first alone would have been worse than
   * neither — the proof of delivery would then die at day 90 with the accusation alive to day 180.
   */
  describe('the evidence clock', () => {
    const proof = () => ({ receiverName: 'Joseph at the gate', photoRef: 'med_pod1', confirmed: requiredUnloadKeys() });

    it('starts at delivery, per load, the way the board’s has since S33', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      anchored.length = 0;
      service.deliver(departureId, booking.bookingId, MANAGER, proof());
      // The BOOKING, not the run: a truck with four loads on it delivers them one at a time, and the
      // other three are still in the world.
      expect(anchored).toEqual([booking.bookingId]);
    });

    it('does not start for loads still on the truck', () => {
      const { service, departureId } = setUp();
      const first = book(service, departureId);
      const second = book(service, departureId);
      anchored.length = 0;
      service.deliver(departureId, first.bookingId, MANAGER, proof());
      expect(anchored).not.toContain(second.bookingId);
    });

    it('starts when a booking is given back before it ever travelled', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      anchored.length = 0;
      service.cancelBooking(departureId, booking.bookingId, SHIPPER);
      expect(anchored).toEqual([booking.bookingId]);
    });

    it('starts for everybody aboard when the run is called off', () => {
      const { service, departureId } = setUp();
      const first = book(service, departureId);
      const second = book(service, departureId);
      service.cancelBooking(departureId, second.bookingId, SHIPPER);
      anchored.length = 0;
      service.setStatus(departureId, 'cancelled', MANAGER, 'The truck broke an axle');
      // The one already given back is not anchored twice; the one that was aboard is.
      expect(anchored).toEqual([first.bookingId]);
    });

    it('does NOT start merely because the truck left — those goods are still in the world', () => {
      const { service, departureId } = setUp();
      book(service, departureId);
      anchored.length = 0;
      service.setStatus(departureId, 'departed', MANAGER);
      expect(anchored).toEqual([]);
    });

    it('puts the carrier’s evidence on the case clock when a claim is raised, not just the claimant’s', () => {
      // The half that decides most claims is the securement photo and the proof of delivery, and until
      // now a run kept the accusation on a 180-day clock and the defence on a 90-day one.
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      service.deliver(departureId, booking.bookingId, MANAGER, proof());
      held.length = 0;
      service.openClaim(departureId, booking.bookingId, SHIPPER, { kind: 'damaged', description: 'Two panels cracked', photoRef: 'med_claim' });
      expect(held).toEqual([booking.bookingId]);
      expect(checked).toContainEqual({ mediaId: 'med_claim', by: SHIPPER, link: { type: 'freight', id: booking.bookingId } }); // round 31
    });
  });

  /* ------------------------------------------------------ the tracking link -- */

  /**
   * A LOAD HAD A TRACKING LINK; SPACE ON A RUN DID NOT. An expeditor booking for a client could hand that client a
   * link for a load and nothing for the same goods on a scheduled run. These pin that a booking answers on the same
   * page, read-only, and that the page says nothing a forwarded link should not: no money, no shipper, nobody else aboard.
   */
  describe('the tracking link on a booking', () => {
    const proof = () => ({ receiverName: 'Joseph at the gate', photoRef: 'med_pod1', confirmed: requiredUnloadKeys() });

    it('gives every sold booking its own key, and the shipper the link to hand on', () => {
      const { service, departureId } = setUp();
      const one = book(service, departureId);
      const two = book(service, departureId, OTHER);
      expect(one.trackingKey).toMatch(/^T-[0-9A-F]{10}$/);
      expect(two.trackingKey).not.toBe(one.trackingKey);
      const mine = service.forShipper(SHIPPER).find((r) => r.bookingId === one.bookingId)!;
      expect(mine.trackingKey).toBe(one.trackingKey);
      expect(mine.trackingUrl).toMatch(new RegExp(`\\?track=${one.trackingKey}$`));
    });

    it('reads booked, then under way from the moment it left, then delivered to whom', () => {
      const { service, departureId } = setUp();
      const booking = book(service, departureId);
      const booked = service.trackView(booking.trackingKey!)!;
      expect(booked).toMatchObject({ kind: 'freight', on: 'run', status: 'claimed', description: 'Maize', weightKg: 500 });
      expect(booked.carrier).toMatchObject({ name: 'Life Haulage', plate: 'KDA 001A' });
      expect(booked.steps.map((x) => x.status)).toEqual(['claimed']);

      service.setStatus(departureId, 'departed', MANAGER);
      const gone = service.require(departureId).departedAt!;
      expect(gone).toBeTruthy();
      const moving = service.trackView(booking.trackingKey!)!;
      expect(moving.status).toBe('in_transit');
      expect(moving.steps).toEqual([{ status: 'claimed', at: booking.at }, { status: 'in_transit', at: gone }]);

      service.deliver(departureId, booking.bookingId, MANAGER, proof());
      const done = service.trackView(booking.trackingKey!.toLowerCase())!;
      expect(done.status).toBe('delivered');
      expect(done.receiverName).toBe('Joseph at the gate');
      expect(done.steps.map((x) => x.status)).toEqual(['claimed', 'in_transit', 'delivered']);
    });

    it('says who withdrew it — the sender, or the carrier calling the run off — and never why', () => {
      const { service, departureId } = setUp();
      const mine = book(service, departureId);
      const other = book(service, departureId, OTHER);
      service.cancelBooking(departureId, mine.bookingId, SHIPPER);
      expect(service.trackView(mine.trackingKey!)).toMatchObject({ status: 'cancelled', cancelled: { by: 'sender' } });

      service.setStatus(departureId, 'cancelled', MANAGER, 'The truck threw a rod');
      const off = service.trackView(other.trackingKey!)!;
      expect(off).toMatchObject({ status: 'cancelled', cancelled: { by: 'carrier' } });
      expect(JSON.stringify(off)).not.toContain('threw a rod');
    });

    it('carries nothing a forwarded link should not: no money, no shipper, nobody else aboard', () => {
      const { service, departureId } = setUp();
      const mine = book(service, departureId);
      book(service, departureId, OTHER);
      const seen = JSON.stringify(service.trackView(mine.trackingKey!));
      expect(seen).not.toContain(SHIPPER);
      expect(seen).not.toContain(OTHER);
      expect(seen).not.toMatch(/amount|price|bookingId|shipperDid/);
    });

    it('answers nothing for a key it never issued', () => {
      const { service, departureId } = setUp();
      book(service, departureId);
      expect(service.trackView('T-0000000000')).toBeUndefined();
      expect(service.trackView('')).toBeUndefined();
    });
  });
});
