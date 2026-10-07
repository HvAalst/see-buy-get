import { Injectable, OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { actingDid } from '../../foundation/auth/acting';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { GlosError } from '../../foundation/http/glos-error';
import { maskAddress } from '../../foundation/mail/mail.service';
import { appUrl } from '../../foundation/mail/mail.templates';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { ConsignmentNoteService } from './consignment-note.service';
import { DocumentLinkRow, DocumentLinkView, LinkState } from './document-link.types';
import { NoteArchiveService } from './note-archive.service';
import { boardDocId } from './note-archive.types';
import { NoteBundleService } from './note-bundle.service';

/** How long a link opens its document. A month: long enough for somebody's bookkeeping, short for a forwarded email. */
export const LINK_DAYS = 30;
/** How often one link hands the file over. A link passed round an office is opened a handful of times, not hundreds. */
export const LINK_MAX_OPENS = 25;
const DAY_MS = 86_400_000;

/** What is kept of a link. NEVER THE KEY: only its fingerprint, so that reading this store opens nothing. */
export interface DocumentLink {
  linkId: string;
  tokenHash: string;
  docId: string;
  /** The party it was made for. The link reads the document as that party does, and that party alone may cancel it. */
  forDid: string;
  sentTo?: string;
  createdAt: string;
  expiresAt: string;
  opened: number;
  lastOpenedAt?: string;
  cancelledAt?: string;
}

/**
 * LINKS TO DOCUMENTS (document-link.types.ts says why they exist).
 *
 * THE KEY is 256 random bits, handed out once — to the email — and never kept: the store holds its SHA-256, so a
 * copy of the store, a log line or a member of staff reading a record holds nothing that opens a document. It goes
 * in the part of an address a browser never sends to any server (`#doc=…`), and comes back in a request's body.
 *
 * IT IS NOT USED UP BY BEING LOOKED AT. Mail scanners follow every link in an email before the reader does; a link
 * that worked once would be spent by the scanner. So it opens until it stops — by its date, by being cancelled, by
 * the count, or by the document itself passing the end of its keeping.
 *
 * The file is built when it is asked for, as the party the link was made for reads the document then — not a copy
 * set aside when the email went. So a link sent at delivery hands over the consignee's signature added an hour later.
 */
@Injectable()
export class DocumentLinkService implements OnModuleInit {
  private readonly links = new PersistentMap<string, DocumentLink>('sbg-document-links');

  constructor(
    private readonly archive: NoteArchiveService,
    private readonly bundles: NoteBundleService,
    private readonly notes: ConsignmentNoteService,
  ) {}

  onModuleInit(): void {
    // The receipt for a delivered load carries a link to its note. Registered here rather than injected there: this
    // reads the archive and the bundle, which both read that.
    this.notes.registerReceiptLink((freightId, forDid, sentTo) => {
      const made = this.issue(boardDocId(freightId), forDid, { sentTo });
      return made ? { url: linkUrl(made.token), until: made.link.expiresAt } : undefined;
    });
  }

  /**
   * Make a link to a document for one of its parties. Nothing — not an error — when that party has no such
   * document: the email this is for goes all the same, and says where the note is instead.
   * The key is in what this returns and nowhere else, ever again.
   */
  issue(docId: string, forDid: string, opts: { sentTo?: string; now?: number } = {}): { token: string; link: DocumentLink } | undefined {
    if (!this.archive.hasFor(docId, forDid)) return undefined;
    const now = opts.now ?? Date.now();
    const token = randomBytes(32).toString('base64url');
    const link: DocumentLink = {
      linkId: `dl_${randomBytes(8).toString('hex')}`,
      tokenHash: hashOf(token),
      docId,
      forDid,
      ...(opts.sentTo ? { sentTo: maskAddress(opts.sentTo) } : {}),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + LINK_DAYS * DAY_MS).toISOString(),
      opened: 0,
    };
    this.links.set(link.tokenHash, link);
    return { token, link };
  }

  /** What this link is — said before the file is taken, and said plainly when it no longer opens. */
  look(token: string, now: number = Date.now()): DocumentLinkView {
    const link = this.find(token);
    const state = this.stateOf(link, now);
    if (state !== 'ready') return { state, expiresAt: link.expiresAt };
    const doc = this.archive.documentAsParty(link.docId, link.forDid);
    return {
      state,
      expiresAt: link.expiresAt,
      number: doc.number,
      from: doc.from,
      to: doc.to,
      ...(doc.deliveredAt ? { deliveredAt: doc.deliveredAt } : {}),
      opensLeft: LINK_MAX_OPENS - link.opened,
      ...(doc.retention.documentUntil ? { documentUntil: doc.retention.documentUntil } : {}),
    };
  }

  /** Hand the file over, and count it. A link that no longer opens says which way it stopped. */
  fetch(token: string, now: number = Date.now()): { filename: string; bytes: Buffer } {
    const link = this.find(token);
    const state = this.stateOf(link, now);
    if (state !== 'ready') throw new GlosError('INVALID_STATE', STOPPED[state], { field: 'token', state });
    const file = this.bundles.oneAsParty(link.docId, link.forDid);
    // Counted once the file exists: an opening that failed to build is not an opening.
    this.links.set(link.tokenHash, { ...link, opened: link.opened + 1, lastOpenedAt: new Date(now).toISOString() });
    return file;
  }

  /**
   * The links made for the caller on one of their documents: where each went, how often it was opened, whether it
   * still opens. Only the party a link was made for sees it — the carrier does not learn who the shipper's
   * bookkeeper is — and staff see them all, as they see the document.
   */
  listFor(docId: string, actor: IntrospectionResult | undefined, now: number = Date.now()): DocumentLinkRow[] {
    this.archive.document(docId, actor);
    const mine = actor?.role === 'operator' ? undefined : actingDid(actor);
    return [...this.links.values()]
      .filter((l) => l.docId === docId && (mine === undefined || l.forDid === mine))
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map((l) => this.row(l, now));
  }

  /** Cancel a link: from now on it opens nothing, whoever holds the email. Twice is the same as once. */
  cancel(docId: string, linkId: string, actor: IntrospectionResult | undefined, now: number = Date.now()): DocumentLinkRow {
    this.archive.document(docId, actor);
    const link = [...this.links.values()].find((l) => l.linkId === linkId && l.docId === docId);
    // Somebody else's link is answered as one that does not exist: that it exists is theirs to know.
    if (!link || (actor?.role !== 'operator' && link.forDid !== actingDid(actor))) throw new GlosError('NOT_FOUND', 'No such link on this document');
    const cancelled = link.cancelledAt ? link : { ...link, cancelledAt: new Date(now).toISOString() };
    this.links.set(link.tokenHash, cancelled);
    return this.row(cancelled, now);
  }

  private row(l: DocumentLink, now: number): DocumentLinkRow {
    return {
      linkId: l.linkId,
      state: this.stateOf(l, now),
      ...(l.sentTo ? { sentTo: l.sentTo } : {}),
      createdAt: l.createdAt,
      expiresAt: l.expiresAt,
      opened: l.opened,
      ...(l.lastOpenedAt ? { lastOpenedAt: l.lastOpenedAt } : {}),
      ...(l.cancelledAt ? { cancelledAt: l.cancelledAt } : {}),
    };
  }

  /** A key that is not one of ours — or is nothing like one — is not found. There is nothing to tell it apart by. */
  private find(token: string): DocumentLink {
    const link = typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? this.links.get(hashOf(token)) : undefined;
    if (!link) throw new GlosError('NOT_FOUND', 'This is not a link we made');
    return link;
  }

  /** What was DONE to it comes first, then what became of the document, then the clock and the count. */
  private stateOf(link: DocumentLink, now: number): LinkState {
    if (link.cancelledAt) return 'cancelled';
    if (!this.archive.hasFor(link.docId, link.forDid)) return 'gone';
    if (now >= Date.parse(link.expiresAt)) return 'expired';
    if (link.opened >= LINK_MAX_OPENS) return 'used_up';
    return 'ready';
  }
}

const STOPPED: Record<Exclude<LinkState, 'ready'>, string> = {
  cancelled: 'This link was cancelled',
  gone: 'The document this link opened is no longer kept',
  expired: 'This link has stopped working: its time is up',
  used_up: 'This link has been opened as often as one link can be',
};

function hashOf(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/**
 * The address an email carries. The key is after the `#`: a browser keeps that part to itself — it is in no server's
 * log, no proxy's, and no "referer" — and the front door reads it there and takes it out of the address bar.
 */
export function linkUrl(token: string): string {
  return `${appUrl('home')}#doc=${token}`;
}
