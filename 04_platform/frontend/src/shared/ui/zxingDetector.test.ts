import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import QRCodeWriter from '@zxing/library/esm/core/qrcode/QRCodeWriter';
import BarcodeFormat from '@zxing/library/esm/core/BarcodeFormat';
import RGBLuminanceSource from '@zxing/library/esm/core/RGBLuminanceSource';
import { decodePicture } from './zxingDetector';
import { checkScan, graiOfScan, ssccOfScan } from '../scan';
// The server's own barcode drawing (it imports nothing): what is read here is what our labels and tags print.
import { gs1_128Widths } from '../../../../backend/src/foundation/gs1/gs1';

/*
 * 2026-11-09 — THE iPHONE'S SCANNER (the owner: "implement the Iphone scan"): where the browser has no barcode reader of its
 * own, ours reads the picture. Pinned here on pictures made the way we print: our QR as a bag's tag carries it, and the
 * GS1-128 barcodes the server draws — a package's SSCC and a bag's GRAI — each read back to the value every scan box takes.
 */
describe('the camera reader for a phone without one', () => {
  /** A picture: black where `ink(x, y)`, white elsewhere — as the camera would hand over a clean label. */
  const picture = (w: number, h: number, ink: (x: number, y: number) => boolean) => {
    const lum = new Uint8ClampedArray(w * h);
    for (let y = 0; y < h; y += 1) for (let x = 0; x < w; x += 1) lum[y * w + x] = ink(x, y) ? 0 : 255;
    return new RGBLuminanceSource(lum, w, h);
  };

  /** A GS1-128 barcode as the server draws it, `px` pixels a module, in the middle of a wider picture. */
  const barcode = (digits: string, tail = '', px = 3) => {
    const widths = gs1_128Widths(digits, tail);
    const bars: boolean[] = [];
    widths.forEach((w, i) => { for (let k = 0; k < w; k += 1) bars.push(i % 2 === 0); });
    const quiet = 20 * px;
    const w = bars.length * px + 2 * quiet;
    return picture(w, 80, (x, y) => y > 10 && y < 70 && x >= quiet && x < w - quiet && bars[Math.floor((x - quiet) / px)]);
  };

  it('reads our QR — a bag’s tag — and the bag box takes it', () => {
    const matrix = new QRCodeWriter().encode('sbg:tote:BAG-007', BarcodeFormat.QR_CODE, 240, 240, new Map());
    const text = decodePicture(picture(matrix.getWidth(), matrix.getHeight(), (x, y) => matrix.get(x, y)));
    expect(text).toBe('sbg:tote:BAG-007');
    expect(checkScan(text!, 'tote').value).toBe('BAG-007');
  });

  it('reads a bag’s GRAI off its GS1-128 barcode — its serial in letters — and the bag box takes it', () => {
    const grai = '08712345999995BAG-007';
    const text = decodePicture(barcode(`8003${grai.slice(0, 14)}`, grai.slice(14)));
    expect(graiOfScan(text)).toBe(grai);
    expect(checkScan(text!, 'tote').value).toBe(grai);
  });

  it('reads a package’s SSCC off its GS1-128 barcode', () => {
    const sscc = '061414112345678908'.slice(0, 17);
    const check = (() => { let sum = 0; for (let i = 0; i < sscc.length; i += 1) sum += Number(sscc[sscc.length - 1 - i]) * (i % 2 === 0 ? 3 : 1); return (10 - (sum % 10)) % 10; })();
    const text = decodePicture(barcode(`00${sscc}${check}`));
    expect(ssccOfScan(text)).toBe(`${sscc}${check}`);
  });

  it('says nothing of a picture with no code in it', () => {
    expect(decodePicture(picture(200, 120, (x) => x % 37 === 0))).toBeNull();
  });

  it('is fetched only by a phone without a reader, and kept there — never downloaded by every phone', () => {
    const scanner = readFileSync('src/shared/ui/Scanner.tsx', 'utf8');
    const config = readFileSync('vite.config.ts', 'utf8');
    expect(scanner.length).toBeGreaterThan(1000); // read the real file
    // Only behind the missing BarcodeDetector, and never imported up front.
    expect(scanner).toMatch(/if \(!detectorCtor\) \{[\s\S]{0,200}await import\('\.\/zxingDetector'\)/);
    expect(scanner).not.toMatch(/^import .*zxingDetector/m);
    // Out of the precache, and kept once fetched.
    expect(config).toContain("'**/zxingDetector-*.js'");
    expect(config).toMatch(/zxingDetector-\[\\w-\]\+\\\.js\$\/\.test\(url\.pathname\)[\s\S]{0,80}handler: 'CacheFirst'/);
  });
});
