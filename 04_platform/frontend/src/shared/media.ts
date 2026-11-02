/**
 * Client-side image capture prep (S26). Before a photo leaves the device it is downscaled and
 * re-encoded to JPEG on a canvas — which strips EXIF (GPS/orientation/device) as a side effect of the
 * re-encode — and shrunk to well under 200 KB, so we never ship a 5 MB original with the owner's home
 * coordinates baked in. A tiny thumbnail is produced alongside for the media grid (S27).
 *
 * A PHOTO IS NEVER REFUSED FOR BEING BIG (the owner, 2026-11-02: "I wanted to upload a profile image that was large. It
 * silently refused."). It is made smaller here until it fits what the server takes, the way a phone's own apps do: the
 * quality first, then the size, step by step — never below what a photo of damage or a seal needs to be read. A picture
 * this phone cannot open at all (too large for its memory, or a kind its browser does not read) is refused with an
 * UploadRefusal that says so in words (upload.ts) — never a null somebody forgets to say.
 *
 * What evidence keeps: the pixels, at up to 1280 on the long side (1600 for an identity check). The server hashes the
 * bytes it receives and freezes them (media.service.ts); nothing here or there reads the file's own capture time, and
 * the location the camera wrote is what this strips on purpose.
 */
import { UPLOAD_LIMITS, UPLOAD_TYPES, UploadRefusal, checkFile, readAsDataUrl, typeOf } from './upload';

export interface Downscaled {
  /** The full image as a `data:image/jpeg;base64,…` URL, ready to POST /media. */
  dataUrl: string;
  /** A small square-ish thumbnail data URL for the media grid. Empty when none was asked for (thumbEdge 0). */
  thumbDataUrl: string;
  contentType: 'image/jpeg';
}

export interface DownscaleOptions {
  maxEdge?: number; // longest side of the full image
  quality?: number; // JPEG quality 0..1
  thumbEdge?: number; // longest side of the thumbnail; 0 for none
  /** The most the full image may be, in bytes — the server's own limit for where it goes. */
  maxBytes?: number;
}

/**
 * Fit (w×h) within a square of `maxEdge`, preserving aspect ratio. Never upscales. Pure — the one
 * bit of downscaling worth unit-testing (the canvas path is browser-only).
 */
export function fitWithin(w: number, h: number, maxEdge: number): { w: number; h: number } {
  if (w <= 0 || h <= 0) return { w: 0, h: 0 };
  const longest = Math.max(w, h);
  if (longest <= maxEdge) return { w, h };
  const scale = maxEdge / longest;
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

/** Estimate the decoded byte size of a base64 data URL (for a client-side pre-check). */
export function dataUrlBytes(dataUrl: string): number {
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return 0;
  const b64 = dataUrl.slice(comma + 1);
  const padding = b64.endsWith('==') ? 2 : b64.endsWith('=') ? 1 : 0;
  return Math.floor((b64.length * 3) / 4) - padding;
}

/** The smallest a photo is made: below this a seal's number or a dent stops being readable, so it is refused instead. */
export const SMALLEST_EDGE = 480;

/**
 * The steps a photo is made smaller by, until it fits: the quality first (0.7 → 0.6 → 0.5), then the size, by a fifth
 * each time, down to SMALLEST_EDGE. Pure, so the order is tested without a canvas.
 */
export function shrinkSteps(maxEdge: number, quality: number): Array<{ edge: number; quality: number }> {
  const steps: Array<{ edge: number; quality: number }> = [];
  for (const q of [quality, 0.6, 0.5]) if (q <= quality && !steps.some((s) => s.quality === q)) steps.push({ edge: maxEdge, quality: q });
  const last = Math.min(quality, 0.5);
  for (let edge = Math.round(maxEdge * 0.8); edge >= SMALLEST_EDGE; edge = Math.round(edge * 0.8)) steps.push({ edge, quality: last });
  if (steps[steps.length - 1].edge > SMALLEST_EDGE && maxEdge > SMALLEST_EDGE) steps.push({ edge: SMALLEST_EDGE, quality: last });
  return steps;
}

/** A picture opened on this phone: what to draw, how large it is, and how to let it go. */
interface Opened {
  source: CanvasImageSource;
  width: number;
  height: number;
  close: () => void;
}

/** How long a picture is given to open. A phone that neither opens nor refuses one must not leave the screen waiting. */
const OPEN_WITHIN_MS = 30_000;

/** Load a File into an <img>. Rejects on a non-image / corrupt file, or one that never answers. */
function loadImage(file: File): Promise<Opened> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    const timer = setTimeout(() => {
      URL.revokeObjectURL(url);
      reject(new Error('The picture did not open in time.'));
    }, OPEN_WITHIN_MS);
    img.onload = () => {
      clearTimeout(timer);
      resolve({ source: img, width: img.naturalWidth || img.width, height: img.naturalHeight || img.height, close: () => URL.revokeObjectURL(url) });
    };
    img.onerror = () => {
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      reject(new Error('That file is not a readable image.'));
    };
    img.src = url;
  });
}

