import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { MAX_HOOK_ATTEMPTS, tryDelivery } from '../../foundation/outbound/hook-delivery';
import { ParcelService } from './parcel.service';
import { VendorService } from './vendor.service';

/** How often the outbox is drained. A store waiting on "ready for pickup" wants seconds, not minutes. */
const DRAIN_MS = Number(process.env.GLOS_CALLBACK_DRAIN_MS ?? 15_000);

/** Give up after this many tries — about a day of backoff — and say so in the outbox. */
export const MAX_CALLBACK_ATTEMPTS = MAX_HOOK_ATTEMPTS;

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
 * VendorCallbackService (PUDO → e-commerce). POSTS HMAC-signed status callbacks to the originating
 * vendor as an inbound parcel hits its milestones — ready_for_pickup (so the store notifies the
 * buyer), collected (order closed), disputed. This is the outbound half of the click-and-collect
 * integration; GLOS orchestrates logistics and reports status, but never touches the money.
 */
@Injectable()
export class VendorCallbackService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(VendorCallbackService.name);
  private timer?: NodeJS.Timeout;
  private draining = false;

  constructor(
    private readonly events: EventBus,
    private readonly parcels: ParcelService,
    private readonly vendors: VendorService,
  ) {}

  onModuleInit(): void {
    for (const topic of Object.keys(EVENT_STATUS)) {
      this.events.subscribe<{ parcelId: string }>(topic, (e) => this.relay(topic, e.payload.parcelId));
    }
    this.timer = setInterval(() => void this.drain(), DRAIN_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * SEND THE ONES THAT ARE DUE — the half this service did not have.
   *
   * Until 2026-09-28 `relay` built a callback, signed it, pushed it to an array and stopped. Every
   * merchant integration on this network has been receiving nothing, and from the inside it looked
   * perfect: the tests passed, the outbox filled, the signature was right. The documentation was at
   * least honest about it ("recorded, not yet delivered over HTTP"), which is how it survived.
   *
   * Serial, and never throws: one store's dead endpoint must not hold up another's.
   */
  async drain(now: number = Date.now()): Promise<{ sent: number; failed: number }> {
    if (this.draining) return { sent: 0, failed: 0 };
    this.draining = true;
    let sent = 0;
    let failed = 0;
    try {
      for (const callback of this.vendors.callbacksDue(now)) {
        // The exact signed body, the same delivery id, backed off and given up as every hook is (hook-delivery.ts).
        const after = await tryDelivery(callback, now);
        if (after.state === 'delivered') sent += 1;
        else if (after.state === 'failed') failed += 1;
        this.vendors.recordCallback(after);
      }
    } catch (err) {
      this.logger.warn(`callback drain failed: ${(err as Error).message}`);
    } finally {
      this.draining = false;
    }
    if (sent || failed) this.logger.log(`store callbacks: ${sent} delivered, ${failed} given up on`);
    return { sent, failed };
  }

  private relay(topic: string, parcelId: string): void {
    let parcel;
    try {
      parcel = this.parcels.get(parcelId);
    } catch {
      return;
    }
    if (parcel.direction !== 'inbound' || !parcel.vendorId || !this.vendors.has(parcel.vendorId)) return;
    // The code rides along unless the store has said its buyers get it from the Send app instead.
    const carriesCode = this.vendors.get(parcel.vendorId).callbackCarriesCode !== false;
    this.vendors.notify(parcel.vendorId, EVENT_STATUS[topic], {
      parcelId,
      externalOrderId: parcel.externalOrderId,
      status: parcel.status,
      ...(carriesCode ? { collectionCode: parcel.collectionCode } : {}),
      binSlot: parcel.binSlot,
      disputeReason: parcel.disputeReason,
    });
  }
}
