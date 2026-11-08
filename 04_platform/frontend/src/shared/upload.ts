import { getLocale, t, type MessageKey } from './i18n';

/**
 * NO UPLOAD EVER FAILS IN SILENCE (the owner, 2026-11-02: "if we put a filesize limit, it needs to show or tell. For
 * example I wanted to upload a profile image that was large. It silently refused.").
 *
 * Three rules, the way a phone's own apps behave:
 *   - a PHOTO is never refused for being big: it is made smaller on the phone before it is sent (media.ts);
 *   - a file that cannot be made smaller — a PDF, a spreadsheet, a recording — has its limit said beside the picker,
 *     and is checked here before a byte is sent;
 *   - every refusal, the phone's or the server's, is said in words where the person chose the file: what was wrong,
 *     the file's size and the most, and what to do.
 */

/**
 * THE MOST OF EACH FILE THE SERVER TAKES — the same numbers under the same names as the server's one list
 * (backend/src/foundation/media/upload-limits.ts). upload.test.ts reads that file and refuses a difference: a phone that
 * believes the limit is larger than it is sends a file to be refused; one that believes it smaller refuses a good one.
 */
export const UPLOAD_LIMITS = {
  photo: 500 * 1024,
  photoThumb: 64 * 1024,
  helpPicture: 150 * 1024,
  document: 8 * 1024 * 1024,
  evidence: 6 * 1024 * 1024,
  voice: 900_000,
  workbook: 1_000_000,
  orderSheetText: 1_500_000,
  packingText: 3_000_000,
  zoneAreasText: 6_000_000,
} as const;

/** What a file is for, which says its most, what it may be, and what to do when it is refused. */
export type UploadKind = 'photo' | 'document' | 'voice' | 'sheet';

/** The types the server reads for each kind (decode-image.ts, decode-document.ts, decode-audio.ts). */
export const UPLOAD_TYPES: Record<Exclude<UploadKind, 'sheet'>, readonly string[]> = {
  photo: ['image/jpeg', 'image/png', 'image/webp'],
  document: ['application/pdf', 'image/png', 'image/jpeg'],
  voice: ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg'],
};

export type RefusalReason = 'too-big' | 'wrong-type' | 'unreadable' | 'empty' | 'not-read';

/** A file refused on this phone, before anything was sent — carrying what it takes to say why. */
export class UploadRefusal extends Error {
  constructor(
    readonly reason: RefusalReason,
    readonly facts: { kind?: UploadKind; bytes?: number; maxBytes?: number; type?: string } = {},
  ) {
    super(`upload refused: ${reason}`);
    this.name = 'UploadRefusal';
  }
}

export function isUploadRefusal(e: unknown): e is UploadRefusal {
  return e instanceof UploadRefusal || Boolean(e && typeof e === 'object' && (e as { name?: unknown }).name === 'UploadRefusal');
}

/**
 * A SIZE AS A PHONE'S GALLERY SAYS IT: kilobytes under a megabyte, megabytes with one decimal under ten. Thousands, as
 * Android counts. A file's own size is rounded UP and a limit DOWN, so a file that was refused never reads as within it
 * ("8.5 MB; the most is 8 MB", never "8 MB; the most is 8 MB").
 */
export function sizeWords(bytes: number, round: 'up' | 'down' = 'up'): string {
  const fit = round === 'up' ? Math.ceil : Math.floor;
  const number = (n: number, digits: number) => new Intl.NumberFormat(getLocale(), { maximumFractionDigits: digits }).format(n);
  if (bytes < 1_000_000) return t('upload.size.kb', { n: number(Math.max(1, fit(bytes / 1000)), 0) });
  const mb = bytes / 1_000_000;
  if (round === 'down') return t('upload.size.mb', { n: number(Math.max(1, Math.floor(mb)), 0) });
  return t('upload.size.mb', { n: mb < 10 ? number(fit(mb * 10) / 10, 1) : number(fit(mb), 0) });
}

/** The most of a kind, in words — for the hint beside a picker. */
export function limitWords(maxBytes: number): string {
  return sizeWords(maxBytes, 'down');
}

/** The hint beside a picker, said before a file is chosen: what it may be, and up to how large. */
export function uploadHint(kind: 'document' | 'sheet' | 'photo' | 'evidence' | 'boundary', maxBytes?: number): string {
  if (kind === 'photo') return t('upload.hint.photo');
  // 2026-11-08 — a country's official areas as a boundary file, for its zones: its own words, never a spreadsheet's.
  if (kind === 'boundary') return t('upload.hint.boundary', { limit: limitWords(maxBytes ?? UPLOAD_LIMITS.zoneAreasText) });
  if (kind === 'evidence') return t('upload.hint.evidence');
  if (kind === 'sheet') return t('upload.hint.sheet', { limit: limitWords(maxBytes ?? UPLOAD_LIMITS.workbook) });
  return t('upload.hint.document', { limit: limitWords(maxBytes ?? UPLOAD_LIMITS.document) });
}