/**
 * Open a picture by every way this browser has: an <img> first (it turns the photo the way the camera held it), then
 * createImageBitmap — a second chance for a large photo the first could not hold. Neither: an UploadRefusal that says
 * this phone could not open it, with its size where that is the likely reason.
 */
async function openPicture(file: File): Promise<Opened> {
  try {
    const opened = await loadImage(file);
    if (opened.width > 0 && opened.height > 0) return opened;
    opened.close();
  } catch {
    /* tried the other way below */
  }
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file);
      if (bitmap.width > 0 && bitmap.height > 0) return { source: bitmap, width: bitmap.width, height: bitmap.height, close: () => bitmap.close?.() };
      bitmap.close?.();
    } catch {
      /* said below */
    }
  }
  throw new UploadRefusal('unreadable', { kind: 'photo', bytes: file.size, type: typeOf(file) });
}

function renderJpeg(pic: Opened, edge: number, quality: number): string {
  const { w, h } = fitWithin(pic.width, pic.height, edge);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new UploadRefusal('unreadable', { kind: 'photo' });
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(pic.source, 0, 0, w, h); // draw-to-canvas + toDataURL('image/jpeg') drops all EXIF metadata
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Downscale + EXIF-strip a captured file into a full JPEG (~1280px, q0.7) and a thumbnail (~96px), made smaller step by
 * step until it fits `maxBytes` (the server's photo limit unless the caller names another). Throws an UploadRefusal —
 * 'unreadable' when this phone cannot open it, 'too-big' only if even the smallest step does not fit.
 */
export async function downscaleImage(file: File, opts: DownscaleOptions = {}): Promise<Downscaled> {
  const { maxEdge = 1280, quality = 0.7, thumbEdge = 96, maxBytes = UPLOAD_LIMITS.photo } = opts;
  const pic = await openPicture(file);
  try {
    let dataUrl = '';
    for (const step of shrinkSteps(maxEdge, quality)) {
      dataUrl = renderJpeg(pic, step.edge, step.quality);
      if (dataUrlBytes(dataUrl) <= maxBytes) break;
    }
    if (dataUrlBytes(dataUrl) > maxBytes) throw new UploadRefusal('too-big', { kind: 'photo', bytes: dataUrlBytes(dataUrl), maxBytes });
    let thumbDataUrl = thumbEdge > 0 ? renderJpeg(pic, thumbEdge, 0.6) : '';
    if (dataUrlBytes(thumbDataUrl) > UPLOAD_LIMITS.photoThumb) thumbDataUrl = renderJpeg(pic, Math.min(thumbEdge, 64), 0.5);
    return { dataUrl, thumbDataUrl, contentType: 'image/jpeg' };
  } finally {
    pic.close();
  }
}

/**
 * A COMPANY'S PAPER, READY TO SEND as a `data:` URL — a PDF as it is, or a photo of the paper.
 *
 * A photo over the most, or of a kind the server does not read (an iPhone's own format, WebP), is made smaller on this
 * phone into a JPEG the server takes — sharp enough to read a certificate (2400 pixels on its long side). One already
 * within the most is sent as it is: nothing on it is lost to a re-encoding. A PDF cannot be made smaller here, so a
 * PDF over the most is refused before anything is sent, with its size and the most. Throws an UploadRefusal.
 */
export async function paperForUpload(file: File, maxBytes: number = UPLOAD_LIMITS.document): Promise<string> {
  const type = typeOf(file);
  if (!file.size) throw new UploadRefusal('empty', { kind: 'document' });
  if (type.startsWith('image/')) {
    if (UPLOAD_TYPES.document.includes(type) && file.size <= maxBytes) return readAsDataUrl(file);
    const { dataUrl } = await downscaleImage(file, { maxEdge: 2400, quality: 0.85, maxBytes, thumbEdge: 0 });
    return dataUrl;
  }
  const refused = checkFile(file, 'document', maxBytes, UPLOAD_TYPES.document);
  if (refused) throw refused;
  return readAsDataUrl(file);
}

/** The four retention bins an image can live in (mirrors the backend RetentionClass). */
export type RetentionClass = 'shipment-proof' | 'dispute-evidence' | 'account-doc' | 'vehicle-asset';

/** The PII-free media record the library (S27) and any list surface see. Mirrors the backend MediaView. */
export interface MediaView {
  mediaId: string;
  kind: string;
  retentionClass: RetentionClass;
  contentType: string;
  hasThumb: boolean;
  link?: { type: string; id: string };
  createdAt: string;
  expiresAt?: string;
  status: 'active' | 'expired';
}
