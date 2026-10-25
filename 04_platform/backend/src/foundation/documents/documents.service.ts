import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';
import { sameSigner, type Signer } from '../entity/same-person';
import { catalogueEntry } from '../countries/catalogue';
import { DOCUMENT_SEEDS } from './documents.seed';
import {
  DOCUMENT_KINDS,
  documentKey,
  documentPath,
  type AgreementDocument,
  type DocumentKind,
  type DocumentVersion,
  type PublishedDocument,
  type PublishedVersionLine,
} from './documents.types';

/** Who wrote a version that was inserted with the system rather than by a person. */
export const SEED_WRITER = 'SeeBuyGet (inserted with the system)';

/**
 * THE DOCUMENTS A SIGN-UP AGREES TO, AS VERSIONS STAFF WRITE (the user, 2026-10-25: "need cms from the staff console
 * and it's usual track of changes timestamped etc."). See documents.types.ts for what a version and a line are.
 *
 * Nothing here is ever edited in place. A change is a new version: proposed by one member of staff with a note saying
 * what changed, published when a DIFFERENT one approves it, or declined with a reason. The published versions of a line
 * are numbered in order and all of them are kept — the record of exactly what anybody agreed to. The general line of
 * each document is inserted with the system; a country's own line starts the day staff write its first version.
 */
@Injectable()
export class DocumentsService implements OnApplicationBootstrap {
  private readonly versions = new PersistentMap<string, DocumentVersion>('documents');
  /** Which ACCOUNT wrote each version — beside it, not on it: a version is read whole by everybody on staff. */
  private readonly writerKeys = new PersistentMap<string, string>('document-writer-keys');
  /** Told of each version as it is published — the bell of everybody it concerns (pudo's DocumentNoticeService). */
  private readonly onPublished: Array<(version: DocumentVersion) => void> = [];

  onApplicationBootstrap(): void {
    this.seed();
  }

  /**
   * The first version of a general document a server has none of, inserted with the system (documents.seed.ts).
   * Idempotent and never overwriting: a document anybody has published keeps what they published.
   */
  seed(now = Date.now()): void {
    for (const kind of DOCUMENT_KINDS) {
      if (this.publishedOf(kind).length) continue;
      const seed = DOCUMENT_SEEDS[kind];
      const at = new Date(now).toISOString();
      const version: DocumentVersion = {
        versionId: `dv_${randomBytes(6).toString('hex')}`,
        kind,
        number: 1,
        title: seed.title,
        body: seed.body,
        changeNote: seed.changeNote,
        askAgain: true,
        status: 'published',
        writtenBy: SEED_WRITER,
        writtenAt: at,
        publishedAt: at,
        source: 'seed',
      };
      this.versions.set(version.versionId, version);
    }
  }

  /** Something to be told of every version published. */
  whenPublished(listener: (version: DocumentVersion) => void): void {
    this.onPublished.push(listener);
  }

  list(): DocumentVersion[] {
    return [...this.versions.values()];
  }

  /** The version anybody reads now on a line: its highest-numbered published one. Refused where the line has none. */
  current(kind: DocumentKind, country?: string): DocumentVersion {
    const latest = this.currentOrNone(kind, country);
    if (!latest) throw new GlosError('NOT_FOUND', country ? `${catalogueEntry(country)?.name ?? country} has no ${kind} document of its own` : `There is no ${kind} document yet`);
    return latest;
  }

  currentOrNone(kind: DocumentKind, country?: string): DocumentVersion | undefined {
    const published = this.publishedOf(kind, country);
    return published[published.length - 1];
  }

  /** One published version of a line, by its number. */
  published(kind: DocumentKind, number: number, country?: string): DocumentVersion {
    const version = this.publishedOf(kind, country).find((v) => v.number === number);
    if (!version) throw new GlosError('NOT_FOUND', `There is no version ${number} of that document`);
    return version;
  }

  /** What anybody may read of a published version: the text, its number and date, what changed. Never who wrote it. */
  publicView(version: DocumentVersion): PublishedDocument {
    return {
      key: documentKey(version.kind, version.country),
      kind: version.kind,
      ...(version.country ? { country: version.country } : {}),
      number: version.number!,
      title: version.title,
      body: version.body,
      publishedAt: version.publishedAt!,
      changeNote: version.changeNote,
      askAgain: version.askAgain,
      path: documentPath(version.kind, version.country),
    };
  }

