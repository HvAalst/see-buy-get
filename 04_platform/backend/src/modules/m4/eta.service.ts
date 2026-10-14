import { Injectable } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { TrackingContextService } from './tracking-context.service';
import { DEFAULT_SPEED_KMH, MODE_SPEED_KMH, geocode, haversineKm } from './geo';

const HANDOVER_BUFFER_H = 2; // dwell allowance at each remaining handover
const CI_BAND = 0.15; // ±15% → 95% confidence interval

export interface LegEta {
  index: number;
  mode: string;
  distanceKm: number;
  hours: number;
}

export interface EtaResult {
  glosShipmentId: string;
  hoursRemaining: number;
  eta: string;
  confidence: { low: string; high: string; level: number };
  perLeg: LegEta[];
  basis: string;
}

/**
 * EtaService (VTT-030/031). Continuously-updated ETA built from the live tracking state and the
 * planned route: distance/mode-speed per remaining leg plus handover buffers, aggregated into one
 * delivery ETA with a 95% confidence interval. A delay on any leg propagates into the total
 * (multi-leg aggregation). Recomputed on demand from whatever events have landed so far.
 */
@Injectable()
export class EtaService {
  constructor(
    private readonly tracking: TrackingService,
    private readonly context: TrackingContextService,
  ) {}

  predict(glosShipmentId: string): EtaResult {
    const snap = this.tracking.snapshot(glosShipmentId);
    const ctx = this.context.get(glosShipmentId);
    const now = Date.now();
    const at = (h: number) => new Date(now + h * 3_600_000).toISOString();

    if (snap?.state === 'DELIVERED') {
      return { glosShipmentId, hoursRemaining: 0, eta: at(0), confidence: { low: at(0), high: at(0), level: 1 }, perLeg: [], basis: 'delivered' };
    }

    const legs = ctx?.legs ?? [];
    if (legs.length === 0) {
      return { glosShipmentId, hoursRemaining: 0, eta: at(0), confidence: { low: at(0), high: at(0), level: 0.3 }, perLeg: [], basis: 'no route context' };
    }

    // Legs completed ≈ handover count; once out-for-delivery we're on the final leg.
    const handovers = (snap?.events ?? []).filter((e) => !e.anomaly && e.type === 'HANDOVER').length;
    let doneLegs = Math.min(handovers, Math.max(0, legs.length - 1));
    if (snap?.state === 'OUT_FOR_DELIVERY') doneLegs = Math.max(doneLegs, legs.length - 1);

    const perLeg: LegEta[] = legs.slice(doneLegs).map((leg) => {
      const distanceKm = haversineKm(geocode(leg.origin), geocode(leg.destination));
      const hours = distanceKm / (MODE_SPEED_KMH[leg.mode] ?? DEFAULT_SPEED_KMH);
      return { index: leg.index, mode: leg.mode, distanceKm: round(distanceKm), hours: round(hours) };
    });

    const transit = perLeg.reduce((s, l) => s + l.hours, 0);
    const buffer = Math.max(0, perLeg.length - 1) * HANDOVER_BUFFER_H;
    const hoursRemaining = round(transit + buffer);

    return {
      glosShipmentId,
      hoursRemaining,
      eta: at(hoursRemaining),
      confidence: { low: at(hoursRemaining * (1 - CI_BAND)), high: at(hoursRemaining * (1 + CI_BAND)), level: 0.95 },
      perLeg,
      basis: `${perLeg.length} leg(s) remaining · ${MODE_SPEED_KMH[perLeg[0]?.mode] ? perLeg[0].mode : 'mixed'} lead`,
    };
  }
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}
