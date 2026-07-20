import { Injectable } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { ExceptionService } from './exception.service';

/**
 * AnalyticsService (VTT-073). Performance roll-up across the live network: shipment counts by state,
 * delivered/on-time rate, and exception counts by type + severity — the data behind the control-
 * tower performance dashboard.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    private readonly tracking: TrackingService,
    private readonly exceptions: ExceptionService,
  ) {}

  summary() {
    const shipments = this.tracking.list();
    const byState: Record<string, number> = {};
    for (const s of shipments) byState[s.state] = (byState[s.state] ?? 0) + 1;

    const delivered = shipments.filter((s) => s.state === 'DELIVERED');
    const cases = this.exceptions.list();
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    for (const c of cases) {
      byType[c.type] = (byType[c.type] ?? 0) + 1;
      bySeverity[c.severity] = (bySeverity[c.severity] ?? 0) + 1;
    }

    // On-time ≈ delivered shipments with no late/acceptance exception against them.
    const troubled = new Set(cases.filter((c) => ['missed_window', 'delivery_without_acceptance'].includes(c.type) && c.status !== 'false_alarm').map((c) => c.glosShipmentId));
    const onTime = delivered.filter((s) => !troubled.has(s.glosShipmentId)).length;

    return {
      shipments: shipments.length,
      byState,
      delivered: delivered.length,
      onTimeRate: delivered.length ? Math.round((onTime / delivered.length) * 100) / 100 : 1,
      exceptions: { total: cases.length, open: cases.filter((c) => c.status === 'open' || c.status === 'acknowledged' || c.status === 'resolving').length, byType, bySeverity },
      at: new Date().toISOString(),
    };
  }
}
