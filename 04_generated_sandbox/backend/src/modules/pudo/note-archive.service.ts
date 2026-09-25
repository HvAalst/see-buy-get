import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { actingDid } from '../../foundation/auth/acting';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { ConsignmentNoteService } from './consignment-note.service';
import type { ConsignmentNote } from './consignment-note.types';
import { DepartureNoteService } from './departure-note.service';
import { DepartureService } from './departure.service';
import { DispatchService } from './dispatch.service';
import type { Freight } from './dispatch.types';
import {
  ArchivedNote,
  ArchivedNoteRow,
  NotePath,
  NoteStage,
  NoteVersion,
  NoteVersionRow,
  STAGE_WORDS,
  boardDocId,
  noteFingerprint,
  runDocId,
} from './note-archive.types';
import { Page, paginate, textMatch, toCsv, withinDates } from './query';
import { RetentionStatement, retentionFor } from './retention';

/** What a caller may narrow the archive by. Mirrors NoteArchiveQueryDto, which validates it at the door. */
export interface ArchiveQuery {
  q?: string;
  from?: string;
  to?: string;
  path?: string;
  stage?: string;
  limit?: number | string;
  offset?: number | string;
}

/**
 * THE CONSIGNMENT-NOTE ARCHIVE — the document, after the job.
 *
 * See note-archive.types.ts for why a derived-on-read note is not evidence. This service is the other
 * half: it listens for the moments a party signs or speaks, freezes the note as it read at that moment,
 * fingerprints it, and keeps it. Nothing in here ever rewrites a version.
 *
 * IT LISTENS RATHER THAN BEING CALLED, and that is not decoration. Freezing at the call site would mean
 * DispatchService and DepartureService each reaching for a note builder that already reaches back for
 * them — a cycle. Every moment worth a copy already publishes an event, because somebody already had to
 * be told about it, so the archive subscribes to the things that were being said anyway.
 *
 * DELIVERY IS AT-LEAST-ONCE, so `append` is idempotent: the same stage with the same fingerprint is
 * already in the archive and does not go in twice.
 */
@Injectable()
export class NoteArchiveService implements OnModuleInit {
  private readonly logger = new Logger(NoteArchiveService.name);
  private readonly docs = new PersistentMap<string, ArchivedNote>('note-archive');

  constructor(
    private readonly dispatch: DispatchService,
    private readonly notes: ConsignmentNoteService,
    private readonly departures: DepartureService,
    private readonly departureNotes: DepartureNoteService,
    private readonly events: EventBus,
  ) {}

  onModuleInit(): void {
    const board: Array<[string, NoteStage, string]> = [
      [GlosEvent.Pudo.FreightPickedUp, 'taken_over', 'The carrier took the goods over'],
      [GlosEvent.Pudo.FreightDelivered, 'delivered', 'The goods were handed over and the receiver was recorded'],
      [GlosEvent.Pudo.FreightDeliveryFailed, 'not_delivered', 'The carrier was at the door and could not hand over'],
      [GlosEvent.Pudo.FreightCancelled, 'cancelled', 'The load was withdrawn'],
      [GlosEvent.Pudo.FreightClaimOpened, 'claimed', 'The sender raised a claim against the delivered goods'],
      [GlosEvent.Pudo.FreightClaimDecided, 'answered', 'The claim was decided'],
    ];
    for (const [type, stage, event] of board) {
      this.events.subscribe<{ freightId: string }>(type, (e) => this.freezeFreight(e.payload.freightId, stage, event));
    }

    const booking: Array<[string, NoteStage, string]> = [
      [GlosEvent.Pudo.DepartureDelivered, 'delivered', 'The goods were handed over and the receiver was recorded'],
      [GlosEvent.Pudo.DepartureClaimOpened, 'claimed', 'The shipper raised a claim against the delivered goods'],
      [GlosEvent.Pudo.DepartureClaimAnswered, 'answered', 'The carrier answered the claim in their own words'],
    ];
    for (const [type, stage, event] of booking) {
      this.events.subscribe<{ departureId: string; bookingId: string }>(type, (e) =>
        this.freezeBooking(e.payload.departureId, e.payload.bookingId, stage, event),
      );
    }

    /*
     * A RUN'S TAKING OVER IS THE TRUCK LEAVING, and it is one moment for everybody aboard.
     *
     * A board haul is one shipper's, so its pickup is its own. A run carries several, and the moment after
     * which nothing about any of them can change is the moment it departs — which is exactly how the fleet
     * already describes it to the people on board. Every booking still open gets its first copy there.
     */
    this.events.subscribe<{ departureId: string }>(GlosEvent.Pudo.DepartureDeparted, (e) =>
      this.freezeWholeRun(e.payload.departureId, 'taken_over', 'The truck left with the goods aboard'),
    );
    this.events.subscribe<{ departureId: string }>(GlosEvent.Pudo.DepartureCancelled, (e) =>
      this.freezeWholeRun(e.payload.departureId, 'cancelled', 'The carrier called the run off'),
    );
  }

