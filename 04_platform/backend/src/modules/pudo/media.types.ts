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
  /**
   * A carrier's goods-in-transit or liability INSURANCE certificate. Its own kind rather than a licence,
   * because it is not one — and a staff member opening "the licence" to check a policy number is exactly
   * the kind of mislabel a date gets misread under.
   */
  'kyc_insurance',
  /** A COMPANY's own papers, put on record when a fleet is set up: its certificate of registration, and proof of where it is. */
  'kyc_registration',
  'kyc_address',
  'shop', // shop premises photo
  'avatar', // a person's profile picture (S29)
  'securement', // S33 — a driver's photo of a secured dedicated-freight load at pickup
  'seal', // round 15 — a seal on a load: the shipper's three when it seals it, the driver's at pickup, a re-seal, a break
  'hazard', // a driver's photo of a road constraint — the bridge, the washout, or the road now clear
  /**
   * Y3 — the condition of a CONTAINER at a gate, photographed by a party to it.
   *
   * The driver's own evidence at the two gates is already taken: a securement photo at pickup and a
   * delivery photo at the depot, both demanded by the freight flow. This kind is for the accounts a PARTY
   * adds beside them — the importer who says the hole was there before, the agent who says it was not.
   */
  'interchange',
  /**
   * CL5 — a photograph of an OFFICIAL DOCUMENT somebody was asked for at a counter.
   *
   * The one kind of image on this network that two gates stand in front of: the country's, and the
   * person's. See FieldObservationService for both, and for why neither substitutes for the other.
   */
  'field_evidence',
  /**
   * A PERSON HOLDING THEIR OWN ID CARD, and the card close up — sent when two people say one national ID is
   * theirs (id-dispute.service.ts). Seen by the two members of staff who decide, and by nobody else.
   */
  'id_check',
  /**
   * A DEFECT ON A VEHICLE, photographed by whoever found it — the driver at the daily check, or later. The vehicle's
   * record, not the driver's: its owner sees it (through the upkeep routes, which ask the defect, not the photo), and
   * nobody deletes it while the vehicle is on the road. See vehicle-care.service.
   */
  'defect',
  /** The workshop's job card for a service or repair: the vehicle's record, like a defect's photo. */
  'job_card',
] as const;

export type MediaKind = (typeof MEDIA_KINDS)[number];

/** How long a photograph of somebody holding their ID is kept after the decision it was sent for. */
export const IDENTITY_CHECK_DAYS = 30;

export type RetentionClass = 'shipment-proof' | 'dispute-evidence' | 'account-doc' | 'vehicle-asset' | 'vehicle-record' | 'road-report' | 'field-evidence' | 'identity-check';
export type MediaStatus = 'active' | 'expired';

/** What a media item is attached to — drives who may see it and when its retention clock starts. */
export interface MediaLink {
  /** `fleet` — a fleet OPERATOR's own papers (its transport licence, its cover), sent from the fleet app. */
  type: 'parcel' | 'vehicle' | 'agent' | 'driver' | 'person' | 'freight' | 'constraint' | 'box' | 'fleet' | 'id-dispute';
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
  // A vehicle's own history — a defect photographed — is evidence in an insurance claim or a damage dispute: kept for
  // as long as the vehicle is on the road, and half a year after it is retired. Not the uploader's to delete.
  'vehicle-record': 180,
  // A road hazard's photo is kept for as long as the hazard is on the map, and its clock starts only when
  // an operator CLEARS it — the one moment the evidence stops being live and starts being a record of a
  // decision somebody may have to review. Nothing here expires on a timer, because time passing is not
  // evidence that a bridge came down.
  'road-report': 180,
  /**
   * CL5 — AND THIS ONE'S CLOCK STARTS AT UPLOAD, which no other bin's does.
   *
   * Every other class waits for a lifecycle event because time passing is not evidence: a bridge does not
   * come back up because 180 days elapsed. A field observation has no such event. It is dated knowledge
   * that stays useful for years, and if its photograph waited for something to finish it would be kept
   * for ever — an accumulating archive of other people's customs paperwork, which is the precise thing
   * this slice exists to prevent.
   *
   * So the PHOTOGRAPH is corroboration with a short life and the OBSERVATION outlives it. Ninety days is
   * long enough for somebody reviewing a surprise at a border to look at what was actually handed over,
   * and short enough that we are not a document archive. When the bytes go the words remain, which is
   * the same shape as an operator stripping a photograph off by hand.
   */
  'field-evidence': 90,
  /**
   * A FACE AND A GOVERNMENT ID IN ONE PICTURE — the most sensitive thing this store holds, sent for one decision.
   * Its clock starts when that decision is made (and again if the decision is looked at in person), and it is
   * short: what stays afterwards is who decided, when and what they checked, never the pictures.
   */
  'identity-check': IDENTITY_CHECK_DAYS,
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
  kyc_insurance: 'account-doc',
  kyc_registration: 'account-doc',
  kyc_address: 'account-doc',
  shop: 'account-doc',
  avatar: 'account-doc', // kept while the account is active (linked to the person → never orphan-reaped)
  hazard: 'road-report',
  securement: 'shipment-proof', // S33 — proof of a secured load, kept 90d after the freight is delivered
  seal: 'shipment-proof', // round 15 — kept with the load's other proof; onto the dispute clock with them if a claim is made
  // An argument about who put the hole in somebody else's container is a dispute about money, and its
  // evidence is kept on the dispute clock rather than the shipment one.
  interchange: 'dispute-evidence',
  field_evidence: 'field-evidence',
  id_check: 'identity-check',
  defect: 'vehicle-record',
  job_card: 'vehicle-record',
};

/** Only real raster image types — no SVG (it can carry script), no arbitrary bytes. */
export const MEDIA_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

/** Server backstop — the client downscales to <200 KB; anything over this is rejected, not stored. */
export const MEDIA_MAX_BYTES = 500 * 1024;
