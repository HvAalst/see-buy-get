import { Injectable, Optional } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { PersistentMap } from '../../foundation/store/persistent-map';
import { isFor } from './addressed-to';
import { AnchorBook } from './anchor-book.service';
import { DispatchService, FREIGHT_CLAIM_WINDOW_DAYS } from './dispatch.service';
import { DriverService } from './driver.service';
import {
  FILED_AS,
  PHOTO_SOURCES,
  PROOF_OF,
  type FiledAs,
  type FiledBy,
  type FiledPhoto,
  type FiledPhotoRef,
  type FiledPhotoView,
  type FileInput,
  type PhotoSource,
  type ProofOf,
} from './filed-photo.types';
import { MediaService } from './media.service';
import type { MediaLink } from './media.types';
import { canonicalJson } from './note-archive.types';
import { ParcelService } from './parcel.service';
import { PersonService } from './person.service';
import type { Parcel } from './pudo.types';
import { VendorService } from './vendor.service';

const DAY_MS = 86_400_000;

/** What a filing is about: one load, or one parcel. */
export interface FilingSubject {
  freightId?: string;
  parcelId?: string;
}

/** A local date and time as a phone writes it into a photo, with a zone only when the photo carried one. */
const PHONE_DATE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?(Z|[+-]\d{2}:\d{2})?$/;
const SHA256_HEX = /^[0-9a-f]{64}$/;

/**
 * THE RECORD'S PHOTO FILE (filed-photo.types.ts says why it is a file of its own, and who reads it).
 *
 * Two halves, so a conversation can refuse BEFORE it writes anything (lesson: refuse before you write): `prepare` asks
 * every question and keeps nothing — a party to the record, a record still open, the person's own photo that we hold,
 * labels that are labels — and hands back the filing it would keep; `keep` then adopts the photo into the record and
 * keeps the filing, and asks nothing that could still say no.
 */
@Injectable()
export class FiledPhotoService {
  private readonly filings = new PersistentMap<string, FiledPhoto>('pudo-filed-photos');

  constructor(
    private readonly media: MediaService,
    private readonly dispatch: DispatchService,
    // Optional so a spec names only what it exercises; app.boot.spec catches one missing from the module.
    @Optional() private readonly parcels?: ParcelService,
    @Optional() private readonly persons?: PersonService,
    @Optional() private readonly drivers?: DriverService,
    @Optional() private readonly vendors?: VendorService,
    @Optional() private readonly anchors?: AnchorBook,
  ) {}

  /**
   * EVERY QUESTION, NOTHING KEPT. The filing this person would make — or the refusal, in words, before anything is
   * written: a stranger to the record, a record that is closed, a photo that is not theirs or not ours to hold, a label
   * that is not one.
   */
  prepare(subject: FilingSubject, did: string, input: FileInput, from: { conversationId: string }, now: number = Date.now()): FiledPhoto {
    const as = oneOf(FILED_AS, input.as, 'What the photo is: damage, a paper, or proof') as FiledAs;
    const proofOf = as === 'proof' ? (oneOf(PROOF_OF, input.proofOf, 'Proof of what: loading, handover or delivery') as ProofOf) : undefined;
    if (as !== 'proof' && input.proofOf) throw new GlosError('INVALID_INPUT', 'Only proof says what moment it shows');
    const source = oneOf(PHOTO_SOURCES, input.source, 'Where the photo came from: the app’s camera, the gallery, or not known') as PhotoSource;
    const labels = labelsOf(source, input);

    const { by, code, link } = subject.freightId ? this.freightFiler(subject.freightId, did, now) : this.parcelFiler(subject.parcelId ?? '', did, proofOf);
    // The person's own photo, one we hold, still kept, and nobody else's evidence: PHOTO_REQUIRED otherwise, said plainly.
    this.media.requireHeld(input.mediaId, did, link, 'mediaId');
    const ref = this.media.get(input.mediaId)!;

    const unsigned: Omit<FiledPhotoRef, 'fingerprint'> = {
      filingId: `fp_${randomBytes(8).toString('hex')}`,
      subject: subject.freightId ? 'freight' : 'parcel',
      ...(subject.freightId ? { freightId: subject.freightId } : { parcelId: subject.parcelId }),
      code,
      as,
      ...(proofOf ? { proofOf } : {}),
      by,
      mediaId: input.mediaId,
      sha256: ref.sha256,
      ...labels,
      source,
      filedAt: new Date(now).toISOString(),
      ...(input.writtenAt ? { writtenAt: input.writtenAt } : {}),
    };
    const fingerprint = fingerprintOf(unsigned);
    return { ...unsigned, fingerprint, conversationId: from.conversationId, byDid: did };
  }

