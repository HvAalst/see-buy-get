// Media (S26) — real image UPLOAD + retention. Every "photo" in the system was a filename ref; now the
// bytes live in a BlobStore behind a MediaRef, and every ref lands in a retention BIN so nothing is kept
// forever. The nuance that makes retention correct: the TTL clock starts at a LIFECYCLE event (a parcel
// reaching a terminal state, a dispute resolving, an account/vehicle closing), not at upload time.

/** Every media kind, as a runtime tuple so the upload DTO can validate against it (single source). */
export const MEDIA_KINDS = [
  'dropoff', // agent drop-off proof
  'pod', // proof of delivery (agent delivered photo OR the receiver's own)
  'dispute', // dispute evidence photo
  'content', // vendor's photo of the order contents at mint
  'vehicle', // fleet vehicle body photo
  'trailer', // coupled trailer photo
  'registration', // vehicle registration papers
  'kyc_id', // account KYC — id document
  'kyc_licence', // account KYC — trading/driving licence
  'shop', // shop premises photo
] as const;

export type MediaKind = (typeof MEDIA_KINDS)[number];

export type RetentionClass = 'shipment-proof' | 'dispute-evidence' | 'account-doc' | 'vehicle-asset';
export type MediaStatus = 'active' | 'expired';

/** What a media item is attached to — drives who may see it and when its retention clock starts. */
export interface MediaLink {
  type: 'parcel' | 'vehicle' | 'agent' | 'driver';
  id: string;
}

export interface MediaRef {
  mediaId: string;
  ownerDid: string; // the actor that uploaded it — the primary (and, with ops, only) viewer
  kind: MediaKind;
  retentionClass: RetentionClass;
  contentType: string; // image/jpeg | image/png | image/webp
  size: number; // bytes of the full image
  sha256: string; // integrity + audit (and a hook for dedup later)
  hasThumb: boolean; // a '<mediaId>.thumb' blob exists for light grid rendering
  link?: MediaLink; // set when a domain object references the media
  createdAt: string;
  /** Undefined until a lifecycle event anchors the clock; once set, the sweeper deletes the bytes after it. */
  expiresAt?: string;
  status: MediaStatus; // 'expired' is a tombstone — the ref (audit line) survives, the bytes do not
}

/** The PII-free projection the media library (S27) and any list surface may see — never the sha256/owner. */
export interface MediaView {
  mediaId: string;
  kind: MediaKind;
  retentionClass: RetentionClass;
  contentType: string;
  hasThumb: boolean;
  link?: MediaLink;
  createdAt: string;
  expiresAt?: string;
  status: MediaStatus;
}

/** How long each bin keeps bytes AFTER its clock starts. Nothing is kept forever. */
export const RETENTION_DAYS: Record<RetentionClass, number> = {
  'shipment-proof': 90, // after the parcel reaches a terminal state (Delivered / collected / Voided)
  'dispute-evidence': 180, // after the dispute is resolved
  'account-doc': 30, // grace after the account/entity is closed
  'vehicle-asset': 30, // grace after the vehicle is retired; user-managed while the vehicle is active
};

/** The bin a kind lands in. */
export const KIND_RETENTION: Record<MediaKind, RetentionClass> = {
  dropoff: 'shipment-proof',
  pod: 'shipment-proof',
  content: 'shipment-proof',
  dispute: 'dispute-evidence',
  vehicle: 'vehicle-asset',
  trailer: 'vehicle-asset',
  registration: 'vehicle-asset',
  kyc_id: 'account-doc',
  kyc_licence: 'account-doc',
  shop: 'account-doc',
};

/** Only real raster image types — no SVG (it can carry script), no arbitrary bytes. */
export const MEDIA_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Server backstop — the client downscales to <200 KB; anything over this is rejected, not stored. */
export const MEDIA_MAX_BYTES = 500 * 1024;
