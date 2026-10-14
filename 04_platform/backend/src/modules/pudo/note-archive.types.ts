import { createHash } from 'crypto';
import type { ConsignmentNote } from './consignment-note.types';

/**
 * THE ARCHIVE — what happens to a consignment note once the job is finished.
 *
 * A paper CMR is made out in three originals (Art. 5): one to the sender, one travelling with the goods,
 * one kept by the carrier. Commercial pads run to four or more sheets, but the extras are office copies
 * with no evidential standing. The detail that matters for a digital note is that THE THREE ORIGINALS ARE
 * NOT THE SAME DOCUMENT. The sender's copy is signed at taking over and never carries the delivery
 * signature. The travelling copy comes back with the consignee's, and whatever the driver wrote at the
 * door. Three copies in three hands, each frozen at a different moment, is a consensus mechanism: when
 * they disagree, somebody can see it.
 *
 * Until now this network derived its note from the LIVE record on every read. Rename a company, re-plate a
 * truck, correct an address, and the "copy" a shipper opened a year later was not the document anybody
 * signed — it was a fresh render against today's facts. A document that can still change is not evidence,
 * and the whole point of the note is to be evidence.
 *
 * So the note is FROZEN at each moment a party signs or says something that lands on it, hashed, and kept.
 * The versions are the copies. Nobody holds a sheet of paper, so instead everybody holds the same set and
 * can see which version they are reading and what changed between two of them.
 */

/** The moments that produce a copy. Each one is a party signing, or a party saying something on the note. */
export const NOTE_STAGES = ['taken_over', 'delivered', 'not_delivered', 'claimed', 'answered', 'cancelled'] as const;
export type NoteStage = (typeof NOTE_STAGES)[number];

/** Which door the carriage came through. Both produce the same document; they differ in who priced it. */
export const NOTE_PATHS = ['board', 'run'] as const;
export type NotePath = (typeof NOTE_PATHS)[number];

/** One frozen copy. Written once, never rewritten — the archive appends and nothing else. */
export interface NoteVersion {
  /** 1-based, in the order the moments happened. Never renumbered, never reused. */
  seq: number;
  stage: NoteStage;
  /** What happened, in the words the archive lists it by. */
  event: string;
  at: string;
  /** sha256 over the canonical JSON of `note`: this copy's fingerprint, and how two are compared. */
  sha256: string;
  /** The note exactly as it read at that moment. */
  note: ConsignmentNote;
}

/**
 * One document's whole life.
 *
 * The searchable facts are denormalised off the LATEST version rather than read back from the live record,
 * because the archive has to keep answering after the live record has moved on — and because a register
 * that re-derives its own rows from elsewhere is not an archive, it is a view.
 */
export interface ArchivedNote {
  /** `freight:<freightId>` or `booking:<departureId>:<bookingId>`. */
  docId: string;
  /** CMR-XXXX, as printed. */
  number: string;
  path: NotePath;
  freightId?: string;
  departureId?: string;
  bookingId?: string;
  /**
   * Every DID that may read this document, frozen WITH it.
   *
   * Not a live lookup: an account can be closed, a driver can leave a fleet, a run can be swept up, and the
   * parties to a carriage that happened are still the parties to it. Reading their own document must not
   * depend on a relationship that has since ended.
   */
  parties: string[];
  /**
   * The photographs this document rests on, frozen with it for the same reason the parties are.
   *
   * Not parsed back out of box 5 when somebody exports: a note describes its photographs in a sentence
   * meant for a person, and reading ids out of prose is how an export quietly loses the one image that
   * mattered. Accumulates — the securement photo, the proof of delivery, and a claimant's own.
   */
  mediaRefs: string[];
  /* --- what a person searches by --- */
  senderName: string;
  carrierName?: string;
  plate?: string;
  from: string;
  to: string;
  /** The cargo nature code, from the same taxonomy the board uses. */
  nature: string;
  grossKg: number;
  status: string;
  /** The country whose retention rule governs the document, where the note names one. */
  country?: string;
  takenOverAt?: string;
  deliveredAt?: string;
  /* --- the copies --- */
  versions: NoteVersion[];
  firstAt: string;
  lastAt: string;
  /** When the parties were told this document is about to go. Set once; the warning is not a reminder. */
  warnedAt?: string;
}

