import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { TrackingService } from './tracking.service';
import { TrackingContextService } from './tracking-context.service';
import { geocode, haversineKm } from './geo';

export interface Geofence {
  id: string;
  name: string;
  center: { lat: number; lng: number };
  radiusM: number;
  kind: 'hub' | 'port' | 'airport' | 'customer' | 'custom';
}

export interface GeofenceCrossing {
  geofenceId: string;
  name: string;
  type: 'GEOFENCE_ENTER' | 'GEOFENCE_EXIT';
}

/**
 * GeofenceService (VTT-045). A global geofence library (ports/airports/hubs) plus per-shipment
 * geofences from the planned route, and custom geofences. A position update is intersected against
 * every relevant geofence; an entry/exit transition auto-generates a GEOFENCE_ENTER/EXIT tracking
 * event (which feeds the timeline + exception engine + SSE milestone signals).
 */
@Injectable()
export class GeofenceService {
  /** Global named geofences (seeded with major nodes; extend via addGeofence). */
  private readonly global = new Map<string, Geofence>();
  /** Per shipment+geofence "currently inside" flag, to detect transitions. */
  private readonly inside = new Map<string, boolean>();

  constructor(
    private readonly tracking: TrackingService,
    private readonly context: TrackingContextService,
  ) {
    for (const name of ['Rotterdam', 'Singapore', 'Shanghai', 'Suez', 'Dubai']) {
      this.global.set(name, { id: `gf-${name}`, name, center: geocode(name), radiusM: 25_000, kind: 'hub' });
    }
  }

  addGeofence(input: { name: string; center?: { lat: number; lng: number }; radiusM?: number; kind?: Geofence['kind'] }): Geofence {
    const gf: Geofence = { id: `gf-${randomBytes(5).toString('hex')}`, name: input.name, center: input.center ?? geocode(input.name), radiusM: input.radiusM ?? 5_000, kind: input.kind ?? 'custom' };
    this.global.set(gf.id, gf);
    return gf;
  }

  library(): Geofence[] {
    return [...this.global.values()];
  }

  /** Intersect a GPS position against the shipment's geofences; emit ENTER/EXIT on transitions. */
  evaluate(glosShipmentId: string, position: { lat: number; lng: number }): GeofenceCrossing[] {
    const crossings: GeofenceCrossing[] = [];
    for (const gf of this.geofencesFor(glosShipmentId)) {
      const key = `${glosShipmentId}:${gf.id}`;
      const nowInside = haversineKm(position, gf.center) * 1000 <= gf.radiusM;
      const wasInside = this.inside.get(key) ?? false;
      if (nowInside === wasInside) continue;
      this.inside.set(key, nowInside);
      const type = nowInside ? 'GEOFENCE_ENTER' : 'GEOFENCE_EXIT';
      this.tracking.ingest({ glosShipmentId, type, source: 'api', location: position, payload: { geofenceId: gf.id, name: gf.name } });
      crossings.push({ geofenceId: gf.id, name: gf.name, type });
    }
    return crossings;
  }

  private geofencesFor(glosShipmentId: string): Geofence[] {
    const ctx = this.context.get(glosShipmentId);
    const route: Geofence[] = (ctx?.legs ?? [])
      .map((leg) => leg.handover?.geofence)
      .filter((g): g is NonNullable<typeof g> => !!g)
      .map((g) => ({ id: g.id, name: g.id, center: g.center, radiusM: g.radiusM, kind: 'hub' as const }));
    return [...route, ...this.global.values()];
  }
}
