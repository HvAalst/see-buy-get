import type { SbgClient } from '../client';

/** The moments that produce a copy of a consignment note. Mirrors the backend's NOTE_STAGES. */
export type NoteStage = 'taken_over' | 'delivered' | 'not_delivered' | 'claimed' | 'answered' | 'cancelled';

/** Which door the carriage came through. Both produce the same document. */
export type NotePath = 'board' | 'run';

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
  lastStage: NoteStage;
}

export interface NoteVersionRow {
  seq: number;
  stage: NoteStage;
  event: string;
  at: string;
  sha256: string;
}

/**
 * How long we keep it, as facts rather than a sentence — the words are the app's, so they translate.
 *
 * `exportBefore` is the one that changes what somebody does: it is set when the photographs behind a note
 * go before a claim could still be brought, which is the ordinary case rather than an edge one.
 */
export interface RetentionStatement {
  /** Days the document is kept after the load finished — twelve months, the CMR's own claim window. */
  documentDays: number;
  documentUntil?: string;
  /** Days the photographs behind it are kept. Shorter, and that gap is the thing worth saying. */
  evidenceDays: number;
  evidenceUntil?: string;
  claimWindowUntil?: string;
  exportBefore?: string;
  /** The fingerprint of every copy outlives all of it, so a copy they keep can always be confirmed. */
  proof: 'permanent';
}

/** What a verification answers. Never the document, and never who the parties were. */
export interface ProofAnswer {
  known: boolean;
  number?: string;
  seq?: number;
  stage?: NoteStage;
  at?: string;
  documentDeletedAt?: string;
  /** The server's own sentence — shown as-is, because it is the finding rather than a status. */
  says: string;
}

export interface ArchivedNoteDoc {
  docId: string;
  number: string;
  path: NotePath;
  freightId?: string;
  departureId?: string;
  bookingId?: string;
  senderName: string;
  carrierName?: string;
  plate?: string;
  from: string;
  to: string;
  nature: string;
  grossKg: number;
  status: string;
  country?: string;
  takenOverAt?: string;
  deliveredAt?: string;
  mediaRefs: string[];
  versions: NoteVersionRow[];
  retention: RetentionStatement;
  firstAt: string;
  lastAt: string;
}

export interface ArchiveQuery {
  q?: string;
  path?: NotePath | '';
  stage?: NoteStage | '';
  from?: string;
  to?: string;
  limit?: string;
  offset?: string;
}

/** Drop the empty strings the filter sheet holds, so a cleared field is absent rather than `q=`. */
function clean(query?: ArchiveQuery): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(query ?? {})) if (v) out[k] = String(v);
  return out;
}

/**
 * THE SHIPMENT ARCHIVE, THE SAME IN EVERY APP.
 *
 * `/v1/sbg/consignment-notes` answers for whoever the token is, because a document's readers were frozen
 * WITH it — so a shop, a fleet office and an operator all ask the identical question and get their own
 * documents back. That is why this is spread into the personas rather than written three times with a
 * `:did` in the path: there is no id to pass, and inventing one would be inventing an owner for a
 * document that has several parties.
 */
