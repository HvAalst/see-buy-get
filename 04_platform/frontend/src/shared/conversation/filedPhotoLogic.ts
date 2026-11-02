/**
 * 2026-11-02 — A PHOTO IS FILED, THEN SHOWN: the pure half. No DOM, no fetch.
 *
 * The owner: "a photo says more than a thousand words, but I want to avoid that images are shared rather than attached to
 * the right file path. Damage claims should be fingerprinted and just sharing blurs this." So a photo enters a chat only
 * by being FILED to the chat's load or parcel — as damage, a paper, or proof of loading, handover or delivery — where the
 * server fingerprints it and keeps it with that record (backend filed-photo.types.ts). The chat shows a card that points
 * at it: "Filed: FRT-7781 › Damage · taken 10:42 in the app · Tsehay · fingerprint 3f9a…c21 · Open in the load’s record".
 *
 * Where it came from is said, never judged (house rule: damage is reported, not judged): "taken in the app, at the time"
 * for the app's own live camera; "from the gallery, taken 30 Oct 2026 (the phone’s date)" for a photo already on the
 * phone, with the date the phone wrote into it (shared/exifDate.ts, read before the photo is made smaller); "from the
 * gallery, no date on it" when it carried none.
 */

import type { MessageKey } from '../i18n';
import type { OutboxItem } from '../outbox';

/** Mirrored from backend filed-photo.types.ts — keep the lists identical. */
export const FILED_AS = ['damage', 'paper', 'proof'] as const;
export type FiledAs = (typeof FILED_AS)[number];
export const PROOF_OF = ['loading', 'handover', 'delivery'] as const;
export type ProofOf = (typeof PROOF_OF)[number];
export type PhotoSource = 'app_camera' | 'gallery' | 'unknown';
export type FiledBy = 'sender' | 'driver' | 'shop' | 'receiver';
export type FilingSubject = 'freight' | 'parcel';

/** The reference a chat message carries — the record, what it is, the fingerprints and the labels. Never the picture. */
export interface FiledPhotoRef {
  filingId: string;
  subject: FilingSubject;
  freightId?: string;
  parcelId?: string;
  code: string;
  as: FiledAs;
  proofOf?: ProofOf;
  by: FiledBy;
  mediaId: string;
  sha256: string;
  originalSha256?: string;
  source: PhotoSource;
  takenAt?: string;
  phoneDate?: string;
  filedAt: string;
  writtenAt?: string;
  fingerprint: string;
}

/** A filed photo as the record's photo file lists it through one chat: whether it was filed in that very chat. */
export interface FiledPhotoView extends FiledPhotoRef {
  here: boolean;
}

/** "What is this?" — one answer: damage, a paper, or proof of one moment. */
export type FilingChoice = { as: 'damage' } | { as: 'paper' } | { as: 'proof'; proofOf: ProofOf };

/** The moments a photo can be proof of, for what the chat is about: a parcel is handed over and delivered, never loaded. */
export function proofChoices(subject: FilingSubject | undefined): readonly ProofOf[] {
  return subject === 'parcel' ? ['handover', 'delivery'] : PROOF_OF;
}

/** Whether a choice can be filed to this kind of record. */
export function fitsSubject(choice: FilingChoice | null, subject: FilingSubject | undefined): boolean {
  return Boolean(choice) && !(choice!.as === 'proof' && !proofChoices(subject).includes(choice!.proofOf));
}

/** What it is, in the reader's words: "Damage", "A paper", "Proof of handover". */
export function whatKey(p: Pick<FiledPhotoRef, 'as' | 'proofOf'>): MessageKey {
  if (p.as === 'proof') return `common.chat.photo.card.proof.${p.proofOf ?? 'handover'}` as MessageKey;
  return `common.chat.photo.card.${p.as}` as MessageKey;
}

