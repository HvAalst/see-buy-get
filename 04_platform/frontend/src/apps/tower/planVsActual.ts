import type { Translate } from '../../shared/i18n';
import { amount } from './queues';

/** One lane, as the server reads it against the plans kept when its parcels were taken in. */
export interface PlanLane {
  from: string;
  to: string;
  arrived: number;
  onTime: number;
  late: number;
  typicalLateHours: number;
  routeKnown: number;
  routeKept: number;
  /** 2026-11-06 — how many took a step their plan did not say, and why (movement unification). */
  offPlan?: number;
  offPlanReasons?: Partial<Record<string, number>>;
  worst?: { parcelId: string; lateHours: number };
  /** 2026-11-06 — paid at stops its parcels were not priced through, and priced stops never used — each in its own money. */
  detours?: { parcels: number; paid: Array<{ currency: string; amount: number }>; unused: Array<{ currency: string; amount: number }> };
}

/**
 * 2026-11-06 — WHAT THE WAYS NOT PRICED COST, in words (the owner: "I follow point 1 to 6"): "3 paid at stops not priced:
 * 1,200.00 KES · priced stops not used: 800.00 KES" — or nothing, where nothing went another way. Monies side by side.
 */
export function detourWords(lane: Pick<PlanLane, 'detours'>, t: Translate): string {
  const d = lane.detours;
  if (!d) return '';
  const line = (list: Array<{ currency: string; amount: number }>) => list.map((m) => amount(m.amount, m.currency)).join(' · ');
  const parts = [d.paid.length ? t('tower.plan.detourPaid', { count: d.parcels, paid: line(d.paid) }) : '', d.unused.length ? t('tower.plan.detourUnused', { unused: line(d.unused) }) : ''].filter(Boolean);
  return parts.join(' — ');
}

/** The reasons a parcel went another way, in the console's words: said at the counter, or the network's own. */
const WHY: Record<string, 'tower.plan.why.noTransport' | 'tower.plan.why.hubFull' | 'tower.plan.why.faster' | 'tower.plan.why.other' | 'tower.plan.why.room' | 'tower.plan.why.arrivedElsewhere' | 'tower.plan.why.networkChanged' | 'tower.plan.why.pricedOtherWay' | 'tower.plan.why.doneOffline' | 'tower.plan.why.shopClosed'> = {
  no_transport: 'tower.plan.why.noTransport',
  hub_full: 'tower.plan.why.hubFull',
  faster: 'tower.plan.why.faster',
  other: 'tower.plan.why.other',
  room: 'tower.plan.why.room',
  arrived_elsewhere: 'tower.plan.why.arrivedElsewhere',
  network_changed: 'tower.plan.why.networkChanged',
  // 2026-11-06 — handed over or bagged with no signal: nobody could be asked then, so it is recorded, not refused.
  done_offline: 'tower.plan.why.doneOffline',
  // 2026-11-06 — its pickup shop closed: the shop its buyers' choosing settled on.
  shop_closed: 'tower.plan.why.shopClosed',
  // Read on one parcel's way (the Support screen); a lane does not count it — a price is not a step it took.
  priced_other_way: 'tower.plan.why.pricedOtherWay',
};

/** Why a parcel went another way than its plan, in words — the code itself where it is one this console does not know yet. */
export function reasonWords(reason: string, t: Translate): string {
  return WHY[reason] ? t(WHY[reason]) : reason;
}

/** "2 went another way: no bus or driver that way (1), arrived elsewhere, nobody said why (1)" — or nothing, where none did. */
export function offPlanWords(lane: Pick<PlanLane, 'offPlan' | 'offPlanReasons'>, t: Translate): string {
  if (!lane.offPlan) return '';
  const why = Object.entries(lane.offPlanReasons ?? {})
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([reason, n]) => `${reasonWords(reason, t)} (${n})`)
    .join(', ');
  return t('tower.plan.offPlan', { count: lane.offPlan, why });
}

/**
 * A LANE IN WORDS — for a person reading down the column, not for a chart.
 *
 * "2 of 3 on time", "usually 6.5 h late", "2 of 3 as planned". A lane never late says so rather than "0 h"; a lane whose
 * custody was never recorded says that rather than "0 of 0".
 */
export function laneWords(lane: PlanLane, t: Translate): { lane: string; onTime: string; late: string; route: string; worst: string } {
  return {
    lane: `${lane.from} → ${lane.to}`,
    onTime: t('tower.plan.onTime', { on: lane.onTime, n: lane.arrived }),
    late: lane.late ? t('tower.plan.usually', { h: lane.typicalLateHours }) : t('tower.plan.neverLate'),
    route: lane.routeKnown ? t('tower.plan.route', { kept: lane.routeKept, known: lane.routeKnown }) : t('tower.plan.routeUnknown'),
    worst: lane.worst ? t('tower.plan.worst', { id: lane.worst.parcelId, h: lane.worst.lateHours }) : '',
  };
}

/** What the fold says while closed: how many lanes ran late — or that none did, or that nothing has arrived to read. */
export function planFoldHint(lanes: PlanLane[] | null, t: Translate): string {
  if (!lanes) return t('tower.plan.loading');
  if (!lanes.length) return t('tower.plan.foldNone');
  return t('tower.plan.fold', { n: lanes.filter((l) => l.late > 0).length });
}
