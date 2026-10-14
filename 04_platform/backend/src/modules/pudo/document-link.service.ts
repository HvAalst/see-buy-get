import { Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { actingDid } from '../../foundation/auth/acting';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { GlosError } from '../../foundation/http/glos-error';
import { maskAddress } from '../../foundation/mail/mail.service';
import { appUrl } from '../../foundation/mail/mail.templates';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { BusinessService } from './business.service';
import { ConsignmentNoteService } from './consignment-note.service';
import { DocumentLinkRow, DocumentLinkView, LinkCancelReason, LinkState } from './document-link.types';
import { NoteArchiveService } from './note-archive.service';
import { boardDocId } from './note-archive.types';
import { NoteBundleService } from './note-bundle.service';
import { PersonService } from './person.service';

/** How long a link opens its document. A month: long enough for somebody's bookkeeping, short for a forwarded email. */
export const LINK_DAYS = 30;
/** How often one link hands the file over. A link passed round an office is opened a handful of times, not hundreds. */
export const LINK_MAX_OPENS = 25;
/** How many links to one note a party may have working at once. Each is a way in: a handful, never a pile nobody remembers. */
export const LINK_MAX_LIVE = 5;
const DAY_MS = 86_400_000;

/** What is kept of a link. NEVER THE KEY: only its fingerprint, so that reading this store opens nothing. */
export interface DocumentLink {
  linkId: string;
  tokenHash: string;
  docId: string;
  /** The party it was made for. The link reads the document as that party does, and that party alone may cancel it. */
  forDid: string;
  sentTo?: string;
  /**
   * The person it was emailed to, when it went to them AS ONE OF A BUSINESS'S PEOPLE. Never shown: it is here so that
   * the link stops when they are no longer in that business.
   */
  person?: string;
  madeBy?: string;
  createdAt: string;
  expiresAt: string;
  opened: number;
  lastOpenedAt?: string;
  cancelledAt?: string;
  cancelledBy?: string;
  cancelledWhy?: LinkCancelReason;
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
    // Optional so the specs that build this by hand keep compiling; app.boot.spec catches it missing from the module.
    @Optional() private readonly businesses?: BusinessService,
    @Optional() private readonly persons?: PersonService,
  ) {}

  onModuleInit(): void {
    // The receipt for a delivered load carries a link to its note. Registered here rather than injected there: this
    // reads the archive and the bundle, which both read that.
    this.notes.registerReceiptLink((freightId, forDid, sentTo, person) => {
      const docId = boardDocId(freightId);
      // A receipt's link is one of the handful a party may have working on a note. Past that the email goes without
      // one and says where the note is: six owners are not six ways in.
      if (this.liveCount(docId, forDid, Date.now()) >= LINK_MAX_LIVE) return undefined;
      const made = this.issue(docId, forDid, { sentTo, ...(person ? { person } : {}) });
      return made ? { url: linkUrl(made.token), until: made.link.expiresAt } : undefined;
    });
    // Somebody is taken out of a business, or leaves it: what was emailed to them as one of its people stops there.
    this.businesses?.onMemberGone((businessDid, personDid) => void this.stopSentTo(personDid, 'left', businessDid));
    // Somebody replaces their recovery email: every link that went to the old address stops, for whichever business
    // it was sent. People change an address because they lost the mailbox, or lost control of it — and nobody says
    // which. The note is still on the load; a new link is one press away.
    this.persons?.onEmailChanged((personDid) => void this.stopSentTo(personDid, 'address'));
  }

  /**
   * Make a link to a document for one of its parties. Nothing — not an error — when that party has no such
   * document: the email this is for goes all the same, and says where the note is instead.
   * The key is in what this returns and nowhere else, ever again.
   */
  issue(docId: string, forDid: string, opts: { sentTo?: string; person?: string; madeBy?: string; now?: number } = {}): { token: string; link: DocumentLink } | undefined {
    if (!this.archive.hasFor(docId, forDid)) return undefined;
    const now = opts.now ?? Date.now();
    const token = randomBytes(32).toString('base64url');
    const link: DocumentLink = {
      linkId: `dl_${randomBytes(8).toString('hex')}`,
      tokenHash: hashOf(token),
      docId,
      forDid,
      ...(opts.sentTo ? { sentTo: maskAddress(opts.sentTo) } : {}),
      ...(opts.person ? { person: opts.person } : {}),
      ...(opts.madeBy ? { madeBy: opts.madeBy.slice(0, 80) } : {}),
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + LINK_DAYS * DAY_MS).toISOString(),
      opened: 0,
    };
    this.links.set(link.tokenHash, link);
    return { token, link };
  }

  /**
   * A PARTY MAKES A LINK ITSELF, TO PASS ON — into a chat, a text, its own mail. The same key as the one a receipt
   * carries, with the same limits; what differs is who holds it first.
   *
   * For the caller's own reading of the note and nobody else's: whoever may take the file may make a link to it,
   * and no more than that. NOT STAFF: staff read every note, and a link made by staff would be a way in that no
   * party to the note made, could see on its note, or could cancel.
   *
   * AT MOST A HANDFUL WORK AT ONCE. Each link is a way in. A party that wants another cancels one — which is also
   * what makes it look at the ones it has.
   *
   * The address is handed back ONCE. The key is not kept, so it cannot be shown again.
   */
  make(docId: string, actor: IntrospectionResult | undefined, now: number = Date.now()): { url: string; link: DocumentLinkRow } {
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A link is made by a party to the note, for its own copy. Staff read the note itself.');
    // Whether the caller is a party to this note is asked where the link is made (`issue`) — once, in one place.
    const forDid = actingDid(actor);
    if (this.liveCount(docId, forDid, now) >= LINK_MAX_LIVE) throw new GlosError('INVALID_STATE', `This note already has ${LINK_MAX_LIVE} links that work. Cancel one to make another.`, { field: 'docId' });
    const made = this.issue(docId, forDid, { now, ...(actor?.actorName ? { madeBy: actor.actorName } : {}) });
    if (!made) throw new GlosError('NOT_FOUND', 'No such consignment note in the archive');
    return { url: linkUrl(made.token), link: this.row(made.link, now) };
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
    // Who did it is kept, where the sign-in names a person: in an office of five, "cancelled" is half an answer.
    const by = actor?.role === 'operator' ? 'SeeBuyGet staff' : actor?.actorName?.slice(0, 80);
    const cancelled: DocumentLink = link.cancelledAt ? link : { ...link, cancelledAt: new Date(now).toISOString(), ...(by ? { cancelledBy: by } : {}) };
    this.links.set(link.tokenHash, cancelled);
    return this.row(cancelled, now);
  }

  /**
   * WHAT WAS EMAILED TO SOMEBODY STOPS, by nobody's hand, and says why.
   *
   * `left`, for one business — they are no longer in it:
   *
   * Their sign-in stops on their next click (membership is read live). Without this, the receipt in their own mailbox
   * would go on opening the business's notes for a month. Only the links sent TO THEM: one they made in the app and
   * passed to a customer was made for the business, is on its note for the business to see, and is the business's to
   * cancel. Kept, and it says why — the owners see what became of it. How many it stopped.
   *
   * `address`, for every business — they replaced the address it was sent to. A mailbox somebody has stopped
   * vouching for is not a place to leave a way into anybody's papers.
   */
  stopSentTo(personDid: string, why: LinkCancelReason, forDid?: string, now: number = Date.now()): number {
    // A reason that belongs to one business is never applied to them all for want of saying which.
    if (!personDid || (why === 'left' && !forDid)) return 0;
    const theirs = [...this.links.values()].filter((l) => l.person === personDid && (forDid === undefined || l.forDid === forDid) && !l.cancelledAt);
    for (const l of theirs) this.links.set(l.tokenHash, { ...l, cancelledAt: new Date(now).toISOString(), cancelledWhy: why });
    return theirs.length;
  }

  /** How many links to this document work for this party right now. Counted in one place, for every way one is made. */
  private liveCount(docId: string, forDid: string, now: number): number {
    return [...this.links.values()].filter((l) => l.docId === docId && l.forDid === forDid && this.stateOf(l, now) === 'ready').length;
  }

  private row(l: DocumentLink, now: number): DocumentLinkRow {
    return {
      linkId: l.linkId,
      state: this.stateOf(l, now),
      ...(l.sentTo ? { sentTo: l.sentTo } : {}),
      ...(l.madeBy ? { madeBy: l.madeBy } : {}),
      createdAt: l.createdAt,
      expiresAt: l.expiresAt,
      opened: l.opened,
      ...(l.lastOpenedAt ? { lastOpenedAt: l.lastOpenedAt } : {}),
      ...(l.cancelledAt ? { cancelledAt: l.cancelledAt } : {}),
      ...(l.cancelledBy ? { cancelledBy: l.cancelledBy } : {}),
      ...(l.cancelledWhy ? { cancelledWhy: l.cancelledWhy } : {}),
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
