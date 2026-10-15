import type { Result, SbgClient } from '../../lib/sbg';
import type { components } from '../../lib/sbg/schema';
import type { MessageKey, Translate } from '../../shared/i18n';

export type VehicleCare = components['schemas']['VehicleCareView'];
export type OffRoadSpell = components['schemas']['OffRoadSpell'];
export type OffRoadReason = OffRoadSpell['reason'];

/**
 * A VEHICLE'S UPKEEP, over the wire — read when its sheet is opened, so it lives beside the sheet rather than in the
 * app's one big hook. What the network keeps about whether a vehicle goes out; never parts, mechanics' time or costs.
 */
export function careApi(sbg: SbgClient) {
  return {
    care: (vehicleId: string): Promise<Result<VehicleCare>> => sbg.request((c) => c.GET('/v1/sbg/vehicles/{id}/care', { params: { path: { id: vehicleId } } })) as never,
    takeOffRoad: (vehicleId: string, body: { reason: OffRoadReason; note?: string; fromDay?: string; untilDay?: string }): Promise<Result<VehicleCare>> =>
      sbg.request((c) => c.POST('/v1/sbg/vehicles/{id}/off-road', { params: { path: { id: vehicleId } }, body })) as never,
    endSpell: (vehicleId: string, spellId: string): Promise<Result<VehicleCare>> =>
      sbg.request((c) => c.POST('/v1/sbg/vehicles/{id}/off-road/{spellId}/end', { params: { path: { id: vehicleId, spellId } } })) as never,
    backOnRoad: (vehicleId: string): Promise<Result<VehicleCare>> => sbg.request((c) => c.POST('/v1/sbg/vehicles/{id}/back-on-road', { params: { path: { id: vehicleId } } })) as never,
  };
}

/** The reasons, in the order the office meets them. A breakdown is usually the driver's report; the office may record one too. */
export const OFF_ROAD_REASONS: OffRoadReason[] = ['repair', 'service', 'accident', 'breakdown', 'other'];
export const REASON_WORD: Record<OffRoadReason, MessageKey> = {
  repair: 'fleet.care.reason.repair',
  service: 'fleet.care.reason.service',
  accident: 'fleet.care.reason.accident',
  breakdown: 'fleet.care.reason.breakdown',
  other: 'fleet.care.reason.other',
};

/** A day as the office says it: "today", "tomorrow", or "Thu 16 Oct". Built at noon, so no clock moves the day. */
export function dayLabel(day: string, today: string, t: Translate): string {
  if (day === today) return t('fleet.care.today');
  if (day === addDays(today, 1)) return t('fleet.care.tomorrow');
  const d = new Date(`${day}T12:00:00Z`);
  return Number.isNaN(d.getTime()) ? day : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });
}

/** A spell's days in words: "today to Sat 18 Oct", "from Mon 20 Oct, until put back". */
export function spellSpan(s: Pick<OffRoadSpell, 'fromDay' | 'untilDay'>, today: string, t: Translate): string {
  const from = dayLabel(s.fromDay, today, t);
  if (!s.untilDay) return t('fleet.care.spanOpen', { from });
  if (s.untilDay === s.fromDay) return t('fleet.care.spanOne', { day: from });
  return t('fleet.care.span', { from, until: dayLabel(s.untilDay, today, t) });
}

/** Has it begun? One that has not is called off, not ended. */
export function spellBegun(s: Pick<OffRoadSpell, 'fromDay'>, today: string): boolean {
  return s.fromDay <= today;
}

/** Today, as YYYY-MM-DD on this device's clock — what a date field means to the person filling it. */
export function localDay(now: Date = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

function addDays(day: string, n: number): string {
  return new Date(Date.parse(`${day}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
}
