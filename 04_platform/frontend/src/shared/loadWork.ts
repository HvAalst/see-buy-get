import type { components } from '../lib/sbg/schema';
import type { MessageKey } from './i18n';

/**
 * 2026-11-13 — UNUSUAL LOADS (plan U1–U4 as the owner revised them): what it takes to move a load, beside what the goods are.
 * The lists are the server's (load-work.types.ts — loadWork.test.ts compares them); the gap rule mirrors load-work.ts so the
 * form can say, as it is filled in, what the driver will bring to each end. The server decides; this only shows it early.
 */
export type LoadWork = components['schemas']['LoadWork'];
export type LoadEnd = components['schemas']['LoadEnd'];
export type LoadWorkView = components['schemas']['LoadWorkView'];
export type LoadExtra = components['schemas']['LoadExtra'];
export type EndGap = components['schemas']['EndGap'];

export const SITE_HANDS = ['none', 'one', 'two'] as const;
export type SiteHands = (typeof SITE_HANDS)[number];
export const END_EQUIPMENT = ['FLT', 'PLT', 'DOCK', 'CRN'] as const;
export type EndEquipment = (typeof END_EQUIPMENT)[number];
export const LOAD_NEEDS = ['one', 'two', 'three', 'machine'] as const;
export type LoadNeeds = (typeof LOAD_NEEDS)[number];
export const HANDLING_MARKS = ['upright', 'noStack', 'long', 'blankets', 'securing'] as const;
export type HandlingMark = (typeof HANDLING_MARKS)[number];
/** Carried further than this is extra work (load-work.ts CARRY_FREE_M). */
export const CARRY_FREE_M = 25;

export const NEEDS_LABEL: Record<LoadNeeds, MessageKey> = { one: 'work.needs.one', two: 'work.needs.two', three: 'work.needs.three', machine: 'work.needs.machine' };
export const HANDS_LABEL: Record<SiteHands, MessageKey> = { none: 'work.hands.none', one: 'work.hands.one', two: 'work.hands.two' };
export const EQUIPMENT_LABEL: Record<EndEquipment, MessageKey> = { FLT: 'work.eq.FLT', PLT: 'work.eq.PLT', DOCK: 'work.eq.DOCK', CRN: 'work.eq.CRN' };
export const MARK_LABEL: Record<HandlingMark, MessageKey> = { upright: 'work.mark.upright', noStack: 'work.mark.noStack', long: 'work.mark.long', blankets: 'work.mark.blankets', securing: 'work.mark.securing' };

/** One end as the form holds it: numbers as typed. */
export interface EndForm {
  hands: SiteHands | '';
  equipment: EndEquipment[];
  theyDoIt: boolean;
  floor: string;
  lift: boolean;
  carryM: string;
  waitMin: string;
}

/** The work as the form holds it. No `needs`: nothing said, and the load is posted as before. */
export interface LoadWorkForm {
  needs: LoadNeeds | '';
  pickup: EndForm;
  delivery: EndForm;
  marks: HandlingMark[];
}

export const EMPTY_END: EndForm = { hands: '', equipment: [], theyDoIt: false, floor: '', lift: false, carryM: '', waitMin: '' };
export const EMPTY_WORK: LoadWorkForm = { needs: '', pickup: { ...EMPTY_END }, delivery: { ...EMPTY_END }, marks: [] };

const whole = (s: string): number | undefined => {
  const n = Number(s.trim());
  return s.trim() && Number.isInteger(n) && n > 0 ? n : undefined;
};

function endOf(e: EndForm): LoadEnd {
  const floor = whole(e.floor);
  const carryM = whole(e.carryM);
  const waitMin = whole(e.waitMin);
  return {
    hands: e.theyDoIt && !e.hands ? 'none' : (e.hands as SiteHands),
    ...(e.equipment.length ? { equipment: END_EQUIPMENT.filter((q) => e.equipment.includes(q)) } : {}),
    ...(e.theyDoIt ? { theyDoIt: true } : {}),
    ...(floor ? { floor } : {}),
    ...(floor && e.lift ? { lift: true } : {}),
    ...(carryM ? { carryM } : {}),
    ...(waitMin ? { waitMin } : {}),
  };
}

/** What is sent: nothing where nothing was said. */
export function workBody(form: LoadWorkForm): LoadWork | undefined {
  if (!form.needs) return undefined;
  return { needs: form.needs, pickup: endOf(form.pickup), delivery: endOf(form.delivery), ...(form.marks.length ? { marks: HANDLING_MARKS.filter((m) => form.marks.includes(m)) } : {}) };
}

/** Why the work cannot be sent yet, or null: who helps at each end, unless they load or unload it themselves. */
export function workBlocker(form: LoadWorkForm): MessageKey | null {
  if (!form.needs) return null;
  if (!form.pickup.theyDoIt && !form.pickup.hands) return 'work.needHandsPickup';
  if (!form.delivery.theyDoIt && !form.delivery.hands) return 'work.needHandsDelivery';
  return null;
}