  /* ------------------------------------------------------------------ freezing -- */

  /** A board haul reached a moment worth a copy. Never throws at the bus: a lost copy must not retry for ever. */
  freezeFreight(freightId: string, stage: NoteStage, event: string): void {
    try {
      const f = this.dispatch.requireFreightPublic(freightId) as Freight;
      const note = this.notes.build(f);
      this.append(
        boardDocId(freightId),
        {
          path: 'board',
          freightId,
          parties: this.notes.partiesOf(f),
          mediaRefs: [f.loadSafety?.securementPhotoRef, f.proofOfDelivery?.photoRef, f.claim?.photoRef],
          country: f.destCountry ?? f.pickupCountry,
          from: f.pickupLabel,
          to: f.destLabel,
        },
        stage,
        event,
        note,
      );
    } catch (err) {
      this.logger.warn(`could not archive freight ${freightId} at ${stage}: ${(err as Error).message}`);
    }
  }

  /** One booking on a run reached a moment worth a copy. */
  freezeBooking(departureId: string, bookingId: string, stage: NoteStage, event: string): void {
    try {
      const departure = this.departures.require(departureId);
      const booking = departure.bookings.find((b) => b.bookingId === bookingId);
      if (!booking) return;
      const note = this.departureNotes.build(departure, booking);
      this.append(
        runDocId(departureId, bookingId),
        {
          path: 'run',
          departureId,
          bookingId,
          // The fleet's OWN customer is not on this network, so there is no third DID to record — the
          // parties who can read it are the two who are.
          parties: [booking.shipperDid, departure.managerDid, ...(departure.driverDid ? [departure.driverDid] : [])],
          mediaRefs: [booking.loadSafety?.securementPhotoRef, booking.pod?.photoRef, booking.claim?.photoRef],
          from: departure.originZone,
          to: departure.destZone,
        },
        stage,
        event,
        note,
      );
    } catch (err) {
      this.logger.warn(`could not archive booking ${bookingId} at ${stage}: ${(err as Error).message}`);
    }
  }

  /** Every load still aboard a run gets the same copy at the same moment. A cancelled booking is already off. */
  private freezeWholeRun(departureId: string, stage: NoteStage, event: string): void {
    try {
      const departure = this.departures.require(departureId);
      for (const b of departure.bookings) {
        if (b.status === 'cancelled') continue;
        this.freezeBooking(departureId, b.bookingId, stage, event);
      }
    } catch (err) {
      this.logger.warn(`could not archive run ${departureId} at ${stage}: ${(err as Error).message}`);
    }
  }

