import type { Translate } from '../../shared/i18n';

/**
 * A PARCEL'S WAY, as staff read it (2026-11-06, movement unification; backend MonitorService.parcelTimeline): the stops its
 * plan names — passed, where it is, next, later — the time it was promised and, where its plan was made again, the time
 * now expected; and every step it took off its plan, with why and by whom.
 */
export interface ParcelWay {
  stops: Array<{ label: string; kind: 'shop' | 'hub' | 'dock'; state: 'passed' | 'here' | 'next' | 'later' }>;
  promisedAt: string;
  expectedAt?: string;
  heading?: { to: string; reason: string; note?: string };
  offPlan: OffPlanStepView[];
}

export interface OffPlanStepView {
  at: string;
  /** Who chose it: a person at a counter or a hub (`decision`), nobody — it arrived there (`arrival`), or the network (`system`). */
  kind: 'decision' | 'arrival' | 'system';
  where: string;
  planned?: string;
  took: string;
  reason: string;
  note?: string;
  by?: string;
}

/** The steps that count as off its plan: a price made on another route is said, but it is not a step the parcel took. */
export function stepsOffPlan(way: Pick<ParcelWay, 'offPlan'>): number {
  return way.offPlan.filter((s) => s.reason !== 'priced_other_way').length;
}

/** One step off its plan in words: where it was, what its plan said, where it went — or, for a price, the way it is planned. */
export function offPlanStepWords(s: OffPlanStepView, t: Translate): string {
  if (s.reason === 'priced_other_way') return t('tower.way.priced', { took: s.took });
  if (!s.planned) return s.kind === 'arrival' ? t('tower.way.arrivalNoPlan', { took: s.took }) : t('tower.way.wentTo', { took: s.took });
  if (s.kind === 'arrival') return t('tower.way.arrival', { took: s.took, planned: s.planned });
  if (s.kind === 'system') return t('tower.way.system', { took: s.took, planned: s.planned });
  return t('tower.way.decision', { where: s.where, planned: s.planned, took: s.took });
}
