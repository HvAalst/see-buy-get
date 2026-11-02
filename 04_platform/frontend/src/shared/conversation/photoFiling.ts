/**
 * 2026-11-02 — FILING A PHOTO FROM THIS PHONE: making it ready, and sending it — or keeping it for a signal.
 *
 * Ready, in this order, because the order is the point: the date the phone wrote into it and the fingerprint of the file
 * are read from the ORIGINAL first (shared/exifDate.ts), and only then is it made smaller (shared/media.ts), which strips
 * the EXIF on purpose. Then it is uploaded and filed to the chat's load or parcel.
 *
 * With no signal (the owner: built for East Africa's weak signal) the smaller copy waits on the phone under a `local:`
 * reference (shared/heldPhotos.ts, kind `filed`), and the filing waits in the outbox carrying it; when the signal comes
 * back the outbox uploads the photo first and files it, dated when it was filed on the phone (`writtenAt`).
 */

import { narrow, type ConversationsApi, type SbgError } from '../../lib/sbg';
import { readExifDate } from '../exifDate';
import { forgetHeld, holdPhoto, isHeld } from '../heldPhotos';
import { downscaleImage } from '../media';
import { refusalWords, UPLOAD_LIMITS } from '../upload';
import { fileBody, type FilingChoice, type PhotoSource, type PreparedPhoto } from './filedPhotoLogic';
import { wasQueued, type ChatMessage } from './logic';

/** The SHA-256 of a file, as hexadecimal — or nothing where this phone cannot work it out. */
export async function sha256Hex(blob: Blob): Promise<string | undefined> {
  try {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) return undefined;
    const digest = await subtle.digest('SHA-256', await blob.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    return undefined;
  }
}

export interface PrepareDeps {
  exif: (file: Blob) => Promise<string | null>;
  digest: (file: Blob) => Promise<string | undefined>;
  shrink: (file: File) => Promise<{ dataUrl: string; thumbDataUrl: string }>;
}

// The shared shrinker, to the server's photo limit (shared/upload.ts): a photo is never refused for being big. It throws
// an UploadRefusal for a picture this phone cannot open, said in words by refusalWords(…, 'photo').
const browserDeps: PrepareDeps = { exif: readExifDate, digest: sha256Hex, shrink: (file) => downscaleImage(file, { maxBytes: UPLOAD_LIMITS.photo }) };

/** Why a photo could not be made ready, in the words every photo field uses — or the chat's own when it is not about the file. */
export function photoRefusal(error: unknown, fallback: string): string {
  return refusalWords(error, 'photo') ?? fallback;
}

/**
 * Make a photo ready to file. The date and the fingerprint come off the original BEFORE it is made smaller; a photo from
 * the app's own camera carries the moment it was taken instead of any date written in a file.
 */
export async function preparePhoto(file: Blob, source: PhotoSource, takenAt?: string, deps: PrepareDeps = browserDeps): Promise<PreparedPhoto> {
  const phoneDate = source === 'gallery' ? await deps.exif(file) : null;
  const originalSha256 = await deps.digest(file);
  const { dataUrl, thumbDataUrl } = await deps.shrink(file as File);
  return {
    dataUrl,
    thumbDataUrl,
    source,
    ...(source === 'app_camera' && takenAt ? { takenAt } : {}),
    ...(phoneDate ? { phoneDate } : {}),
    ...(originalSha256 ? { originalSha256 } : {}),
  };
}

/** What became of filing one photo: filed (the card the server answered), waiting for a signal, or refused — in words. */
export type FileOutcome = { state: 'filed'; message: ChatMessage | null } | { state: 'queued' } | { state: 'refused'; why: string };

/** No signal: the network never answered. A refusal that arrived is an answer, and is said as one. */
export function isOffline(error: Pick<SbgError, 'code'> | null | undefined): boolean {
  return Boolean(error && (error.code === 'NETWORK' || error.code === 'OFFLINE' || error.code === 'TIMEOUT'));
}

export interface FileDeps {
  hold: (dataUrl: string, thumbDataUrl?: string) => string | null;
  forget: (ref: string) => void;
}

const heldDeps: FileDeps = { hold: (dataUrl, thumb) => holdPhoto('filed', dataUrl, thumb), forget: forgetHeld };

/**
 * Upload the photo and file it to this chat's load or parcel. With no signal for the upload, the photo is held on the
 * phone and the filing goes into the outbox carrying it (the outbox answers `{ queued: true }`). `say` turns a refusal
 * into the sentence the person reads; `noRoom` is said when the phone is too full to keep the photo for a signal.
 */
export async function fileTo(
  api: Pick<ConversationsApi, 'upload' | 'filePhoto'>,
  conversationId: string,
  photo: PreparedPhoto,
  choice: FilingChoice,
  say: (error: SbgError) => string,
  noRoom: string,
  now: Date = new Date(),
  deps: FileDeps = heldDeps,
): Promise<FileOutcome> {
  let mediaId: string | undefined;
  const up = await api.upload(photo.dataUrl, photo.thumbDataUrl);
  if (up.error) {
    if (!isOffline(up.error)) return { state: 'refused', why: say(up.error) };
    const held = deps.hold(photo.dataUrl, photo.thumbDataUrl);
    if (!held) return { state: 'refused', why: noRoom };
    mediaId = held;
  } else {
    mediaId = narrow<{ mediaId: string }>(up.data)?.mediaId;
    if (!mediaId) return { state: 'refused', why: noRoom };
  }
  const filed = await api.filePhoto(conversationId, fileBody(mediaId, photo, choice, now.toISOString()));
  if (filed.error) {
    // Refused when it arrived: a photo held for it would wait for nothing.
    if (isHeld(mediaId)) deps.forget(mediaId);
    return { state: 'refused', why: say(filed.error) };
  }
  if (wasQueued(filed.data)) return { state: 'queued' };
  return { state: 'filed', message: narrow<ChatMessage>(filed.data) ?? null };
}

/**
 * Several photos shared at once, filed to one chat as one kind (what they are was said once, for all of them): filed when
 * every one was; waiting when any waits for a signal; the first refusal stops the rest and is said — the ones before it
 * stay filed, as every filing does.
 */
export async function fileAll(
  api: Pick<ConversationsApi, 'upload' | 'filePhoto'>,
  conversationId: string,
  photos: readonly PreparedPhoto[],
  choice: FilingChoice,
  say: (error: SbgError) => string,
  noRoom: string,
  now: Date = new Date(),
  deps: FileDeps = heldDeps,
): Promise<FileOutcome> {
  let waited = false;
  let last: FileOutcome = { state: 'filed', message: null };
  for (const photo of photos) {
    last = await fileTo(api, conversationId, photo, choice, say, noRoom, now, deps);
    if (last.state === 'refused') return last;
    if (last.state === 'queued') waited = true;
  }
  return waited ? { state: 'queued' } : last;
}
