import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UPLOAD_LIMITS, UploadRefusal, checkFile, refusalWords, sizeWords, typeOf, uploadHint } from './upload';
import { errorSentence, refusalSentence, uploadFailureSentence } from './ui/ErrorNote';
import { toSbgError, clientError } from '../lib/sbg';
import { paperForUpload } from './media';

/**
 * EVERY REFUSAL OF A FILE, SAID (the owner, 2026-11-02: "if we put a filesize limit, it needs to show or tell").
 */

describe('the limits the phone holds are the server’s', () => {
  it('names the same limits, with the same numbers, as backend/src/foundation/media/upload-limits.ts', () => {
    // Read from where the tests run (the frontend's own folder), as content-policy.test.ts reads the Caddyfile.
    const server = readFileSync('../backend/src/foundation/media/upload-limits.ts', 'utf8');
    const body = /export const UPLOAD_LIMITS = \{([\s\S]*?)\} as const;/.exec(server)?.[1] ?? '';
    const named: Record<string, number> = {};
    for (const m of body.matchAll(/^\s*(\w+):\s*([\d_ *]+),/gm)) {
      // Only digits, underscores and multiplication — worked out here rather than trusted to eval.
      named[m[1]] = m[2].split('*').reduce((acc, part) => acc * Number(part.replace(/[_\s]/g, '')), 1);
    }
    // The guard read the server's list: its photo limit is among what it found.
    expect(named.photo).toBe(500 * 1024);
    expect(Object.keys(named).length).toBeGreaterThanOrEqual(9);
    expect(named).toEqual({ ...UPLOAD_LIMITS });
  });
});

describe('a size, as a phone’s gallery says it', () => {
  it('in kilobytes under a megabyte, megabytes with one decimal under ten; a limit rounded down, a file up', () => {
    expect(sizeWords(14_000_000)).toBe('14 MB');
    expect(sizeWords(8_450_000)).toBe('8.5 MB');
    expect(sizeWords(600_100)).toBe('601 KB');
    expect(sizeWords(UPLOAD_LIMITS.document, 'down')).toBe('8 MB');
    expect(sizeWords(UPLOAD_LIMITS.photo, 'down')).toBe('512 KB');
    expect(sizeWords(UPLOAD_LIMITS.workbook, 'down')).toBe('1 MB');
    // A file just over a limit never reads as within it.
    expect(sizeWords(UPLOAD_LIMITS.workbook + 1)).toBe('1.1 MB');
  });

  it('says the limit beside a picker, before a file is chosen', () => {
    expect(uploadHint('document')).toBe('A PDF or a photo, up to 8 MB. A photo is made smaller before it is sent, if it needs to be.');
    expect(uploadHint('sheet')).toBe('A spreadsheet, up to 1 MB.');
  });
});

