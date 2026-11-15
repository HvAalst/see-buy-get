import { GlosError } from '../../foundation/http/glos-error';
import {
  END_EQUIPMENT,
  HANDLING_MARKS,
  LOAD_NEEDS,
  SITE_HANDS,
  type DriverBrings,
  type EndGap,
  type HandlingMark,
  type LoadEnd,
  type LoadExtra,
  type LoadWork,
  type LoadWorkView,
} from './load-work.types';

/**
 * 2026-11-13 — UNUSUAL LOADS, THE RULES (plan U1–U4 as the owner revised them). Pure: what a load's two ends leave for the
 * driver to bring, what extra work it names, and whether a driver can do it. load-work.types.ts holds the words.
 *
 * U1 — as freight already works: the poster says, for the pickup and the delivery separately, who is there to help and what
 * equipment; the GAP between what the load needs and what an end offers is what the driver brings there. Only a gap limits
 * who may take it. U2 — the floor, a lift, how far it is carried, on the same screen. U3 — a few handling marks. U4 — any extra
 * work makes it a negotiated load: the driver names one price for the whole job; nobody sets rates for extras.
 */

/** Over this, an item is long (U3): a van shorter than it cannot take it. */
export const LONG_CM = 250;
/** Carried further than this from where the vehicle stops is extra work. */
export const CARRY_FREE_M = 25;
/** The most of each, so a slip of the keyboard is refused rather than kept. */
export const MAX_FLOOR = 60;
export const MAX_CARRY_M = 500;
export const MAX_WAIT_MIN = 600;
/** The most helpers a driver says work with them. */
export const MAX_HELPERS = 2;

const NONE: EndGap = { helpers: 0, tailLift: false, palletJack: false };
const PEOPLE: Record<Exclude<LoadWork['needs'], 'machine'>, number> = { one: 1, two: 2, three: 3 };
const THERE: Record<LoadEnd['hands'], number> = { none: 0, one: 1, two: 2 };

/** What the driver must bring to this end: nothing where they load or unload it themselves, or the end has what it takes. */
export function gapAt(needs: LoadWork['needs'], end: LoadEnd): EndGap {
  if (end.theyDoIt) return { ...NONE };
  if (needs === 'machine') {
    const there = end.equipment ?? [];
    // A forklift or a crane does it all; a dock takes it level onto the deck, which a pallet jack then moves.
    if (there.includes('FLT') || there.includes('CRN')) return { ...NONE };
    if (there.includes('DOCK')) return { helpers: 0, tailLift: false, palletJack: !there.includes('PLT') };
    return { helpers: 0, tailLift: true, palletJack: !there.includes('PLT') };
  }
  // The driver is one of the people it takes; whoever is there helps.
  return { helpers: Math.max(0, PEOPLE[needs] - 1 - THERE[end.hands]), tailLift: false, palletJack: false };
}

/** Both ends' gaps. */
export function gapsOf(work: LoadWork): { pickup: EndGap; delivery: EndGap } {
  return { pickup: gapAt(work.needs, work.pickup), delivery: gapAt(work.needs, work.delivery) };
}

/** Whether an end leaves the driver anything to bring. */
export function hasGap(gap: EndGap): boolean {
  return gap.helpers > 0 || gap.tailLift || gap.palletJack;
}

/**
 * The extra work a load names, end by end (U4): what the driver brings because an end has none, each floor without a lift,
 * carrying beyond {@link CARRY_FREE_M}, and waiting. Where the sender loads or the receiver unloads, the driver carries nothing
 * there — only a wait is still theirs.
 */
export function extrasOf(work: LoadWork): LoadExtra[] {
  const out: LoadExtra[] = [];
  for (const end of ['pickup', 'delivery'] as const) {
    const at = work[end];
    const gap = gapAt(work.needs, at);
    if (gap.helpers) out.push({ end, kind: 'helper', n: gap.helpers });
    if (gap.tailLift) out.push({ end, kind: 'tailLift' });
    if (gap.palletJack) out.push({ end, kind: 'palletJack' });
    if (!at.theyDoIt) {
      if ((at.floor ?? 0) > 0 && !at.lift) out.push({ end, kind: 'floors', n: at.floor });
      if ((at.carryM ?? 0) > CARRY_FREE_M) out.push({ end, kind: 'carry', n: at.carryM });
    }
    if ((at.waitMin ?? 0) > 0) out.push({ end, kind: 'wait', n: at.waitMin });
  }
  return out;
}

