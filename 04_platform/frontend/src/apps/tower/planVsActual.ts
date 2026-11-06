import type { Translate } from '../../shared/i18n';

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
}

/** The reasons a parcel went another way, in the console's words: said at the counter, or the network's own. */
const WHY: Record<string, 'tower.plan.why.noTransport' | 'tower.plan.why.hubFull' | 'tower.plan.why.faster' | 'tower.plan.why.other' | 'tower.plan.why.room' | 'tower.plan.why.arrivedElsewhere' | 'tower.plan.why.networkChanged'> = {
  no_transport: 'tower.plan.why.noTransport',
  hub_full: 'tower.plan.why.hubFull',
  faster: 'tower.plan.why.faster',
  other: 'tower.plan.why.other',
  room: 'tower.plan.why.room',
  arrived_elsewhere: 'tower.plan.why.arrivedElsewhere',
  network_changed: 'tower.plan.why.networkChanged',
};

/** "2 went another way: no bus or driver that way (1), arrived elsewhere, nobody said why (1)" — or nothing, where none did. */
export function offPlanWords(lane: Pick<PlanLane, 'offPlan' | 'offPlanReasons'>, t: Translate): string {
  if (!lane.offPlan) return '';
  const why = Object.entries(lane.offPlanReasons ?? {})
    .filter(([, n]) => (n ?? 0) > 0)
    .sort((a, b) => (b[1] ?? 0) - (a[1] ?? 0))
    .map(([reason, n]) => `${WHY[reason] ? t(WHY[reason]) : reason} (${n})`)
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