  /**
   * KEEP IT WITH THE RECORD: the photo adopted into the record (so it is the record's, and nobody else's evidence), the
   * filing kept and anchored, and the photo put on the record's own clock — the dispute clock where a claim or a problem
   * was already reported, the proof clock where the record has already ended, and none yet while it is still moving
   * (its own ending starts it, as it does for every other photo of the record).
   */
  keep(filing: FiledPhoto, now: number = Date.now()): FiledPhotoRef {
    const link: MediaLink = filing.freightId ? { type: 'freight', id: filing.freightId } : { type: 'parcel', id: filing.parcelId! };
    this.media.adopt(filing.mediaId, filing.byDid, link, 'filed');
    this.filings.set(filing.filingId, filing);
    this.anchors?.anchor(`filed-photo:${filing.filingId}`, { f: filing.filingId, on: filing.code, sha256: filing.sha256, fingerprint: filing.fingerprint }, now);
    this.startClock(filing, now);
    return refOf(filing);
  }

  /**
   * Whether this person may file a photo to this record now — a party to it, and the record open — so a chat offers the
   * camera only to somebody it would not refuse. The filing itself asks again, with the photo.
   */
  canFile(subject: FilingSubject, did: string, now: number = Date.now()): boolean {
    try {
      if (subject.freightId) this.freightFiler(subject.freightId, did, now);
      else this.parcelFiler(subject.parcelId ?? '', did, undefined);
      return true;
    } catch {
      return false;
    }
  }

  get(filingId: string): FiledPhoto | undefined {
    return this.filings.get(filingId);
  }

  /** Every photo filed to one load or one parcel, oldest first. */
  forSubject(subject: FilingSubject): FiledPhoto[] {
    return [...this.filings.values()]
      .filter((f) => (subject.freightId ? f.freightId === subject.freightId : f.parcelId === subject.parcelId))
      .sort((a, b) => a.filedAt.localeCompare(b.filedAt));
  }

  /** The photos filed to a parcel — what its damage claim report hands over. */
  forParcel(parcelId: string): FiledPhotoRef[] {
    return this.forSubject({ parcelId }).map(refOf);
  }

  /**
   * WHO MAY READ THE RECORD'S PHOTO FILE — the record's own read rule, beyond the two people in one conversation:
   *   a load    its poster (the store, where a store's order was diverted to a load), the driver carrying it, and that
   *             driver's current fleet manager;
   *   a parcel  the shop it is collected at, the person it is for, the person who sent it, and the store whose order it is.
   * Staff read a filed photo through a shared report, a load's claim, and a parcel's damage claim report — not here.
   */
  isRecordReader(subject: FilingSubject, did: string): boolean {
    try {
      if (subject.freightId) {
        const f = this.dispatch.requireFreightPublic(subject.freightId);
        if (did === this.posterOf(f) || did === f.claimedBy) return true;
        return Boolean(f.claimedBy) && this.managerOf(f.claimedBy!) === did;
      }
      if (!this.parcels || !subject.parcelId) return false;
      const p = this.parcels.get(subject.parcelId);
      if (did === p.destAgentDid) return true;
      if (p.vendorId && this.storeDid(p.vendorId) === did) return true;
      const person = this.persons?.findByDid(did);
      return Boolean(person && (isFor(this.parcels.receiverOf(p), person) || isFor(this.parcels.senderOf(p), person)));
    } catch {
      return false;
    }
  }

  /**
   * The photos filed to a thread's record that this reader may see through that thread: every one, to a reader of the
   * record; otherwise only the ones filed from this very thread — a driver who only asked about a load sees what was
   * filed in their own conversation, and nothing the poster filed with somebody else.
   */
  visibleThrough(conversationId: string, subject: FilingSubject, did: string): FiledPhotoView[] {
    const reader = this.isRecordReader(subject, did);
    return this.forSubject(subject)
      .filter((f) => f.conversationId === conversationId || reader)
      .map((f) => ({ ...refOf(f), here: f.conversationId === conversationId }));
  }

