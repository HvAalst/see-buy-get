import { DepartureService } from './departure.service';
import { DepartureNoteService } from './departure-note.service';
import { ConsignmentNoteService } from './consignment-note.service';
import { CorridorService } from './corridor.service';
import { CargoService } from './cargo.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { requiredUnloadKeys } from './heavy-cargo';
import type { DriverService } from './driver.service';
import type { VehicleService } from './vehicle.service';
import type { AgentService } from './agent.service';
import type { VendorService } from './vendor.service';
import type { FleetManagerService } from './fleet-manager.service';
import type { PresenceService } from '../../foundation/presence/presence.service';
import type { EventBus } from '../../foundation/events/event-bus.service';
import type { MediaService } from './media.service';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';

/**
 * F5 — A RUN'S BOOKING IS A CONTRACT OF CARRIAGE, and produces the document one produces.
 *
 * The rule for FP2 was: implement the CMR, and let it be the standard where there is no standard. It did
 * not stop applying because the load arrived through a different door — and a booking on a run was the
 * only kind of carriage on this network that produced no document at all.
 *
 * And a claim, which is the other half. On a board haul the network took the shipper's money, so it can
 * take some of it back off the carrier. Here the fleet was paid directly and we carry no cover, so an
 * award of ours would be an award of somebody else's money. What CAN be built — and is the thing informal
 * freight has never had — is the RECORD: a dated claim against a note, beside the photographs, with the
 * carrier's answer next to it. That is what a forwarder or an insurer can act on.
 */
