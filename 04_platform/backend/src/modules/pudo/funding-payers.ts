import { Injectable, Optional, OnModuleInit } from '@nestjs/common';
import { refused } from './notice-words/refuse';
import { money, noticeOf, number, said } from './notice-words/say';
import { NotificationService } from './notification.service';
import { FundingService } from '../../foundation/funding/funding.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { currencyForJurisdiction } from '../../foundation/money/currency';
import { WalletGateService } from './wallet-gate.service';
import { AgentService } from './agent.service';
import { VendorService } from './vendor.service';
import { PersonDoorService } from './person-door.service';
import { PersonLoadPayService } from './person-load-pay.service';

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
    // A person paying first for a load to their own door (2026-10-27: "Mobile money first"). Optional, as above.
    @Optional() private readonly doors?: PersonDoorService,
    // 2026-11-13 — a person paying for a load they posted (unusual loads, part 3b).
    @Optional() private readonly loads?: PersonLoadPayService,
  ) {}

  onModuleInit(): void {
    this.funding.register('agent', {
      resolve: (did) => {
        const agent = this.agents.get(did);
        if (agent.status === 'DRAFT' || agent.status === 'KYC_PENDING') {
          throw refused('KYC_INCOMPLETE', said('refuse.fundingPayers.shopNotApproved'));
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

    this.registerPerson();
  }

  /** …and the person: a prepayment for ONE load to their door, never a balance (PersonDoorService). */
  private registerPerson(): void {
    const doors = this.doors;
    const loads = this.loads;
    if (!doors) return;
    // 2026-11-13 — by what it is for: a person's own door, or a load they posted and accepted a price on (part 3b).
    this.funding.register('person', {
      resolve: (personDid, purpose) => (purpose === 'load' && loads ? loads.resolvePayer(personDid) : doors.resolvePayer(personDid)),
      credit: (personDid, c) => (c.purpose === 'load' && loads ? loads.paid(personDid, c) : doors.paid(personDid, c)),
      reverse: (personDid, c) => (c.purpose === 'load' && loads ? loads.reversed(personDid, c) : doors.reversed(personDid, c)),
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
    const text = `${currency ?? ''} ${amount.toFixed(2)}`.trim();
    const sum = currency ? money(text, amount, currency) : number(text, amount, 2);
    const payload =
      direction === 'in'
        ? noticeOf(said('fundingPayers.shopIn.title'), said('fundingPayers.shopIn.body', { amount: sum }))
        : noticeOf(said('fundingPayers.shopBack.title'), said('fundingPayers.shopBack.body', { amount: sum }));
    void this.notifications
      ?.notify(did, { kind: 'money_in', ...payload, link: '/', tag: `money_in:${did}`, data: {} })
      .catch(() => undefined);
  }

  /**
   * TELL THE STORE — BOTH WAYS, because a store is two audiences wearing one id.
   *
   * Its SOFTWARE reads the HMAC-signed callback it already receives for every parcel status; a balance
   * changing is the same kind of fact and belongs on the same channel.
   *
   * Its PERSON reads a notification. That half was missing, on the reasoning that a store is "an
   * integration, not a person with a phone" — which was wrong, and the user said so: a store is run by
   * somebody at a desk or on a phone who is waiting on exactly this. A callback posted to a URL tells
   * that person nothing at all.
   *
   * Neither failure may undo a payment that arrived: the money is real whatever our messaging does.
   */
  private tellStore(vendorId: string, event: string, c: { gross: number; reference: string }, balance: number | null | undefined): void {
    try {
      this.vendors.notify(vendorId, event, { amount: c.gross, providerRef: c.reference, balance: balance ?? null });
    } catch {
      /* a callback that cannot be queued must never undo a payment that arrived */
    }
    // Keyed to the store's DID, which is what its own token acts as — the same inbox its app reads.
    const did = this.vendors.get(vendorId).did;
    if (!did) return;
    // 2026-11-27 — a sum in the store's own currency, written the reader's way where it is known (the English as before).
    const cur = this.vendors.currencyOf(this.vendors.get(vendorId));
    const sum = cur ? money(c.gross.toFixed(2), c.gross, cur) : number(c.gross.toFixed(2), c.gross, 2);
    const payload =
      event === 'balance_topped_up'
        ? noticeOf(said('fundingPayers.storeIn.title'), said('fundingPayers.storeIn.body', { amount: sum }))
        : noticeOf(said('fundingPayers.storeBack.title'), said('fundingPayers.storeBack.body', { amount: sum }));
    void this.notifications
      ?.notify(did, { kind: 'money_in', ...payload, link: '/', tag: `money_in:${did}`, data: {} })
      .catch(() => undefined);
  }

  /** Which sister collects, and in what money — rule 1, collection follows the payer. */
  private money(entityId: string): { entityId: string; currency: string } {
    const entity = this.entities.get(entityId);
    return { entityId, currency: entity.currency ?? currencyForJurisdiction(entity.jurisdiction) };
  }
}
