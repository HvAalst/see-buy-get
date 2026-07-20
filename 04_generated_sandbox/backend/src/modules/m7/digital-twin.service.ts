import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { ShipmentState, TwinEdge, TwinNode } from './twin.types';

export interface PlannedLeg {
  index: number;
  mode: string;
  origin: string;
  destination: string;
  handover: { locationId: string; geofence?: { center: { lat: number; lng: number } } };
}

const STATE_BY_EVENT: Record<string, ShipmentState> = {
  [GlosEvent.Tracking.PickupOk]: 'picked_up',
  [GlosEvent.Tracking.HandoverOk]: 'handed_over',
  [GlosEvent.Tracking.Delivered]: 'delivered',
};

const haversineKm = (a: { lat: number; lng: number }, b: { lat: number; lng: number }): number => {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

/**
 * DigitalTwinService (M7-010/011/012). A live property graph of the network, updated in real time
 * from M2 (shipment/leg/location nodes), M3 (assigned-to edges), and M4 (state transitions). Backs
 * geospatial/temporal queries and the control-tower heatmap.
 */
@Injectable()
export class DigitalTwinService implements OnModuleInit {
  private readonly nodes = new Map<string, TwinNode>();
  private readonly edges: TwinEdge[] = [];
  private readonly legsByShipment = new Map<string, PlannedLeg[]>();

  constructor(private readonly events: EventBus) {}

  onModuleInit(): void {
    this.events.subscribe<{ glosShipmentId: string }>(GlosEvent.Shipment.Created, (e) => this.upsertShipment(e.payload.glosShipmentId, 'created'));
    this.events.subscribe<{ glosShipmentId: string; legs: PlannedLeg[] }>(GlosEvent.Shipment.LegDecomposed, (e) => this.onLegDecomposed(e.payload.glosShipmentId, e.payload.legs));
    this.events.subscribe<{ glosShipmentId: string; carrierDid: string; payerDid?: string }>(GlosEvent.Match.Confirmed, (e) => this.onMatch(e.payload.glosShipmentId, e.payload.carrierDid, e.payload.payerDid));
    for (const topic of [GlosEvent.Tracking.PickupOk, GlosEvent.Tracking.HandoverOk, GlosEvent.Tracking.Delivered]) {
      this.events.subscribe<{ glosShipmentId: string }>(topic, (e) => this.upsertShipment(e.payload.glosShipmentId, STATE_BY_EVENT[topic]));
    }
    this.events.subscribe<{ glosShipmentId: string }>(GlosEvent.Tracking.ExceptionRaised, (e) => this.flagException(e.payload.glosShipmentId));
  }

  /**
   * Graduation hook: upsert a shipment node from an EXTERNAL edition (e.g. PUDO Light) that doesn't
   * flow through the M2 e-waybill. Sets location + state + a source tag directly so the parcel shows
   * on the control tower alongside full freight — one pane of glass across editions.
   */
  upsertExternal(input: { glosShipmentId: string; state?: ShipmentState; location?: { lat: number; lng: number }; props?: Record<string, unknown> }): TwinNode {
    const id = `shipment:${input.glosShipmentId}`;
    const node = this.nodes.get(id) ?? { id, type: 'shipment' as const, props: { glosShipmentId: input.glosShipmentId }, updatedAt: '' };
    if (input.state) node.state = input.state;
    if (input.location) node.location = input.location;
    node.props = { ...node.props, ...input.props };
    node.updatedAt = new Date().toISOString();
    this.nodes.set(id, node);
    return node;
  }

  // --- queries ---

  shipment(glosShipmentId: string): TwinNode | undefined {
    return this.nodes.get(`shipment:${glosShipmentId}`);
  }

  legs(glosShipmentId: string): PlannedLeg[] {
    return this.legsByShipment.get(glosShipmentId) ?? [];
  }

  shipments(): TwinNode[] {
    return [...this.nodes.values()].filter((n) => n.type === 'shipment');
  }

  edgesFrom(nodeId: string): TwinEdge[] {
    return this.edges.filter((e) => e.from === nodeId);
  }

  /** Geospatial + temporal query (M7-011): shipments within radius of a point, optional filters. */
  query(opts: { center?: { lat: number; lng: number }; radiusKm?: number; state?: ShipmentState; isLate?: (id: string) => boolean }): TwinNode[] {
    return this.shipments().filter((n) => {
      if (opts.state && n.state !== opts.state) return false;
      if (opts.center && opts.radiusKm != null) {
        if (!n.location || haversineKm(n.location, opts.center) > opts.radiusKm) return false;
      }
      if (opts.isLate && !opts.isLate(String(n.props.glosShipmentId))) return false;
      return true;
    });
  }

  /** Density heatmap (M7-012): shipment + exception counts bucketed by coarse region. */
  heatmap(precision = 1): Array<{ cell: string; count: number; exceptions: number }> {
    const cells = new Map<string, { count: number; exceptions: number }>();
    for (const n of this.shipments()) {
      if (!n.location) continue;
      const cell = `${n.location.lat.toFixed(precision)},${n.location.lng.toFixed(precision)}`;
      const c = cells.get(cell) ?? { count: 0, exceptions: 0 };
      c.count += 1;
      if (n.props.exception) c.exceptions += 1;
      cells.set(cell, c);
    }
    return [...cells.entries()].map(([cell, v]) => ({ cell, ...v }));
  }

  // --- mutations (from events) ---

  private upsertShipment(glosShipmentId: string, state: ShipmentState): void {
    const id = `shipment:${glosShipmentId}`;
    const node = this.nodes.get(id) ?? { id, type: 'shipment' as const, props: { glosShipmentId }, updatedAt: '' };
    node.state = state;
    node.updatedAt = new Date().toISOString();
    // Locate the shipment at its current leg's handover point as it advances.
    const legs = this.legsByShipment.get(glosShipmentId);
    if (legs?.length) {
      const idx = state === 'delivered' ? legs.length - 1 : state === 'handed_over' ? Math.min(1, legs.length - 1) : 0;
      node.location = legs[idx]?.handover?.geofence?.center ?? node.location;
    }
    this.nodes.set(id, node);
  }

  private onLegDecomposed(glosShipmentId: string, legs: PlannedLeg[]): void {
    this.legsByShipment.set(glosShipmentId, legs);
    this.upsertShipment(glosShipmentId, 'planned');
    const shipmentId = `shipment:${glosShipmentId}`;
    for (const leg of legs) {
      const legId = `leg:${glosShipmentId}:${leg.index}`;
      this.nodes.set(legId, { id: legId, type: 'leg', label: `${leg.origin}→${leg.destination}`, location: leg.handover?.geofence?.center, props: { mode: leg.mode }, updatedAt: new Date().toISOString() });
      this.edges.push({ from: shipmentId, to: legId, type: 'has-leg' });
      if (leg.handover?.locationId) {
        const locId = `location:${leg.handover.locationId}`;
        if (!this.nodes.has(locId)) this.nodes.set(locId, { id: locId, type: 'location', location: leg.handover.geofence?.center, props: {}, updatedAt: new Date().toISOString() });
        this.edges.push({ from: legId, to: locId, type: 'at-location' });
      }
    }
  }

  private onMatch(glosShipmentId: string, carrierDid: string, payerDid?: string): void {
    const carrierId = `carrier:${carrierDid}`;
    if (!this.nodes.has(carrierId)) this.nodes.set(carrierId, { id: carrierId, type: 'carrier', props: { did: carrierDid }, updatedAt: new Date().toISOString() });
    this.edges.push({ from: carrierId, to: `shipment:${glosShipmentId}`, type: 'assigned-to' });
    this.upsertShipment(glosShipmentId, 'assigned');
    const node = this.shipment(glosShipmentId);
    if (node && payerDid) node.props.payerDid = payerDid;
  }

  private flagException(glosShipmentId: string): void {
    const node = this.shipment(glosShipmentId);
    if (node) {
      node.props.exception = true;
      node.state = 'exception';
      node.updatedAt = new Date().toISOString();
    }
  }
}
