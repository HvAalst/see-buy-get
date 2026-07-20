import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { DigitalTwinService } from '../m7/digital-twin.service';
import { TrackingService } from '../m4/tracking.service';
import { TrackingContextService } from '../m4/tracking-context.service';
import { PlannedLeg, PlannedMilestone } from '../m4/tracking.types';
import { AgentService } from './agent.service';
import { ParcelService } from './parcel.service';
import { MdpService } from './mdp.service';

/**
 * GraduationService (PUDO ↔ M4 + M7). Promotes every PUDO Light parcel onto the GLOS visibility +
 * orchestration spine so the network is ONE pane of glass: emerging-market PUDO last-mile shows up in
 * the M7 control tower (digital twin) and the M4 tracking timeline alongside enterprise freight,
 * reusing all of that machinery. It maps the PUDO scan lifecycle onto canonical tracking states —
 * accept→PICKUP, hand-to-bus→HANDOVER, ready→OUT_FOR_DELIVERY, pickup→DELIVERED (with proof). PUDO is
 * pre-paid, so it deliberately does NOT emit `match.confirmed` — no SSE escrow is created.
 */
@Injectable()
export class GraduationService implements OnModuleInit {
  private readonly logger = new Logger(GraduationService.name);

  constructor(
    private readonly events: EventBus,
    private readonly twin: DigitalTwinService,
    private readonly tracking: TrackingService,
    private readonly context: TrackingContextService,
    private readonly agents: AgentService,
    private readonly parcels: ParcelService,
    private readonly mdps: MdpService,
  ) {}

  onModuleInit(): void {
    this.events.subscribe<{ parcelId: string; agentDid: string; destZone: string }>(GlosEvent.Pudo.ParcelAccepted, (e) => this.onAccepted(e.payload));
    this.events.subscribe<{ parcelId: string }>(GlosEvent.Pudo.ParcelHandedToBus, (e) => this.scan(e.payload.parcelId, 'HANDOVER'));
    this.events.subscribe<{ parcelId: string }>(GlosEvent.Pudo.ParcelReadyForPickup, (e) => this.scan(e.payload.parcelId, 'OUT_FOR_DELIVERY'));
    this.events.subscribe<{ parcelId: string }>(GlosEvent.Pudo.ParcelDelivered, (e) => this.onDelivered(e.payload.parcelId));
    this.events.subscribe<{ parcelId: string }>(GlosEvent.Pudo.ParcelDisputed, (e) => { this.twin.upsertExternal({ glosShipmentId: e.payload.parcelId, state: 'exception', props: { dispute: true } }); });
    // Multi-hop visibility: a parcel sorted at an MDP shows as in-transit at that hub on the twin.
    this.events.subscribe<{ parcelId: string; mdpId: string; toteCode: string }>(GlosEvent.Pudo.ParcelSorted, (e) => this.onSorted(e.payload));
  }

  private onSorted(payload: { parcelId: string; mdpId: string; toteCode: string }): void {
    try {
      const mdp = this.mdps.require(payload.mdpId);
      this.twin.upsertExternal({ glosShipmentId: payload.parcelId, state: 'in_transit', location: mdp.location, props: { source: 'pudo', hub: mdp.name, bag: payload.toteCode } });
    } catch (err) {
      this.logger.warn(`PUDO→GLOS sort bridge failed for ${payload.parcelId}: ${String(err)}`);
    }
  }

  private onAccepted(payload: { parcelId: string; agentDid: string; destZone: string }): void {
    try {
      const agent = this.agents.get(payload.agentDid);
      // Register a minimal one-leg route so the M4 timeline + M7 twin have a location to place it.
      const legs: PlannedLeg[] = [{ index: 0, mode: 'courier', origin: agent.zone, destination: payload.destZone, handover: { locationId: `PUDO-${agent.zone}`, geofence: { id: `gf-${agent.agentId}`, center: agent.location, radiusM: 500 }, verification: 'scan' } }];
      const milestones: PlannedMilestone[] = [{ id: 'm-pickup', name: 'PICKUP', legIndex: 0 }, { id: 'm-delivery', name: 'DELIVERY', legIndex: 0 }];
      this.context.register(payload.parcelId, legs, milestones);
      this.twin.upsertExternal({ glosShipmentId: payload.parcelId, state: 'picked_up', location: agent.location, props: { source: 'pudo', shop: agent.shopName, destZone: payload.destZone } });
      this.tracking.ingest({ glosShipmentId: payload.parcelId, type: 'PICKUP', source: 'api', location: agent.location, carrierDid: payload.agentDid });
    } catch (err) {
      this.logger.warn(`PUDO→GLOS accept bridge failed for ${payload.parcelId}: ${String(err)}`);
    }
  }

  private scan(parcelId: string, type: 'HANDOVER' | 'OUT_FOR_DELIVERY'): void {
    try {
      this.tracking.ingest({ glosShipmentId: parcelId, type, source: 'api' });
    } catch (err) {
      this.logger.warn(`PUDO→GLOS ${type} bridge failed for ${parcelId}: ${String(err)}`);
    }
  }

  private onDelivered(parcelId: string): void {
    try {
      const parcel = this.parcels.get(parcelId);
      // Carry a proof-of-delivery so M4 doesn't flag a delivery-without-acceptance exception.
      this.tracking.submitDelivery(parcelId, { type: 'photo', ref: parcel.deliveredPhotoRef || parcel.dropoffPhotoRef || `pudo:${parcelId}`, capturedAt: new Date().toISOString() });
    } catch (err) {
      this.logger.warn(`PUDO→GLOS delivery bridge failed for ${parcelId}: ${String(err)}`);
    }
  }
}