const PEOPLE: Record<Exclude<LoadNeeds, 'machine'>, number> = { one: 1, two: 2, three: 3 };
const THERE: Record<SiteHands, number> = { none: 0, one: 1, two: 2 };

/** What the driver brings to an end — the server's rule (load-work.ts gapAt), shown while the form is filled in. */
export function gapAt(needs: LoadNeeds, end: LoadEnd): EndGap {
  if (end.theyDoIt) return { helpers: 0, tailLift: false, palletJack: false };
  if (needs === 'machine') {
    const there = end.equipment ?? [];
    if (there.includes('FLT') || there.includes('CRN')) return { helpers: 0, tailLift: false, palletJack: false };
    if (there.includes('DOCK')) return { helpers: 0, tailLift: false, palletJack: !there.includes('PLT') };
    return { helpers: 0, tailLift: true, palletJack: !there.includes('PLT') };
  }
  return { helpers: Math.max(0, PEOPLE[needs] - 1 - THERE[end.hands as SiteHands]), tailLift: false, palletJack: false };
}

/** Whether the form names extra work: then drivers name one price for the whole job (U4). */
export function namesExtraWork(form: LoadWorkForm): boolean {
  const body = workBody(form);
  if (!body) return false;
  return (['pickup', 'delivery'] as const).some((end) => {
    const at = body[end];
    const gap = gapAt(body.needs, at);
    return gap.helpers > 0 || gap.tailLift || gap.palletJack || (!at.theyDoIt && (((at.floor ?? 0) > 0 && !at.lift) || (at.carryM ?? 0) > CARRY_FREE_M)) || (at.waitMin ?? 0) > 0;
  });
}

type T = (key: MessageKey, params?: Record<string, string | number>) => string;

/** What the driver brings, in words: "a helper, a tail-lift" — empty where nothing. */
export function bringsWords(gap: EndGap, t: T): string {
  return [gap.helpers ? t('work.bring.helper', { n: gap.helpers }) : '', gap.tailLift ? t('work.bring.tailLift') : '', gap.palletJack ? t('work.bring.palletJack') : ''].filter(Boolean).join(', ');
}

/** One end in words, for the driver and the poster: who helps there, the floor, the carry — and what the driver brings. */
export function endWords(end: LoadEnd, gap: EndGap | undefined, which: 'pickup' | 'delivery', t: T, forDriver = true): string {
  const parts: string[] = [];
  if (end.theyDoIt) parts.push(t(which === 'pickup' ? 'work.sum.senderLoads' : 'work.sum.receiverUnloads'));
  else {
    parts.push(t(end.hands === 'none' ? 'work.sum.nobody' : end.hands === 'one' ? 'work.sum.one' : 'work.sum.two'));
    if (end.equipment?.length) parts.push(end.equipment.map((q) => t(EQUIPMENT_LABEL[q as EndEquipment]).toLowerCase()).join(', '));
    if ((end.floor ?? 0) > 0) parts.push(t(end.lift ? 'work.sum.floorLift' : 'work.sum.floorNoLift', { n: end.floor! }));
    if ((end.carryM ?? 0) > 0) parts.push(t('work.extra.carry', { n: end.carryM! }));
  }
  if ((end.waitMin ?? 0) > 0) parts.push(t('work.extra.wait', { n: end.waitMin! }));
  const brings = gap ? bringsWords(gap, t) : '';
  if (brings) parts.push(t(forDriver ? 'work.sum.youBring' : 'work.sum.driverBrings', { list: brings }));
  return parts.join(' · ');
}

/** A work form read back from storage (a draft kept on the phone): only what this version asks, each of the kind it is. */
export function cleanWorkForm(raw: unknown): LoadWorkForm {
  const w = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === 'string' ? v.slice(0, 8) : '');
  const end = (rawEnd: unknown): EndForm => {
    const e = (rawEnd && typeof rawEnd === 'object' ? rawEnd : {}) as Record<string, unknown>;
    return {
      hands: (SITE_HANDS as readonly unknown[]).includes(e.hands) ? (e.hands as SiteHands) : '',
      equipment: Array.isArray(e.equipment) ? END_EQUIPMENT.filter((q) => (e.equipment as unknown[]).includes(q)) : [],
      theyDoIt: e.theyDoIt === true,
      floor: str(e.floor),
      lift: e.lift === true,
      carryM: str(e.carryM),
      waitMin: str(e.waitMin),
    };
  };
  return {
    needs: (LOAD_NEEDS as readonly unknown[]).includes(w.needs) ? (w.needs as LoadNeeds) : '',
    pickup: end(w.pickup),
    delivery: end(w.delivery),
    marks: Array.isArray(w.marks) ? HANDLING_MARKS.filter((m) => (w.marks as unknown[]).includes(m)) : [],
  };
}
