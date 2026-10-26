import type { components } from '../../lib/sbg/schema';
import type { MessageKey, Translate } from '../../shared/i18n';
import type { PillTone } from '../../shared/ui';
import { money } from './logic';
import { WEEK, type WeekForm } from '../fleet/sites';

/**
 * COMING IN — A HUB AS A CROSS-DOCK, from the hub's side (reading B; backend hub-arrival.service.ts; the user, 2026-10-25:
 * "Yes, A then B"). Its owner says whether it takes stores' parcels in bulk, on which days and hours, at how many doors.
 * A store books an arrival — its parcels on so many pallets or cartons, on a day the hub receives. At the door the hub
 * counts the units that came, then scans each parcel off them: from that scan the parcel is the hub's, to sort. What was
 * booked and not on it stays the store's, which is told.
 */
export type HubArrival = components['schemas']['HubArrivalView'];
export type HubArrivalParcel = components['schemas']['HubArrivalParcel'];
export type HubArrivalsView = components['schemas']['HubArrivals'];
export type HubBulk = components['schemas']['HubBulkView'];
export type HubArrivalScan = components['schemas']['HubArrivalScan'];
export type HubUnitKind = HubArrival['unitKind'];

/** Where an arrival stands for the hub, in one word the list can colour. */
export type HubArrivalWord = 'due' | 'late' | 'coming' | 'receiving' | 'all_in' | 'some_missing' | 'withdrawn' | 'missed';

export const WORD_TONE: Record<HubArrivalWord, PillTone> = {
  due: 'info',
  late: 'warn',
  coming: 'idle',
  receiving: 'info',
  all_in: 'ok',
  some_missing: 'warn',
  withdrawn: 'idle',
  missed: 'warn',
};

export function hubArrivalWord(a: Pick<HubArrival, 'state' | 'today' | 'late' | 'finished'>): HubArrivalWord {
  if (a.state === 'withdrawn') return 'withdrawn';
  if (a.state === 'missed') return 'missed';
  if (a.state === 'receiving') return 'receiving';
  if (a.state === 'received') return a.finished?.missing.length ? 'some_missing' : 'all_in';
  if (a.late) return 'late';
  return a.today ? 'due' : 'coming';
}

/**
 * The floor's three piles: AT THE DOOR NOW — being taken in, then late, then due today; COMING on a later day, the soonest
 * first; DONE this week — taken in, withdrawn, or said not to have come — the latest first. Today and late are the
 * server's, on the hub's own clock.
 */
export function arrivalGroups(list: readonly HubArrival[]): { now: HubArrival[]; coming: HubArrival[]; done: HubArrival[] } {
  const rank = (a: HubArrival) => (a.state === 'receiving' ? 0 : a.late ? 1 : 2);
  const now = list.filter((a) => a.state === 'receiving' || (a.state === 'expected' && (a.today || a.late)));
  const coming = list.filter((a) => a.state === 'expected' && !a.today && !a.late);
  const done = list.filter((a) => a.state === 'received' || a.state === 'withdrawn' || a.state === 'missed');
  const endOf = (a: HubArrival) => a.finished?.at ?? a.withdrawn?.at ?? a.missed?.at ?? a.createdAt;
  return {
    now: [...now].sort((a, b) => rank(a) - rank(b) || a.expectedOn.localeCompare(b.expectedOn)),
    coming: [...coming].sort((a, b) => a.expectedOn.localeCompare(b.expectedOn)),
    done: [...done].sort((a, b) => endOf(b).localeCompare(endOf(a))),
  };
}

/** An arrival as the server now has it, in the list in place of what it was. */
export function replaceArrival(view: HubArrivalsView | null, a: HubArrival): HubArrivalsView | null {
  if (!view) return view;
  return { ...view, arrivals: view.arrivals.some((x) => x.arrivalId === a.arrivalId) ? view.arrivals.map((x) => (x.arrivalId === a.arrivalId ? a : x)) : [a, ...view.arrivals] };
}

/** The hub may say an arrival did not come once its day is over on its clock, and nothing was taken in at the door. */
export function canSayMissed(a: Pick<HubArrival, 'state' | 'late'>): boolean {
  return a.state === 'expected' && Boolean(a.late);
}

/** What the tab's badge counts: the arrivals at the door now. */
export function arrivalsAtTheDoor(view: HubArrivalsView | null | undefined): number {
  return view ? arrivalGroups(view.arrivals).now.length : 0;
}

const UNITS: Record<HubUnitKind, MessageKey> = {
  pallet: 'mdp.arrivals.units.pallet',
  carton: 'mdp.arrivals.units.carton',
  cage: 'mdp.arrivals.units.cage',
  sack: 'mdp.arrivals.units.sack',
};

/** "3 pallets · 42 parcels" — what was booked to come. */
export function loadLine(a: Pick<HubArrival, 'unitKind' | 'units' | 'parcels'>, t: Translate): string {
  return `${t(UNITS[a.unitKind], { n: a.units })} · ${t('mdp.arrivals.parcels', { n: a.parcels.length })}`;
}

/** A count of units, in the kind booked: "3 pallets". */
export function unitsLine(kind: HubUnitKind, n: number, t: Translate): string {
  return t(UNITS[kind], { n });
}

