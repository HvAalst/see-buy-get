import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { ShipmentService } from '../m2/shipment.service';
import { LegDecompositionService } from '../m2/leg-decomposition.service';
import { AvailabilityService } from './availability.service';
import { PricingService } from './pricing.service';
import { AvailabilityForecast, DemandInput, PreBooking } from './matching.types';

const MAX_SAMPLES = 200;

/**
 * PredictionService (M3-022). Builds a lightweight history of supply per zone (sampled whenever
 * carriers heartbeat) and forecasts future capacity with a probability, so shippers can **pre-book**
 * against predicted availability at an indicative price (binding on confirmation).
 */
@Injectable()
export class PredictionService {
  private readonly history = new Map<string, number[]>(); // zone → recent available-counts
  private readonly preBookings = new Map<string, PreBooking>();

  constructor(
    private readonly availability: AvailabilityService,
    private readonly shipments: ShipmentService,
    private readonly legs: LegDecompositionService,
    private readonly pricing: PricingService,
  ) {}

  /** Sample current supply per zone — call on each availability heartbeat to grow the history. */
  observe(): void {
    const counts = new Map<string, number>();
    for (const entry of this.availability.available()) counts.set(entry.zone, (counts.get(entry.zone) ?? 0) + 1);
    // Record a sample for every zone we've ever seen, so quiet zones accrue zeros too.
    const zones = new Set<string>([...this.history.keys(), ...counts.keys()]);
    for (const zone of zones) this.push(zone, counts.get(zone) ?? 0);
  }

  forecast(zone: string): AvailabilityForecast {
    const samples = this.history.get(zone) ?? [];
    const n = samples.length;
    const expected = n ? samples.reduce((a, b) => a + b, 0) / n : 0;
    const probability = n ? samples.filter((c) => c >= 1).length / n : 0;
    const confidence = n >= 10 ? 'high' : n >= 4 ? 'medium' : 'low';
    return { zone, samples: n, expectedAvailable: Math.round(expected * 10) / 10, probabilityHasCapacity: Math.round(probability * 100) / 100, confidence };
  }

  /** Pre-book a (decomposed) shipment against predicted capacity at an indicative price. */
  preBook(demand: DemandInput): PreBooking {
    const shipment = this.shipments.require(demand.glosShipmentId);
    const zone = demand.zone ?? this.availability.get(demand.payerDid)?.zone ?? 'unknown';
    const forecast = this.forecast(zone);
    const jrv = this.legs.buildJobRequirementVector(shipment);
    const expectedSupply = Math.max(1, Math.round(forecast.expectedAvailable));
    const indicativePrice = this.pricing.price(shipment.ewaybill.packaging.totalWeightKg, Math.max(1, jrv.perLeg.length), expectedSupply, { currency: demand.currency, tier: demand.slo?.tier, indicative: true });

    const preBooking: PreBooking = { preBookingId: `pb_${randomBytes(8).toString('hex')}`, glosShipmentId: demand.glosShipmentId, zone, forecast, indicativePrice, createdAt: new Date().toISOString() };
    this.preBookings.set(preBooking.preBookingId, preBooking);
    return preBooking;
  }

  getPreBooking(id: string): PreBooking | undefined {
    return this.preBookings.get(id);
  }

  private push(zone: string, count: number): void {
    const arr = this.history.get(zone) ?? [];
    arr.push(count);
    if (arr.length > MAX_SAMPLES) arr.shift();
    this.history.set(zone, arr);
  }
}
