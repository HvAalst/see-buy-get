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
 * generic media endpoints serve the OWNER (or an operator); a counterparty who is allowed to see an
 * image (e.g. the receiver's own PoD) uploaded it themselves, so the owner check already covers them —
 * this keeps MediaService a leaf with no dependency on ParcelService/VehicleService (no DI cycle), while
 * the free-text/PII discipline from S25 holds (the list projection never leaks owner/sha256).
 *
 * The ONE exception is a posted road-hazard photo, readable by any authenticated peer — see peerViewable,
 * which carries the argument. It is decided on the REF ALONE for the reason above: the moment this gate
 * has to ask another service what a caller may see, MediaService stops being a leaf.
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
    /*
     * CL5 — THE ONE BIN WHOSE CLOCK STARTS HERE.
     *
     * Every other class is anchored by a lifecycle event, because time passing is not evidence that
     * anything changed. A field observation has no such event — it is dated knowledge that stays useful
     * for years — so a photograph waiting for one would be kept for ever, and an archive of other
     * people's customs paperwork is the precise thing this slice exists to prevent.
     */
    if (ref.retentionClass === 'field-evidence') {
      ref.expiresAt = new Date(Date.parse(ref.createdAt) + RETENTION_DAYS['field-evidence'] * DAY_MS).toISOString();
    }
    this.refs.set(mediaId, ref);
    return { mediaId };
  }

  /** The raw record (or undefined). Internal — never returned to a client as-is (use toView). */
  get(mediaId: string): MediaRef | undefined {
    return this.refs.get(mediaId);
  }

  /**
   * A PHOTOGRAPH OF A ROAD, which every driver about to run it may see. The one widening of the gate.
   *
   * The rest of this store is owner-or-operator because every counterparty allowed to see an image
   * uploaded it themselves. A crowd-sourced hazard map is the case that breaks the rule: the whole point
   * of the photograph is that the NEXT driver sees the bridge before they meet it, and a warning that
   * says "2 photos" and then refuses them is a warning nobody can check. Peer reporting that cannot be
   * read back is not peer sharing.
   *
   * TWO CONDITIONS, and both matter.
   *
   * `kind === 'hazard'` — never a KYC id, never a delivery photo, never a load. This is a list of one,
   * and it stays a list of one until somebody argues a second kind through on its own merits.
   *
   * `link.type === 'constraint'` — the ref must actually be ATTACHED to a report. An upload sitting in a
   * driver's camera roll on the way to a form is nobody else's yet, and the abandoned-capture case (a
   * driver who photographed the wrong thing and backed out) must not become readable because the bytes
   * happened to be tagged 'hazard' at upload. Posting it is the act that makes it public, and the link is
   * what records that act.
   *
   * WHAT THIS BUYS AN ATTACKER, stated plainly: an authenticated participant who knows a media id can now
   * read it if it is a posted hazard photo. Ids are 24 random hex, so knowing one means being told one,
   * and what they learn is a picture of a public road that is already described to them in words on the
   * same screen. In exchange, the route-constraint service now ADOPTS client-supplied photo refs instead
   * of blind-linking them — a caller can no longer relabel someone else's media as a hazard, which under
   * the old owner-only gate leaked nothing and under this one would have leaked everything.
   *
   * NOT status-gated on purpose. An expired ref falls through to `blob()`, which answers MEDIA_EXPIRED —
   * "this was kept for 180 days and then deleted" is a true answer, and 403 in its place would be a lie.
   */
  static peerViewable(ref: MediaRef): boolean {
    return ref.kind === 'hazard' && ref.link?.type === 'constraint';
  }

  /** May this caller fetch these bytes? Owner-or-operator, plus a posted hazard photo for any peer. */
  viewableBy(ref: MediaRef, callerDid: string, isOperator: boolean): boolean {
    return isOperator || ref.ownerDid === callerDid || MediaService.peerViewable(ref);
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
  adopt(mediaId: string | undefined, ownerDid: string, link: MediaLink, kind: MediaKind): boolean {
    if (!mediaId || !ownerDid) return false;
    const ref = this.refs.get(mediaId);
    if (!ref || ref.status !== 'active') return false;
    if (ref.ownerDid !== ownerDid) return false; // not the caller's — never launder another actor's media
    if (ref.link && (ref.link.type !== link.type || ref.link.id !== link.id)) return false; // attached elsewhere
    ref.link = link;
    ref.kind = kind;
    ref.retentionClass = KIND_RETENTION[kind];
    this.refs.set(mediaId, ref);
    // TRUE means this media is now ours to serve. A caller that RECORDS a photo reference — a hazard
    // account, say — needs to know, or it writes down a citation to a photograph nobody can produce,
    // which is the same defect as a screen that says "2 photos" and shows none.
    return true;
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
  /**
   * An operator cleared a road hazard: its photographs stop being live evidence and start their clock.
   *
   * Until this moment they have NO expiry at all, which is the point — a bridge does not come down
   * because a retention window elapsed, and a photo reaped while the hazard is still on the map would
   * leave the warning standing with nothing behind it. The link is what keeps them out of the
   * orphan sweep meanwhile (an unlinked upload is reclaimed as an abandoned capture).
   */
  anchorConstraintCleared(constraintId: string, at: Date = new Date()): void {
    const until = new Date(at.getTime() + RETENTION_DAYS['road-report'] * DAY_MS).toISOString();
    for (const ref of this.refs.values()) {
      if (ref.link?.type !== 'constraint' || ref.link.id !== constraintId) continue;
      if (ref.status !== 'active' || ref.expiresAt) continue;
      ref.expiresAt = until;
      this.refs.set(ref.mediaId, ref);
    }
  }

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
   * An account document has been REPLACED — a licence renewed from a newer photograph — so the old one
   * starts its clock instead of waiting for the account to close.
   *
   * Account documents are kept for the life of the account because they are what it was vetted on. A
   * superseded licence is not that any more; kept until the courier leaves, a long-serving one would
   * leave a drawer of every card they ever held. It is not purged on the spot either: for the bin's
   * grace period it still answers "what was on record before this date was typed". Account documents
   * only, so this cannot become a way to start the clock on somebody's evidence.
   */
  retireAccountDoc(mediaId: string | undefined, at: Date = new Date()): void {
    if (!mediaId) return;
    const ref = this.refs.get(mediaId);
    if (!ref || ref.status !== 'active' || ref.expiresAt) return;
    if (ref.retentionClass !== 'account-doc') return;
    ref.expiresAt = new Date(at.getTime() + RETENTION_DAYS['account-doc'] * DAY_MS).toISOString();
    this.refs.set(mediaId, ref);
  }

  /**
   * CL5 — STOP HOLDING A PHOTOGRAPH OF AN OFFICIAL DOCUMENT, NOW, and keep the fact that we did.
   *
   * Taking a photograph back off an observation used to unlink it and leave the bytes on disk for the rest
   * of their ninety days — still served, still ours. Both reasons anybody takes one back mean the opposite:
   * a number was visible that should have been covered, or a country withdrew its permission. In either
   * case holding it for another eighty-nine days is the thing the user said we cannot do.
   *
   * ONE BIN ONLY, BY CONSTRUCTION. Every other public door into this store refuses the evidence bins, and
   * rightly: a party must never destroy proof mid-case. This one refuses everything EXCEPT field evidence,
   * so it cannot become a way to purge a dispute photo because somebody found the method.
   *
   * A TOMBSTONE, NOT A HARD DELETE. The bytes go; the record that a photograph existed and was withdrawn
   * stays, because a withdrawal nobody can see happened is indistinguishable from one that never did.
   */
  withdrawFieldEvidence(mediaId: string | undefined): void {
    if (!mediaId) return;
    const ref = this.refs.get(mediaId);
    if (!ref || ref.status !== 'active') return;
    if (ref.retentionClass !== 'field-evidence') {
      throw new GlosError('MEDIA_LOCKED', 'Only a photograph of an official document can be withdrawn this way');
    }
    this.purge(ref, /* tombstone */ true);
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
