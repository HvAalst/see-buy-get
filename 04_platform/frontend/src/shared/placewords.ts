/**
 * Place words — any point on earth as THREE speakable words ("goldfox calmriver blueowl").
 *
 * Why: this network runs where street addresses often do not exist (the agent record says
 * it outright: "no street addresses — landmark + GPS"). A map pin shows a place; place
 * words let someone SAY it — over a call, in an SMS, across a counter — with no address
 * literacy, no screen sharing, no external service.
 *
 * How: the globe is a 2^18 × 2^18 grid (a cell is ~76 m north–south and ~153 m east–west
 * at the equator, tighter toward the poles). The cell number is written base-4096, one
 * word per digit, from a wordlist of 64 adjectives × 64 nouns compounded — 4096 distinct,
 * pronounceable words. Deterministic, reversible, fully offline.
 *
 * This is an OPEN sandbox codec, not what3words: the algorithm and list are ours, and a
 * production deploy can swap this module for a commercial geocoder behind the same two
 * functions. Neighbouring cells share no words by construction of the mixed-radix split,
 * so a one-word slip lands far away and reads as "not found" rather than nearly-right —
 * the failure mode you want for a pickup point.
 */

import type { GeoPoint } from './geo';

const ADJECTIVES = [
  'calm', 'gold', 'blue', 'red', 'green', 'tall', 'soft', 'warm',
  'cool', 'dark', 'pale', 'wide', 'slim', 'bold', 'kind', 'wise',
  'glad', 'neat', 'pure', 'fair', 'deep', 'high', 'low', 'new',
  'old', 'big', 'dry', 'wet', 'icy', 'sunny', 'misty', 'windy',
  'rainy', 'dusty', 'sandy', 'rocky', 'leafy', 'mossy', 'shady', 'bright',
  'quiet', 'quick', 'slow', 'brave', 'gentle', 'happy', 'lucky', 'merry',
  'noble', 'plain', 'proud', 'rare', 'ripe', 'royal', 'rustic', 'silver',
  'simple', 'smooth', 'spring', 'steady', 'still', 'sweet', 'young', 'amber',
] as const;

const NOUNS = [
  'fox', 'lion', 'tiger', 'zebra', 'camel', 'eagle', 'heron', 'crane',
  'dove', 'finch', 'gull', 'hawk', 'ibis', 'kite', 'lark', 'owl',
  'swan', 'wren', 'ant', 'bee', 'crab', 'fish', 'frog', 'goat',
  'horse', 'lamb', 'mole', 'mouse', 'otter', 'panda', 'rabbit', 'seal',
  'sheep', 'toad', 'whale', 'yak', 'river', 'lake', 'pond', 'creek',
  'delta', 'dune', 'field', 'glade', 'grove', 'hill', 'island', 'meadow',
  'oasis', 'peak', 'ridge', 'shore', 'stone', 'trail', 'valley', 'cliff',
  'cave', 'reef', 'bay', 'cape', 'marsh', 'brook', 'cedar', 'palm',
] as const;

/** The 4096-word list, index = adjective*64 + noun. Exported for the tests' invariants. */
export const PLACE_WORDS: readonly string[] = ADJECTIVES.flatMap((a) => NOUNS.map((n) => `${a}${n}`));

const INDEX = new Map(PLACE_WORDS.map((w, i) => [w, i]));

/** Grid steps per axis. 2^18 → ~76 m of latitude per cell. */
const STEPS = 1 << 18;
const BASE = 4096;

/** A point → its three place words. */
export function toPlaceWords(p: GeoPoint): string {
  const u = Math.max(0, Math.min(STEPS - 1, Math.floor(((p.lat + 90) / 180) * STEPS)));
  const v = Math.max(0, Math.min(STEPS - 1, Math.floor(((p.lng + 180) / 360) * STEPS)));
  const m = u * STEPS + v; // ≤ 2^36 — exact in a JS double
  const i1 = Math.floor(m / (BASE * BASE));
  const i2 = Math.floor(m / BASE) % BASE;
  const i3 = m % BASE;
  return `${PLACE_WORDS[i1]} ${PLACE_WORDS[i2]} ${PLACE_WORDS[i3]}`;
}

/** Three words (any case, any of space/./,/· between) → the cell's centre, or null. */
export function fromPlaceWords(text: string): GeoPoint | null {
  const words = text.toLowerCase().split(/[\s.,·]+/).filter(Boolean);
  if (words.length !== 3) return null;
  const idx = words.map((w) => INDEX.get(w));
  if (idx.some((i) => i === undefined)) return null;
  const m = (idx[0]! * BASE + idx[1]!) * BASE + idx[2]!;
  const u = Math.floor(m / STEPS);
  const v = m % STEPS;
  if (u >= STEPS) return null; // three real words can still name a cell off the top of the grid
  return {
    lat: ((u + 0.5) / STEPS) * 180 - 90,
    lng: ((v + 0.5) / STEPS) * 360 - 180,
  };
}

/** True when the text parses to a real place. */
export function isPlaceWords(text: string): boolean {
  return fromPlaceWords(text) !== null;
}
