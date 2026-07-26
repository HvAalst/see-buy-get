/**
 * Client-side image capture prep (S26). Before a photo leaves the device it is downscaled and
 * re-encoded to JPEG on a canvas — which strips EXIF (GPS/orientation/device) as a side effect of the
 * re-encode — and shrunk to well under 200 KB, so we never ship a 5 MB original with the owner's home
 * coordinates baked in. A tiny thumbnail is produced alongside for the media grid (S27).
 */

export interface Downscaled {
  /** The full image as a `data:image/jpeg;base64,…` URL, ready to POST /media. */
  dataUrl: string;
  /** A small square-ish thumbnail data URL for the media grid. */
  thumbDataUrl: string;
  contentType: 'image/jpeg';
}

export interface DownscaleOptions {
  maxEdge?: number; // longest side of the full image
  quality?: number; // JPEG quality 0..1
  thumbEdge?: number; // longest side of the thumbnail
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

/** Load a File into an <img>. Rejects on a non-image / corrupt file. */
function loadImage(file: File): Promise<{ img: HTMLImageElement; revoke: () => void }> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => resolve({ img, revoke: () => URL.revokeObjectURL(url) });
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('That file is not a readable image.'));
    };
    img.src = url;
  });
}

function renderJpeg(img: HTMLImageElement, edge: number, quality: number): string {
  const { w, h } = fitWithin(img.naturalWidth || img.width, img.naturalHeight || img.height, edge);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot process the image on this device.');
  ctx.drawImage(img, 0, 0, w, h); // draw-to-canvas + toDataURL('image/jpeg') drops all EXIF metadata
  return canvas.toDataURL('image/jpeg', quality);
}

/**
 * Downscale + EXIF-strip a captured file into a full JPEG (~1280px, q0.7) and a thumbnail (~96px). If
 * the full still lands over the (generous) size cap, drop quality once more before giving up.
 */
export async function downscaleImage(file: File, opts: DownscaleOptions = {}): Promise<Downscaled> {
  const { maxEdge = 1280, quality = 0.7, thumbEdge = 96 } = opts;
  const { img, revoke } = await loadImage(file);
  try {
    let dataUrl = renderJpeg(img, maxEdge, quality);
    if (dataUrlBytes(dataUrl) > 400 * 1024) dataUrl = renderJpeg(img, maxEdge, 0.5);
    const thumbDataUrl = renderJpeg(img, thumbEdge, 0.6);
    return { dataUrl, thumbDataUrl, contentType: 'image/jpeg' };
  } finally {
    revoke();
  }
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
