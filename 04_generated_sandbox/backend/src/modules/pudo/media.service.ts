import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { GlosError } from '../../foundation/http/glos-error';
import { BlobStore, FsBlobStore } from '../../foundation/media/blob-store';
import { decodeImage } from '../../foundation/media/decode-image';
import { PersistentMap } from '../../foundation/store/persistent-map';
import {
  KIND_RETENTION,
  MEDIA_CONTENT_TYPES,
  MEDIA_MAX_BYTES,
  MediaKind,
  MediaLink,
  MediaRef,
  MediaView,
  RETENTION_DAYS,
  RetentionClass,
} from './media.types';

const DAY_MS = 24 * 60 * 60 * 1000;
const SWEEP_MS = Number(process.env.GLOS_MEDIA_SWEEP_MS ?? 60 * 60 * 1000); // hourly
// An upload that never reaches a lifecycle event (abandoned capture) is reaped after this grace so
// orphans cannot accumulate forever — long enough that a slow form is never caught mid-fill.
const ORPHAN_GRACE_MS = Number(process.env.GLOS_MEDIA_ORPHAN_GRACE_MS ?? 48 * 60 * 60 * 1000);
const DATA_URL_RE = /^data:([a-z]+\/[a-z0-9.+-]+);base64,([A-Za-z0-9+/=]+)$/i;

/**
 * MediaService (S26) — real image upload + retention. Bytes go to a BlobStore; the core keeps a MediaRef
 * per image and a retention BIN per kind, so nothing is hoarded. Access is deliberately narrow: the
 * generic media endpoints serve the OWNER (or an operator) only; a counterparty who is allowed to see an
 * image (e.g. the receiver's own PoD) uploaded it themselves, so the owner check already covers them —
 * this keeps MediaService a leaf with no dependency on ParcelService/VehicleService (no DI cycle), while
 * the free-text/PII discipline from S25 holds (the list projection never leaks owner/sha256).
 */
