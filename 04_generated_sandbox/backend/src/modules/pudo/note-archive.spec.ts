import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { requiredUnloadKeys } from './heavy-cargo';
import { CargoService } from './cargo.service';
import { ConsignmentNoteService } from './consignment-note.service';
import { CorridorService } from './corridor.service';
import { DepartureNoteService } from './departure-note.service';
import { DepartureService } from './departure.service';
import { NoteArchiveService } from './note-archive.service';
import { boardDocId, canonicalJson, noteFingerprint, runDocId } from './note-archive.types';
import type { ConsignmentNote } from './consignment-note.types';
import type { DispatchService } from './dispatch.service';
import type { AgentService } from './agent.service';
import type { DriverService } from './driver.service';
import type { FleetManagerService } from './fleet-manager.service';
import type { MediaService } from './media.service';
import type { VehicleService } from './vehicle.service';
import type { VendorService } from './vendor.service';
import type { PresenceService } from '../../foundation/presence/presence.service';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';

/**
 * THE ARCHIVE — what happens to the consignment note once the job is finished.
 *
 * A paper CMR is three originals in three hands, each frozen at a different moment: the sender's signed at
 * taking over, the travelling copy back with the consignee's signature and whatever the driver wrote at the
 * door. Three copies that stopped changing is a consensus mechanism — when they disagree, somebody can see
 * it. This network derived its note from the LIVE record on every read, so a "copy" opened a year later was
 * a fresh render against today's facts, and a document that can still change is not evidence.
 *
 * THE TEST THAT MATTERS is `does not move when the load does`. Everything else here is plumbing around it.
 */
