import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import { ShipmentService } from '../m2/shipment.service';
import { DigitalTwinService } from './digital-twin.service';
import { GreenerPlan, LegFootprint, NetworkCarbon, ShipmentFootprint } from './carbon.types';

// Indicative well-to-wheel emission factors, gCO2e per tonne-km (industry ballpark figures).
const EMISSION_FACTORS: Record<string, number> = { air: 500, courier: 150, road: 62, multimodal: 60, rail: 22, ocean: 8 };
const DEFAULT_FACTOR = 100;
// Greener modal-shift map: the lower-carbon mode a leg could plausibly shift to.
const GREENER_MODE: Record<string, string> = { air: 'ocean', road: 'rail', multimodal: 'rail' };

/** Deterministic geocode — mirrors M2's leg geocoder so distances line up with the planned route. */
function geocode(name: string): { lat: number; lng: number } {
  const hash = createHash('sha256').update(name).digest();
  const lat = (hash.readUInt16BE(0) / 65535) * 120 - 60;
  const lng = (hash.readUInt16BE(2) / 65535) * 360 - 180;
  return { lat, lng };
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

const round = (n: number) => Math.round(n * 10) / 10;

/**
 * CarbonService (M7-042). The control tower's sustainability lens: estimates per-leg and per-shipment
 * CO2e from mode × distance × weight, proposes a greener modal-shift alternative (with the carbon
 * saving), and rolls the footprint up across the live network for the dashboard.
 */
@Injectable()
export class CarbonService {
  constructor(
    private readonly twin: DigitalTwinService,
    private readonly shipments: ShipmentService,
  ) {}

  /** Per-leg + total footprint for one shipment, plus a greener-alternative comparison. */
  footprint(glosShipmentId: string): ShipmentFootprint {
    const shipment = this.shipments.require(glosShipmentId);
    const weightKg = shipment.ewaybill.packaging.totalWeightKg;
    const weightT = weightKg / 1000;

    const legs: LegFootprint[] = shipment.legs.map((leg) => {
      const distanceKm = haversineKm(geocode(leg.origin), geocode(leg.destination));
      const kgCo2 = (EMISSION_FACTORS[leg.mode] ?? DEFAULT_FACTOR) * weightT * (distanceKm / 1000);
      return { index: leg.index, mode: leg.mode, origin: leg.origin, destination: leg.destination, distanceKm: round(distanceKm), kgCo2: round(kgCo2) };
    });

    const totalKgCo2 = round(legs.reduce((s, l) => s + l.kgCo2, 0));
    const totalDistanceKm = round(legs.reduce((s, l) => s + l.distanceKm, 0));
    const intensity = weightT > 0 && totalDistanceKm > 0 ? Math.round((totalKgCo2 * 1000) / (weightT * totalDistanceKm)) : 0;

    return {
      glosShipmentId,
      weightKg,
      totalDistanceKm,
      totalKgCo2,
      intensityGPerTonneKm: intensity,
      legs,
      greener: this.greener(legs, weightT, totalKgCo2),
    };
  }

  /** Network-wide roll-up across the live twin (shipments that have a digitized plan). */
  network(): NetworkCarbon {
    const footprints: ShipmentFootprint[] = [];
    for (const node of this.twin.shipments()) {
      const id = String(node.props.glosShipmentId);
      try {
        const fp = this.footprint(id);
        if (fp.legs.length) footprints.push(fp);
      } catch {
        // shipment not retained in M2 (e.g. ephemeral) — skip
      }
    }

    const byMode: Record<string, number> = {};
    for (const fp of footprints) for (const leg of fp.legs) byMode[leg.mode] = round((byMode[leg.mode] ?? 0) + leg.kgCo2);

    const totalKgCo2 = round(footprints.reduce((s, f) => s + f.totalKgCo2, 0));
    const potentialSavingKgCo2 = round(footprints.reduce((s, f) => s + f.greener.savingKgCo2, 0));
    const topEmitters = [...footprints].sort((a, b) => b.totalKgCo2 - a.totalKgCo2).slice(0, 5);

    return { shipments: footprints.length, totalKgCo2, potentialSavingKgCo2, byMode, topEmitters, at: new Date().toISOString() };
  }

  // --- internals ---

  private greener(legs: LegFootprint[], weightT: number, currentTotal: number): GreenerPlan {
    const shifted: LegFootprint[] = legs.map((leg) => {
      const altMode = GREENER_MODE[leg.mode] ?? leg.mode;
      const kgCo2 = (EMISSION_FACTORS[altMode] ?? DEFAULT_FACTOR) * weightT * (leg.distanceKm / 1000);
      return { ...leg, mode: altMode, kgCo2: round(kgCo2) };
    });
    const totalKgCo2 = round(shifted.reduce((s, l) => s + l.kgCo2, 0));
    const savingKgCo2 = round(currentTotal - totalKgCo2);
    const savingPct = currentTotal > 0 ? Math.round((savingKgCo2 / currentTotal) * 100) : 0;
    return { legs: shifted, totalKgCo2, savingKgCo2, savingPct, note: 'Shift air→ocean and road/multimodal→rail where feasible (lower carbon, slower transit).' };
  }
}