export function createArchiveApi(sbg: SbgClient) {
  return {
    /** Every consignment note the caller was a party to — searched, filtered, paged. */
    notes: (query?: ArchiveQuery) =>
      sbg.request((c) => c.GET('/v1/sbg/consignment-notes' as never, { params: { query: clean(query) } } as never)),

    /** The whole match as a spreadsheet, past the page cap. */
    notesExport: (query?: ArchiveQuery) =>
      sbg.request((c) => c.GET('/v1/sbg/consignment-notes/export' as never, { params: { query: clean(query) }, parseAs: 'text' } as never)),

    /** One document: its facts, its copies with their fingerprints, and how long we keep it. */
    note: (docId: string) =>
      sbg.request((c) => c.GET('/v1/sbg/consignment-notes/{docId}' as never, { params: { path: { docId } } } as never)),

    /** One copy, exactly as it was frozen. `0` is the newest. */
    noteCopy: (docId: string, seq: number) =>
      sbg.request((c) => c.GET('/v1/sbg/consignment-notes/{docId}/copies/{seq}' as never, { params: { path: { docId, seq: String(seq) } } } as never)),

    /** The same copy as the printable page — rendered from what was frozen, never from the load. */
    noteCopyHtml: (docId: string, seq: number) =>
      sbg.request((c) =>
        c.GET('/v1/sbg/consignment-notes/{docId}/copies/{seq}/print.html' as never, { params: { path: { docId, seq: String(seq) } }, parseAs: 'text' } as never),
      ),

    /** The document, its copies and its photographs, in one file that needs nothing from us afterwards. */
    noteBundle: (docId: string) =>
      sbg.request((c) => c.GET('/v1/sbg/consignment-notes/{docId}/bundle.zip' as never, { params: { path: { docId } }, parseAs: 'blob' } as never)),

    /** The same for everything matching a filter — what an audit asks for. */
    noteBundles: (query?: ArchiveQuery) =>
      sbg.request((c) => c.GET('/v1/sbg/consignment-notes/bundle.zip' as never, { params: { query: clean(query) }, parseAs: 'blob' } as never)),

    /**
     * Is a copy somebody handed us the one the network issued?
     *
     * The route is public, so this is for convenience inside an app rather than access — a fleet holding
     * a note a shipper emailed them checks it here instead of leaving for a web page.
     */
    verifyNote: (sha256: string) =>
      sbg.request((c) => c.POST('/v1/sbg/consignment-notes/verify' as never, { body: { sha256 } } as never)),

    /* ---------------------------------------------------- plug your own storage -- */

    destination: () => sbg.request((c) => c.GET('/v1/sbg/consignment-notes/destination' as never, {} as never)),
    connectDestination: (body: ConnectDestination) =>
      sbg.request((c) => c.POST('/v1/sbg/consignment-notes/destination' as never, { body } as never)),
    disconnectDestination: () => sbg.request((c) => c.DELETE('/v1/sbg/consignment-notes/destination' as never, {} as never)),
    /** Writes a real file and reports what happened — the only way to find a key that cannot write. */
    testDestination: () => sbg.request((c) => c.POST('/v1/sbg/consignment-notes/destination/test' as never, {} as never)),
    destinationSecret: () => sbg.request((c) => c.GET('/v1/sbg/consignment-notes/destination/secret' as never, {} as never)),
    deliveries: () => sbg.request((c) => c.GET('/v1/sbg/consignment-notes/deliveries' as never, {} as never)),
  };
}

/** The protocols, rather than the vendors — which is what makes "any other" true. */
export const DESTINATION_KINDS = ['s3', 'webdav', 'webhook'] as const;
export type DestinationKind = (typeof DESTINATION_KINDS)[number];

export interface ConnectDestination {
  kind: DestinationKind;
  label?: string;
  endpoint: string;
  bucket?: string;
  region?: string;
  pathStyle?: boolean;
  prefix?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  username?: string;
  password?: string;
}

export interface DestinationView {
  connected: boolean;
  kind?: DestinationKind;
  label?: string;
  endpoint?: string;
  bucket?: string;
  region?: string;
  prefix?: string;
  createdAt?: string;
  /** Absent means nothing has ever landed there — worth showing rather than hiding. */
  lastOkAt?: string;
  lastTriedAt?: string;
  lastError?: string;
}

export interface DeliveryRow {
  deliveryId: string;
  docId: string;
  number: string;
  key: string;
  state: 'pending' | 'delivered' | 'failed';
  attempts: number;
  queuedAt: string;
  deliveredAt?: string;
  lastError?: string;
}

export type ArchiveApi = ReturnType<typeof createArchiveApi>;
