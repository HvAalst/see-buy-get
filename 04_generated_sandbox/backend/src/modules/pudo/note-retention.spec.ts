import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { requiredUnloadKeys } from './heavy-cargo';
import { CargoService } from './cargo.service';
import { ConsignmentNoteService } from './consignment-note.service';
import { CorridorService } from './corridor.service';
import { DepartureNoteService } from './departure-note.service';
import { DepartureService } from './departure.service';
import { NoteArchiveService } from './note-archive.service';
import { runDocId } from './note-archive.types';
import { CLAIM_WINDOW_DAYS, DOCUMENT_RETENTION_DAYS, documentExpiringSoon, retentionFor, retentionWords } from './retention';
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

const DAY = 86_400_000;

/**
 * RETENTION — the document goes, the proof stays.
 *
 * A consignment note has weight partly because a neutral third party issued it and held a copy. Delete
 * ours and the two parties hold two files either of them could have edited. So the payload expires at a
 * year (the CMR's own limitation period — we never delete inside the window somebody can still sue in)
 * and the FINGERPRINT is kept for good, which is what still lets anyone ask "is this the document you
 * issued" years later.
 *
 * The tests that matter: the proof survives the deletion, a claim is never swept, and the answer to a
 * stranger holding an altered file is no.
 */