/** The date part of what the phone wrote, said as a day — "30 Oct 2026" — with no time zone guessed onto it. */
export function phoneDay(phoneDate: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(phoneDate);
  if (!m) return phoneDate;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/**
 * Where it came from, as a key and its words. `at` is how a time is said where the card says one ("taken 10:42 in the
 * app"); without it, the label the viewer shows ("taken in the app, at the time").
 */
export function sourceLabel(p: Pick<FiledPhotoRef, 'source' | 'phoneDate' | 'takenAt'>, at?: (iso: string) => string): { key: MessageKey; params?: Record<string, string> } {
  if (p.source === 'app_camera') return at && p.takenAt ? { key: 'common.chat.photo.source.appAt', params: { time: at(p.takenAt) } } : { key: 'common.chat.photo.source.app' };
  if (p.source === 'gallery') return p.phoneDate ? { key: 'common.chat.photo.source.galleryDated', params: { date: phoneDay(p.phoneDate) } } : { key: 'common.chat.photo.source.galleryUndated' };
  return { key: 'common.chat.photo.source.unknown' };
}

/** A fingerprint as a person compares it at a glance: "3f9a…c21". The whole of it is in the viewer. */
export function shortPrint(hex: string | undefined): string {
  if (!hex) return '';
  return hex.length > 10 ? `${hex.slice(0, 4)}…${hex.slice(-3)}` : hex;
}

/** Who filed it, by their part in the record — for a photo filed in another chat about it, where "you" or a name says nothing. */
export function byKey(by: FiledBy, subject: FilingSubject): MessageKey {
  return `common.chat.photo.by.${subject === 'parcel' && by === 'receiver' ? 'customer' : by}` as MessageKey;
}

/** The record link's words: the load's, or the parcel's. */
export function recordKey(subject: FilingSubject | undefined): MessageKey {
  return subject === 'parcel' ? 'common.chat.photo.openRecord.parcel' : 'common.chat.photo.openRecord.freight';
}

/* ---------------------------------------------------------------- sending -- */

/** A photo made ready on the phone: the smaller copy to send, and the labels read from the original before it shrank. */
export interface PreparedPhoto {
  dataUrl: string;
  thumbDataUrl?: string;
  source: PhotoSource;
  /** app_camera — when it was taken, by this phone's clock. */
  takenAt?: string;
  /** gallery — the date the phone wrote into it, read before it was made smaller. */
  phoneDate?: string;
  /** SHA-256 of the file as it was on the phone, before it was made smaller. */
  originalSha256?: string;
}

/** What is sent to file it — only the labels that belong to where it came from (the server refuses the others). */
export function fileBody(mediaId: string, photo: PreparedPhoto, choice: FilingChoice, writtenAt: string) {
  return {
    mediaId,
    as: choice.as,
    ...(choice.as === 'proof' ? { proofOf: choice.proofOf } : {}),
    source: photo.source,
    ...(photo.source === 'app_camera' && photo.takenAt ? { takenAt: photo.takenAt } : {}),
    ...(photo.source === 'gallery' && photo.phoneDate ? { phoneDate: photo.phoneDate } : {}),
    ...(photo.originalSha256 ? { originalSha256: photo.originalSha256 } : {}),
    writtenAt,
  };
}

/** Whether a queued write is a photo being filed in this chat. */
export function isPhotoIn(path: string, conversationId: string): boolean {
  return path === `/v1/sbg/conversations/${conversationId}/photos` || path === `/v1/sbg/conversations/${encodeURIComponent(conversationId)}/photos`;
}

/** A photo filed with no signal, waiting on this phone: what it is, when, and — once refused — why. */
export interface WaitingPhoto {
  id: string;
  as: FiledAs;
  proofOf?: ProofOf;
  writtenAt: string;
  refused?: string;
}

/** The photos of this chat still waiting on this phone for a signal, in the order they were filed. */
export function waitingPhotosIn(items: ReadonlyArray<Pick<OutboxItem, 'id' | 'method' | 'path' | 'body' | 'at' | 'state' | 'error'>>, conversationId: string): WaitingPhoto[] {
  const out: WaitingPhoto[] = [];
  for (const item of items) {
    if (item.method.toUpperCase() !== 'POST' || !isPhotoIn(item.path, conversationId)) continue;
    const body = (item.body ?? {}) as { as?: unknown; proofOf?: unknown; writtenAt?: unknown };
    if (!(FILED_AS as readonly unknown[]).includes(body.as)) continue;
    out.push({
      id: item.id,
      as: body.as as FiledAs,
      ...((PROOF_OF as readonly unknown[]).includes(body.proofOf) ? { proofOf: body.proofOf as ProofOf } : {}),
      writtenAt: typeof body.writtenAt === 'string' ? body.writtenAt : item.at,
      ...(item.state === 'blocked' ? { refused: item.error || 'Refused' } : {}),
    });
  }
  return out;
}
