// M7-042 — sustainability / carbon lens. Per-leg CO2e estimated from transport mode, distance and
// weight (tonne-km × emission factor), with a "greener alternative" modal-shift comparison.

export interface LegFootprint {
  index: number;
  mode: string;
  origin: string;
  destination: string;
  distanceKm: number;
  kgCo2: number;
}

export interface GreenerPlan {
  legs: LegFootprint[];
  totalKgCo2: number;
  savingKgCo2: number;
  savingPct: number;
  note: string;
}

export interface ShipmentFootprint {
  glosShipmentId: string;
  weightKg: number;
  totalDistanceKm: number;
  totalKgCo2: number;
  /** Average carbon intensity (gCO2e per tonne-km). */
  intensityGPerTonneKm: number;
  legs: LegFootprint[];
  greener: GreenerPlan;
}

export interface NetworkCarbon {
  shipments: number;
  totalKgCo2: number;
  /** Potential saving if every shipment took its greener alternative. */
  potentialSavingKgCo2: number;
  byMode: Record<string, number>;
  topEmitters: ShipmentFootprint[];
  at: string;
}