  /**
   * Append a copy. Idempotent by (stage, fingerprint) against the newest copy, because event delivery is
   * at-least-once and a retried handler must not put a second identical original in somebody's file.
   */
  private append(
    docId: string,
    facts: {
      path: NotePath;
      freightId?: string;
      departureId?: string;
      bookingId?: string;
      parties: string[];
      mediaRefs: Array<string | undefined>;
      country?: string;
      from: string;
      to: string;
    },
    stage: NoteStage,
    event: string,
    note: ConsignmentNote,
  ): void {
    const sha256 = noteFingerprint(note);
    const existing = this.docs.get(docId);
    const last = existing?.versions[existing.versions.length - 1];
    if (last && last.stage === stage && last.sha256 === sha256) return;

    const at = new Date().toISOString();
    const version: NoteVersion = { seq: (last?.seq ?? 0) + 1, stage, event, at, sha256, note };
    const doc: ArchivedNote = {
      docId,
      number: note.number,
      path: facts.path,
      ...(facts.freightId ? { freightId: facts.freightId } : {}),
      ...(facts.departureId ? { departureId: facts.departureId } : {}),
      ...(facts.bookingId ? { bookingId: facts.bookingId } : {}),
      // Parties accumulate: a driver who took the goods over is a party to the document for good, even
      // after the fleet puts somebody else on the run.
      parties: [...new Set([...(existing?.parties ?? []), ...facts.parties.filter(Boolean)])],
      mediaRefs: [...new Set([...(existing?.mediaRefs ?? []), ...facts.mediaRefs.filter((r): r is string => Boolean(r))])],
      senderName: note.sender.name,
      ...(note.carrier?.name ? { carrierName: note.carrier.name } : {}),
      ...(note.carrier?.plate ? { plate: note.carrier.plate } : {}),
      from: facts.from,
      to: facts.to,
      nature: note.goods.nature,
      grossKg: note.goods.grossKg,
      status: note.status,
      ...(facts.country ? { country: facts.country } : {}),
      ...(note.takingOver.at ? { takenOverAt: note.takingOver.at } : {}),
      ...(note.delivery.at ? { deliveredAt: note.delivery.at } : {}),
      versions: [...(existing?.versions ?? []), version],
      firstAt: existing?.firstAt ?? at,
      lastAt: at,
    };
    this.docs.set(docId, doc);
  }

  /* ------------------------------------------------------------------ reading -- */

  /** Operators read everything; everybody else reads the documents they were a party to. */
  private mine(actor: IntrospectionResult | undefined): ArchivedNote[] {
    if (actor?.role === 'operator') return [...this.docs.values()];
    const who = actor ? actingDid(actor) : undefined;
    if (!who) return [];
    return [...this.docs.values()].filter((d) => d.parties.includes(who));
  }

  /**
   * THE SHIPMENT REGISTER — the archive as a list somebody can actually work through.
   *
   * Countries that require transport documents to be kept require them to be FINDABLE; a folder nobody can
   * search is a folder nobody can produce. Newest first, because the question is almost always recent.
   */
  register(actor: IntrospectionResult | undefined, q: ArchiveQuery = {}): Page<ArchivedNoteRow> {
    return paginate(this.filtered(actor, q), q.limit, q.offset);
  }

  /** The matching rows, newest first, with no page bound — what the register pages and the CSV takes whole. */
  private filtered(actor: IntrospectionResult | undefined, q: ArchiveQuery): ArchivedNoteRow[] {
    return this.mine(actor)
      .filter((d) => (q.path ? d.path === q.path : true))
      .filter((d) => (q.stage ? this.lastStage(d) === q.stage : true))
      .filter((d) => withinDates(d.lastAt, q.from, q.to))
      .filter((d) => textMatch([d.number, d.senderName, d.carrierName, d.plate, d.from, d.to, d.nature, d.status], q.q))
      .sort((a, b) => (a.lastAt < b.lastAt ? 1 : a.lastAt > b.lastAt ? -1 : 0))
      .map((d) => this.row(d));
  }

  /**
   * The same register as a spreadsheet — every page, current filters, no pagination.
   *
   * The CSV is the index, not the archive: it carries each document's number and fingerprint so a row can
   * be matched back to the copy it describes, and it says plainly that the notes themselves are in the
   * bundle. A register that exported only rows would look like a record and be a list of references.
   */
  registerCsv(actor: IntrospectionResult | undefined, q: ArchiveQuery = {}): string {
    // The whole match, not a page: an export that stopped at the page cap would be a quietly partial
    // record of what a country asked to see.
    const items = this.filtered(actor, q);
    return toCsv(
      ['Note number', 'Through', 'Sender', 'Carrier', 'Vehicle', 'From', 'To', 'Nature', 'Gross kg', 'Status', 'Taken over', 'Delivered', 'Copies', 'Last copy', 'Last event', 'Document'],
      items.map((r) => [
        r.number,
        r.path === 'board' ? 'Freight board' : 'Scheduled run',
        r.senderName,
        r.carrierName ?? '',
        r.plate ?? '',
        r.from,
        r.to,
        r.nature,
        r.grossKg,
        r.status,
        r.takenOverAt ?? '',
        r.deliveredAt ?? '',
        r.copies,
        r.lastAt,
        STAGE_WORDS[r.lastStage],
        r.docId,
      ]),
    );
  }

