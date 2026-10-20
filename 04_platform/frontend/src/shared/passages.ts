import type { Translate } from './i18n';

/**
 * A LOAD AT A BORDER OR A HUB (round 14: "A load at a border or hub"; "The driver, by a tap"; "Each post's promise").
 *
 * The driver carrying a load says it is at a border post, has cleared it, or is at a hub. The shipper's Loads screen, the
 * tracking page and the driver's own app say the same thing in the same words, from here: what was said and when; for a
 * load crossing a border, where it has got to, how long the crossing is allowed and what that rests on — measured over so
 * many crossings, or our standard figure because not enough have been — and when it is expected. Never who said it, never
 * where their phone was: the server sends neither.
 */
export type PassageKind = 'at_border' | 'cleared_border' | 'at_hub';

export interface PassageView {
  kind: PassageKind;
  post?: string;
  hub?: string;
  at: string;
  /** On clearing a border: minutes the load was at the post. */
  waitedMin?: number;
}

export interface BorderWaitView {
  from: string;
  to: string;
  post?: string;
  hours: number;
  basis: 'measured' | 'standard';
  crossings?: number;
  posts?: string[];
}

export interface CrossingView {
  state: 'ahead' | 'at_post' | 'cleared';
  from: string;
  to: string;
  post?: string;
  since?: string;
  clearedAt?: string;
  waitedMin?: number;
  wait: BorderWaitView;
  expectedAt?: string;
  /** Round 21 — the pace its drive is promised at, and what that rests on. */
  drive?: LaneDriveView;
}

/** Round 21 — measured: the middle of its lane's last ninety days' trips (a town pair, else a country pair); standard: too few yet. */
export interface LaneDriveView {
  kmh: number;
  basis: 'measured' | 'standard';
  trips?: number;
  lane?: string;
  level?: 'towns' | 'countries';
}

/** Round 26 — a load in one country, on the road: when it is expected, the pace, and the minutes at the door a standard pace adds. */
export interface ArrivalView {
  expectedAt: string;
  drive: LaneDriveView;
  doorMin?: number;
}

/** How a time reads in the app at hand (each app has its own clock words). */
export type When = (iso: string) => string;

/** A duration as people say it: "45 min", "3 h", "3 h 20 min". */
export function durationWords(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h} h ${rest} min` : `${h} h`;
}

/** Hours to the half hour, as the wait is said: "4 h", "9.5 h" — and under an hour, in minutes: "25 min". */
export function hoursWords(hours: number): string {
  if (hours < 1) return durationWords(hours * 60);
  const half = Math.round(hours * 2) / 2;
  return `${Number.isInteger(half) ? half : half.toFixed(1)} h`;
}

/** How long the crossing is allowed, and what that rests on. */
export function waitWords(w: BorderWaitView, t: Translate): string {
  const hours = hoursWords(w.hours);
  if (w.basis === 'standard') return t('common.passage.waitStandard', { hours });
  if (w.post) return t('common.passage.waitMeasured', { hours, n: w.crossings ?? 0 });
  return t('common.passage.waitMeasuredCrossing', { hours, n: w.crossings ?? 0, posts: (w.posts ?? []).join(', ') });
}

/** One thing the driver said, as a line. */
export function passageWords(p: PassageView, t: Translate, when: When): string {
  if (p.kind === 'at_border') return t('common.passage.atBorder', { post: p.post ?? '', when: when(p.at) });
  if (p.kind === 'cleared_border') {
    return p.waitedMin != null ? t('common.passage.clearedAfter', { post: p.post ?? '', when: when(p.at), waited: durationWords(p.waitedMin) }) : t('common.passage.cleared', { post: p.post ?? '', when: when(p.at) });
  }
  return t('common.passage.atHub', { hub: p.hub ?? '', when: when(p.at) });
}

/** Round 21 — the pace the drive is promised at, and what it rests on: its own lane's trips, or the standard. */
export function driveWords(d: LaneDriveView, t: Translate): string {
  return d.basis === 'measured' ? t('common.passage.driveMeasured', { n: d.trips ?? 0, lane: d.lane ?? '', kmh: d.kmh }) : t('common.passage.driveStandard', { kmh: d.kmh });
}

/** A load crossing a border: where it has got to, the wait and what it rests on, and when it is expected — at what pace. */
export function crossingWords(c: CrossingView, t: Translate, when: When): { where: string; wait?: string; expected?: string; drive?: string } {
  const where =
    c.state === 'at_post'
      ? t('common.passage.nowAt', { post: c.post ?? '', when: when(c.since ?? '') })
      : c.state === 'cleared'
        ? c.waitedMin != null
          ? t('common.passage.clearedAfter', { post: c.post ?? '', when: when(c.clearedAt ?? ''), waited: durationWords(c.waitedMin) })
          : t('common.passage.cleared', { post: c.post ?? '', when: when(c.clearedAt ?? '') })
        : c.post
          ? t('common.passage.aheadAt', { post: c.post })
          : t('common.passage.ahead');
  return {
    where,
    // Across, the wait is history; before and at the post it is what the expectation rests on.
    ...(c.state === 'cleared' ? {} : { wait: waitWords(c.wait, t) }),
    ...(c.expectedAt ? { expected: t('common.passage.expected', { when: when(c.expectedAt) }), ...(c.drive ? { drive: driveWords(c.drive, t) } : {}) } : {}),
  };
}

/**
 * Round 26 — a load in one country, when it is expected, and at what pace: the lane's own, or the standard said as such —
 * with the minutes at the door it adds, which a measured pace already holds.
 */
export function arrivalWords(a: ArrivalView, t: Translate, when: When): { expected: string; drive: string } {
  const drive = a.drive.basis === 'standard' && a.doorMin ? t('common.passage.driveStandardDoor', { kmh: a.drive.kmh, min: a.doorMin }) : driveWords(a.drive, t);
  return { expected: t('common.passage.expected', { when: when(a.expectedAt) }), drive };
}