/** The handling marks, with LONG added where the goods measure over {@link LONG_CM} on their longest side. */
export function marksOf(work: LoadWork | undefined, dimensionsCm?: readonly number[]): HandlingMark[] {
  const marks = new Set<HandlingMark>(work?.marks ?? []);
  if (dimensionsCm?.length && Math.max(...dimensionsCm) > LONG_CM) marks.add('long');
  return HANDLING_MARKS.filter((m) => marks.has(m));
}

/**
 * Why this driver cannot do this load's work, in words — or undefined. Only a gap limits (U1): helpers beside them, and the
 * tail-lift or pallet jack on their vehicle. A long item needs a load space at least as long, where the space is known (U3).
 */
export function cannotDo(work: LoadWork | undefined, brings: DriverBrings, longestCm?: number, loadLengthM?: number): string | undefined {
  if (work) {
    const gaps = gapsOf(work);
    const need: EndGap = {
      helpers: Math.max(gaps.pickup.helpers, gaps.delivery.helpers),
      tailLift: gaps.pickup.tailLift || gaps.delivery.tailLift,
      palletJack: gaps.pickup.palletJack || gaps.delivery.palletJack,
    };
    if (need.helpers > brings.helpers) {
      return need.helpers === 1 ? 'This load needs a helper with you, and you have said you work alone' : `This load needs ${need.helpers} helpers with you, and you have said you bring ${brings.helpers}`;
    }
    if (need.tailLift && !brings.tailLift) return 'This load needs a tail-lift where nobody has the equipment to load it, and your vehicle has none';
    if (need.palletJack && !brings.palletJack) return 'This load needs a pallet jack where the site has none, and your vehicle carries none';
  }
  if (longestCm != null && loadLengthM != null && longestCm > loadLengthM * 100) {
    return `The longest item is ${(longestCm / 100).toFixed(1)} m and your load space is ${loadLengthM} m long`;
  }
  return undefined;
}

/** What a driver brings, from what they said of themselves and what their vehicle carries. */
export function bringsOf(helpers: number | undefined, equipment: readonly string[] | undefined): DriverBrings {
  return { helpers: helpers ?? 0, tailLift: Boolean(equipment?.includes('TLT')), palletJack: Boolean(equipment?.includes('PLT')) };
}

const isWhole = (n: unknown, min: number, max: number): n is number => typeof n === 'number' && Number.isInteger(n) && n >= min && n <= max;

function cleanEnd(raw: unknown, which: 'pickup' | 'delivery'): LoadEnd {
  const at = (raw ?? {}) as Record<string, unknown>;
  const field = (f: string) => ({ field: `work.${which}.${f}` });
  if (!(SITE_HANDS as readonly unknown[]).includes(at.hands)) throw new GlosError('VALIDATION_FAILED', `Say who is there to help at the ${which}: nobody, one person, or two or more`, field('hands'));
  const equipment = at.equipment == null ? [] : at.equipment;
  if (!Array.isArray(equipment) || equipment.some((e) => !(END_EQUIPMENT as readonly unknown[]).includes(e))) {
    throw new GlosError('VALIDATION_FAILED', `Equipment at the ${which} is one of: forklift, pallet jack, loading dock, crane`, field('equipment'));
  }
  if (at.floor != null && !isWhole(at.floor, 0, MAX_FLOOR)) throw new GlosError('VALIDATION_FAILED', `The floor at the ${which} is a whole number from 0 (the ground) to ${MAX_FLOOR}`, field('floor'));
  if (at.carryM != null && !isWhole(at.carryM, 0, MAX_CARRY_M)) throw new GlosError('VALIDATION_FAILED', `How far it is carried at the ${which} is whole metres, up to ${MAX_CARRY_M}`, field('carryM'));
  if (at.waitMin != null && !isWhole(at.waitMin, 0, MAX_WAIT_MIN)) throw new GlosError('VALIDATION_FAILED', `Waiting at the ${which} is whole minutes, up to ${MAX_WAIT_MIN}`, field('waitMin'));
  const said = new Set(equipment as string[]);
  const kept = END_EQUIPMENT.filter((e) => said.has(e));
  return {
    hands: at.hands as LoadEnd['hands'],
    ...(kept.length ? { equipment: kept } : {}),
    ...(at.theyDoIt === true ? { theyDoIt: true } : {}),
    ...(at.floor ? { floor: at.floor as number } : {}),
    ...(at.lift === true && at.floor ? { lift: true } : {}),
    ...(at.carryM ? { carryM: at.carryM as number } : {}),
    ...(at.waitMin ? { waitMin: at.waitMin as number } : {}),
  };
}

