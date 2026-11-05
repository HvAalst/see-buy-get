import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { AgentService } from './agent.service';
import { DropOffHold, DropOffHoldService } from './drop-off-hold.service';
import { NotificationService } from './notification.service';
import { ParcelService } from './parcel.service';
import { VendorService } from './vendor.service';

const SWEEP_MS = 10 * 60 * 1000;

/**
 * 2026-11-05 — TOLD BEFORE THE PLACE ENDS (the owner: "the store or sender is told at 12, 6, and 3 hours before time ends").
 *
 * A booking holds a place at its drop-off shop for 24 hours (DropOffHoldService). This sweep tells whoever booked it — the
 * store, the business, or the person — in the bell, never a text: at 12, 6 and 3 hours left, and once when it has ended.
 * Ten minutes apart, so a notice is at most ten minutes late; a sweep that slept through two marks sends the nearer one.
 *
 * A booking that is no longer waiting to be handed in (taken in, cancelled, lost) is told nothing, and its place is let go.
 */
@Injectable()
export class DropOffHoldSweeper implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DropOffHoldSweeper.name);
  private timer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly holds: DropOffHoldService,
    private readonly parcels: ParcelService,
    private readonly agents: AgentService,
    private readonly vendors: VendorService,
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  onApplicationBootstrap(): void {
    void this.sweep().catch(() => undefined);
    this.timer = setInterval(() => void this.sweep().catch((err: Error) => this.logger.warn(`the drop-off reminder did not run: ${err.message}`)), SWEEP_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Returns how many notices went out. Callable from a test with a fixed clock. */
  async sweep(now: number = Date.now()): Promise<number> {
    const due = this.holds.due(now);
    let sent = 0;
    for (const { hold, hoursLeft } of due.warn) if (await this.tell(hold, hoursLeft, now)) sent += 1;
    for (const hold of due.lapsed) if (await this.tell(hold, 0, now)) sent += 1;
    return sent;
  }

  private async tell(hold: DropOffHold, hoursLeft: number, now: number): Promise<boolean> {
    let parcel;
    try {
      parcel = this.parcels.get(hold.parcelId);
    } catch {
      this.holds.end(hold.parcelId, now);
      return false;
    }
    // Handed in, called off, lost: nothing to remind anybody of, and no place to keep.
    if (parcel.status !== 'Created') {
      this.holds.end(hold.parcelId, now);
      return false;
    }
    if (!this.notifications) return false;
    const shop = this.agents.find(hold.agentDid)?.shopName ?? 'the shop';
    const to = this.recipientOf(hold);
    if (!to) return false;
    const what = 'vendorId' in hold.bookedBy ? (parcel.externalOrderId ? `Order ${parcel.externalOrderId}` : `Parcel ${parcel.parcelId}`) : 'Your parcel';
    // The clock never cancels a booking (the owner: "package has to go anyway"); calling it off stays the booker's choice.
    const refund = 'vendorId' in hold.bookedBy ? ' You can also cancel it for a full refund.' : ' You can also cancel it.';
    const ended = hoursLeft === 0;
    try {
      await this.notifications.notify(to.did, {
        kind: 'drop_off_hold',
        title: ended ? `${what}: the place held at ${shop} has ended` : `${what}: hand it in at ${shop} within ${hoursLeft} ${hoursLeft === 1 ? 'hour' : 'hours'}`,
        body: ended
          ? `It is still booked, and it still goes: hand it in there, and it is taken in as soon as the shop has room.${refund}`
          : `A place on the shelf at ${shop} is held for it until then. After that it still goes: it is taken in as soon as the shop has room.${refund}`,
        link: to.link,
        // One a mark: the 12-, 6- and 3-hour notices and the end are each their own, never stacked twice.
        tag: `drop-off-hold:${hold.parcelId}:${ended ? 'ended' : hoursLeft}`,
        data: { parcelId: hold.parcelId, agentDid: hold.agentDid, until: hold.until },
      });
      return true;
    } catch (err) {
      this.logger.warn(`drop-off reminder not sent for ${hold.parcelId}: ${(err as Error).message}`);
      return false;
    }
  }

  /** The store's (or business's) bell, opened on its orders; a person's, opened on the parcel. */
  private recipientOf(hold: DropOffHold): { did: string; link: string } | undefined {
    if ('personDid' in hold.bookedBy) return { did: hold.bookedBy.personDid, link: `/?parcel=${hold.parcelId}` };
    if (!this.vendors.has(hold.bookedBy.vendorId)) return undefined;
    const vendor = this.vendors.get(hold.bookedBy.vendorId);
    const did = vendor.business?.did ?? vendor.did;
    return did ? { did, link: vendor.business ? '/' : '/?go=orders' } : undefined;
  }
}