describe('how long we keep a consignment note', () => {
  const MANAGER = 'did:glos:fleet-ret';
  const DRIVER = 'did:glos:driver-ret';
  const SHIPPER = 'did:glos:shipper-ret';

  const asShipper = { role: 'pudo', did: SHIPPER } as unknown as IntrospectionResult;

  const managers = { get: () => ({ jurisdiction: 'KE' }) } as unknown as FleetManagerService;
  const drivers = { canOperate: () => true, offRoadReasons: () => [] } as unknown as DriverService;
  const presence = { can: () => true } as unknown as PresenceService;
  const media = { adopt: () => undefined, anchorFreightTerminal: () => undefined, holdFreightForDispute: () => undefined } as unknown as MediaService;
  const agents = { get: () => ({ shopName: 'Mama Sarah Shop', physicalAddress: '12 Ngong Road', country: 'KE', did: SHIPPER }) } as unknown as AgentService;
  const vendors = { has: () => false, get: () => ({}) } as unknown as VendorService;
  const proof = { receiverName: 'Joseph at the gate', photoRef: 'med_pod', confirmed: requiredUnloadKeys() };

  let lanes = 0;
  const setUp = () => {
    lanes += 1;
    const bus = new EventBus();
    const corridors = new CorridorService();
    const vehicles = {
      get: () => ({ vehicleId: 'veh_r', plate: 'KDA 777N', vehicleClass: 'truck', capacityKg: 8000, managerDid: MANAGER, status: 'ACTIVE' }),
      isUsable: () => true,
      offRoadReasons: () => [],
    } as unknown as VehicleService;
    const departures = new DepartureService(corridors, managers, drivers, vehicles, new CargoService(), media, presence, bus);
    const renderer = new ConsignmentNoteService(
      undefined as never, undefined as never, undefined as never, undefined as never,
      undefined as never, undefined as never, undefined as never,
    );
    const departureNotes = new DepartureNoteService(departures, renderer, new CargoService(), agents, vendors);
    const dispatch = { requireFreightPublic: () => ({ freightId: 'frt_r', pickupLabel: 'Nairobi', destLabel: 'Kisumu' }) } as unknown as DispatchService;
    const notes = { build: () => ({}) as ConsignmentNote, partiesOf: () => [], htmlFor: () => '' } as unknown as ConsignmentNoteService;

    const archive = new NoteArchiveService(dispatch, notes, departures, departureNotes, bus);
    archive.onModuleInit();

    const proposed = corridors.proposeLine({ managerDid: MANAGER, company: 'Ret Haulage', name: `Ret line ${lanes}`, originZone: 'Nairobi', destZone: 'Mombasa', vehicleType: 'truck' });
    const corridor = corridors.publish(proposed.corridorId, 'did:glos:network-staff');
    const run = departures.declare({
      managerDid: MANAGER,
      corridorId: corridor.corridorId,
      vehicleId: 'veh_r',
      leavesAt: new Date(Date.now() + 86_400_000).toISOString(),
      basis: 'per_trip',
      amount: 900,
    });
    const booking = departures.book(run.departureId, { shipperDid: SHIPPER, description: 'Solar panels', weightKg: 800 }).booking;
    departures.assignDriver(run.departureId, MANAGER, { did: DRIVER, name: 'Wanjiru' });
    return { archive, departures, bus, departureId: run.departureId, bookingId: booking.bookingId, docId: runDocId(run.departureId, booking.bookingId) };
  };

  /**
   * Deliver for real, and sweep from a date far enough ahead that the clock has run.
   *
   * The clock is moved rather than the record: `document()` hands back a PROJECTION, so mutating what it
   * returns changes nothing in the store — an earlier draft of this helper did exactly that and the
   * sweep quietly found nothing to delete. Pushing `now` forward exercises the same arithmetic against
   * the data the service actually holds.
   */
  const delivered = async () => {
    const ctx = setUp();
    ctx.departures.deliver(ctx.departureId, ctx.bookingId, DRIVER, proof);
    await flush();
    return { ...ctx, after: (days: number) => Date.now() + days * DAY };
  };

  /* ----------------------------------------------------------------- the clock -- */

  describe('the clock', () => {
    it('is the CMR limitation period, so nothing goes while a claim could still be brought', () => {
      // Not "about a year" — the same number, because they are the same fact.
      expect(DOCUMENT_RETENTION_DAYS).toBe(CLAIM_WINDOW_DAYS);
    });

    it('has not started while the load is still open', () => {
      const s = retentionFor({});
      expect(s.documentUntil).toBeUndefined();
      expect(s.evidenceUntil).toBeUndefined();
      expect(s.proof).toBe('permanent');
      expect(retentionWords(s)).toContain('not finished');
    });

    it('puts the document a year out and the photographs ninety days out, from the same moment', () => {
      const finishedAt = '2026-01-01T00:00:00.000Z';
      const s = retentionFor({ finishedAt });
      expect(s.documentUntil?.slice(0, 10)).toBe('2027-01-01');
      expect(s.evidenceUntil?.slice(0, 10)).toBe('2026-04-01');
      // The gap between those two is the thing worth telling somebody, so it is said.
      expect(s.exportBefore).toBe(s.evidenceUntil);
      expect(retentionWords(s)).toContain('before 2026-04-01');
    });

    it('promises a confirmation rather than another copy, once it is gone', () => {
      const said = retentionWords(retentionFor({ finishedAt: '2026-01-01T00:00:00.000Z' }));
      expect(said).toContain('we cannot give you another one');
      expect(said).toContain('genuine');
    });

    it('warns only inside the last month', () => {
      const s = retentionFor({ finishedAt: '2026-01-01T00:00:00.000Z' });
      expect(documentExpiringSoon(s, Date.parse('2026-12-20T00:00:00.000Z'))).toBe(true);
      expect(documentExpiringSoon(s, Date.parse('2026-06-01T00:00:00.000Z'))).toBe(false);
      expect(documentExpiringSoon(retentionFor({}), Date.now())).toBe(false);
    });
  });

  /* ------------------------------------------------------------------ the sweep -- */

  describe('the sweep', () => {
    it('leaves a document that is still inside its window', async () => {
      const { archive, docId, after } = await delivered();
      expect(archive.sweepExpired(after(300)).deleted).toBe(0);
      expect(archive.document(docId, asShipper).number).toMatch(/^CMR-/);
    });

    it('deletes the document once the year has run', async () => {
      const { archive, docId, after } = await delivered();
      expect(archive.sweepExpired(after(400)).deleted).toBe(1);
      expect(() => archive.document(docId, asShipper)).toThrow(/No such consignment note/);
      expect(archive.register(asShipper).total).toBe(0);
    });

    it('KEEPS THE PROOF, which is the whole reason deleting is safe', async () => {
      const { archive, docId, after } = await delivered();
      const fingerprint = archive.document(docId, asShipper).versions[0].sha256;
      archive.sweepExpired(after(400));

      const answer = archive.verify({ sha256: fingerprint });
      expect(answer.known).toBe(true);
      expect(answer.number).toMatch(/^CMR-/);
      expect(answer.documentDeletedAt).toBeTruthy();
      expect(answer.says).toContain('has not been altered');
      expect(answer.says).toContain('this confirmation is all we hold');
    });

    it('never touches a document with a claim on it', async () => {
      const ctx = setUp();
      ctx.departures.deliver(ctx.departureId, ctx.bookingId, DRIVER, proof);
      ctx.departures.openClaim(ctx.departureId, ctx.bookingId, SHIPPER, { kind: 'damaged', description: 'Two panels cracked' });
      await flush();

      // A claim is a live matter and its evidence runs on the longer case clock.
      expect(ctx.archive.sweepExpired(Date.now() + 400 * DAY).deleted).toBe(0);
      expect(ctx.archive.document(ctx.docId, asShipper).versions.length).toBeGreaterThan(1);
    });

    it('TELLS THE PARTIES A MONTH BEFORE, which is what makes deleting it defensible', async () => {
      const { archive, bus, docId, after } = await delivered();
      const parties = archive.document(docId, asShipper).parties;

      // Eleven months in: inside the last thirty days, nothing deleted yet, everybody aboard told.
      const heard: Array<Record<string, unknown>> = [];
      bus.subscribe(GlosEvent.Pudo.NoteExpiringSoon, (e) => void heard.push(e.payload as Record<string, unknown>));
      const swept = archive.sweepExpired(after(350));
      await flush();

      expect(swept).toMatchObject({ deleted: 0, warned: 1 });
      expect(heard).toHaveLength(1);
      expect(heard[0]).toMatchObject({ docId, parties });
      expect(String(heard[0].goesAt).slice(0, 4)).toMatch(/^\d{4}$/);
    });

    it('warns once, not once an hour for a month', async () => {
      const { archive, bus, after } = await delivered();
      const heard: unknown[] = [];
      bus.subscribe(GlosEvent.Pudo.NoteExpiringSoon, (e) => void heard.push(e.payload));
      archive.sweepExpired(after(350));
      archive.sweepExpired(after(351));
      archive.sweepExpired(after(360));
      await flush();
      expect(heard).toHaveLength(1);
    });

    it('does not warn before the last month — a year out is not a warning, it is noise', async () => {
      const { archive, bus, after } = await delivered();
      const heard: unknown[] = [];
      bus.subscribe(GlosEvent.Pudo.NoteExpiringSoon, (e) => void heard.push(e.payload));
      expect(archive.sweepExpired(after(200)).warned).toBe(0);
      await flush();
      expect(heard).toHaveLength(0);
    });

    it('never touches a load that never finished', async () => {
      const ctx = setUp();
      await ctx.departures.setStatus(ctx.departureId, 'departed', MANAGER);
      await flush();
      // Taken over and never delivered: an open matter, not an expired one. No clock has started.
      expect(ctx.archive.sweepExpired(Date.now() + 5 * 365 * DAY).deleted).toBe(0);
    });
  });

  /* ------------------------------------------------------------------ verifying -- */

  describe('a ledger that has fallen behind the documents', () => {
    it('is rebuilt from what we still hold, because the alternative is calling a real note fake', async () => {
      // A lost or rolled-back proofs file, or documents frozen before the ledger existed. While the
      // document is here it is its own authority, and the worst answer this endpoint can give is
      // telling somebody holding a GENUINE note that we never issued it.
      const { archive, docId } = await delivered();
      const sha = archive.document(docId, asShipper).versions[0].sha256;
      archive.forgetProofsForTest();
      expect(archive.verify({ sha256: sha }).known).toBe(false);

      expect(archive.healProofs().added).toBeGreaterThan(0);
      expect(archive.verify({ sha256: sha }).known).toBe(true);
    });

    it('adds nothing on a healed ledger, and never invents one for a document that is gone', async () => {
      const { archive, after } = await delivered();
      expect(archive.healProofs().added).toBe(0);
      archive.sweepExpired(after(400));
      // The document is gone; there is nothing left to derive a proof from, and the one written at
      // freeze time is the only reason verification still works.
      expect(archive.healProofs().added).toBe(0);
    });
  });

  describe('verifying a copy somebody holds', () => {
    it('recognises a note we issued, and says which copy it is', async () => {
      const { archive, docId } = await delivered();
      const copy = archive.version(docId, 1, asShipper);
      const answer = archive.verify({ note: copy.note });
      expect(answer.known).toBe(true);
      expect(answer.seq).toBe(1);
      expect(answer.documentDeletedAt).toBeUndefined();
      expect(answer.says).toContain('issued by the SeeBuyGet network');
    });

    it('refuses a note altered by ONE CHARACTER, which is the point of a fingerprint', async () => {
      const { archive, docId } = await delivered();
      const copy = archive.version(docId, 1, asShipper);
      const tampered = { ...copy.note, goods: { ...copy.note.goods, grossKg: copy.note.goods.grossKg + 1 } };
      const answer = archive.verify({ note: tampered });
      expect(answer.known).toBe(false);
      expect(answer.says).toContain('altered');
    });

    it('needs no account, and gives nothing away to somebody who has not got the document', async () => {
      const { archive } = await delivered();
      // A fingerprint cannot be guessed; an unknown one is simply unknown, with nothing to probe at.
      const answer = archive.verify({ sha256: 'f'.repeat(64) });
      expect(answer.known).toBe(false);
      expect(answer.number).toBeUndefined();
    });

    it('refuses anything that is not a fingerprint rather than answering "no"', async () => {
      const { archive } = await delivered();
      // "No" to a malformed input reads as "that document is not ours", which is a different claim.
      expect(() => archive.verify({ sha256: 'not-a-hash' })).toThrow(/fingerprint/);
      expect(() => archive.verify({})).toThrow(/fingerprint/);
    });

    it('does not care about case or stray spaces in a fingerprint somebody typed off a page', async () => {
      const { archive, docId } = await delivered();
      const sha = archive.document(docId, asShipper).versions[0].sha256;
      expect(archive.verify({ sha256: `  ${sha.toUpperCase()}  ` }).known).toBe(true);
    });
  });
});

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
  await new Promise((r) => setImmediate(r));
}