@Injectable()
export class MediaService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(MediaService.name);
  private readonly refs = new PersistentMap<string, MediaRef>('media');
  // The byte-storage seam: FS under the sandbox (in-memory under Jest / GLOS_PERSIST=off). A prod S3/GCS/R2
  // impl of BlobStore slots in here without touching a caller. Not a DI dependency (interface = no token).
  private readonly blobs: BlobStore = new FsBlobStore();
  private sweeper?: NodeJS.Timeout;

  onApplicationBootstrap(): void {
    this.sweep(); // clear anything already past its window on boot
    this.sweeper = setInterval(() => this.sweep(), SWEEP_MS);
    this.sweeper.unref?.(); // never hold the process open for the sweep
  }

  onModuleDestroy(): void {
    if (this.sweeper) clearInterval(this.sweeper);
  }

  /** Store an uploaded image (a `data:<type>;base64,<...>` URL) + an optional thumbnail. Returns the id. */
  upload(input: { ownerDid: string; kind: MediaKind; dataUrl: string; thumbDataUrl?: string }): { mediaId: string } {
    if (!input.ownerDid) throw new GlosError('INVALID_INPUT', 'An owner is required to upload media');
    // Decode + validate BOTH parts BEFORE writing any bytes: a bad thumb must not leave the full image
    // orphaned on disk with no MediaRef (invisible to the retention sweep — an unreclaimable leak).
    const { contentType, bytes } = this.decode(input.dataUrl);
    const thumb = input.thumbDataUrl ? this.decode(input.thumbDataUrl, { maxBytes: 64 * 1024 }) : undefined;

    const mediaId = `med_${randomBytes(12).toString('hex')}`;
    this.blobs.put(mediaId, bytes);
    if (thumb) this.blobs.put(`${mediaId}.thumb`, thumb.bytes);

    const ref: MediaRef = {
      mediaId,
      ownerDid: input.ownerDid,
      kind: input.kind,
      retentionClass: KIND_RETENTION[input.kind],
      contentType,
      size: bytes.length,
      sha256: createHash('sha256').update(bytes).digest('hex'),
      hasThumb: Boolean(thumb),
      createdAt: new Date().toISOString(),
      status: 'active',
    };
    this.refs.set(mediaId, ref);
    return { mediaId };
  }

  /** The raw record (or undefined). Internal — never returned to a client as-is (use toView). */
  get(mediaId: string): MediaRef | undefined {
    return this.refs.get(mediaId);
  }

  /** May this caller fetch these bytes? Owner-or-operator only — the generic media endpoint's gate. */
  viewableBy(ref: MediaRef, callerDid: string, isOperator: boolean): boolean {
    return isOperator || ref.ownerDid === callerDid;
  }

  /** The bytes for a media (or its thumbnail). Throws GONE once the retention sweep has removed them. */
  blob(mediaId: string, variant: 'full' | 'thumb' = 'full'): { bytes: Buffer; contentType: string } {
    const ref = this.refs.get(mediaId);
    if (!ref) throw new GlosError('NOT_FOUND', 'No such media');
    if (ref.status === 'expired') throw new GlosError('MEDIA_EXPIRED', 'This media has passed its retention window and was removed');
    const key = variant === 'thumb' && ref.hasThumb ? `${mediaId}.thumb` : mediaId;
    const bytes = this.blobs.get(key);
    if (!bytes) throw new GlosError('NOT_FOUND', 'Media bytes are unavailable');
    return { bytes, contentType: ref.contentType };
  }

  /** The active media a given actor owns — the media-library (S27) source. PII-free projection. */
  listForOwner(ownerDid: string): MediaView[] {
    return [...this.refs.values()]
      .filter((r) => r.ownerDid === ownerDid && r.status === 'active')
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .map(MediaService.toView);
  }

  static toView(r: MediaRef): MediaView {
    return {
      mediaId: r.mediaId,
      kind: r.kind,
      retentionClass: r.retentionClass,
      contentType: r.contentType,
      hasThumb: r.hasThumb,
      link: r.link,
      createdAt: r.createdAt,
      expiresAt: r.expiresAt,
      status: r.status,
    };
  }

  /**
   * Attach a media to the domain object that references it (best-effort: a no-op if the ref is a legacy
   * filename or an unknown id, so old flows and demo data never break). Re-derives the retention bin from
   * the kind so a mis-uploaded kind still lands in the right place.
   */
  link(mediaId: string | undefined, link: MediaLink, kind?: MediaKind): void {
    if (!mediaId) return;
    const ref = this.refs.get(mediaId);
    if (!ref) return;
    ref.link = link;
    if (kind) {
      ref.kind = kind;
      ref.retentionClass = KIND_RETENTION[kind];
    }
    this.refs.set(mediaId, ref);
  }

  /**
   * S33 — adopt a CLIENT-SUPPLIED photo as a domain object's proof: link it + set its kind, but ONLY when the
   * caller OWNS it and it is not already attached elsewhere. `link()` above is ownership/kind-blind for TRUSTED
   * internal refs; a mediaId a client hands us (a driver's securement id at pickup) must not be able to launder
   * another actor's media out of its retention bin, nor detach media already anchored to something else (S29).
   * Silently no-ops (never throws) when it cannot safely adopt — an unknown/legacy id, a ref that isn't the
   * caller's, or one linked elsewhere — so a fresh own upload links and anything dubious is simply left alone.
   */
  adopt(mediaId: string | undefined, ownerDid: string, link: MediaLink, kind: MediaKind): void {
    if (!mediaId || !ownerDid) return;
    const ref = this.refs.get(mediaId);
    if (!ref || ref.status !== 'active') return;
    if (ref.ownerDid !== ownerDid) return; // not the caller's — never launder another actor's media
    if (ref.link && (ref.link.type !== link.type || ref.link.id !== link.id)) return; // already attached elsewhere
    ref.link = link;
    ref.kind = kind;
    ref.retentionClass = KIND_RETENTION[kind];
    this.refs.set(mediaId, ref);
  }

  /** Parcel reached a terminal state → start the 90-day clock on its shipment-proof media. Idempotent. */
  anchorParcelTerminal(parcelId: string, at: Date = new Date()): void {
    this.anchorLink('parcel', parcelId, 'shipment-proof', at);
  }

  /** Vehicle retired → start the grace clock on its asset media (so retired-fleet photos don't linger). */
  anchorVehicleRetired(vehicleId: string, at: Date = new Date()): void {
    this.anchorLink('vehicle', vehicleId, 'vehicle-asset', at);
  }

  /** Freight delivered (terminal) → start the 90-day clock on its securement proof. Idempotent (S33). */
  anchorFreightTerminal(freightId: string, at: Date = new Date()): void {
    this.anchorLink('freight', freightId, 'shipment-proof', at);
  }

  /**
   * A dispute was filed against a terminal parcel: put ALL its evidence — the delivery proof AND the
   * dispute photo — on ONE dispute-evidence clock, OVERRIDING any shorter shipment-proof window so the
   * proof needed to adjudicate is not swept out from under an open case, and starting the clock on the
   * dispute photo (which otherwise never anchors). No resolution event exists yet, so the clock is
   * anchored at filing — a bounded, honest approximation of "180 days after resolution".
   */
  /** FP3b — a claim was opened against a delivered freight: its securement + delivery proof and the claim photo go onto one dispute-evidence clock. */
  holdFreightForDispute(freightId: string, at: Date = new Date()): void {
    const until = new Date(at.getTime() + RETENTION_DAYS['dispute-evidence'] * DAY_MS).toISOString();
    for (const ref of this.refs.values()) {
      if (ref.status !== 'active') continue;
      if (ref.link?.type !== 'freight' || ref.link.id !== freightId) continue;
      ref.expiresAt = until;
      if (ref.retentionClass === 'shipment-proof') ref.retentionClass = 'dispute-evidence';
      this.refs.set(ref.mediaId, ref);
    }
  }

  holdParcelForDispute(parcelId: string, at: Date = new Date()): void {
    const until = new Date(at.getTime() + RETENTION_DAYS['dispute-evidence'] * DAY_MS).toISOString();
    for (const ref of this.refs.values()) {
      if (ref.status !== 'active') continue;
      if (ref.link?.type !== 'parcel' || ref.link.id !== parcelId) continue;
      ref.expiresAt = until; // override any existing (shorter) shipment-proof window
      if (ref.retentionClass === 'shipment-proof') ref.retentionClass = 'dispute-evidence'; // onto the case clock
      this.refs.set(ref.mediaId, ref);
    }
  }

  /** Set expiresAt for every active, not-yet-anchored media attached to `link` in a given bin. Idempotent. */
  private anchorLink(linkType: MediaLink['type'], linkId: string, retentionClass: RetentionClass, at: Date): void {
    for (const ref of this.refs.values()) {
      if (ref.status !== 'active' || ref.expiresAt) continue;
      if (ref.link?.type !== linkType || ref.link.id !== linkId) continue;
      if (ref.retentionClass !== retentionClass) continue;
      ref.expiresAt = new Date(at.getTime() + RETENTION_DAYS[retentionClass] * DAY_MS).toISOString();
      this.refs.set(ref.mediaId, ref);
    }
  }

  /**
   * Owner-initiated removal — only for user-managed asset media (vehicle/trailer/registration). Evidence
   * bins (shipment proof, dispute) are LOCKED until their retention expiry: a party must not be able to
   * delete proof mid-case.
   */
  removeByOwner(mediaId: string, ownerDid: string): void {
    const ref = this.refs.get(mediaId);
    if (!ref) throw new GlosError('NOT_FOUND', 'No such media');
    if (ref.ownerDid !== ownerDid) throw new GlosError('FORBIDDEN', 'You can only remove your own media');
    if (ref.retentionClass !== 'vehicle-asset') {
      throw new GlosError('MEDIA_LOCKED', 'This image is kept as evidence until its retention window ends');
    }
    this.purge(ref);
  }

  /**
   * Owner-scoped hard delete for an INTERNAL caller superseding its own media — e.g. a new avatar replaces
   * the old one. Requires ownership and is best-effort (an unknown id or a ref that is not yours is a silent
   * no-op). Defence in depth: it REFUSES the evidence bins (shipment-proof, dispute-evidence) — a party must
   * never destroy proof mid-case, and no internal supersede path has a legitimate reason to purge evidence.
   */
  purgeByOwner(mediaId: string | undefined, ownerDid: string): void {
    if (!mediaId) return;
    const ref = this.refs.get(mediaId);
    if (!ref || ref.ownerDid !== ownerDid) return;
    if (ref.retentionClass === 'shipment-proof' || ref.retentionClass === 'dispute-evidence') return;
    this.purge(ref);
  }

  /**
   * The retention sweep, two passes: (1) media whose retention window has closed → delete the bytes,
   * leave the ref as a tombstone (audit line). (2) never-linked uploads older than the upload grace →
   * hard delete (an abandoned capture that never reached any lifecycle event carries no evidence value,
   * so no tombstone). LINKED media with no clock yet (a drop-off on an in-transit parcel, an active
   * vehicle's photos) are left alone — their clock starts at their own lifecycle event.
   */
  sweep(now: Date = new Date()): number {
    let removed = 0;
    const orphanCutoff = now.getTime() - ORPHAN_GRACE_MS;
    for (const ref of this.refs.values()) {
      if (ref.status !== 'active') continue;
      if (ref.expiresAt) {
        if (new Date(ref.expiresAt).getTime() > now.getTime()) continue;
        this.purge(ref, /* tombstone */ true);
        removed += 1;
      } else if (!ref.link && new Date(ref.createdAt).getTime() < orphanCutoff) {
        this.purge(ref, /* tombstone */ false); // abandoned, never-attached upload — reclaim, no audit line
        removed += 1;
      }
    }
    if (removed) this.logger.log(`Retention sweep removed ${removed} media`);
    return removed;
  }

  /** Delete the bytes (+ thumb). tombstone=true keeps the ref record as an 'expired' audit line. */
  private purge(ref: MediaRef, tombstone = false): void {
    this.blobs.delete(ref.mediaId);
    if (ref.hasThumb) this.blobs.delete(`${ref.mediaId}.thumb`);
    if (tombstone) {
      ref.status = 'expired';
      this.refs.set(ref.mediaId, ref);
    } else {
      this.refs.delete(ref.mediaId);
    }
  }

  /** Decode + validate one uploaded image. The rules themselves live in foundation/media/decode-image, so
   *  this service and the help-illustration registry cannot disagree about what an image is. */
  private decode(dataUrl: string, opts: { maxBytes?: number } = {}): { contentType: string; bytes: Buffer } {
    return decodeImage(dataUrl, opts.maxBytes ?? MEDIA_MAX_BYTES);
  }
}
