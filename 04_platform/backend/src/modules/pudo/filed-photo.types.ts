/**
 * 2026-11-02 — A PHOTO IS FILED, THEN SHOWN (the owner: "a photo says more than a thousand words, but I want to avoid that
 * images are shared rather than attached to the right file path. Damage claims should be fingerprinted and just sharing
 * blurs this").
 *
 * So a photo never enters a conversation loose. It enters by being FILED to the thread's load or parcel — as damage, a
 * paper, or proof of loading, handover or delivery — where it is fingerprinted (the SHA-256 of its bytes, when, by which
 * side) and kept with that record. The chat shows a card that points at the filed photo; the card carries the reference
 * and the labels, never the picture.
 *
 * WHERE IT IS FILED, and why a file of its own. Every photograph a load or a parcel already holds belongs to an ACT: the
 * securement photo to the pickup, the proof of delivery to the delivery, the claim's photo to the opening of the claim,
 * a parcel's problem photo to the report of the problem — and the consignment note freezes those acts at each signature.
 * A photo filed from a conversation is none of those acts; written into one of them afterwards it would change a record
 * that was signed. So the record keeps a PHOTO FILE beside its acts (one per load, one per parcel), append-only, each
 * entry frozen with a fingerprint of its own; and the readers that already gather a record's evidence read it too:
 *   - a parcel's DAMAGE CLAIM REPORT puts the photos filed before it was made among its photographs, and hands over the
 *     ones filed afterwards beside it, in the same file (damage-report.service.ts);
 *   - a load's CLAIM lists them with the rest of its evidence for the member of staff reading it (dispatch.service.ts);
 *   - the media store keeps them on the record's own clock: the load's or parcel's proof clock, moved onto the dispute
 *     clock with everything else when a claim or a problem is reported.
 *
 * WHERE IT CAME FROM, said and never judged (the owner: gallery photos "accepted, labelled"; house rule: damage is
 * reported, not judged — both sides heard). A photo taken with the app's own live camera is "taken in the app, at the
 * time"; one chosen from the phone's gallery is "from the gallery", with the date the phone wrote into it (EXIF
 * DateTimeOriginal, read on the phone before the photo is made smaller, which strips it) — or "no date on it".
 */

/** What a filed photo IS — the answer to "What is this?". */
export const FILED_AS = ['damage', 'paper', 'proof'] as const;
export type FiledAs = (typeof FILED_AS)[number];

/** Proof of which moment. A parcel is handed over and delivered; only a load is also loaded. */
export const PROOF_OF = ['loading', 'handover', 'delivery'] as const;
export type ProofOf = (typeof PROOF_OF)[number];

/**
 * Where the photo came from, as the app that sent it says:
 *   app_camera  the app's own live camera, at the moment it was taken
 *   gallery     a photo already on the phone — chosen from the gallery, or shared into the app from another
 *   unknown     the app could not tell
 */
export const PHOTO_SOURCES = ['app_camera', 'gallery', 'unknown'] as const;
export type PhotoSource = (typeof PHOTO_SOURCES)[number];

/** Who filed it, named by their part in the RECORD — never who they are. */
export type FiledBy = 'sender' | 'driver' | 'shop' | 'receiver';

/**
 * THE REFERENCE a chat message carries, and what a shared report copies: the record, what the photo is, the media id,
 * the fingerprints and the labels. Never the picture.
 */
export interface FiledPhotoRef {
  filingId: string;
  subject: 'freight' | 'parcel';
  freightId?: string;
  parcelId?: string;
  /** The record's code as people read it: a load's code, or the parcel id. */
  code: string;
  as: FiledAs;
  proofOf?: ProofOf;
  by: FiledBy;
  mediaId: string;
  /** SHA-256 of the photo's bytes as they are kept. */
  sha256: string;
  /** SHA-256 of the file as it was on the phone, before it was made smaller to send — the phone's own word for it. */
  originalSha256?: string;
  source: PhotoSource;
  /** app_camera — when it was taken, by the phone's clock. */
  takenAt?: string;
  /** gallery — the date the phone wrote into the photo, as written there (a local time; no zone unless it carried one). */
  phoneDate?: string;
  /** When SeeBuyGet filed it — the server's clock. */
  filedAt: string;
  /** Filed on the phone with no signal and sent when it came back: when, by the phone. */
  writtenAt?: string;
  /** SHA-256 over this reference without this field, keys sorted: anybody holding the card can work it out again. */
  fingerprint: string;
}

/** What is kept of a filing: the reference, the thread it came from, and who — the who never leaves the server. */
export interface FiledPhoto extends FiledPhotoRef {
  conversationId: string;
  byDid: string;
}

/** A filed photo as one reader of the record sees it: the reference, and whether it was filed from the thread being read. */
export interface FiledPhotoView extends FiledPhotoRef {
  /** Filed from the conversation this was read through. */
  here: boolean;
}

/** What the filing asks for, as the phone sends it. Checked, every field, before anything is kept. */
export interface FileInput {
  mediaId: string;
  as: string;
  proofOf?: string;
  source: string;
  takenAt?: string;
  phoneDate?: string;
  originalSha256?: string;
  writtenAt?: string;
}