/** A register row: everything a list needs and not one field more. The copies stay behind the document. */
export interface ArchivedNoteRow {
  docId: string;
  number: string;
  path: NotePath;
  senderName: string;
  carrierName?: string;
  plate?: string;
  from: string;
  to: string;
  nature: string;
  grossKg: number;
  status: string;
  takenOverAt?: string;
  deliveredAt?: string;
  copies: number;
  lastAt: string;
  /** What the newest copy was stamped for, so a row says why it last moved. */
  lastStage: NoteStage;
}

/** One copy in a list — the fingerprint and the moment, never the note itself. */
export interface NoteVersionRow {
  seq: number;
  stage: NoteStage;
  event: string;
  at: string;
  sha256: string;
}

/**
 * Canonical JSON — the same object always produces the same string.
 *
 * `JSON.stringify` preserves insertion order, so two notes with identical facts built by different code
 * paths would hash differently and a fingerprint would mean nothing. Keys are sorted, `undefined` members
 * are dropped (the note is built with spread-conditionals, so an absent box is absent, not null), and
 * arrays keep their order because on a note the order is a fact — box 18's reservations are a sequence.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return 'null';
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

/** This copy's fingerprint. Printed on the document so two people can compare what they are holding. */
export function noteFingerprint(note: ConsignmentNote): string {
  return createHash('sha256').update(canonicalJson(note)).digest('hex');
}

/**
 * THE NOTARISATION ROW — what survives after the document itself is deleted.
 *
 * A consignment note has evidential weight partly because a neutral third party issued it and held a
 * copy. Delete ours and the sender and the carrier hold two files that either of them could have edited,
 * with a fingerprint printed on the page that proves nothing once nobody holds the original hash. The
 * neutrality is the thing we would be throwing away, and it is the only part worth keeping for ever.
 *
 * So the payload goes and the PROOF stays. Thirty-two bytes per copy, and deliberately nothing else:
 *
 *   NOT the parties. A permanent row saying DID-A and DID-B carried goods together on a date is, across
 *   years, a complete trade graph — who ships with whom and how often. That is the most commercially
 *   sensitive thing in the archive and it is not needed to answer the question.
 *   NOT the route, the goods, the weight or the money. None of it is needed either.
 *
 * What is left answers exactly one question, which is the one anybody actually asks: SOMEBODY IS HOLDING
 * A FILE — is this the document you issued, unaltered, and which copy is it? A hash cannot be reversed
 * and cannot be guessed, so a holder must already have the document to ask; that is what makes it safe to
 * answer this publicly, to an insurer or a magistrate who has no account here.
 *
 * The honest limit: a hash VERIFIES, it cannot RE-ISSUE. If every party loses their file, the proof has
 * nothing to compare against — which is why automatic delivery to the party's own storage matters more
 * than a download button, and why the warning before expiry is not optional.
 */
export interface NoteProof {
  /** sha256 over the canonical note. The key, and what a holder presents. */
  sha256: string;
  /** CMR-XXXX — so an answer can say WHICH document rather than only "yes". */
  number: string;
  /** Which copy of it, and the moment it was taken at. */
  seq: number;
  stage: NoteStage;
  at: string;
  /** When the payload was deleted. Absent while the document is still here. */
  documentDeletedAt?: string;
}

/** What a verification answers. Never the document, and never who the parties were. */
export interface ProofAnswer {
  /** Whether this network issued a document with this fingerprint. */
  known: boolean;
  number?: string;
  seq?: number;
  stage?: NoteStage;
  /** When the copy was frozen — the moment it stopped being able to change. */
  at?: string;
  /** Present once the payload has gone; the proof outlives it. */
  documentDeletedAt?: string;
  /** In words, for whoever is reading the answer rather than parsing it. */
  says: string;
}

/**
 * A document's id, and the only place its shape is written.
 *
 * `~` rather than `:` because the id travels in a URL path segment and a tilde is unreserved — nothing
 * between the browser and the route handler has an opinion about it.
 */
export function boardDocId(freightId: string): string {
  return `freight~${freightId}`;
}

export function runDocId(departureId: string, bookingId: string): string {
  return `booking~${departureId}~${bookingId}`;
}

/** The words a stage is listed by — what a reader sees against a copy, rather than the enum. */
export const STAGE_WORDS: Record<NoteStage, string> = {
  taken_over: 'Taken over by the carrier',
  delivered: 'Delivered',
  not_delivered: 'Could not be delivered',
  claimed: 'Claim raised by the sender',
  answered: 'Answered',
  cancelled: 'Cancelled',
};
