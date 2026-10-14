import { Injectable } from '@nestjs/common';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { GlosError } from '../../foundation/http/glos-error';
import { appUrl } from '../../foundation/mail/mail.templates';
import { ZipEntry, zip } from '../../foundation/archive/zip';
import { ConsignmentNoteService } from './consignment-note.service';
import { MediaService } from './media.service';
import { ArchiveQuery, NoteArchiveService } from './note-archive.service';
import { NoteVersion, STAGE_WORDS } from './note-archive.types';
import { retentionWords } from './retention';

/**
 * THE EXPORT — the document, its copies and its photographs, in one file that needs nothing from us.
 *
 * "Can I have a copy" has a specific meaning in freight and it is not a link. A link needs an account, it
 * needs this network to still be running, and it points at photographs on a retention clock the document
 * outlives — so a PDF full of URLs is a record of where evidence used to be. What a party, a forwarder, an
 * insurer or a magistrate can act on is the whole thing on a laptop with no network.
 *
 * SO THE BUNDLE SAYS WHAT IS MISSING. If a photograph has already passed its retention window the manifest
 * names it and says so in words, rather than the bundle simply having one fewer file in it. An export that
 * quietly understates what it holds is the failure mode worth designing against: somebody would take the
 * absence of a securement photo for proof that none was taken.
 */
@Injectable()
export class NoteBundleService {
  /** A bulk export is for an audit, not a backup. Past this it is a data dump and should be asked for. */
  static readonly MAX_DOCUMENTS = 100;

  constructor(
    private readonly archive: NoteArchiveService,
    private readonly notes: ConsignmentNoteService,
    private readonly media: MediaService,
  ) {}

  /** One document: every copy, every photograph, and a manifest that reconciles the two. */
  one(docId: string, actor: IntrospectionResult | undefined): { filename: string; bytes: Buffer } {
    return this.bundleOf(this.readAs(docId, actor));
  }

  /**
   * The same file for a party by name, with nobody signed in: what a link that party was sent hands over
   * (document-link.service). It is the party's own reading of the document — the archive checks that it is one.
   */
  oneAsParty(docId: string, partyDid: string): { filename: string; bytes: Buffer } {
    return this.bundleOf({ document: () => this.archive.documentAsParty(docId, partyDid), version: (seq) => this.archive.versionAsParty(docId, seq, partyDid) });
  }

  private readAs(docId: string, actor: IntrospectionResult | undefined): NoteReader {
    return { document: () => this.archive.document(docId, actor), version: (seq) => this.archive.version(docId, seq, actor) };
  }

  private bundleOf(read: NoteReader): { filename: string; bytes: Buffer } {
    const doc = read.document();
    const entries = this.entriesFor(read, '');
    entries.unshift({
      name: 'README.txt',
      bytes: Buffer.from(this.readme([doc.number]), 'utf8'),
    });
    return { filename: `${safe(doc.number)}.zip`, bytes: zip(entries) };
  }

  /**
   * Every document matching a filter, each in its own folder.
   *
   * This is the shape an audit actually asks for — "everything you moved in 2026" — and the reason the
   * register's filters and this share one query type rather than two that drift.
   */
  many(actor: IntrospectionResult | undefined, query: ArchiveQuery): { filename: string; bytes: Buffer } {
    const { items, total } = this.archive.register(actor, { ...query, limit: String(NoteBundleService.MAX_DOCUMENTS), offset: '0' });
    if (!items.length) throw new GlosError('NOT_FOUND', 'No consignment notes match that — there is nothing to export');

    const entries: ZipEntry[] = [];
    for (const row of items) entries.push(...this.entriesFor(this.readAs(row.docId, actor), `${safe(row.number)}/`));
    entries.unshift({
      name: 'README.txt',
      bytes: Buffer.from(
        this.readme(items.map((r) => r.number)) +
          (total > items.length
            ? `\nTHIS EXPORT IS NOT COMPLETE. ${total} consignment notes match what you asked for and this file holds the ${items.length} most recent. Narrow the dates and export again to get the rest.\n`
            : ''),
        'utf8',
      ),
    });
    return { filename: `consignment-notes-${new Date().toISOString().slice(0, 10)}.zip`, bytes: zip(entries) };
  }

  /* ------------------------------------------------------------------ the files -- */

