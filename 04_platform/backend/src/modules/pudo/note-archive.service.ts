import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
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
  NoteProof,
  NoteVersionRow,
  ProofAnswer,
  STAGE_WORDS,
  boardDocId,
  noteFingerprint,
  runDocId,
} from './note-archive.types';
import { Page, paginate, textMatch, toCsv, withinDates } from './query';
import { CLAIM_WINDOW_DAYS, DOCUMENT_RETENTION_DAYS, RetentionStatement, WARN_BEFORE_DAYS, retentionFor } from './retention';

/** How often the retention sweep runs. Hourly is ample for a clock measured in months. */
const SWEEP_MS = Number(process.env.GLOS_DOC_SWEEP_MS ?? 3_600_000);
const DAY_MS = 86_400_000;

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
export class NoteArchiveService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NoteArchiveService.name);
  private readonly docs = new PersistentMap<string, ArchivedNote>('note-archive');
  /**
   * Keyed by fingerprint, and it OUTLIVES the documents — see NoteProof. A separate map rather than a
   * field on the document precisely because the two have different lifetimes; hanging the proof off the
   * record it is meant to survive would be the one mistake that makes the whole idea pointless.
   */
  private readonly proofs = new PersistentMap<string, NoteProof>('note-proofs');
  private sweeper?: NodeJS.Timeout;

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
    ];
    for (const [type, stage, event] of board) {
      this.events.subscribe<{ freightId: string }>(type, (e) => this.freezeFreight(e.payload.freightId, stage, event));
    }
    // Round 15 — a seal changed on the road: found broken, or replaced by customs at a post. A copy is frozen then, with
    // the seal's story and its photographs on it: the record any claim on the goods is reported from.
    this.events.subscribe<{ freightId: string }>(GlosEvent.Pudo.FreightSealBroken, (e) => this.freezeFreight(e.payload.freightId, 'seal_changed', 'A seal on the load was found broken on the road'));
    // Round 25 — the cold chain broken on the road: a copy is frozen then, with the reading on it — so the copy the shipper
    // opens says what it was told, and a claim on spoiled goods is reported from the copy that said it first.
    this.events.subscribe<{ freightId: string }>(GlosEvent.Pudo.FreightTempBreach, (e) => this.freezeFreight(e.payload.freightId, 'cold_chain_broken', 'The cold chain was found broken on the road'));
    this.events.subscribe<{ freightId: string; passage?: { post?: string; seals?: { resealed?: unknown[] } } }>(GlosEvent.Pudo.FreightPassed, (e) => {
      if (e.payload?.passage?.seals?.resealed?.length) this.freezeFreight(e.payload.freightId, 'seal_changed', `Customs opened the load${e.payload.passage.post ? ` at ${e.payload.passage.post}` : ''} and sealed it again`);
    });
    // The copy that answers a claim: a decision, where a company that stated cover made one — or, where nothing of
    // ours pays, the damage claim report itself: the note frozen with the claim on it, for the sender to hand on.
    this.events.subscribe<{ freightId: string; decision?: string }>(GlosEvent.Pudo.FreightClaimDecided, (e) =>
      this.freezeFreight(e.payload.freightId, 'answered', e.payload.decision === 'report_only' ? 'A damage claim report was made from the record: no company of the network decides this claim or pays one' : 'The claim was decided'),
    );

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
    // A reload after a breakdown is written on the note (box 18) and nowhere else, so the note is kept as it read then.
    this.events.subscribe<{ reloadedFreightIds: string[]; reloadedDepartureIds: string[] }>(GlosEvent.Pudo.VehicleLoadsHandedOver, (e) => {
      for (const id of e.payload.reloadedFreightIds) this.freezeFreight(id, 'reloaded', 'The goods were moved to another of the carrier’s vehicles after a breakdown');
      for (const id of e.payload.reloadedDepartureIds) this.freezeWholeRun(id, 'reloaded', 'The run went on in another of the carrier’s vehicles after a breakdown');
    });

    /*
     * THE LEDGER IS HEALED FROM THE DOCUMENTS BEFORE ANYTHING ELSE RUNS.
     *
     * While a document is still here it is its own authority, so a proof row missing for one of its
     * copies is recoverable — and must be recovered, because the failure it causes is the worst one this
     * endpoint has: telling somebody holding a GENUINE note that we never issued it. That can happen
     * from a lost or rolled-back proofs file, or simply from documents frozen before the ledger existed.
     *
     * Done once at boot rather than as a fallback inside verify(): the route is public, and a miss that
     * triggers a scan is a scan anybody can ask for as often as they like.
     */
    this.healProofs();

    // Swept on boot for anything already past its window, then on a timer. unref'd so a retention
    // sweep can never be the reason a process will not exit.
    this.sweepExpired();
    this.sweeper = setInterval(() => this.sweepExpired(), SWEEP_MS);
    this.sweeper.unref?.();
  }

  onModuleDestroy(): void {
    if (this.sweeper) clearInterval(this.sweeper);
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
          // Round 15 — and every photograph of its seals: as the shipper sealed it, at pickup, a re-seal, a break.
          mediaRefs: [f.loadSafety?.securementPhotoRef, f.proofOfDelivery?.photoRef, f.claim?.photoRef, ...(this.dispatch.sealPhotosOf?.(freightId) ?? [])],
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

    /*
     * SAID OUT LOUD, so a party's own storage can be given a copy without the archive knowing anything
     * about storage. `finished` is the half that matters: a bundle delivered mid-journey is an
     * incomplete document somebody would file and forget, so only a terminal moment is worth sending.
     */
    void this.events
      .publish(
        GlosEvent.Pudo.NoteFrozen,
        { docId, number: note.number, stage, parties: doc.parties, finished: Boolean(this.finishedAtOf(doc)) },
        { source: 'pudo' },
      )
      .catch(() => undefined);

    // The proof is written HERE, at the moment the copy is frozen — not later at deletion. A ledger
    // built during a sweep is a ledger that is wrong for every document the sweep never reached, and
    // one bad deploy between freezing and expiring would lose the ability to verify anything.
    this.proofs.set(sha256, { sha256, number: note.number, seq: version.seq, stage, at });
  }

  /* ------------------------------------------------------------------ the proof -- */

  /**
   * IS THIS THE DOCUMENT WE ISSUED?
   *
   * Public on purpose. A hash cannot be guessed and cannot be reversed, so whoever is asking already
   * holds the document — and the people who most need this answer (an insurer, a forwarder, a
   * magistrate) have no account here and never will. It answers about the FINGERPRINT and nothing else:
   * never the note, never the parties, never the route.
   */
  verify(input: { sha256?: string; note?: ConsignmentNote }): ProofAnswer {
    const key = (input.sha256 ?? (input.note ? noteFingerprint(input.note) : '')).trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(key)) {
      throw new GlosError('INVALID_INPUT', 'Give the fingerprint printed on the note, or the note itself');
    }
    const proof = this.proofs.get(key);
    if (!proof) {
      return {
        known: false,
        says: 'No document with that fingerprint was issued by this network. A copy that has been altered in any way — even a space — produces a different fingerprint from the one it was issued with.',
      };
    }
    const when = proof.at.slice(0, 10);
    return {
      known: true,
      number: proof.number,
      seq: proof.seq,
      stage: proof.stage,
      at: proof.at,
      ...(proof.documentDeletedAt ? { documentDeletedAt: proof.documentDeletedAt } : {}),
      says:
        `This is copy ${proof.seq} of consignment note ${proof.number}, as it stood on ${when} — ${STAGE_WORDS[proof.stage].toLowerCase()}. ` +
        `It was issued by the SeeBuyGet network and has not been altered since.` +
        (proof.documentDeletedAt
          ? ` Our own copy was deleted on ${proof.documentDeletedAt.slice(0, 10)} at the end of its retention period; this confirmation is all we hold.`
          : ''),
    };
  }

  /**
   * Write a proof for every copy of every document we still hold that has not got one.
   *
   * Idempotent and cheap on a healed ledger. It never invents a proof for a document that is gone —
   * there is nothing left to derive one from, which is exactly why the row is written at freeze time
   * and this is only a net rather than the mechanism.
   */
  /** Drop every proof row, to prove the heal actually rebuilds them. Tests only. */
  forgetProofsForTest(): void {
    for (const key of [...this.proofs.keys()]) this.proofs.delete(key);
  }

  healProofs(): { added: number } {
    let added = 0;
    for (const doc of this.docs.values()) {
      for (const v of doc.versions) {
        if (this.proofs.has(v.sha256)) continue;
        this.proofs.set(v.sha256, { sha256: v.sha256, number: doc.number, seq: v.seq, stage: v.stage, at: v.at });
        added += 1;
      }
    }
    if (added) this.logger.log(`retention: ${added} proof row(s) rebuilt from documents still held`);
    return { added };
  }

  /* ------------------------------------------------------------------ expiry -- */

  /**
   * THE DOCUMENT GOES AND THE PROOF STAYS.
   *
   * Runs on the same shape as the media sweep. What makes it safe to delete somebody's consignment note
   * is everything around it: they were told the date on the document itself, warned before it, handed an
   * export, and what remains can still confirm the copy they kept is genuine.
   *
   * TWO THINGS ARE NEVER SWEPT. A document with a claim on it, open or answered, because a claim is a
   * live matter and its own evidence clock runs longer. And nothing at all before the CMR's ordinary
   * limitation period has run, which the retention period equals by construction — the guard is here
   * anyway, because an override that shortened the period would otherwise silently start destroying
   * evidence inside the window somebody can still sue in.
   */
  sweepExpired(now: number = Date.now()): { deleted: number; warned: number } {
    let deleted = 0;
    let warned = 0;
    for (const doc of [...this.docs.values()]) {
      const finishedAt = this.finishedAtOf(doc);
      if (!finishedAt) continue; // an unfinished load has no clock running
      if (doc.versions.some((v) => v.stage === 'claimed' || v.stage === 'answered')) continue;

      const elapsed = now - Date.parse(finishedAt);
      if (!Number.isFinite(elapsed)) continue;

      /*
       * TELL THEM BEFORE, ONCE. A retention period nobody is reminded of is a trap, and the reminder is
       * the difference between "we told you" and "you were told" — the date has been on the document
       * since the day it was frozen, which nobody re-reads a year later.
       *
       * Fired as an EVENT rather than a notification: resolving who hears about a thing is the
       * dispatcher's job everywhere else in this product, and the archive has no business knowing about
       * devices. `warnedAt` makes it once per document, not once an hour for the last month.
       */
      if (!doc.warnedAt && elapsed >= (DOCUMENT_RETENTION_DAYS - WARN_BEFORE_DAYS) * DAY_MS && elapsed < DOCUMENT_RETENTION_DAYS * DAY_MS) {
        doc.warnedAt = new Date(now).toISOString();
        this.docs.set(doc.docId, doc);
        warned += 1;
        void this.events
          .publish(
            GlosEvent.Pudo.NoteExpiringSoon,
            {
              docId: doc.docId,
              number: doc.number,
              parties: doc.parties,
              goesAt: new Date(Date.parse(finishedAt) + DOCUMENT_RETENTION_DAYS * DAY_MS).toISOString(),
            },
            { source: 'pudo' },
          )
          .catch(() => undefined);
      }

      if (elapsed < DOCUMENT_RETENTION_DAYS * DAY_MS) continue;
      if (elapsed < CLAIM_WINDOW_DAYS * DAY_MS) continue;

      const at = new Date(now).toISOString();
      for (const v of doc.versions) {
        const proof = this.proofs.get(v.sha256);
        // Tombstone the proof rather than rewriting it: the fingerprint and what it describes do not
        // change, only whether we still hold what it describes.
        if (proof) this.proofs.set(v.sha256, { ...proof, documentDeletedAt: at });
      }
      /*
       * The WHOLE row goes — parties, route, goods, weight, the notes themselves. Keeping a tombstone
       * with the parties on it would mean a permanent record that these two companies carried goods
       * together, which across years is a trade graph and is the most sensitive thing in here. "We
       * deleted it" has to mean that.
       */
      this.docs.delete(doc.docId);
      deleted += 1;
    }
    if (deleted) this.logger.log(`retention: ${deleted} consignment note(s) past their window deleted; their proofs kept`);
    return { deleted, warned };
  }

  /** The moment the load became terminal, which is when every clock on it starts. */
  private finishedAtOf(doc: ArchivedNote): string | undefined {
    if (doc.deliveredAt) return doc.deliveredAt;
    const last = doc.versions[doc.versions.length - 1];
    return last && (last.stage === 'cancelled' || last.stage === 'not_delivered') ? last.at : undefined;
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
    return this.statementOf(this.require(docId, actor));
  }

  private statementOf(doc: ArchivedNote): Omit<ArchivedNote, 'versions'> & { versions: NoteVersionRow[]; retention: RetentionStatement } {
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
    return this.copyOf(this.require(docId, actor), seq);
  }

  private copyOf(doc: ArchivedNote, seq: number): NoteVersion {
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

  /**
   * THE SAME TWO READS FOR A PARTY BY NAME, with nobody signed in — a link that party was sent (document-link.service).
   *
   * The rule is the one above and no wider: the party must be one of the document's own, and a document it is not
   * a party to is answered as one that does not exist. Nothing here reads as staff do. Whoever calls this has
   * already decided that the caller stands for that party — that decision is the link's, and is made there.
   */
  documentAsParty(docId: string, partyDid: string) {
    return this.statementOf(this.requireParty(docId, partyDid));
  }

  versionAsParty(docId: string, seq: number, partyDid: string): NoteVersion {
    return this.copyOf(this.requireParty(docId, partyDid), seq);
  }

  /** Is there a document with this id that this party may read? Without building anything. */
  hasFor(docId: string, partyDid: string): boolean {
    return Boolean(partyDid) && Boolean(this.docs.get(docId)?.parties.includes(partyDid));
  }

  private requireParty(docId: string, partyDid: string): ArchivedNote {
    const doc = this.docs.get(docId);
    if (!doc || !partyDid || !doc.parties.includes(partyDid)) throw new GlosError('NOT_FOUND', 'No such consignment note in the archive');
    return doc;
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