  /** Every published version of a line, newest first, as its public history lists them. */
  publicHistory(kind: DocumentKind, country?: string): PublishedVersionLine[] {
    return this.publishedOf(kind, country)
      .reverse()
      .map((v) => ({ number: v.number!, title: v.title, publishedAt: v.publishedAt!, changeNote: v.changeNote, askAgain: v.askAgain }));
  }

  /** Everything written on a line — published, waiting and declined — newest first, as staff read it. */
  history(kind: DocumentKind, country?: string, reader?: Signer): DocumentVersion[] {
    return this.lineOf(kind, country)
      .sort((a, b) => Number(b.status === 'proposed') - Number(a.status === 'proposed') || b.writtenAt.localeCompare(a.writtenAt))
      .map((v) => ({ ...v, ...(reader ? { mine: sameSigner(reader, this.writerOf(v)) } : {}) }));
  }

  /** The version waiting for a second person on a line, if one is. One at a time: two would each undo the other. */
  pending(kind: DocumentKind, country?: string): DocumentVersion | undefined {
    return this.lineOf(kind, country).find((v) => v.status === 'proposed');
  }

  /** The countries with a line of their own for any document — anything written, published or not. */
  countries(): string[] {
    return [...new Set(this.list().map((v) => v.country).filter((c): c is string => Boolean(c)))].sort();
  }

  /**
   * WRITE A NEW VERSION of a line — a country's first included. It changes nothing until a different member of staff
   * publishes it. Refused when nothing in it differs from what is published, when another proposal for the same line is
   * already waiting, and without a note saying what changed: the note is what the history is read by.
   */
  propose(kind: DocumentKind, input: { title: string; body: string; changeNote: string; askAgain: boolean; country?: string }, writer: Signer, now = Date.now()): DocumentVersion {
    this.requireKind(kind);
    const country = this.requireCountry(input.country);
    const title = input.title.trim();
    const body = normaliseBody(input.body);
    const changeNote = input.changeNote.trim();
    if (!title) throw new GlosError('FIELD_REQUIRED', 'Give the document its title', { field: 'title' });
    if (!body) throw new GlosError('FIELD_REQUIRED', 'Write the text', { field: 'body' });
    if (!changeNote) throw new GlosError('FIELD_REQUIRED', 'Say what changed, and why: the history is read by it', { field: 'changeNote' });
    if (!writer.name?.trim()) throw new GlosError('FIELD_REQUIRED', 'Say who you are — every version names the person who wrote it');
    const current = this.currentOrNone(kind, country);
    if (current && title === current.title && body === current.body) throw new GlosError('INVALID_INPUT', 'Nothing in it differs from the published version', { field: 'body' });
    const waiting = this.pending(kind, country);
    if (waiting) throw new GlosError('CONFLICT', `A new version written by ${waiting.writtenBy} is already waiting for a second person — publish or decline it first`);
    const version: DocumentVersion = {
      versionId: `dv_${randomBytes(6).toString('hex')}`,
      kind,
      ...(country ? { country } : {}),
      title,
      body,
      changeNote,
      // A country's first version is agreed to by everybody there whatever it says: there was nothing to agree to before.
      askAgain: current ? input.askAgain : true,
      status: 'proposed',
      ...(current ? { basedOn: current.versionId } : {}),
      writtenBy: writer.name.trim(),
      writtenAt: new Date(now).toISOString(),
    };
    this.versions.set(version.versionId, version);
    if (writer.key) this.writerKeys.set(version.versionId, writer.key);
    return { ...version, mine: true };
  }

  /**
   * THE SECOND PERSON PUBLISHES IT. Never the one who wrote it. Refused when the line moved on since it was written:
   * publishing it would quietly undo whatever was published in between.
   */
  publish(versionId: string, publisher: Signer, now = Date.now()): DocumentVersion {
    const version = this.requireProposed(versionId);
    if (!publisher.name?.trim()) throw new GlosError('FIELD_REQUIRED', 'Say who you are — the second person is named just like the first');
    if (sameSigner(publisher, this.writerOf(version))) throw new GlosError('FORBIDDEN', 'You wrote this version — a different person must publish it');
    const current = this.currentOrNone(version.kind, version.country);
    if ((current?.versionId ?? undefined) !== version.basedOn) {
      throw new GlosError('CONFLICT', `Version ${current?.number ?? 1} was published after this was written — write it again from that text, so nothing in it is undone`);
    }
    const at = new Date(now).toISOString();
    Object.assign(version, { status: 'published', number: (current?.number ?? 0) + 1, decidedBy: publisher.name.trim(), decidedAt: at, publishedAt: at });
    this.versions.set(version.versionId, version);
    for (const tell of this.onPublished) {
      try {
        tell(version);
      } catch {
        // Telling people is not publishing: a listener that fails never takes the version back.
      }
    }
    return version;
  }