describe('a run’s booking as a contract of carriage', () => {
  const MANAGER = 'did:glos:fleet-note';
  const DRIVER = 'did:glos:driver-note';
  const SHIPPER = 'did:glos:shipper-note';
  const STRANGER = 'did:glos:nobody';

  const managers = { get: () => ({ jurisdiction: 'KE' }), tradingBlocks: () => [], assertMayTakeWork: () => undefined } as unknown as FleetManagerService;
  const clearDrivers = { canOperate: () => true, offRoadReasons: () => [] } as unknown as DriverService;
  const openEverywhere = { can: () => true } as unknown as PresenceService;
  const adoptions: Array<{ mediaId: string; role: string }> = [];
  const media = {
    adopt: (mediaId: string, _by: string, _s: unknown, role: string) => void adoptions.push({ mediaId, role }),
    // Round 31 — every photo is held here: the check itself is the media service's, tested there and over the wire.
    requireHeld: () => undefined,
    anchorFreightTerminal: () => undefined,
    holdFreightForDispute: () => undefined,
  } as unknown as MediaService;
  const vehicles = {
    get: () => ({ vehicleId: 'veh_n', plate: 'KDA 777N', vehicleClass: 'truck', capacityKg: 8000, managerDid: MANAGER, status: 'ACTIVE' }),
    isUsable: () => true,
    offRoadReasons: () => [],
  } as unknown as VehicleService;
  const agents = { get: () => ({ shopName: 'Mama Sarah Shop', physicalAddress: '12 Ngong Road', country: 'KE', did: SHIPPER }) } as unknown as AgentService;
  const vendors = { has: () => false, get: () => ({}) } as unknown as VendorService;

  const asShipper = { role: 'pudo', did: SHIPPER } as unknown as IntrospectionResult;
  const asFleet = { role: 'fleet_manager', did: MANAGER } as unknown as IntrospectionResult;
  const asStranger = { role: 'pudo', did: STRANGER } as unknown as IntrospectionResult;

  let lanes = 0;
  const setUp = (over: Record<string, unknown> = {}) => {
    lanes += 1;
    const corridors = new CorridorService();
    const heard: Array<{ name: string; payload: Record<string, unknown> }> = [];
    const bus = { publish: async (name: string, payload: Record<string, unknown>) => void heard.push({ name, payload }) } as unknown as EventBus;
    const service = new DepartureService(corridors, managers, clearDrivers, vehicles, new CargoService(), media, openEverywhere, bus);
    // The real renderer, with no dependencies wired: htmlFor() is a pure function of the note it is
    // handed, so this prints through exactly the code a board haul prints through.
    const renderer = new ConsignmentNoteService(
      undefined as never, undefined as never, undefined as never, undefined as never,
      undefined as never, undefined as never, undefined as never,
    );
    const notes = new DepartureNoteService(service, renderer, new CargoService(), agents, vendors);
    const proposed = corridors.proposeLine({ managerDid: MANAGER, company: 'Note Haulage', name: `Note line ${lanes}`, originZone: 'Nairobi', destZone: 'Mombasa', vehicleType: 'truck' });
    const corridor = corridors.publish(proposed.corridorId, 'did:glos:network-staff');
    const run = service.declare({
      managerDid: MANAGER,
      corridorId: corridor.corridorId,
      vehicleId: 'veh_n',
      leavesAt: new Date(Date.now() + 86_400_000).toISOString(),
      basis: 'per_trip',
      amount: 900,
      settleMethod: 'mobile_money',
      settleWhen: 'on_delivery',
      ...over,
    });
    const booking = service.book(run.departureId, { shipperDid: SHIPPER, description: 'Solar panels, 12 crates', weightKg: 800, declaredValue: 450000 }).booking;
    service.assignDriver(run.departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' });
    return { service, notes, departureId: run.departureId, bookingId: booking.bookingId, of: (n: string) => heard.filter((e) => e.name === n) };
  };

  const proof = { receiverName: 'Joseph at the gate', photoRef: 'med_pod', confirmed: requiredUnloadKeys() };

  /* ------------------------------------------------------------------- the note -- */

  describe('the consignment note', () => {
    it('B4 — names the CLIENT as sender when an expeditor booked for them, and the expeditor as their agent', () => {
      const { service, departureId } = setUp();
      const forwarder = { byDid: (did: string) => (did === SHIPPER ? { kind: 'business', name: 'Abyssinia Forwarding', jurisdiction: 'ET', did: SHIPPER } : undefined) };
      const renderer = new ConsignmentNoteService(undefined as never, undefined as never, undefined as never, undefined as never, undefined as never, undefined as never, undefined as never);
      const notes = new DepartureNoteService(service, renderer, new CargoService(), agents, vendors, forwarder as never);
      const { booking } = service.book(departureId, { shipperDid: SHIPPER, bookedByName: 'Hana Tadesse', onBehalfOf: { clientId: 'cli_1', name: 'Yirgacheffe Union', country: 'ET', address: 'Dilla' }, description: 'Coffee samples', weightKg: 40 });
      const n = notes.note(departureId, booking.bookingId, asShipper);
      expect(n.sender).toMatchObject({ name: 'Yirgacheffe Union', address: 'Dilla' });
      expect(n.agent).toMatchObject({ name: 'Abyssinia Forwarding' });
      expect(n.confirmations.sender.by).toBe('Hana Tadesse, for Abyssinia Forwarding, as agent for Yirgacheffe Union');
      expect(notes.html(departureId, booking.bookingId, asShipper)).toContain('Booked by Abyssinia Forwarding as agent for the sender');
      // A booking for nobody in particular names nobody as agent.
      const own = service.book(departureId, { shipperDid: SHIPPER, description: 'Own goods', weightKg: 40 }).booking;
      expect(notes.note(departureId, own.bookingId, asShipper).agent).toBeUndefined();
    });

    it('names the law of the run from the countries its zones’ hubs stand in, and stays national where it cannot tell', () => {
      const { service, departureId, bookingId } = setUp();
      const renderer = new ConsignmentNoteService(undefined as never, undefined as never, undefined as never, undefined as never, undefined as never, undefined as never, undefined as never);
      const hubs = (countries: Record<string, string>) => ({ mdpForZone: (zone: string) => (countries[zone] ? { country: countries[zone] } : undefined), countryOf: (m: { country: string }) => m.country });
      const across = new DepartureNoteService(service, renderer, new CargoService(), agents, vendors, undefined, hubs({ Nairobi: 'KE', Mombasa: 'UG' }) as never);
      expect(across.note(departureId, bookingId, asShipper)).toMatchObject({ kind: 'northern_corridor', title: 'International road consignment note — Northern Corridor' });
      const unknown = new DepartureNoteService(service, renderer, new CargoService(), agents, vendors, undefined, hubs({ Nairobi: 'KE' }) as never);
      expect(unknown.note(departureId, bookingId, asShipper)).toMatchObject({ kind: 'national', title: 'Consignment note (CMR layout)' });
    });

    it('names the sender, the carrier and the vehicle that took the goods', () => {
      const { notes, departureId, bookingId } = setUp();
      const n = notes.note(departureId, bookingId, asShipper);
      expect(n.sender).toMatchObject({ name: 'Mama Sarah Shop', address: '12 Ngong Road' });
      expect(n.carrier).toMatchObject({ name: 'Note Haulage', plate: 'KDA 777N', driverName: 'Wanjiru' });
    });

    it('says the consignee is NOT STATED rather than inventing one', () => {
      // A run sells space, not a door. Inventing a party would be the one lie on an otherwise honest page.
      const { notes, departureId, bookingId } = setUp();
      expect(notes.note(departureId, bookingId, asShipper).consignee.name).toMatch(/Not stated/);
    });

    it('puts the declared value and the carrier’s cover in the same box', () => {
      // Either alone is a half-truth: a value with no cover reads as insured, a limit with no value reads
      // as sufficient. Side by side they are the gap, stated.
      const { notes, departureId, bookingId } = setUp({ coverLimit: 200000, coverPolicy: 'Jubilee GIT/2026/114' });
      const said = notes.note(departureId, bookingId, asShipper).instructions.join(' | ');
      expect(said).toContain('450000');
      expect(said).toContain('200000');
      expect(said).toContain('Jubilee GIT/2026/114');
      expect(said).toContain('SeeBuyGet carries no cover');
    });

    it('says plainly when the carrier holds NO cover', () => {
      const { notes, departureId, bookingId } = setUp({ coverLimit: 0 });
      expect(notes.note(departureId, bookingId, asShipper).instructions.join(' | ')).toContain('travel uninsured');
    });

    it('says the carrier has not said, rather than guessing either way', () => {
      const { notes, departureId, bookingId } = setUp();
      expect(notes.note(departureId, bookingId, asShipper).instructions.join(' | ')).toContain('has not stated what cover');
    });

    it('says in box 14 that we neither bill nor hold the payment', () => {
      // The board's note can say the network billed the sender. This one must not: the fleet quoted their
      // own price and was paid directly, so `between-parties` is the honest answer.
      const { notes, departureId, bookingId } = setUp();
      const n = notes.note(departureId, bookingId, asShipper);
      expect(n.carriage.paidBy).toBe('between-parties');
      expect(n.carriage.note).toContain('does not bill or hold this payment');
      expect(n.carriage.note).toContain('by mobile money on delivery');
    });

    it('carries the photographs as box 5, once they exist', () => {
      const { service, notes, departureId, bookingId } = setUp();
      expect(notes.note(departureId, bookingId, asShipper).documents).toHaveLength(0);

      service.arrive(departureId, bookingId, 'loading', DRIVER);
      const run = service.require(departureId);
      service.secured(departureId, bookingId, DRIVER, { confirmed: service.loadChecklist(run, run.bookings[0]), securementPhotoRef: 'med_sec' });
      service.deliver(departureId, bookingId, DRIVER, proof);

      const documents = notes.note(departureId, bookingId, asShipper).documents.join(' | ');
      expect(documents).toContain('med_sec');
      expect(documents).toContain('med_pod');
    });

    it('records who actually took the goods as the third confirmation', () => {
      const { service, notes, departureId, bookingId } = setUp();
      service.deliver(departureId, bookingId, MANAGER, proof);
      expect(notes.note(departureId, bookingId, asShipper).confirmations.consignee).toMatchObject({ by: 'Joseph at the gate' });
    });

    it('prints on the board’s own renderer, not a second layout', () => {
      const { notes, departureId, bookingId } = setUp();
      const html = notes.html(departureId, bookingId, asShipper);
      expect(html).toContain('Consignment note');
      expect(html).toContain('Mama Sarah Shop');
      expect(html).toContain('KDA 777N');
    });

    it('is not a public document', () => {
      // It names both sides and describes the goods. The same stance the board's note takes.
      const { notes, departureId, bookingId } = setUp();
      expect(() => notes.note(departureId, bookingId, asStranger)).toThrow(/only the parties to it/);
      expect(() => notes.note(departureId, bookingId, undefined)).toThrow(/only the parties to it/);
      expect(notes.note(departureId, bookingId, asFleet).number).toMatch(/^CMR-/);
    });
  });

  /* ------------------------------------------------------------------ the claim -- */

  describe('a claim, recorded and never adjudicated', () => {
    const delivered = () => {
      const s = setUp();
      s.service.deliver(s.departureId, s.bookingId, MANAGER, proof);
      return s;
    };

    it('is the shipper’s to raise and nobody else’s', () => {
      const { service, departureId, bookingId } = delivered();
      expect(() => service.openClaim(departureId, bookingId, MANAGER, { kind: 'damaged', description: 'Two crates crushed' })).toThrow(/Only the shipper/);
      expect(service.openClaim(departureId, bookingId, SHIPPER, { kind: 'damaged', description: 'Two crates crushed' }).booking.claim?.kind).toBe('damaged');
    });

    it('needs the goods to have been delivered first', () => {
      const { service, departureId, bookingId } = setUp();
      expect(() => service.openClaim(departureId, bookingId, SHIPPER, { kind: 'damaged', description: 'x' })).toThrow(/not been handed over yet/);
    });

    it('needs words, because the carrier is answering it', () => {
      const { service, departureId, bookingId } = delivered();
      expect(() => service.openClaim(departureId, bookingId, SHIPPER, { kind: 'damaged', description: '   ' })).toThrow(/Say what went wrong/);
    });

    it('refuses a kind nobody agreed on, and lists the ones that exist', () => {
      const { service, departureId, bookingId } = delivered();
      expect(() => service.openClaim(departureId, bookingId, SHIPPER, { kind: 'annoyed', description: 'x' })).toThrow(/damaged, short, not_received/);
    });

    it('keeps the shipper’s photograph in the dispute-evidence bin', () => {
      const { service, departureId, bookingId } = delivered();
      adoptions.length = 0;
      service.openClaim(departureId, bookingId, SHIPPER, { kind: 'damaged', description: 'Crushed', photoRef: 'med_claim' });
      // The same bin the board's claim photos use, and the same 180-day retention: a claim argued in
      // month five still has its photograph.
      expect(adoptions).toContainEqual({ mediaId: 'med_claim', role: 'dispute' });
    });

    it('closes after the window, because a carrier is not answering in March for a January load', () => {
      const { service, departureId, bookingId } = delivered();
      const booking = service.require(departureId).bookings[0];
      const old = { ...booking, deliveredAt: new Date(Date.now() - 30 * 86_400_000).toISOString() };
      expect(DepartureService.claimable(old)).toBe(false);
      expect(DepartureService.claimable(booking)).toBe(true);
    });

    it('takes one claim, not a second bite', () => {
      const { service, departureId, bookingId } = delivered();
      service.openClaim(departureId, bookingId, SHIPPER, { kind: 'short', description: 'Two crates missing' });
      expect(() => service.openClaim(departureId, bookingId, SHIPPER, { kind: 'damaged', description: 'And crushed' })).toThrow(/already a claim/);
    });

    it('tells the carrier, and awards nothing', () => {
      const { service, departureId, bookingId, of } = delivered();
      service.openClaim(departureId, bookingId, SHIPPER, { kind: 'damaged', description: 'Crushed', amount: 120000 });
      const [event] = of(GlosEvent.Pudo.DepartureClaimOpened);
      expect(event.payload).toMatchObject({ managerDid: MANAGER, kind: 'damaged', amount: 120000 });
      // Their figure, carried. Not a decision, not an award, and nothing on any ledger.
      expect(JSON.stringify(event.payload)).not.toMatch(/award|decision|upheld/i);
    });

    it('carries the carrier’s answer back, in their own words', () => {
      const { service, departureId, bookingId, of } = delivered();
      service.openClaim(departureId, bookingId, SHIPPER, { kind: 'damaged', description: 'Crushed' });
      const { booking } = service.answerClaim(departureId, bookingId, MANAGER, 'accepted', 'Our strap failed. We will settle it.');
      expect(booking.claim).toMatchObject({ answer: 'accepted', answerNote: 'Our strap failed. We will settle it.' });
      expect(of(GlosEvent.Pudo.DepartureClaimAnswered)[0].payload).toMatchObject({ shipperDid: SHIPPER, answer: 'accepted' });
    });

    it('will not take a refusal with no reason', () => {
      // A refusal with no reason is not an answer the other side can do anything with — and the whole
      // value here is that the other side CAN do something with it.
      const { service, departureId, bookingId } = delivered();
      service.openClaim(departureId, bookingId, SHIPPER, { kind: 'damaged', description: 'Crushed' });
      expect(() => service.answerClaim(departureId, bookingId, MANAGER, 'refused')).toThrow(/Say why you are refusing it/);
      expect(service.answerClaim(departureId, bookingId, MANAGER, 'refused', 'Loaded and signed for in that state').booking.claim?.answer).toBe('refused');
    });

    it('answers once', () => {
      const { service, departureId, bookingId } = delivered();
      service.openClaim(departureId, bookingId, SHIPPER, { kind: 'damaged', description: 'Crushed' });
      service.answerClaim(departureId, bookingId, MANAGER, 'refused', 'Signed for in that state');
      expect(() => service.answerClaim(departureId, bookingId, MANAGER, 'accepted', 'Changed my mind')).toThrow(/already answered/);
    });

    it('is on the shipper’s own screen, with whether there is still time to raise one', () => {
      const { service, departureId, bookingId } = delivered();
      expect(service.forShipper(SHIPPER)[0].claimable).toBe(true);
      service.openClaim(departureId, bookingId, SHIPPER, { kind: 'damaged', description: 'Crushed' });
      const mine = service.forShipper(SHIPPER)[0];
      expect(mine.claim?.kind).toBe('damaged');
      expect(mine.claimable).toBe(false);
    });

    it('lands on the consignment note, which is where it is argued from', () => {
      const { service, notes, departureId, bookingId } = delivered();
      service.openClaim(departureId, bookingId, SHIPPER, { kind: 'damaged', description: 'Two crates crushed' });
      service.answerClaim(departureId, bookingId, MANAGER, 'refused', 'Signed for in that state');
      const n = notes.note(departureId, bookingId, asShipper);
      expect(n.claim?.line).toContain('Two crates crushed');
      expect(n.claim?.decision).toContain('Signed for in that state');
    });
  });
});
