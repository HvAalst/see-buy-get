import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { SubjectRole } from './reputation.types';

interface TransactionRecord {
  glosShipmentId: string;
  shipperDid: string;
  carrierDid: string;
  complete: boolean;
  ratedBy: Set<string>;
}

/**
 * TransactionRegistry (M5-021). Event-sourced record of who participated in a transaction and
 * whether it completed — the anchor that makes ratings verifiable (only a verified participant
 * in a delivered transaction can rate, once). Populated from `match.confirmed` + `tracking.delivered`.
 */
@Injectable()
export class TransactionRegistry implements OnModuleInit {
  private readonly txns = new Map<string, TransactionRecord>();

  constructor(private readonly events: EventBus) {}

  onModuleInit(): void {
    this.events.subscribe<{ glosShipmentId: string; payerDid: string; carrierDid: string }>(GlosEvent.Match.Confirmed, (e) => {
      this.register(e.payload.glosShipmentId, e.payload.payerDid, e.payload.carrierDid);
    });
    this.events.subscribe<{ glosShipmentId: string }>(GlosEvent.Tracking.Delivered, (e) => {
      const t = this.txns.get(e.payload.glosShipmentId);
      if (t) t.complete = true;
    });
  }

  register(glosShipmentId: string, shipperDid: string, carrierDid: string): void {
    if (!this.txns.has(glosShipmentId)) {
      this.txns.set(glosShipmentId, { glosShipmentId, shipperDid, carrierDid, complete: false, ratedBy: new Set() });
    }
  }

  markComplete(glosShipmentId: string): void {
    const t = this.txns.get(glosShipmentId);
    if (t) t.complete = true;
  }

  isComplete(glosShipmentId: string): boolean {
    return Boolean(this.txns.get(glosShipmentId)?.complete);
  }

  participantRole(glosShipmentId: string, did: string): SubjectRole | null {
    const t = this.txns.get(glosShipmentId);
    if (!t) return null;
    if (t.shipperDid === did) return 'shipper';
    if (t.carrierDid === did) return 'carrier';
    return null;
  }

  /** The party being rated when `did` rates: the counterparty + their role. */
  counterparty(glosShipmentId: string, did: string): { did: string; role: SubjectRole } | null {
    const t = this.txns.get(glosShipmentId);
    if (!t) return null;
    if (t.shipperDid === did) return { did: t.carrierDid, role: 'carrier' };
    if (t.carrierDid === did) return { did: t.shipperDid, role: 'shipper' };
    return null;
  }

  hasRated(glosShipmentId: string, raterDid: string): boolean {
    return Boolean(this.txns.get(glosShipmentId)?.ratedBy.has(raterDid));
  }

  markRated(glosShipmentId: string, raterDid: string): void {
    this.txns.get(glosShipmentId)?.ratedBy.add(raterDid);
  }
}
