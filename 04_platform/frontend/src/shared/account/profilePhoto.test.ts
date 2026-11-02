import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { pickAvatar } from './AccountMenu';
import { dataUrlBytes } from '../media';
import { UPLOAD_LIMITS } from '../upload';

/**
 * THE PROFILE PHOTO THAT WAS REFUSED IN SILENCE (the owner, 2026-11-02: "I wanted to upload a profile image that was
 * large. It silently refused.").
 *
 * The sheet made the photo smaller on the phone with createImageBitmap, and on ANY failure resolved null — "so the
 * caller shows nothing rather than a stack trace" — and the caller then did nothing at all: no message, no change. A
 * phone fails to open exactly the largest photos (a 50- or 108-megapixel photo needs 200–430 MB of memory to open) and
 * the kinds its browser does not read. These stand in for such a phone: the browser's own ways of opening a picture,
 * answering as a phone does.
 */

const phone = { opens: true, width: 0, height: 0, bitmap: false };
const drawn: Array<{ width: number; height: number; quality: number }> = [];

class PhoneImage {
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
}

/** A canvas whose JPEG weighs what a phone's does, near enough: half a byte a pixel at quality 1. */
function phoneCanvas() {
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage: () => undefined, imageSmoothingQuality: 'low' }),
    toDataURL: (_type: string, quality: number) => {
      drawn.push({ width: canvas.width, height: canvas.height, quality });
      const bytes = Math.round(canvas.width * canvas.height * quality * 0.5);
      return `data:image/jpeg;base64,${'A'.repeat(Math.ceil(bytes / 3) * 4)}`;
    },
  };
  return canvas;
}

/** A photo as the phone hands it over — its size said without making the test hold 48 MB. */
function photo(bytes: number, name = 'IMG_20261102_0930.jpg', type = 'image/jpeg'): File {
  const file = new File([new Uint8Array(16)], name, { type });
  Object.defineProperty(file, 'size', { value: bytes });
  return file;
}

beforeEach(() => {
  drawn.length = 0;
  Object.assign(phone, { opens: true, width: 0, height: 0, bitmap: false });
  vi.stubGlobal('Image', PhoneImage);
  vi.stubGlobal('document', { createElement: () => phoneCanvas() });
  vi.stubGlobal('createImageBitmap', async () => {
    if (!phone.bitmap) throw new Error('The source image could not be decoded.');
    return { width: phone.width, height: phone.height, close: () => undefined };
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('a profile photo, picked in the account menu', () => {
  it('a large photo this phone cannot open is said in words, with its size — never dropped in silence', async () => {
    phone.opens = false; // a 48 MB photo: the phone has not the memory to open it
    const saveAvatar = vi.fn(async () => 'med_1');
    const said = await pickAvatar(photo(48_000_000), saveAvatar);
    expect(saveAvatar).not.toHaveBeenCalled();
    expect(said).toBe('This phone could not open that picture: at 48 MB it is too large for it. Take a photo with the camera instead, or choose a smaller one.');
  });

  it('a photo of a kind this browser cannot read is said too', async () => {
    phone.opens = false;
    const said = await pickAvatar(photo(2_400_000, 'IMG_0001.HEIC', 'image/heic'), vi.fn(async () => 'med_1'));
    expect(said).toBe('This phone could not open that picture. Choose another, or take a photo with the camera.');
  });

  it('a large photo that opens is made small enough to send, and sent', async () => {
    Object.assign(phone, { width: 9000, height: 12000 }); // 108 megapixels
    const saveAvatar = vi.fn(async (_dataUrl: string) => 'med_1');
    const said = await pickAvatar(photo(31_000_000), saveAvatar);
    expect(said).toBeNull();
    expect(saveAvatar).toHaveBeenCalledTimes(1);
    const sent = saveAvatar.mock.calls[0][0];
    expect(sent.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(dataUrlBytes(sent)).toBeLessThanOrEqual(UPLOAD_LIMITS.photo);
    // A 64-pixel circle: never more than 512 on its long side.
    expect(Math.max(...drawn.map((d) => Math.max(d.width, d.height)))).toBeLessThanOrEqual(512);
  });

  it('what the server answers is said in the sheet, from the account’s error (a refusal, or no signal)', async () => {
    Object.assign(phone, { width: 4000, height: 3000 });
    // saveAvatar resolves null when the server refused: the hook has put the refusal where the sheet shows it (ErrorNote).
    const said = await pickAvatar(photo(4_000_000), vi.fn(async () => null));
    expect(said).toBeNull();
  });
});