/** The work as a poster sent it, checked and kept only as the words allow — refused in words where it is not. */
export function cleanWork(raw: unknown): LoadWork | undefined {
  if (raw == null) return undefined;
  if (typeof raw !== 'object' || Array.isArray(raw)) throw new GlosError('VALIDATION_FAILED', 'Say what it takes to move the load', { field: 'work' });
  const w = raw as Record<string, unknown>;
  if (!(LOAD_NEEDS as readonly unknown[]).includes(w.needs)) throw new GlosError('VALIDATION_FAILED', 'Say what it takes to lift and carry it: one person, two, three or more, or a machine', { field: 'work.needs' });
  const marks = w.marks == null ? [] : w.marks;
  if (!Array.isArray(marks) || marks.some((m) => !(HANDLING_MARKS as readonly unknown[]).includes(m))) {
    throw new GlosError('VALIDATION_FAILED', 'A handling mark is one of: keep upright, do not stack, long, blankets or wrapping, needs securing', { field: 'work.marks' });
  }
  const kept = HANDLING_MARKS.filter((m) => (marks as unknown[]).includes(m));
  return {
    needs: w.needs as LoadWork['needs'],
    pickup: cleanEnd(w.pickup, 'pickup'),
    delivery: cleanEnd(w.delivery, 'delivery'),
    ...(kept.length ? { marks: kept } : {}),
  };
}

/** The view of a load's work, or undefined where it names none and nothing about it is long. */
export function workViewOf(work: LoadWork | undefined, dimensionsCm?: readonly number[]): LoadWorkView | undefined {
  const marks = marksOf(work, dimensionsCm);
  if (!work && !marks.length) return undefined;
  if (!work) return { extras: [], marks };
  return { needs: work.needs, pickup: work.pickup, delivery: work.delivery, gaps: gapsOf(work), extras: extrasOf(work), marks };
}

const END_WORDS = { pickup: 'pickup', delivery: 'delivery' } as const;

/** The work in plain words, for the consignment note's box 13: what each end has, what the driver brings, the marks. */
export function workLines(work: LoadWork | undefined, dimensionsCm?: readonly number[]): string[] {
  const lines: string[] = [];
  const marks = marksOf(work, dimensionsCm);
  const MARK: Record<HandlingMark, string> = { upright: 'Keep upright', noStack: 'Do not stack', long: `Long item (over ${LONG_CM / 100} m)`, blankets: 'Needs blankets or wrapping', securing: 'Needs securing' };
  for (const m of marks) lines.push(MARK[m]);
  if (!work) return lines;
  for (const end of ['pickup', 'delivery'] as const) {
    const at = work[end];
    const gap = gapAt(work.needs, at);
    const parts: string[] = [];
    if (at.theyDoIt) parts.push(end === 'pickup' ? 'the sender loads' : 'the receiver unloads');
    if ((at.floor ?? 0) > 0) parts.push(`floor ${at.floor}${at.lift ? ', with a lift' : ', no lift'}`);
    if ((at.carryM ?? 0) > 0) parts.push(`carried ${at.carryM} m`);
    const brings = [gap.helpers ? (gap.helpers === 1 ? 'a helper' : `${gap.helpers} helpers`) : '', gap.tailLift ? 'a tail-lift' : '', gap.palletJack ? 'a pallet jack' : ''].filter(Boolean);
    if (brings.length) parts.push(`the driver brings ${brings.join(', ')}`);
    if (parts.length) lines.push(`At ${END_WORDS[end]}: ${parts.join('; ')}`);
  }
  return lines;
}