describe('the consignment-note archive', () => {
  const MANAGER = 'did:glos:fleet-arc';
  const DRIVER = 'did:glos:driver-arc';
  const SHIPPER = 'did:glos:shipper-arc';
  const STRANGER = 'did:glos:nobody-arc';

  const asShipper = { role: 'pudo', did: SHIPPER } as unknown as IntrospectionResult;
  const asFleet = { role: 'fleet_manager', did: MANAGER } as unknown as IntrospectionResult;
  const asDriver = { role: 'driver', did: DRIVER } as unknown as IntrospectionResult;
  const asStranger = { role: 'pudo', did: STRANGER } as unknown as IntrospectionResult;
  const asOperator = { role: 'operator', did: 'did:glos:ops' } as unknown as IntrospectionResult;

  const managers = { get: () => ({ jurisdiction: 'KE' }) } as unknown as FleetManagerService;
  const drivers = { canOperate: () => true, offRoadReasons: () => [] } as unknown as DriverService;
  const presence = { can: () => true } as unknown as PresenceService;
  const media = { adopt: () => undefined, anchorFreightTerminal: () => undefined, holdFreightForDispute: () => undefined } as unknown as MediaService;
  const agents = { get: () => ({ shopName: 'Mama Sarah Shop', physicalAddress: '12 Ngong Road', country: 'KE', did: SHIPPER }) } as unknown as AgentService;
  const vendors = { has: () => false, get: () => ({}) } as unknown as VendorService;

  const proof = { receiverName: 'Joseph at the gate', photoRef: 'med_pod', confirmed: requiredUnloadKeys() };

  let lanes = 0;
  /**
   * The real DepartureService, the real note builder, the real bus. The archive is a thing that listens,
   * so a stubbed bus would test nothing: the subscriptions ARE the feature.
   */
  const setUp = () => {
    lanes += 1;
    const bus = new EventBus();
    const corridors = new CorridorService();
    const vehicles = {
      get: () => ({ vehicleId: 'veh_a', plate: 'KDA 777N', vehicleClass: 'truck', capacityKg: 8000, managerDid: MANAGER, status: 'ACTIVE' }),
      isUsable: () => true,
      offRoadReasons: () => [],
    } as unknown as VehicleService;
    const departures = new DepartureService(corridors, managers, drivers, vehicles, new CargoService(), media, presence, bus);
    const renderer = new ConsignmentNoteService(
      undefined as never, undefined as never, undefined as never, undefined as never,
      undefined as never, undefined as never, undefined as never,
    );
    const departureNotes = new DepartureNoteService(departures, renderer, new CargoService(), agents, vendors);

    /*
     * The board half is stubbed at the note builder rather than dragged in whole: DispatchService needs a
     * dozen collaborators to produce one Freight, and what is under test here is the archive. The run half
     * runs through the real builder, and the e2e drives a board haul end to end.
     */
    let boardNote: ConsignmentNote = {
      number: 'CMR-AB12',
      kind: 'national',
      title: 'Consignment note (CMR layout)',
      freightId: 'frt_1',
      code: 'AB12',
      status: 'in_transit',
      sender: { name: 'Mama Sarah Shop' },
      consignee: { name: 'Kisumu Hardware' },
      delivery: { place: 'Kisumu' },
      takingOver: { place: 'Nairobi', at: '2026-09-01T08:00:00.000Z' },
      documents: [],
      goods: { description: 'Roofing sheets', nature: 'GEN', cargoClass: 'heavy', packages: null, grossKg: 1200, dangerous: false, fragile: false },
      instructions: [],
      carriage: { paidBy: 'sender', note: 'Billed by SeeBuyGet' },
      carrier: { name: 'Note Haulage', plate: 'KDA 777N' },
      reservations: [],
      established: { place: 'Nairobi', at: '2026-09-01T07:00:00.000Z' },
      confirmations: { sender: { by: 'Mama Sarah Shop', at: '2026-09-01T07:00:00.000Z', how: 'Confirmed electronically at posting' } },
      attempts: [],
    };
    const dispatch = { requireFreightPublic: () => ({ freightId: 'frt_1', pickupLabel: 'Nairobi', destLabel: 'Kisumu', destCountry: 'KE' }) } as unknown as DispatchService;
    const notes = {
      build: () => boardNote,
      partiesOf: () => [SHIPPER, DRIVER, MANAGER],
      htmlFor: (n: ConsignmentNote) => `<h1>${n.number}</h1><p>${n.carrier?.plate ?? ''}</p>`,
    } as unknown as ConsignmentNoteService;

    const archive = new NoteArchiveService(dispatch, notes, departures, departureNotes, bus);
    archive.onModuleInit();

    const proposed = corridors.proposeLine({ managerDid: MANAGER, company: 'Note Haulage', name: `Arc line ${lanes}`, originZone: 'Nairobi', destZone: 'Mombasa', vehicleType: 'truck' });
    const corridor = corridors.publish(proposed.corridorId, 'did:glos:network-staff');
    const run = departures.declare({
      managerDid: MANAGER,
      corridorId: corridor.corridorId,
      vehicleId: 'veh_a',
      leavesAt: new Date(Date.now() + 86_400_000).toISOString(),
      basis: 'per_trip',
      amount: 900,
    });
    const booking = departures.book(run.departureId, { shipperDid: SHIPPER, description: 'Solar panels, 12 crates', weightKg: 800, declaredValue: 450000 }).booking;
    departures.assignDriver(run.departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' });

    return {
      archive, departures, bus,
      departureId: run.departureId,
      bookingId: booking.bookingId,
      docId: runDocId(run.departureId, booking.bookingId),
      setBoardNote: (n: ConsignmentNote) => void (boardNote = n),
    };
  };

  /* ---------------------------------------------------------- the copy stops moving -- */

  describe('a frozen copy', () => {
    it('is written when the truck leaves, and again when the goods are handed over', async () => {
      const { archive, departures, departureId, bookingId, docId } = setUp();
      await departures.setStatus(departureId, 'departed', MANAGER);
      departures.deliver(departureId, bookingId, DRIVER, proof);
      await flush();

      const doc = archive.document(docId, asShipper);
      expect(doc.versions.map((v) => v.stage)).toEqual(['taken_over', 'delivered']);
      expect(doc.versions[0].seq).toBe(1);
      expect(doc.versions[1].seq).toBe(2);
      // Two moments, two different documents — if the fingerprints matched, one of them recorded nothing.
      expect(doc.versions[0].sha256).not.toBe(doc.versions[1].sha256);
    });

    it('DOES NOT MOVE WHEN THE LOAD DOES — the whole reason the archive exists', async () => {
      const { archive, departures, departureId, bookingId, docId } = setUp();
      await departures.setStatus(departureId, 'departed', MANAGER);
      await flush();
      const asTakenOver = archive.version(docId, 1, asShipper);
      const fingerprint = asTakenOver.sha256;
      expect(asTakenOver.note.carrier?.plate).toBe('KDA 777N');
      expect(asTakenOver.note.goods.description).toBe('Solar panels, 12 crates');

      // The live record moves on, the way a live record does: the fleet renames itself, re-plates the
      // truck, and the description is corrected. A derived note would answer with all three.
      const live = departures.require(departureId);
      live.company = 'Renamed Haulage Ltd';
      live.plate = 'KBZ 001Z';
      live.bookings[0].description = 'Solar panels, 11 crates';

      const again = archive.version(docId, 1, asShipper);
      expect(again.note.carrier?.name).toBe('Note Haulage');
      expect(again.note.carrier?.plate).toBe('KDA 777N');
      expect(again.note.goods.description).toBe('Solar panels, 12 crates');
      expect(noteFingerprint(again.note)).toBe(fingerprint);
    });

    it('is not written twice for one moment, because event delivery is at-least-once', async () => {
      const { archive, bus, departureId, bookingId, docId } = setUp();
      await bus.publish(GlosEvent.Pudo.DepartureDeparted, { departureId }, { source: 'test' });
      await bus.publish(GlosEvent.Pudo.DepartureDeparted, { departureId }, { source: 'test' });
      await bus.publish(GlosEvent.Pudo.DepartureDeparted, { departureId }, { source: 'test' });
      await flush();
      expect(archive.document(docId, asShipper).versions).toHaveLength(1);
      expect(bookingId).toBeTruthy();
    });

    it('records a claim and the carrier’s answer as copies of their own', async () => {
      const { archive, departures, departureId, bookingId, docId } = setUp();
      departures.deliver(departureId, bookingId, DRIVER, proof);
      departures.openClaim(departureId, bookingId, SHIPPER, { kind: 'damaged', description: 'Two panels cracked in the corner' });
      departures.answerClaim(departureId, bookingId, MANAGER, 'refused', 'They were loaded cracked');
      await flush();

      const doc = archive.document(docId, asShipper);
      expect(doc.versions.map((v) => v.stage)).toEqual(['delivered', 'claimed', 'answered']);
      // The claim is ON the document, which is the point — box 24 is where a forwarder reads it.
      expect(archive.version(docId, 3, asShipper).note.claim?.decision).toContain('refused');
      // ...and the copy taken at delivery still knows nothing about it.
      expect(archive.version(docId, 1, asShipper).note.claim).toBeUndefined();
    });

    it('leaves a cancelled booking out when the run departs — it was never aboard', async () => {
      const { archive, departures, departureId, bookingId } = setUp();
      const second = departures.book(departureId, { shipperDid: SHIPPER, description: 'A pallet of tiles', weightKg: 400 }).booking;
      departures.cancelBooking(departureId, second.bookingId, SHIPPER);
      await departures.setStatus(departureId, 'departed', MANAGER);
      await flush();

      expect(archive.document(runDocId(departureId, bookingId), asShipper).versions).toHaveLength(1);
      expect(() => archive.document(runDocId(departureId, second.bookingId), asShipper)).toThrow(/No such consignment note/);
    });
  });

  /* ------------------------------------------------------------------- who may read -- */

  describe('who may read a copy', () => {
    it('answers a stranger that it does not exist, rather than that they may not see it', async () => {
      // A note names both sides and describes the goods; its EXISTENCE is a fact about two companies.
      const { archive, departures, departureId, docId } = setUp();
      await departures.setStatus(departureId, 'departed', MANAGER);
      await flush();
      expect(() => archive.document(docId, asStranger)).toThrow(/No such consignment note/);
      expect(() => archive.version(docId, 1, asStranger)).toThrow(/No such consignment note/);
      expect(archive.register(asStranger).items).toHaveLength(0);
    });

    it('is readable by the shipper, the fleet, the driver who moved it, and an operator', async () => {
      const { archive, departures, departureId, docId } = setUp();
      await departures.setStatus(departureId, 'departed', MANAGER);
      await flush();
      for (const who of [asShipper, asFleet, asDriver, asOperator]) {
        expect(archive.document(docId, who).number).toMatch(/^CMR-/);
      }
    });

    it('keeps a party a party after the relationship ends', async () => {
      // The driver who took the goods over is a party to that carriage for good, even once the fleet has
      // put somebody else on the run. A live lookup would have quietly stopped answering them.
      const { archive, departures, departureId, bookingId, docId } = setUp();
      await departures.setStatus(departureId, 'departed', MANAGER);
      await flush();
      departures.assignDriver(departureId, MANAGER, { did: 'did:glos:driver-other', name: 'Otieno' });
      departures.deliver(departureId, bookingId, 'did:glos:driver-other', proof);
      await flush();

      expect(archive.document(docId, asDriver).versions).toHaveLength(2);
      expect(archive.document(docId, { role: 'driver', did: 'did:glos:driver-other' } as unknown as IntrospectionResult).versions).toHaveLength(2);
    });
  });

  /* ---------------------------------------------------------------- the register -- */

  describe('the register', () => {
    it('finds a document by its number, its parties, its plate and its places', async () => {
      const { archive, departures, departureId } = setUp();
      await departures.setStatus(departureId, 'departed', MANAGER);
      await flush();
      for (const q of ['CMR-', 'Mama Sarah', 'Note Haulage', 'KDA 777N', 'Mombasa']) {
        expect(archive.register(asShipper, { q }).items).toHaveLength(1);
      }
      expect(archive.register(asShipper, { q: 'a lorry nobody owns' }).items).toHaveLength(0);
    });

    it('narrows by the door the carriage came through and by what last happened to it', async () => {
      const { archive, departures, departureId, bookingId } = setUp();
      await departures.setStatus(departureId, 'departed', MANAGER);
      departures.deliver(departureId, bookingId, DRIVER, proof);
      await flush();
      expect(archive.register(asShipper, { path: 'run' }).items).toHaveLength(1);
      expect(archive.register(asShipper, { path: 'board' }).items).toHaveLength(0);
      expect(archive.register(asShipper, { stage: 'delivered' }).items).toHaveLength(1);
      expect(archive.register(asShipper, { stage: 'taken_over' }).items).toHaveLength(0);
    });

    it('says how many copies a document has, and what the newest one was for', async () => {
      const { archive, departures, departureId, bookingId } = setUp();
      await departures.setStatus(departureId, 'departed', MANAGER);
      departures.deliver(departureId, bookingId, DRIVER, proof);
      await flush();
      expect(archive.register(asShipper).items[0]).toMatchObject({ copies: 2, lastStage: 'delivered' });
    });

    it('exports EVERY match, not the page in front of them', async () => {
      const { archive, departures, departureId } = setUp();
      for (let i = 0; i < 3; i++) departures.book(departureId, { shipperDid: SHIPPER, description: `Extra load ${i}`, weightKg: 100 });
      await departures.setStatus(departureId, 'departed', MANAGER);
      await flush();

      expect(archive.register(asShipper, { limit: '1' }).items).toHaveLength(1);
      expect(archive.register(asShipper, { limit: '1' }).total).toBe(4);
      // An export capped at the page size would be a quietly partial record of what a country asked for.
      const csv = archive.registerCsv(asShipper, { limit: '1' });
      expect(csv.trim().split('\r\n')).toHaveLength(5); // a header and four documents
      expect(csv).toContain('Note number');
    });

    it('gives a stranger an empty spreadsheet rather than somebody else’s', async () => {
      const { archive, departures, departureId } = setUp();
      await departures.setStatus(departureId, 'departed', MANAGER);
      await flush();
      expect(archive.registerCsv(asStranger).trim().split('\r\n')).toHaveLength(1);
    });
  });

  /* --------------------------------------------------------------- the board half -- */

  describe('a board haul', () => {
    it('freezes at taking over and at delivery, through the same archive', async () => {
      const { archive, bus, setBoardNote } = setUp();
      await bus.publish(GlosEvent.Pudo.FreightPickedUp, { freightId: 'frt_1' }, { source: 'test' });
      setBoardNote({ ...(archive.version(boardDocId('frt_1'), 1, asShipper).note), status: 'delivered', delivery: { place: 'Kisumu', at: '2026-09-02T16:00:00.000Z' } });
      await bus.publish(GlosEvent.Pudo.FreightDelivered, { freightId: 'frt_1' }, { source: 'test' });
      await flush();

      const doc = archive.document(boardDocId('frt_1'), asShipper);
      expect(doc.path).toBe('board');
      expect(doc.versions.map((v) => v.stage)).toEqual(['taken_over', 'delivered']);
      expect(archive.version(boardDocId('frt_1'), 1, asShipper).note.status).toBe('in_transit');
      expect(archive.version(boardDocId('frt_1'), 0, asShipper).note.status).toBe('delivered');
    });

    it('prints a copy from what was frozen, never from the load', async () => {
      const { archive, bus, setBoardNote } = setUp();
      await bus.publish(GlosEvent.Pudo.FreightPickedUp, { freightId: 'frt_1' }, { source: 'test' });
      await flush();
      const html = archive.html(boardDocId('frt_1'), 1, asShipper);
      expect(html).toContain('CMR-AB12');
      expect(html).toContain('KDA 777N');

      setBoardNote({ ...(archive.version(boardDocId('frt_1'), 1, asShipper).note), carrier: { name: 'Note Haulage', plate: 'SOMETHING ELSE' } });
      expect(archive.html(boardDocId('frt_1'), 1, asShipper)).toContain('KDA 777N');
    });
  });

  /* ------------------------------------------------------------------ fingerprints -- */

  describe('the fingerprint', () => {
    it('does not depend on the order the note was built in', () => {
      // JSON.stringify keeps insertion order, so without canonicalisation two notes stating identical
      // facts would fingerprint differently and the fingerprint would mean nothing.
      const a = { number: 'CMR-1', goods: { grossKg: 800, nature: 'GEN' }, sender: { name: 'A' } };
      const b = { sender: { name: 'A' }, goods: { nature: 'GEN', grossKg: 800 }, number: 'CMR-1' };
      expect(canonicalJson(a)).toBe(canonicalJson(b));
      expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
    });

    it('changes when any fact on the note changes', () => {
      const base = { number: 'CMR-1', goods: { grossKg: 800 } } as unknown as ConsignmentNote;
      const heavier = { number: 'CMR-1', goods: { grossKg: 801 } } as unknown as ConsignmentNote;
      expect(noteFingerprint(base)).not.toBe(noteFingerprint(heavier));
    });

    it('treats an absent box and an undefined one as the same absence', () => {
      // The note is built with spread-conditionals, so a box that does not apply is missing rather than
      // undefined. Two builders disagreeing about which would otherwise produce two fingerprints.
      const absent = { number: 'CMR-1' } as unknown as ConsignmentNote;
      const undef = { number: 'CMR-1', trackingKey: undefined } as unknown as ConsignmentNote;
      expect(noteFingerprint(absent)).toBe(noteFingerprint(undef));
    });
  });
});

/** Let the bus's fire-and-forget publishes settle before reading what they wrote. */
async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
}