  /** The bytes of a filed photo, or its thumbnail. MEDIA_EXPIRED once its keeping time has ended — a true answer. */
  bytes(filingId: string, variant: 'full' | 'thumb' = 'full'): { bytes: Buffer; contentType: string } {
    const filing = this.filings.get(filingId);
    if (!filing) throw new GlosError('NOT_FOUND', 'Photo not found');
    return this.media.blob(filing.mediaId, variant);
  }

  /* ------------------------------------------------------------------ the two records -- */

  /**
   * A LOAD: filed by its poster or by the driver carrying it — a driver who only asked about it has nothing of theirs on
   * it. Closed once it was cancelled, or once the time to claim on a delivered load has passed with no claim open, or
   * once its claim was decided: after that nothing filed could change anything, and the record is settled.
   */
  private freightFiler(freightId: string, did: string, now: number): { by: FiledBy; code: string; link: MediaLink } {
    const f = this.dispatch.requireFreightPublic(freightId);
    const by: FiledBy | undefined = did === this.posterOf(f) ? 'sender' : did === f.claimedBy ? 'driver' : undefined;
    if (!by) throw new GlosError('FORBIDDEN', 'You are not carrying this load, so there is nothing of yours to file to it. A photo is filed by the poster, or by the driver who has the load.');
    if (f.status === 'cancelled') throw new GlosError('INVALID_STATE', 'This load was cancelled, so its record is closed');
    if (f.claim && f.claim.state !== 'open') throw new GlosError('INVALID_STATE', 'This load’s claim has been decided, so its record is closed');
    const ended = f.deliveredAt ? Date.parse(f.deliveredAt) : NaN;
    if ((f.status === 'delivered' || f.status === 'refused') && !f.claim && Number.isFinite(ended) && now - ended > FREIGHT_CLAIM_WINDOW_DAYS * DAY_MS) {
      throw new GlosError('INVALID_STATE', `This load was delivered more than ${FREIGHT_CLAIM_WINDOW_DAYS} days ago, so its record is closed`);
    }
    return { by, code: f.code ?? f.freightId, link: { type: 'freight', id: f.freightId } };
  }

  /**
   * A PARCEL: filed by the shop it is collected at, or by the person it is for — the two in a parcel's conversation, each
   * checked against the parcel as it is now (a parcel sent on to another shop is no longer the first shop's to file to).
   * Closed once it was voided or returned. Never "loaded": a parcel is handed over and delivered.
   */
  private parcelFiler(parcelId: string, did: string, proofOf: ProofOf | undefined): { by: FiledBy; code: string; link: MediaLink } {
    if (!this.parcels || !this.persons) throw new GlosError('INVALID_STATE', 'Photos cannot be filed to a parcel here');
    let p: Parcel;
    try {
      p = this.parcels.get(parcelId);
    } catch {
      throw new GlosError('NOT_FOUND', 'Parcel not found');
    }
    let by: FiledBy | undefined;
    if (did === p.destAgentDid) by = 'shop';
    else {
      const person = this.persons.findByDid(did);
      if (person && isFor(this.parcels.receiverOf(p), person)) by = 'receiver';
    }
    if (!by) throw new GlosError('FORBIDDEN', 'This parcel is not collected at your shop or addressed to you, so there is nothing of yours to file to it');
    if (p.status === 'Voided' || p.status === 'Returned') throw new GlosError('INVALID_STATE', 'This parcel was voided or sent back, so its record is closed');
    if (proofOf === 'loading') throw new GlosError('INVALID_INPUT', 'A parcel is handed over and delivered — proof of loading is for a load');
    return { by, code: p.parcelId, link: { type: 'parcel', id: p.parcelId } };
  }

