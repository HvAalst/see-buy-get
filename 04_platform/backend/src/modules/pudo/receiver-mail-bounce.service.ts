import { Injectable, Logger, OnModuleInit, Optional } from '@nestjs/common';
import { MailBounces } from '../../foundation/mail/mail-bounces.service';
import { DispatchService } from './dispatch.service';
import { noticeOf, said } from './notice-words/say';
import { NotificationService } from './notification.service';
import { loadLink } from './notification.types';
import { ParcelService } from './parcel.service';
import { VendorService } from './vendor.service';

/**
 * 2026-11-16 — AN EMAIL WE SENT FOR SOMEBODY CAME BACK (the owner: "a bounce deserves a notice"). Until this, a bounce only
 * stopped us writing to the address again: the sender went on thinking their receiver had the delivery code, and a store
 * thought its buyer knew where to collect.
 *
 * - A load's receiver: its POSTER is told in their bell — a person, a business, or the counter that booked it — that the
 *   code email did not arrive. The code is on the load in their app: they give it on themselves, or send it to another
 *   address there (DispatchService.newReceiverEmail).
 * - A store's buyer: the STORE is told, once per order still on its way or waiting, to reach its buyer another way.
 *
 * Told when the provider reports the bounce, and at once when we would write to an address that already came back.
 * Once per load or order; never a text (rule-a-receiver-is-not-texted, rule-texts-only-codes).
 */
@Injectable()
export class ReceiverMailBounces implements OnModuleInit {
  private readonly logger = new Logger(ReceiverMailBounces.name);

  constructor(
    private readonly dispatch: DispatchService,
    private readonly parcels: ParcelService,
    private readonly notifications: NotificationService,
    @Optional() private readonly vendors?: VendorService,
    @Optional() private readonly bounces?: MailBounces,
  ) {}

  onModuleInit(): void {
    this.bounces?.onBounce((address) => void this.bounced(address));
  }

  /** Is email to this address stopped because it came back before — so the one we are about to send will not arrive. */
  cameBack(address: string | undefined): boolean {
    return Boolean(address && this.bounces?.stopped(address));
  }

  /** An address came back: whoever we wrote to it for is told. How many were told. */
  bounced(address: string, now: number = Date.now()): number {
    let told = 0;
    for (const f of this.dispatch.codeMailedTo(address)) {
      const to = f.postedByDid ?? f.shipperDid;
      this.dispatch.markCodeMailBounced(f.freightId, now);
      if (!to) continue;
      told += 1;
      void this.notifications
        .notify(to, {
          kind: 'mail_bounced',
          ...noticeOf(said('receiverMailBounce.load.title', { code: f.code }), said('receiverMailBounce.load.body', { email: f.receiverEmail ?? '' })),
          link: loadLink(f.freightId),
          tag: `mail-bounced:${f.freightId}`,
          data: { freightId: f.freightId },
        })
        .catch((err: Error) => this.logger.warn(`bounce notice for ${f.freightId} failed: ${err.message}`));
    }
    for (const p of this.parcels.buyerMailedTo(address)) {
      this.parcels.markBuyerMailBounced(p.parcelId, now);
      let storeDid: string | undefined;
      try {
        storeDid = p.vendorId ? this.vendors?.get(p.vendorId).did : undefined;
      } catch {
        storeDid = undefined;
      }
      if (!storeDid) continue;
      told += 1;
      const order = p.externalOrderId ? said('receiverMailBounce.order', { id: p.externalOrderId }) : said('receiverMailBounce.parcel', { id: p.parcelId });
      const waiting = p.status === 'Ready_For_Pickup' || p.status === 'Unclaimed';
      void this.notifications
        .notify(storeDid, {
          kind: 'mail_bounced',
          ...noticeOf(
            said('receiverMailBounce.buyer.title', { order }),
            said('receiverMailBounce.buyer.body', { email: p.buyerEmail ?? '', state: waiting ? said('receiverMailBounce.buyer.waiting') : said('receiverMailBounce.buyer.onItsWay') }),
          ),
          link: '/?go=orders',
          tag: `mail-bounced:${p.parcelId}`,
          data: { parcelId: p.parcelId },
        })
        .catch((err: Error) => this.logger.warn(`bounce notice for ${p.parcelId} failed: ${err.message}`));
    }
    return told;
  }
}
