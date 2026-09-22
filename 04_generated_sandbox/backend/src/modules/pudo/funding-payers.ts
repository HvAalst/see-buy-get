import { Injectable, Optional, OnModuleInit } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
import { NotificationService } from './notification.service';
import { FundingService } from '../../foundation/funding/funding.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { currencyForJurisdiction } from '../../foundation/money/currency';
import { WalletGateService } from './wallet-gate.service';
import { AgentService } from './agent.service';
import { VendorService } from './vendor.service';

/**
 * WHO CAN PUT MONEY IN, and which account it lands in when a rail confirms it.
 *
 * `FundingService` owns the lifecycle of a payment — the reference, the waiting, the idempotency, the
 * single door a confirmation comes through. It deliberately owns none of the bookkeeping: a shop's float
 * and a store's prepaid balance are different liabilities of ours, and a foundation service branching on
 * which is which is how one of them eventually gets credited to the other.
 *
 * So each payer kind registers how it is resolved and how it is credited, once at boot — the same shape
 * as the payout side's `PayeeStandingRegistrar`, and for the same two reasons: `foundation` must not
 * reach into `modules`, and an optional parameter is a thing every call site forgets.
 *
 * `resolve` runs BEFORE a reference is issued, and both of its refusals matter. A shop that is not
 * approved cannot hold a balance, and a shop in a country where no sister of ours holds money has no
 * account to credit — handing either of them a paybill number and a reference would be inviting a
 * payment nobody here can post.
 */
@Injectable()
export class FundingPayerRegistrar implements OnModuleInit {
  constructor(
    private readonly funding: FundingService,
    private readonly gate: WalletGateService,
    private readonly agents: AgentService,
    private readonly vendors: VendorService,
    private readonly entities: EntityService,
    /** @Optional so the many specs that hand-list this module's providers keep compiling — the
     *  established pattern here, and the reason 334 tests once went red in one edit. */
    @Optional() private readonly notifications?: NotificationService,
  ) {}

  onModuleInit(): void {
    this.funding.register('agent', {
      resolve: (did) => {
        const agent = this.agents.get(did);
        if (agent.status === 'DRAFT' || agent.status === 'KYC_PENDING') {
          throw new GlosError('KYC_INCOMPLETE', 'This shop is not approved yet — it cannot hold a balance');
        }
        return { ...this.money(this.agents.entityIdOf(agent)), label: agent.shopName };
      },
      credit: (did, c) => {
        const entry = this.gate.topUp(did, c.gross, c.reference, c.fee);
        this.tellShop(did, c.gross, entry.currency, 'in');
        return { entryId: entry.entryId ?? '' };
      },
      reverse: (did, c) => {
        const entry = this.gate.reverseTopUp(did, c.gross, c.reference);
        this.tellShop(did, c.gross, entry?.currency, 'back');
        return { entryId: entry?.entryId ?? '' };
      },
    });

    this.funding.register('vendor', {
      resolve: (vendorId) => {
        const vendor = this.vendors.get(vendorId);
        return { ...this.money(this.vendors.entityIdOf(vendor)), label: vendor.name };
      },
      credit: (vendorId, c) => {
        const done = this.vendors.topUpConfirmed(vendorId, c.gross, c.reference, c.fee);
        this.tellStore(vendorId, 'balance_topped_up', c, done.vendor.balance);
        return { entryId: done.entryId };
      },
      reverse: (vendorId, c) => {
        const done = this.vendors.reverseTopUp(vendorId, c.gross, c.reference);
        this.tellStore(vendorId, 'balance_returned', c, done.vendor.balance);
        return { entryId: done.entryId };
      },
    });
  }

  /**
   * TELL THE SHOP, on the channel a shopkeeper actually reads.
   *
   * They paid at a kiosk and walked back to the counter. The confirmation lands minutes later on a
   * provider's callback, and without this the only way to find out is to reopen the app and press "Check
   * again" — which is a person standing at a till, unable to scan, refreshing a screen.
   *
   * Kept SHORT on purpose: this is read on a lock screen, which is the lesson the papers notifications
   * cost us (164 characters down to 95). Failures are swallowed — a notification that will not send must
   * never undo a payment that did arrive.
   */
  private tellShop(did: string, amount: number, currency: string | undefined, direction: 'in' | 'back'): void {
    const money = `${currency ?? ''} ${amount.toFixed(2)}`.trim();
    const payload =
      direction === 'in'
        ? { title: 'Your payment came through', body: `${money} is in your wallet. You can scan again.` }
        : { title: 'A payment was taken back', body: `${money} was returned by the payment provider.` };
    void this.notifications
      ?.notify(did, { kind: 'money_in', ...payload, link: '/', tag: `money_in:${did}`, data: {} })
      .catch(() => undefined);
  }

  /**
   * TELL THE STORE, on the channel a store actually reads — its own signed callback.
   *
   * A store is an integration, not a person with a phone: the vendor app has no notification bell, so
   * writing to an inbox would be a message nobody ever opens. It already receives HMAC-signed status
   * callbacks for its parcels, and its balance changing is the same kind of fact.
   */
  private tellStore(vendorId: string, event: string, c: { gross: number; reference: string }, balance: number | null | undefined): void {
    try {
      this.vendors.notify(vendorId, event, { amount: c.gross, providerRef: c.reference, balance: balance ?? null });
    } catch {
      /* a callback that cannot be queued must never undo a payment that arrived */
    }
  }

  /** Which sister collects, and in what money — rule 1, collection follows the payer. */
  private money(entityId: string): { entityId: string; currency: string } {
    const entity = this.entities.get(entityId);
    return { entityId, currency: entity.currency ?? currencyForJurisdiction(entity.jurisdiction) };
  }
}