  private startClock(filing: FiledPhoto, now: number): void {
    try {
      if (filing.freightId) {
        const f = this.dispatch.requireFreightPublic(filing.freightId);
        // The claim's own moment, so every photo of the load keeps the one date it already had.
        if (f.claim) this.media.holdFreightForDispute(f.freightId, new Date(f.claim.raisedAt));
        else if (f.status === 'delivered' || f.status === 'refused') this.media.anchorFreightTerminal(f.freightId, new Date(now));
        return;
      }
      const p = this.parcels?.get(filing.parcelId!);
      if (!p) return;
      if (p.dispute) this.media.holdParcelForDispute(p.parcelId, new Date(p.dispute.raisedAt));
      else if (p.status === 'Delivered' || p.status === 'Lost') this.media.anchorParcelTerminal(p.parcelId, new Date(now));
    } catch {
      /* a record that cannot be read now keeps the photo linked; its own ending starts the clock */
    }
  }

  /** Who answers for a load, as a DID somebody signs in as — a store's diverted order records the store's id. */
  private posterOf(f: { postedByDid?: string; shipperDid?: string }): string | undefined {
    if (f.postedByDid) return f.postedByDid;
    if (f.shipperDid && this.vendors?.has(f.shipperDid)) return this.vendors.get(f.shipperDid).did;
    return f.shipperDid;
  }

  private managerOf(driverDid: string): string | undefined {
    try {
      return this.drivers?.get(driverDid).managerDid ?? undefined;
    } catch {
      return undefined;
    }
  }

  private storeDid(vendorId: string): string | undefined {
    try {
      return this.vendors?.get(vendorId).did;
    } catch {
      return undefined;
    }
  }
}

/** The reference, without who — what a card, a report and a record reader see. */
export function refOf(f: FiledPhoto | FiledPhotoRef): FiledPhotoRef {
  const { conversationId: _c, byDid: _b, ...ref } = f as FiledPhoto;
  return ref;
}

/** SHA-256 over a reference without its fingerprint, keys sorted — the card's own fingerprint. */
export function fingerprintOf(ref: Omit<FiledPhotoRef, 'fingerprint'> | FiledPhotoRef): string {
  const { fingerprint: _f, ...unsigned } = ref as FiledPhotoRef;
  return createHash('sha256').update(canonicalJson(unsigned)).digest('hex');
}

function oneOf(allowed: readonly string[], value: string | undefined, say: string): string {
  if (!value || !allowed.includes(value)) throw new GlosError('INVALID_INPUT', say);
  return value;
}

/**
 * The labels, kept as the phone sent them and only where they belong: a time taken for the app's camera, the phone's own
 * date for a gallery photo, nothing for one whose origin is not known. A label that is not the shape of one is refused,
 * rather than kept as something it is not.
 */
function labelsOf(source: PhotoSource, input: FileInput): Pick<FiledPhotoRef, 'takenAt' | 'phoneDate' | 'originalSha256'> {
  const out: Pick<FiledPhotoRef, 'takenAt' | 'phoneDate' | 'originalSha256'> = {};
  if (input.originalSha256 !== undefined && input.originalSha256 !== '') {
    if (!SHA256_HEX.test(input.originalSha256)) throw new GlosError('INVALID_INPUT', 'The photo’s own fingerprint is 64 hexadecimal characters');
    out.originalSha256 = input.originalSha256;
  }
  if (source === 'app_camera') {
    if (input.phoneDate) throw new GlosError('INVALID_INPUT', 'A photo taken in the app is dated when it was taken, not by a date written in a file');
    if (input.takenAt !== undefined && input.takenAt !== '') {
      if (!Number.isFinite(Date.parse(input.takenAt))) throw new GlosError('INVALID_INPUT', 'When the photo was taken is not a time');
      out.takenAt = new Date(Date.parse(input.takenAt)).toISOString();
    }
  } else if (source === 'gallery') {
    if (input.takenAt) throw new GlosError('INVALID_INPUT', 'A photo from the gallery carries the phone’s own date, not a time the app saw it taken');
    if (input.phoneDate !== undefined && input.phoneDate !== '') {
      if (!PHONE_DATE.test(input.phoneDate)) throw new GlosError('INVALID_INPUT', 'The phone’s date is written as 2026-10-30T14:22:05');
      out.phoneDate = input.phoneDate;
    }
  } else if (input.takenAt || input.phoneDate) {
    throw new GlosError('INVALID_INPUT', 'A photo whose origin is not known carries no date');
  }
  return out;
}