  private entriesFor(read: NoteReader, prefix: string): ZipEntry[] {
    const doc = read.document();
    const entries: ZipEntry[] = [];

    // The newest copy at the top level, because that is the one somebody opens.
    const newest = read.version(0);
    entries.push({ name: `${prefix}consignment-note.html`, bytes: Buffer.from(this.notes.htmlFor(newest.note), 'utf8'), at: new Date(newest.at) });

    for (const v of doc.versions) {
      const copy = read.version(v.seq);
      const stem = `${prefix}copies/${String(v.seq).padStart(2, '0')}-${v.stage}`;
      entries.push({ name: `${stem}.html`, bytes: Buffer.from(this.notes.htmlFor(copy.note), 'utf8'), at: new Date(v.at) });
      entries.push({ name: `${stem}.json`, bytes: Buffer.from(JSON.stringify(copy.note, null, 2), 'utf8'), at: new Date(v.at) });
    }

    const photographs: Array<Record<string, unknown>> = [];
    for (const mediaId of doc.mediaRefs) {
      const ref = this.media.get(mediaId);
      try {
        const { bytes, contentType } = this.media.blob(mediaId);
        const name = `${prefix}photographs/${mediaId}.${extensionFor(contentType)}`;
        entries.push({ name, bytes, at: ref ? new Date(ref.createdAt) : undefined });
        photographs.push({ mediaId, file: name.slice(prefix.length), kind: ref?.kind, takenAt: ref?.createdAt, bytes: bytes.length, sha256: ref?.sha256 });
      } catch {
        // The whole reason the manifest exists. A reader must be able to tell "no photograph was taken"
        // from "the photograph was taken and has since passed its retention window".
        photographs.push({
          mediaId,
          file: null,
          kind: ref?.kind,
          takenAt: ref?.createdAt,
          missing: ref?.status === 'expired' ? 'Kept until its retention window closed, then deleted' : 'Not available',
        });
      }
    }

    const manifest = {
      note: doc.number,
      document: doc.docId,
      through: doc.path === 'board' ? 'Posted to the freight board' : 'Space booked on a scheduled run',
      sender: doc.senderName,
      carrier: doc.carrierName ?? null,
      vehicle: doc.plate ?? null,
      from: doc.from,
      to: doc.to,
      goods: { nature: doc.nature, grossKg: doc.grossKg },
      takenOverAt: doc.takenOverAt ?? null,
      deliveredAt: doc.deliveredAt ?? null,
      copies: doc.versions.map((v) => ({ seq: v.seq, moment: STAGE_WORDS[v.stage], at: v.at, sha256: v.sha256, file: `copies/${String(v.seq).padStart(2, '0')}-${v.stage}.html` })),
      photographs,
      retention: { ...doc.retention, inWords: retentionWords(doc.retention) },
      exportedAt: new Date().toISOString(),
      /** The fingerprint of this manifest's own subject matter, so two exports of one document match. */
      fingerprint: newest.sha256,
    };
    entries.push({ name: `${prefix}manifest.json`, bytes: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') });
    return entries;
  }

  private readme(numbers: string[]): string {
    return [
      'CONSIGNMENT NOTES, EXPORTED FROM SEEBUYGET',
      '',
      `Exported ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
      `${numbers.length} document${numbers.length === 1 ? '' : 's'}: ${numbers.join(', ')}`,
      '',
      'WHAT IS IN HERE',
      '  consignment-note.html   The note as it now stands — the copy to print or file.',
      '  copies/                 Every copy of the note, frozen at the moment a party signed or spoke.',
      '                          A consignment note is made out in originals that stop changing: the',
      '                          sender’s at taking over, the carrier’s and the consignee’s at delivery.',
      '                          Each file here is one of those moments, and each carries a fingerprint.',
      '  photographs/            The images the note refers to: the load as secured, the goods as',
      '                          delivered, and any photograph filed with a claim.',
      '  manifest.json           Every file above with its fingerprint, AND every photograph that is NOT',
      '                          here because its retention window has closed. Read this before assuming',
      '                          a missing image means no image was taken.',
      '',
      'CHECKING A COPY',
      '  Each copy’s fingerprint is a SHA-256 of the note’s own facts, printed at the foot of the page',
      '  and listed in the manifest. Two parties holding two printouts can compare that one line and know',
      '  whether they are holding the same document.',
      '  Anybody can also check one with us, with no account:',
      `    ${appUrl('home')}?note=<fingerprint>`,
      '  We answer whether we issued a document with that fingerprint and which copy it is — nothing',
      '  about the goods, the parties or the price. That answer keeps working after the dates below.',
      '',
      'HOW LONG WE KEEP IT',
      '  The notes are kept for twelve months after the load is finished, which is how long a claim can',
      '  be brought under the CMR. The photographs go sooner — the manifest states both dates.',
      '  AFTER THAT WE CANNOT GIVE YOU ANOTHER COPY. We keep each copy’s fingerprint for good, so we can',
      '  always confirm that the files in this bundle are genuine; we cannot reissue them. This export is',
      '  the copy that does not expire, and how long YOUR country requires you to keep it is a question',
      '  for you, not for us.',
      '',
      'WHAT THIS IS NOT',
      '  SeeBuyGet issues these documents from its own records of what was done on the network. It is not',
      '  an insurer, it does not adjudicate claims, and where a note says a fact is not recorded, it is',
      '  not recorded.',
      '',
    ].join('\n');
  }
}

/** One document as one reader may read it: the signed-in caller, or the party a link was sent to. */
interface NoteReader {
  document(): ReturnType<NoteArchiveService['document']>;
  version(seq: number): NoteVersion;
}

/** A filename somebody can save on any operating system. */
function safe(s: string): string {
  return s.replace(/[^A-Za-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'consignment-note';
}

function extensionFor(contentType: string): string {
  if (contentType.includes('png')) return 'png';
  if (contentType.includes('webp')) return 'webp';
  return 'jpg';
}
