import { createHash } from 'crypto';
import { existsSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { HELP_TOPICS, HELP_TOPIC_KEYS, HelpTopic } from './help.types';

/**
 * THE HOUSE SET — the illustrations the network ships with, before any deployment has uploaded a thing.
 *
 * The masters are drawn in `brand/illustrations/<topic>/<key>.svg` and copied here by `npm run
 * sync:illustrations`; this directory is what actually ships, so the backend stays self-contained and does
 * not reach out of its own package at runtime.
 *
 * They are a FALLBACK, never a default anybody is stuck with: an operator's own upload always wins, because
 * a drawing of "a flatbed" is a claim about what trucks look like *here* and the deployment is what knows.
 * Removing an upload reveals the house drawing again rather than leaving a blank.
 */

/** Resolved from this file rather than from `process.cwd()`, which depends on how the process was started.
 *  Holds in both `src/modules/pudo` (tests) and `dist/modules/pudo` (built) — three levels up is the
 *  package root either way. */
const PACKAGE_ROOT = resolve(__dirname, '..', '..', '..');

export const BUILTIN_DIR = process.env.GLOS_ILLUSTRATIONS_DIR || join(PACKAGE_ROOT, 'assets', 'illustrations');

/**
 * SVG first, because the house set is authored here and vector is the right form for a flat line drawing —
 * a couple of KB, sharp at any size. Raster is accepted too so a deployment that forks this repo can drop
 * photographs in without needing a redraw.
 *
 * SVG is safe HERE and refused on the upload path, and the difference is provenance, not the format: these
 * bytes are in version control and were reviewed, and they are served to an `<img>`, which runs no script
 * and loads no external resources even for SVG.
 */
const EXTENSIONS: Array<{ ext: string; contentType: string }> = [
  { ext: '.svg', contentType: 'image/svg+xml' },
  { ext: '.webp', contentType: 'image/webp' },
  { ext: '.png', contentType: 'image/png' },
  { ext: '.jpg', contentType: 'image/jpeg' },
];

export interface BuiltinImage {
  path: string;
  contentType: string;
  /** Short content hash — the cache-busting `?v=` for a drawing nobody uploaded. */
  version: string;
  size: number;
}

function keyOf(topic: HelpTopic, key: string): string {
  return `${topic}:${key}`;
}

/**
 * Scan the house set once.
 *
 * Only ever looks for files named by a key that is ALREADY in the canonical list, so nothing a caller sends
 * reaches the filesystem — the traversal question never arises because no caller-supplied string is ever
 * part of a path.
 *
 * A missing directory is normal, not an error: a deployment may legitimately ship no house set at all, and
 * the sheets then fall back to their words exactly as they did before this existed.
 */
export function loadBuiltins(dir: string = BUILTIN_DIR): Map<string, BuiltinImage> {
  const found = new Map<string, BuiltinImage>();
  if (!dir || !existsSync(dir)) return found;

  for (const topic of HELP_TOPICS) {
    for (const key of HELP_TOPIC_KEYS[topic]) {
      for (const { ext, contentType } of EXTENSIONS) {
        const path = join(dir, topic, `${key}${ext}`);
        if (!existsSync(path)) continue;
        try {
          const bytes = readFileSync(path);
          found.set(keyOf(topic, key), {
            path,
            contentType,
            version: createHash('sha256').update(bytes).digest('hex').slice(0, 12),
            size: statSync(path).size,
          });
        } catch {
          // An unreadable file is a missing file. Help must never be the thing that breaks a booking.
        }
        break; // first extension in preference order wins
      }
    }
  }
  return found;
}

/** Read one house drawing's bytes. Returns undefined if it has gone since the scan. */
export function readBuiltin(img: BuiltinImage): Buffer | undefined {
  try {
    return readFileSync(img.path);
  } catch {
    return undefined;
  }
}
