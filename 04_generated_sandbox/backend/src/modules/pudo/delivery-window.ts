/**
 * A DELIVERY WINDOW, READ — "8-12", "before 14:00", "2pm-5pm" — as the hours of the day a door is expecting its goods.
 *
 * The window on an order is words the shipper typed, eighty characters of them, and until now the plan only showed
 * them beside its own estimate. To plan to a window it has to be a time. This reads the forms people actually write,
 * and — like the sheet reader beside it — it does not guess: "morning", "asap", "call first", or two hours that could
 * as well be the small hours as the afternoon ("1-5") are NOT a window this read, and the plan says so on that order
 * rather than quietly planning to a time nobody asked for.
 *
 * Pure: words in, minutes of the day out.
 */

export interface DayWindow {
  /** Not before: minutes after midnight. Absent: any time up to `toMin`. */
  fromMin?: number;
  /** Not after: minutes after midnight. Absent: any time from `fromMin`. */
  toMin?: number;
}

/** One clock time as people write it: 8, 08:00, 8.30, 8h30, 0800, 2pm, 2:30 p.m. Minutes after midnight, and whether it said am or pm. */
function timeOf(raw: string): { min: number; half?: 'am' | 'pm'; hour: number; bare: boolean } | undefined {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '');
  const m = /^(\d{1,2})(?:[:.h](\d{2})|h)?(am|pm|a\.m\.|p\.m\.|uur|u)?$/.exec(s) ?? /^(\d{2})(\d{2})()$/.exec(s);
  if (!m) return undefined;
  let hour = Number(m[1]);
  const minute = m[2] ? Number(m[2]) : 0;
  const half = m[3]?.startsWith('a') ? 'am' : m[3]?.startsWith('p') ? 'pm' : undefined;
  if (minute > 59) return undefined;
  if (half) {
    if (hour < 1 || hour > 12) return undefined;
    hour = (hour % 12) + (half === 'pm' ? 12 : 0);
  } else if (hour > 24 || (hour === 24 && minute > 0)) return undefined;
  // "Bare": an hour on its own, with nothing to say which half of the day — 8, not 08:00 and not 8am.
  return { min: hour * 60 + minute, half, hour: Number(m[1]), bare: !half && m[2] === undefined && m[1].length === 1 };
}

const BEFORE = /^(?:before|by|until|till|no later than|not after|latest|voor|tot|uiterlijk)\s+(.+)$/;
const AFTER = /^(?:after|from|not before|earliest|na|vanaf)\s+(.+)$/;
const BETWEEN = /^(?:between|from|van|tussen)\s+(.+?)\s+(?:and|to|till|until|tot|en)\s+(.+)$/;
const RANGE = /^(.+?)\s*(?:-|–|—|to|till|until|tot|\/)\s*(.+)$/;

/**
 * The window in a shipper's words, or undefined when the words are not one this can read for certain.
 * A range is read in the twenty-four-hour clock unless it says am or pm; an "am"/"pm" on one end lends itself to the
 * other where that makes a window ("2-5pm" is 14:00–17:00, "9-5pm" is 09:00–17:00).
 */
export function windowOf(words: string | undefined): DayWindow | undefined {
  const s = (words ?? '').trim().toLowerCase().replace(/\s+/g, ' ').replace(/\.$/, '');
  if (!s) return undefined;
  const before = BEFORE.exec(s);
  const between = BETWEEN.exec(s);
  if (between) return rangeOf(between[1], between[2]);
  if (before) {
    const t = timeOf(before[1]);
    return t && !ambiguous(t) && t.min > 0 ? { toMin: t.min } : undefined;
  }
  const after = AFTER.exec(s);
  if (after) {
    const t = timeOf(after[1]);
    return t && !ambiguous(t) && t.min < 24 * 60 ? { fromMin: t.min } : undefined;
  }
  const range = RANGE.exec(s);
  return range ? rangeOf(range[1], range[2]) : undefined;
}

/** A bare small hour — "5" — is five in the morning or five in the afternoon, and nothing says which. */
const ambiguous = (t: { hour: number; bare: boolean }) => t.bare && t.hour >= 1 && t.hour <= 6;

function rangeOf(a: string, b: string): DayWindow | undefined {
  const from = timeOf(a);
  const to = timeOf(b);
  if (!from || !to) return undefined;
  let fromMin = from.min;
  let toMin = to.min;
  if (!from.half && to.half) {
    // "2-5pm": the first hour takes the second's half of the day where that still comes before it; else it is morning.
    const lent = (from.hour % 12) * 60 + (from.min % 60) + (to.half === 'pm' ? 720 : 0);
    if (from.hour >= 1 && from.hour <= 12) fromMin = lent < toMin ? lent : (from.hour % 12) * 60 + (from.min % 60);
  } else if (from.half && !to.half) {
    // "9am-5": the second is after the first, in whichever half of the day makes it so.
    if (to.hour >= 1 && to.hour <= 12 && toMin <= fromMin) toMin += 720;
  } else if (!from.half && !to.half) {
    // No am or pm anywhere. "10-2" can only be 10:00–14:00; "1-5" could be either half of the day, and is not read.
    if (ambiguous(from) && ambiguous(to)) return undefined;
    // Only on a twelve-hour clock: somebody who writes 14 does not mean nine in the evening by 9.
    if (toMin <= fromMin && to.bare && from.hour <= 12) toMin += 720;
  }
  if (toMin <= fromMin || toMin > 24 * 60) return undefined;
  return { fromMin, toMin };
}

/** Minutes after midnight as a clock time. */
export function clockWords(min: number): string {
  const m = Math.max(0, Math.round(min));
  // The end of a day is 24:00, not the start of the next.
  if (m === 1440) return '24:00';
  return `${String(Math.floor(m / 60) % 24).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** A window as the plan says it back: "08:00–12:00", "before 14:00", "from 09:30". */
export function windowWords(w: DayWindow): string {
  if (w.fromMin !== undefined && w.toMin !== undefined) return `${clockWords(w.fromMin)}–${clockWords(w.toMin)}`;
  return w.toMin !== undefined ? `before ${clockWords(w.toMin)}` : `from ${clockWords(w.fromMin ?? 0)}`;
}
