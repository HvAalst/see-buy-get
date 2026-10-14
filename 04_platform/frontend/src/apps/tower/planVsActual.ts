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
  worst?: { parcelId: string; lateHours: number };
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
