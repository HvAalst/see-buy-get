import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SMALLEST_EDGE, dataUrlBytes, downscaleImage, fitWithin, shrinkSteps } from './media';
import { UPLOAD_LIMITS, isUploadRefusal, refusalWords } from './upload';

describe('media capture math (S26)', () => {
  it('fitWithin never upscales and preserves aspect ratio when shrinking', () => {
    expect(fitWithin(800, 600, 1280)).toEqual({ w: 800, h: 600 }); // already within → untouched
    expect(fitWithin(4000, 3000, 1280)).toEqual({ w: 1280, h: 960 }); // landscape → longest side capped
    expect(fitWithin(3000, 4000, 1280)).toEqual({ w: 960, h: 1280 }); // portrait
    expect(fitWithin(2560, 2560, 96)).toEqual({ w: 96, h: 96 }); // square thumbnail
    expect(fitWithin(0, 0, 1280)).toEqual({ w: 0, h: 0 }); // degenerate input is safe
  });

  it('dataUrlBytes estimates the decoded size of a base64 data URL', () => {
    // "AAAA" → 3 bytes; the +2 padding case decodes to fewer.
    expect(dataUrlBytes('data:image/jpeg;base64,AAAA')).toBe(3);
    expect(dataUrlBytes('data:image/jpeg;base64,AAA=')).toBe(2);
    expect(dataUrlBytes('not-a-data-url')).toBe(0);
  });

  it('makes a photo smaller by its quality first, then its size, never below what evidence needs to be read', () => {
    const steps = shrinkSteps(1280, 0.7);
    expect(steps.slice(0, 3)).toEqual([
      { edge: 1280, quality: 0.7 },
      { edge: 1280, quality: 0.6 },
      { edge: 1280, quality: 0.5 },
    ]);
    expect(steps.map((s) => s.edge)).toEqual([1280, 1280, 1280, 1024, 819, 655, 524, 480]);
    expect(Math.min(...steps.map((s) => s.edge))).toBe(SMALLEST_EDGE);
    // A profile photo starts small already: the quality, then the floor.
    expect(shrinkSteps(512, 0.82).map((s) => `${s.edge}@${s.quality}`)).toEqual(['512@0.82', '512@0.6', '512@0.5', '480@0.5']);
  });
});

/**
 * A PHOTO IS NEVER REFUSED FOR BEING BIG (2026-11-02). A stand-in for a phone's browser: a picture opens at the size
 * the test says, and the canvas's JPEG weighs what the test says per pixel — so a photo of busy detail (gravel, a
 * patterned cloth: the heaviest JPEGs there are) can be made to need every step.
 */
const phone = { opens: true, width: 0, height: 0, bytesPerPixel: 0.5 };
const drawn: Array<{ width: number; height: number; quality: number }> = [];

beforeEach(() => {
  drawn.length = 0;
  Object.assign(phone, { opens: true, width: 0, height: 0, bytesPerPixel: 0.5 });
  vi.stubGlobal(
    'Image',
    class {
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      naturalWidth = 0;
      naturalHeight = 0;
      width = 0;
      height = 0;
      set src(_url: string) {
        queueMicrotask(() => {
          if (!phone.opens) return this.onerror?.();
          this.naturalWidth = this.width = phone.width;
          this.naturalHeight = this.height = phone.height;
          this.onload?.();
        });
      }
    },
  );
  vi.stubGlobal('createImageBitmap', async () => {
    throw new Error('The source image could not be decoded.');
  });
  vi.stubGlobal('document', {
    createElement: () => {
      const canvas = {
        width: 0,
        height: 0,
        getContext: () => ({ drawImage: () => undefined, imageSmoothingQuality: 'low' }),
        toDataURL: (_type: string, quality: number) => {
          drawn.push({ width: canvas.width, height: canvas.height, quality });
          const bytes = Math.round(canvas.width * canvas.height * quality * phone.bytesPerPixel);
          return `data:image/jpeg;base64,${'A'.repeat(Math.ceil(bytes / 3) * 4)}`;
        },
      };
      return canvas;
    },
  });
});

afterEach(() => vi.unstubAllGlobals());

const photo = (bytes: number) => {
  const f = new File([new Uint8Array(16)], 'IMG_20261102.jpg', { type: 'image/jpeg' });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
};

describe('a large photo, made small enough on the phone', () => {
  it('a 50-megapixel photo comes out under the server’s limit, with a thumbnail under its own', async () => {
    Object.assign(phone, { width: 8160, height: 6120 });
    const out = await downscaleImage(photo(24_000_000));
    expect(dataUrlBytes(out.dataUrl)).toBeLessThanOrEqual(UPLOAD_LIMITS.photo);
    expect(dataUrlBytes(out.thumbDataUrl)).toBeLessThanOrEqual(UPLOAD_LIMITS.photoThumb);
    expect(Math.max(drawn[0].width, drawn[0].height)).toBe(1280); // the full size first, as before
  });

  it('a photo of heavy detail is stepped down — quality, then size — until it fits, and is not refused', async () => {
    Object.assign(phone, { width: 12000, height: 9000, bytesPerPixel: 1.6 }); // 108 megapixels of gravel
    const out = await downscaleImage(photo(48_000_000));
    expect(dataUrlBytes(out.dataUrl)).toBeLessThanOrEqual(UPLOAD_LIMITS.photo);
    const full = drawn.filter((d) => Math.max(d.width, d.height) > 96);
    expect(full.length).toBeGreaterThan(3); // it took more than the first try
    expect(Math.max(full[full.length - 1].width, full[full.length - 1].height)).toBeGreaterThanOrEqual(SMALLEST_EDGE);
  });

  it('refuses, in words with the most, only what does not fit even at the smallest a photo may be', async () => {
    Object.assign(phone, { width: 12000, height: 9000, bytesPerPixel: 20 });
    const e = await downscaleImage(photo(48_000_000)).catch((x: unknown) => x);
    expect(isUploadRefusal(e)).toBe(true);
    expect(refusalWords(e, 'photo')).toMatch(/^This photo is still .+ after making it smaller; the most is 512 KB\. Take it again, a little further away\.$/);
  });

  it('a picture this phone cannot open is an UploadRefusal that says so — never a silent null', async () => {
    phone.opens = false;
    const e = await downscaleImage(photo(30_000_000)).catch((x: unknown) => x);
    expect(isUploadRefusal(e)).toBe(true);
    expect(refusalWords(e, 'photo')).toBe('This phone could not open that picture: at 30 MB it is too large for it. Take a photo with the camera instead, or choose a smaller one.');
  });

  it('a paper photographed for a company record keeps more of itself: 2400 on its long side, within the paper limit', async () => {
    Object.assign(phone, { width: 4000, height: 3000 });
    const out = await downscaleImage(photo(6_000_000), { maxEdge: 2400, quality: 0.85, maxBytes: UPLOAD_LIMITS.document, thumbEdge: 0 });
    expect(Math.max(drawn[0].width, drawn[0].height)).toBe(2400);
    expect(out.thumbDataUrl).toBe('');
  });
});