  /** Say no — anybody, the writer withdrawing it included — and always with a reason that is kept. */
  decline(versionId: string, decider: Signer, reason?: string, now = Date.now()): DocumentVersion {
    const version = this.requireProposed(versionId);
    if (!decider.name?.trim()) throw new GlosError('FIELD_REQUIRED', 'Say who you are');
    const why = reason?.trim();
    if (!why) throw new GlosError('REASON_REQUIRED', 'Say why — a version declined is kept with its reason', { field: 'reason' });
    Object.assign(version, { status: 'declined', decidedBy: decider.name.trim(), decidedAt: new Date(now).toISOString(), reason: why });
    this.versions.set(version.versionId, version);
    return version;
  }

  /**
   * WHAT A SIGN-UP AGREES TO NOW: the current version of each general document — and, for somebody in a country with
   * documents of its own, those too. Per line, the oldest version that still counts: the latest one published asking
   * everybody to agree again. Somebody who agreed to that or later is not asked again; a change that asked nothing new
   * of people leaves them where they were.
   */
  agreementSet(country?: string): AgreementDocument[] {
    const code = catalogueEntry(country)?.code;
    const lines: Array<{ kind: DocumentKind; country?: string }> = [...DOCUMENT_KINDS.map((kind) => ({ kind })), ...(code ? DOCUMENT_KINDS.map((kind) => ({ kind, country: code })) : [])];
    const set: AgreementDocument[] = [];
    for (const line of lines) {
      const published = this.publishedOf(line.kind, line.country);
      const current = published[published.length - 1];
      if (!current) {
        if (!line.country) throw new GlosError('NOT_FOUND', `There is no ${line.kind} document yet`);
        continue;
      }
      const since = [...published].reverse().find((v) => v.askAgain)?.number ?? 1;
      set.push({
        key: documentKey(line.kind, line.country),
        kind: line.kind,
        ...(line.country ? { country: line.country } : {}),
        title: current.title,
        number: current.number!,
        publishedAt: current.publishedAt!,
        since,
        path: documentPath(line.kind, line.country),
      });
    }
    return set;
  }

  requireKind(kind: string): DocumentKind {
    if (!(DOCUMENT_KINDS as readonly string[]).includes(kind)) throw new GlosError('NOT_FOUND', `No such document: ${kind}`);
    return kind as DocumentKind;
  }

  /** A country named for a line must exist; none is the general line. */
  requireCountry(country?: string): string | undefined {
    if (!country?.trim()) return undefined;
    const entry = catalogueEntry(country);
    if (!entry) throw new GlosError('INVALID_INPUT', `${country} is not a country in the catalogue`, { field: 'country' });
    return entry.code;
  }

  private lineOf(kind: DocumentKind, country?: string): DocumentVersion[] {
    const code = country ? catalogueEntry(country)?.code ?? country.toUpperCase() : undefined;
    return this.list().filter((v) => v.kind === kind && (v.country ?? undefined) === code);
  }

  private publishedOf(kind: DocumentKind, country?: string): DocumentVersion[] {
    return this.lineOf(kind, country)
      .filter((v) => v.status === 'published')
      .sort((a, b) => a.number! - b.number!);
  }

  private requireProposed(versionId: string): DocumentVersion {
    const version = this.versions.get(versionId);
    if (!version) throw new GlosError('NOT_FOUND', 'No such version');
    if (version.status !== 'proposed') throw new GlosError('INVALID_STATE', `That version was already ${version.status}`);
    return version;
  }

  private writerOf(version: DocumentVersion): Signer {
    return { name: version.writtenBy, key: this.writerKeys.get(version.versionId) };
  }
}

/** Line ends made one kind, and no trailing space or blank lines: two texts that read the same compare the same. */
export function normaliseBody(body: string): string {
  return body
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
