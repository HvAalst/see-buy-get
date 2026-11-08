import { json, type NextFunction, type Request, type Response } from 'express';
import { GlosError } from './foundation/http/glos-error';
import { UPLOAD_LIMITS } from './foundation/media/upload-limits';

/**
 * HOW LARGE A REQUEST MAY BE, ROUTE BY ROUTE — sized from the files the routes take (2026-11-02).
 *
 * The owner, 2026-11-02: "if we put a filesize limit, it needs to show or tell … It silently refused." Two things were
 * wrong here. The body parser in front of most routes took 2 MB while the routes behind it took papers of 6 and 8 MB,
 * so a scan of 3 MB was turned away at the door with no word about papers at all. And what it turned away with was not
 * ours: the parser's own error went through as an unknown failure — a 500 that told the phone to send the same thing
 * again. Now every route that takes a large file is named here with the file it takes, its body limit is worked out
 * from that file (never typed beside it, so the two cannot drift), and a body over it is answered MEDIA_TOO_LARGE in
 * the shape every other refusal has, with the file's size and the most in `params` for the phone to say.
 *
 * Kept out of `main.ts`, as edge.ts is, so a test can put it on an application and ask over the wire.
 */

/** A file in a JSON string: base64 makes every 3 bytes 4, and the rest of the body (a thumbnail, a name) gets 256 KB. */
export function bodyForFile(fileBytes: number): number {
  return Math.ceil(fileBytes / 3) * 4 + 256 * 1024;
}

/** Text in a JSON string, counted in characters: one may come to 3 bytes (UTF-8 — Amharic, Arabic), or 2 escaped (a tab). */
export function bodyForText(chars: number): number {
  return chars * 3 + 256 * 1024;
}

export interface BodyLimit {
  /** What arrives here, for the log and the test. */
  name: string;
  /** The routes, as written in their controllers under /v1 (`:id` is any one segment). Empty: every other route. */
  paths: string[];
  /** What the file is — a file's bytes go as base64; a sheet's text goes as it is; 'none', a route that takes no file. */
  carries: 'file' | 'text' | 'none';
  /** The most of the file (bytes) or the text (characters) the route itself accepts. Absent where it takes none. */
  most?: number;
  /** The most the request body may be: worked out from `most`, never typed. */
  bodyBytes: number;
}

/** `alongside`: what else of size comes in the same body — a photograph's thumbnail. */
const file = (name: string, paths: string[], most: number, alongside = 0): BodyLimit => ({ name, paths, carries: 'file', most, bodyBytes: bodyForFile(most + alongside) });
const text = (name: string, paths: string[], most: number): BodyLimit => ({ name, paths, carries: 'text', most, bodyBytes: bodyForText(most) });

/** Every route that takes a file. Each one's `most` is the limit its service enforces; its body is worked out from it. */
export const BODY_LIMITS: BodyLimit[] = [
  file('a photograph', ['/v1/sbg/media', '/v1/sbg/shipping/photos', '/v1/sbg/api/business/photos', '/v1/sbg/api/business/parcels/photos', '/v1/sbg/identity/id-disputes/photo'], UPLOAD_LIMITS.photo, UPLOAD_LIMITS.photoThumb),
  file('a help picture', ['/v1/sbg/help/:id/:id/image'], UPLOAD_LIMITS.helpPicture),
  file('a voice message', ['/v1/sbg/conversations/:id/voice'], UPLOAD_LIMITS.voice),
  file('a company paper', ['/v1/sbg/entities/:id/documents', '/v1/sbg/entities/:id/record/declare', '/v1/sbg/quotes/:id/proforma', '/v1/sbg/media/paper'], UPLOAD_LIMITS.document),
  file('what shows a paper is wrong', ['/v1/sbg/entities/:id/documents/:id/report', '/v1/sbg/contract/company/papers/report', '/v1/sbg/paper-reports/:id/answer'], UPLOAD_LIMITS.evidence),
  text('a sheet of orders', ['/v1/sbg/fleet/managers/:id/contracts/:id/orders/import'], UPLOAD_LIMITS.orderSheetText),
  text('a packing list', ['/v1/sbg/exports/:id/packing-list/check', '/v1/sbg/exports/:id/packing-list', '/v1/sbg/api/business/exports/:id/packing-list'], UPLOAD_LIMITS.packingText),
  text('a country’s areas', ['/v1/sbg/entities/:id/zones/areas'], UPLOAD_LIMITS.zoneAreasText),
];

/** Everything else takes no file: 2 MB, as before, is far more than any form. */
export const DEFAULT_BODY: BodyLimit = { name: 'everything else', paths: [], carries: 'none', bodyBytes: 2 * 1024 * 1024 };

/** A route as written → the pattern Express matches it with: any case (Express routes ignore case), a slash at the end or not. */
export function patternOf(path: string): RegExp {
  const body = path
    .split('/')
    .map((part) => (part.startsWith(':') ? '[^/]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    .join('/');
  return new RegExp(`^${body}/?$`, 'i');
}

/** The limit a request to this path meets. */
export function bodyLimitFor(path: string): BodyLimit {
  return BODY_LIMITS.find((l) => l.paths.some((p) => patternOf(p).test(path))) ?? DEFAULT_BODY;
}

/** What the body parser throws when a body is over its limit (body-parser → raw-body → http-errors). */
interface TooLarge {
  type: 'entity.too.large';
  /** The body's length as the request declared it — absent when it came in pieces. */
  length?: number;
}
function isTooLarge(err: unknown): err is TooLarge {
  return Boolean(err && typeof err === 'object' && (err as { type?: unknown }).type === 'entity.too.large');
}

/** The file inside a body of this length, near enough: base64 is 4 characters for every 3 bytes. */
function fileInside(limit: BodyLimit, bodyLength: number | undefined): number | undefined {
  if (!bodyLength || !Number.isFinite(bodyLength) || limit.carries === 'none') return undefined;
  return limit.carries === 'file' ? Math.round((bodyLength * 3) / 4) : bodyLength;
}

/** The parser's own refusal, in ours: MEDIA_TOO_LARGE, with how large and the most. Anything else goes on as it was. */
export function sayTooLarge(limit: BodyLimit) {
  return (err: unknown, _req: Request, _res: Response, next: NextFunction): void => {
    if (!isTooLarge(err)) return next(err);
    const bytes = fileInside(limit, err.length);
    const mb = (n: number) => `${Math.round((n / 1_000_000) * 10) / 10} MB`;
    const most = limit.most;
    next(
      new GlosError(
        'MEDIA_TOO_LARGE',
        `That is too large to send here${bytes ? ` (${mb(bytes)})` : ''}${most ? `: the most is ${mb(most)}` : ''}.`,
        { ...(bytes ? { bytes } : {}), ...(most ? { maxBytes: most } : {}) },
      ),
    );
  };
}

type Use = (...args: unknown[]) => unknown;

/**
 * Put the parsers on: the named routes first, each with its own, then everything else. A body one parser has read is
 * left alone by the next, so the order is the whole of it. Call where the server starts, AFTER anything that must read
 * a body as its raw bytes (readProviderEventsRaw).
 */
export function applyBodyLimits(app: { use: Use }): void {
  for (const limit of BODY_LIMITS) {
    for (const path of limit.paths) app.use(patternOf(path), json({ limit: limit.bodyBytes }), sayTooLarge(limit));
  }
  app.use(json({ limit: DEFAULT_BODY.bodyBytes }), sayTooLarge(DEFAULT_BODY));
}
