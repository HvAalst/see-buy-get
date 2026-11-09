import QRCodeReader from '@zxing/library/esm/core/qrcode/QRCodeReader';
import Code128Reader from '@zxing/library/esm/core/oned/Code128Reader';
import BinaryBitmap from '@zxing/library/esm/core/BinaryBitmap';
import HybridBinarizer from '@zxing/library/esm/core/common/HybridBinarizer';
import DecodeHintType from '@zxing/library/esm/core/DecodeHintType';
import { HTMLCanvasElementLuminanceSource } from '@zxing/library/esm/browser/HTMLCanvasElementLuminanceSource';
import type LuminanceSource from '@zxing/library/esm/core/LuminanceSource';

/**
 * 2026-11-09 — THE CAMERA SCANNER WHERE THE BROWSER HAS NONE (the owner: "implement the Iphone scan"). Safari on an iPhone,
 * and Firefox, give a page no barcode reader of their own, so the scanner fell back to typing there. This reads the same
 * two codes we print — our QR, and the GS1-128 barcode (an SSCC on a package, a GRAI on a bag) — from the camera's
 * picture, in plain JavaScript (ZXing): no WebAssembly, so the site's content policy stays as strict as it is.
 *
 * Loaded only on a phone that needs it (Scanner.tsx imports it when the browser has no BarcodeDetector), never precached
 * for everyone: an Android phone never downloads it. It answers in BarcodeDetector's own shape, so the scanner reads
 * both the same way.
 */
export interface FallbackDetector {
  detect(source: HTMLVideoElement): Promise<Array<{ rawValue: string }>>;
}

/** The picture is read at most this many pixels on its long side: enough for a label at arm's length, quick on a phone. */
const LONG_SIDE = 960;

const qr = new QRCodeReader();
const code128 = new Code128Reader();
// Harder: the barcode turned on its side is looked for as well.
const hints = new Map<DecodeHintType, unknown>([[DecodeHintType.TRY_HARDER, true]]);

/** What one picture says: our QR's text or the GS1-128 barcode's, or nothing. Kept apart from the camera so it is tested. */
export function decodePicture(source: LuminanceSource): string | null {
  const bitmap = new BinaryBitmap(new HybridBinarizer(source));
  for (const reader of [qr, code128]) {
    try {
      const text = reader.decode(bitmap, hints as Map<DecodeHintType, any>)?.getText();
      if (text) return text;
    } catch {
      // Nothing of that kind in this picture: the next kind, or the next picture.
    } finally {
      reader.reset();
    }
  }
  return null;
}

export function createFallbackDetector(): FallbackDetector {
  const canvas = document.createElement('canvas');
  let busy = false;
  return {
    async detect(video) {
      // One picture at a time: a slower phone skips a tick rather than piling them up.
      if (busy) return [];
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (!w || !h) return [];
      busy = true;
      try {
        const scale = Math.min(1, LONG_SIDE / Math.max(w, h));
        canvas.width = Math.round(w * scale);
        canvas.height = Math.round(h * scale);
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return [];
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
        const text = decodePicture(new HTMLCanvasElementLuminanceSource(canvas));
        return text ? [{ rawValue: text }] : [];
      } finally {
        busy = false;
      }
    },
  };
}