const TOO_BIG: Record<UploadKind, MessageKey> = {
  photo: 'upload.tooBig.photo',
  document: 'upload.tooBig.document',
  voice: 'upload.tooBig.voice',
  sheet: 'upload.tooBig.sheet',
};
const WRONG_TYPE: Record<UploadKind, MessageKey> = {
  photo: 'upload.wrongType.photo',
  document: 'upload.wrongType.document',
  voice: 'upload.wrongType.voice',
  sheet: 'upload.wrongType.sheet',
};

function tooBigWords(kind: UploadKind, bytes?: number, maxBytes?: number): string {
  if (bytes && maxBytes) return t(TOO_BIG[kind], { size: sizeWords(bytes), limit: limitWords(maxBytes) });
  if (maxBytes) return t('upload.tooBig.at', { limit: limitWords(maxBytes) });
  return t('upload.tooBig.any');
}

/** The refusal a phone or a server gave a file, in words — or null when it is not about the file at all. */
export function refusalWords(e: unknown, kind: UploadKind = 'document'): string | null {
  if (isUploadRefusal(e)) {
    const f = e.facts;
    const k = f.kind ?? kind;
    switch (e.reason) {
      case 'too-big':
        return tooBigWords(k, f.bytes, f.maxBytes);
      case 'wrong-type':
        return t(WRONG_TYPE[k]);
      case 'unreadable':
        // A picture this phone could not open — most often one too large for its memory, or a kind its browser cannot
        // read (an iPhone's own format, on Android). The size is said where it is the likely reason.
        return f.bytes && f.bytes >= 10_000_000 ? t('upload.unreadableLarge', { size: sizeWords(f.bytes) }) : t('upload.unreadable');
      case 'empty':
        return t('upload.empty');
      default:
        return t('upload.notRead');
    }
  }
  // The server's own refusals of a file: MEDIA_TOO_LARGE with the size and the most where it knew them.
  const err = e as { code?: unknown; params?: { bytes?: unknown; maxBytes?: unknown } } | null;
  if (err && typeof err === 'object' && err.code === 'MEDIA_TOO_LARGE') {
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined);
    return tooBigWords(kind, num(err.params?.bytes), num(err.params?.maxBytes));
  }
  if (err && typeof err === 'object' && err.code === 'UNSUPPORTED_MEDIA') return t(WRONG_TYPE[kind]);
  return null;
}

/** What an upload came to: the id the server gave it, or why it did not go — in words, for where the photo was taken. */
export type Uploaded = string | { failed: string } | null;

export function mediaIdOf(u: Uploaded): string | null {
  return typeof u === 'string' && u ? u : null;
}

export function failedWords(u: Uploaded): string | null {
  return u && typeof u === 'object' ? u.failed : null;
}

/** A phone's file type, where the phone did not say one (some Androids do not): from the name. */
export function typeOf(file: File): string {
  if (file.type) return file.type.toLowerCase();
  const ext = /\.([a-z0-9]+)$/i.exec(file.name ?? '')?.[1]?.toLowerCase();
  const byExt: Record<string, string> = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', csv: 'text/csv', txt: 'text/plain', tsv: 'text/tab-separated-values', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' };
  return (ext && byExt[ext]) || '';
}

/**
 * Check a file that cannot be made smaller, BEFORE it is read or sent: empty, too large, or not a kind the server takes.
 * Returns the refusal, or null when it may go.
 */
export function checkFile(file: File, kind: UploadKind, maxBytes: number, types?: readonly string[]): UploadRefusal | null {
  if (!file.size) return new UploadRefusal('empty', { kind });
  if (types && types.length && !types.includes(typeOf(file))) return new UploadRefusal('wrong-type', { kind, type: typeOf(file) });
  if (file.size > maxBytes) return new UploadRefusal('too-big', { kind, bytes: file.size, maxBytes });
  return null;
}

/** Read a file as a `data:` URL. A phone that cannot read it says so, rather than leaving the screen waiting for ever. */
export function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => (typeof reader.result === 'string' ? resolve(reader.result) : reject(new UploadRefusal('not-read')));
    reader.onerror = () => reject(new UploadRefusal('not-read'));
    reader.onabort = () => reject(new UploadRefusal('not-read'));
    reader.readAsDataURL(file);
  });
}

/* A company's paper, made ready to send (a photo of it made smaller where it must be): paperForUpload, in media.ts. */
