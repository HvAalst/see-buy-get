import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { ParcelService } from './parcel.service';
import { VendorService } from './vendor.service';

const EVENT_STATUS: Record<string, string> = {
  [GlosEvent.Pudo.ParcelPaid]: 'parcel_paid', // vendor prepaid → drop-off PUDO confirmation, label unblocked
  [GlosEvent.Pudo.ParcelReadyForPickup]: 'ready_for_pickup',
  // A reissued code is still a "ready for pickup" as far as the store is concerned — same status, new
  // code. relay() reads the parcel fresh, so the callback carries the ROTATED code, which is exactly
  // what the store needs to re-tell a buyer who is standing at the counter unable to collect.
  [GlosEvent.Pudo.ParcelReleaseCodeReissued]: 'ready_for_pickup',
  [GlosEvent.Pudo.ParcelDelivered]: 'collected',
  [GlosEvent.Pudo.ParcelDisputed]: 'disputed',
};

/**
 * VendorCallbackService (PUDO → e-commerce). Pushes HMAC-signed status callbacks to the originating
 * vendor as an inbound parcel hits its milestones — ready_for_pickup (so the store notifies the
 * buyer), collected (order closed), disputed. This is the outbound half of the click-and-collect
 * integration; GLOS orchestrates logistics and reports status, but never touches the money.
 */
@Injectable()
export class VendorCallbackService implements OnModuleInit {
  constructor(
    private readonly events: EventBus,
    private readonly parcels: ParcelService,
    private readonly vendors: VendorService,
  ) {}

  onModuleInit(): void {
    for (const topic of Object.keys(EVENT_STATUS)) {
      this.events.subscribe<{ parcelId: string }>(topic, (e) => this.relay(topic, e.payload.parcelId));
    }
  }

  private relay(topic: string, parcelId: string): void {
    let parcel;
    try {
      parcel = this.parcels.get(parcelId);
    } catch {
      return;
    }
    if (parcel.direction !== 'inbound' || !parcel.vendorId || !this.vendors.has(parcel.vendorId)) return;
    this.vendors.notify(parcel.vendorId, EVENT_STATUS[topic], {
      parcelId,
      externalOrderId: parcel.externalOrderId,
      status: parcel.status,
      collectionCode: parcel.collectionCode,
      binSlot: parcel.binSlot,
      disputeReason: parcel.disputeReason,
    });
  }
}