describe('a refusal, in words: what was wrong, the size and the most, and what to do', () => {
  it('on the phone: a file over the most, of the wrong kind, empty', () => {
    const pdf = new File([new Uint8Array(10)], 'certificate.pdf', { type: 'application/pdf' });
    Object.defineProperty(pdf, 'size', { value: 14_000_000 });
    const refused = checkFile(pdf, 'document', UPLOAD_LIMITS.document, ['application/pdf']);
    expect(refused?.reason).toBe('too-big');
    expect(refusalWords(refused)).toBe('This file is 14 MB; the most is 8 MB. Choose a smaller one, or take a photo of the paper instead.');
    const doc = new File([new Uint8Array(10)], 'letter.docx', { type: 'application/msword' });
    expect(refusalWords(checkFile(doc, 'document', UPLOAD_LIMITS.document, ['application/pdf']))).toBe('That kind of file cannot be sent here. Choose a PDF, or a photo of the paper.');
    expect(refusalWords(checkFile(new File([], 'empty.pdf', { type: 'application/pdf' }), 'document', UPLOAD_LIMITS.document))).toBe('That file is empty. Choose another.');
    expect(refusalWords(new UploadRefusal('too-big', { kind: 'voice', bytes: 1_200_000, maxBytes: UPLOAD_LIMITS.voice }))).toBe('This recording is 1.2 MB; the most is 900 KB. Record a shorter message.');
  });

  it('from the server: MEDIA_TOO_LARGE with the size and the most — and a bare 413 from anything in front of it', () => {
    const said = toSbgError({ code: 'MEDIA_TOO_LARGE', detail: 'That document is larger than 8 MB', params: { bytes: 9_100_000, maxBytes: UPLOAD_LIMITS.document } }, 413);
    expect(errorSentence(said)).toBe('This file is 9.1 MB; the most is 8 MB. Choose a smaller one, or take a photo of the paper instead.');
    expect(refusalSentence(said)).toBe(errorSentence(said)); // never the server's developer English in its place
    // The most, without the size (the body came in pieces).
    expect(errorSentence(toSbgError({ code: 'MEDIA_TOO_LARGE', params: { maxBytes: UPLOAD_LIMITS.evidence } }, 413))).toBe('That file is too large to send; the most is 6 MB. Choose a smaller one, or take a photo instead.');
    // A proxy's own page, not ours: a 413 is still about the file, never "Something went wrong".
    const proxy = toSbgError(null, 413);
    expect(proxy.code).toBe('MEDIA_TOO_LARGE');
    expect(errorSentence(proxy)).toBe('That file is too large to send. Choose a smaller one, or take a photo instead.');
    expect(toSbgError(null, 415).code).toBe('UNSUPPORTED_MEDIA');
    expect(uploadFailureSentence(toSbgError({ code: 'UNSUPPORTED_MEDIA' }, 415), 'photo')).toBe('That is not a photo. Choose a photo, or take one with the camera.');
  });

  it('no signal mid-upload, and anything else, is a sentence too — never nothing', () => {
    expect(uploadFailureSentence(clientError('NETWORK', 'Failed to fetch'))).toBe('No signal right now. This needs a connection — try again when you have one.');
    expect(uploadFailureSentence(new Error('boom'))).toBe('It did not go. Try again.');
    expect(uploadFailureSentence(undefined)).toBe('It did not go. Try again.');
  });

  it('reads a file’s kind from its name where the phone did not say it', () => {
    expect(typeOf(new File([], 'scan.PDF'))).toBe('application/pdf');
    expect(typeOf(new File([], 'IMG_1.heic'))).toBe('image/heic');
    expect(typeOf(new File([], 'x', { type: 'Image/JPEG' }))).toBe('image/jpeg');
  });
});

describe('a company’s paper, made ready to send', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('refuses a PDF over the most before a byte is read, and sends one within it as it is', async () => {
    const reads: string[] = [];
    vi.stubGlobal(
      'FileReader',
      class {
        result: string | null = null;
        onload: (() => void) | null = null;
        onerror: (() => void) | null = null;
        onabort: (() => void) | null = null;
        readAsDataURL(f: File) {
          reads.push(f.name);
          this.result = 'data:application/pdf;base64,JVBERi0=';
          queueMicrotask(() => this.onload?.());
        }
      },
    );
    const big = new File([new Uint8Array(10)], 'big.pdf', { type: 'application/pdf' });
    Object.defineProperty(big, 'size', { value: 9_000_000 });
    await expect(paperForUpload(big)).rejects.toMatchObject({ reason: 'too-big', facts: { bytes: 9_000_000, maxBytes: UPLOAD_LIMITS.document } });
    expect(reads).toEqual([]);
    await expect(paperForUpload(new File([new Uint8Array(10)], 'small.pdf', { type: 'application/pdf' }))).resolves.toBe('data:application/pdf;base64,JVBERi0=');
    expect(reads).toEqual(['small.pdf']);
  });

  it('a phone that cannot read the file says so, rather than leaving the screen waiting', async () => {
    vi.stubGlobal(
      'FileReader',
      class {
        onerror: (() => void) | null = null;
        readAsDataURL() {
          queueMicrotask(() => this.onerror?.());
        }
      },
    );
    const e = await paperForUpload(new File([new Uint8Array(10)], 'a.pdf', { type: 'application/pdf' })).catch((x: unknown) => x);
    expect(uploadFailureSentence(e)).toBe('This phone could not read that file. Choose it again.');
  });
});