/** The parcels still to come off the units: booked, not scanned, not withdrawn by the store. */
export function stillToScan(a: Pick<HubArrival, 'parcels'>): HubArrivalParcel[] {
  return a.parcels.filter((p) => !p.scanned && !p.withdrawn);
}

/** The parcels the store still sends on it: booked and not withdrawn. */
export function onIt(a: Pick<HubArrival, 'parcels'>): HubArrivalParcel[] {
  return a.parcels.filter((p) => !p.withdrawn);
}

/** The kinds of unit a hub takes in, in the order a sheet asks for them. */
export const UNIT_KINDS: readonly HubUnitKind[] = ['pallet', 'carton', 'cage', 'sack'];

const FEE_EACH: Record<HubUnitKind, MessageKey> = {
  pallet: 'mdp.bulk.feeEach.pallet',
  carton: 'mdp.bulk.feeEach.carton',
  cage: 'mdp.bulk.feeEach.cage',
  sack: 'mdp.bulk.feeEach.sack',
};

/** "KES 150.00 a pallet" — the hub's fee for one unit of a kind (D12). */
export function feeEach(kind: HubUnitKind, fee: number, currency: string | undefined, t: Translate): string {
  return t(FEE_EACH[kind], { price: money(fee, currency) });
}

/** "KES 150.00 a pallet · KES 20.00 a carton" — what the hub charges to take in each kind; null where it charges nothing. */
export function feesLine(bulk: Pick<HubBulk, 'fees' | 'feeCurrency'> | undefined, t: Translate): string | null {
  const fees = bulk?.fees;
  if (!fees) return null;
  const parts = UNIT_KINDS.filter((k) => (fees[k] ?? 0) > 0).map((k) => feeEach(k, fees[k]!, bulk?.feeCurrency, t));
  return parts.length ? parts.join(' · ') : null;
}

/** Units as counted at the door: a whole number from 1 to 100 — or nothing. */
export function unitsOf(text: string): number | null {
  const s = text.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= 100 ? n : null;
}

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * WHAT IS WRONG WITH A WEEK OF HOURS as a hub writes it — its opening hours or the hours it takes stores' parcels in bulk
 * — checked as the server checks it: no day open, a time not HH:MM, closing before opening on a day.
 */
export function weekProblem(week: WeekForm): 'noDay' | 'time' | 'closes' | null {
  const open = WEEK.filter((d) => week[d]);
  if (!open.length) return 'noDay';
  for (const d of open) {
    const h = week[d]!;
    if (!HHMM.test(h.open) || !HHMM.test(h.close)) return 'time';
    if (h.close <= h.open) return 'closes';
  }
  return null;
}

const BULK_PROBLEM = { noDay: 'mdp.bulk.errNoDay', time: 'mdp.bulk.errTime', closes: 'mdp.bulk.errCloses' } as const satisfies Record<string, MessageKey>;
const REACH_PROBLEM = { noDay: 'mdp.reach.errNoDay', time: 'mdp.reach.errTime', closes: 'mdp.reach.errCloses' } as const satisfies Record<string, MessageKey>;

/** The hub's opening hours, before they are sent (HubReachCard.tsx): nothing to check where it keeps no set hours. */
export function openingHoursProblem(keepsHours: boolean, week: WeekForm): MessageKey | null {
  const wrong = keepsHours ? weekProblem(week) : null;
  return wrong ? REACH_PROBLEM[wrong] : null;
}

/**
 * THE HUB'S WORD THAT IT TAKES PARCELS IN BULK, as its owner wrote it, made the body the server takes — or the first thing
 * wrong with it, checked as the server checks it: a day it receives at least, each opening before it closes; doors blank
 * (not said) or 1 to 50. Without set hours it receives whenever it is working.
 */
export function bulkBody(
  keepsHours: boolean,
  week: WeekForm,
  doorsText: string,
  feesText?: Partial<Record<HubUnitKind, string>>,
): { body: { open: true; hours: WeekForm | null; doors: number | null; fees?: Record<HubUnitKind, number | null> } } | { error: MessageKey } {
  const wrong = keepsHours ? weekProblem(week) : null;
  if (wrong) return { error: BULK_PROBLEM[wrong] };
  const s = doorsText.trim();
  let doors: number | null = null;
  if (s) {
    const n = Number(s);
    if (!/^\d+$/.test(s) || n < 1 || n > 50) return { error: 'mdp.bulk.errDoors' };
    doors = n;
  }
  if (!feesText) return { body: { open: true, hours: keepsHours ? week : null, doors } };
  // What it charges to take in each kind (D12): a sum of money to the cent, or blank for nothing.
  const fees = {} as Record<HubUnitKind, number | null>;
  for (const kind of UNIT_KINDS) {
    const f = (feesText[kind] ?? '').trim().replace(',', '.');
    if (!f) {
      fees[kind] = null;
      continue;
    }
    if (!/^\d+(\.\d{1,2})?$/.test(f) || Number(f) > 1_000_000) return { error: 'mdp.bulk.errFee' };
    fees[kind] = Number(f) || null;
  }
  return { body: { open: true, hours: keepsHours ? week : null, doors, fees } };
}