  /**
   * One document and its copies — the fingerprints, never the notes. A copy is read one at a time.
   *
   * The retention statement rides along because this is where somebody is deciding what to do with the
   * document, and it is the one moment the answer to "how long do you keep this" changes what they do.
   */
  document(
    docId: string,
    actor: IntrospectionResult | undefined,
  ): Omit<ArchivedNote, 'versions'> & { versions: NoteVersionRow[]; retention: RetentionStatement } {
    const doc = this.require(docId, actor);
    const { versions, ...rest } = doc;
    const hasClaim = versions.some((v) => v.stage === 'claimed' || v.stage === 'answered');
    // A load that was never delivered has no clock running, and the statement says so by leaving the
    // dates out rather than guessing at one.
    const finishedAt = doc.deliveredAt ?? (this.lastStage(doc) === 'cancelled' ? doc.lastAt : undefined);
    return {
      ...rest,
      versions: versions.map((v) => ({ seq: v.seq, stage: v.stage, event: v.event, at: v.at, sha256: v.sha256 })),
      retention: retentionFor({ finishedAt, hasClaim }),
    };
  }

  /** One copy, exactly as it was frozen. `seq` 0 means the newest. */
  version(docId: string, seq: number, actor: IntrospectionResult | undefined): NoteVersion {
    const doc = this.require(docId, actor);
    const v = seq > 0 ? doc.versions.find((x) => x.seq === seq) : doc.versions[doc.versions.length - 1];
    if (!v) throw new GlosError('NOT_FOUND', 'No such copy of this consignment note');
    return v;
  }

  /** The same copy as the printable page, rendered from what was frozen and never from the live record. */
  html(docId: string, seq: number, actor: IntrospectionResult | undefined): string {
    const v = this.version(docId, seq, actor);
    return this.notes.htmlFor(v.note);
  }

  /**
   * The newest frozen copy of a load's note, if there is one.
   *
   * This is what the ordinary note route asks before building anything: ONCE THE GOODS ARE ON THE TRUCK
   * THE DOCUMENT HAS TO STOP MOVING, so from the first copy onward the note somebody reads is the copy,
   * not a fresh render against whatever the parties are called today.
   */
  latestForFreight(freightId: string): NoteVersion | undefined {
    return this.latest(boardDocId(freightId));
  }

  latestForBooking(departureId: string, bookingId: string): NoteVersion | undefined {
    return this.latest(runDocId(departureId, bookingId));
  }

  private latest(docId: string): NoteVersion | undefined {
    const doc = this.docs.get(docId);
    return doc?.versions[doc.versions.length - 1];
  }

  private require(docId: string, actor: IntrospectionResult | undefined): ArchivedNote {
    const doc = this.docs.get(docId);
    // A document somebody is not a party to is answered the same way as one that does not exist: a note
    // names both sides, so its existence is itself a fact about two companies.
    if (!doc) throw new GlosError('NOT_FOUND', 'No such consignment note in the archive');
    if (actor?.role === 'operator') return doc;
    const who = actor ? actingDid(actor) : undefined;
    if (!who || !doc.parties.includes(who)) throw new GlosError('NOT_FOUND', 'No such consignment note in the archive');
    return doc;
  }

  private lastStage(d: ArchivedNote): NoteStage {
    return d.versions[d.versions.length - 1].stage;
  }

  private row(d: ArchivedNote): ArchivedNoteRow {
    return {
      docId: d.docId,
      number: d.number,
      path: d.path,
      senderName: d.senderName,
      ...(d.carrierName ? { carrierName: d.carrierName } : {}),
      ...(d.plate ? { plate: d.plate } : {}),
      from: d.from,
      to: d.to,
      nature: d.nature,
      grossKg: d.grossKg,
      status: d.status,
      ...(d.takenOverAt ? { takenOverAt: d.takenOverAt } : {}),
      ...(d.deliveredAt ? { deliveredAt: d.deliveredAt } : {}),
      copies: d.versions.length,
      lastAt: d.lastAt,
      lastStage: this.lastStage(d),
    };
  }

  /** The words a stage is listed by, for anything rendering a copy outside the UI (the CSV, the bundle). */
  static words(stage: NoteStage): string {
    return STAGE_WORDS[stage];
  }
}
