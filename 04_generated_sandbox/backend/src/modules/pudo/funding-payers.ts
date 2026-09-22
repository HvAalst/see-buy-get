import { Injectable, OnModuleInit } from '@nestjs/common';
import { GlosError } from '../../foundation/http/glos-error';
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
      credit: (did, c) => ({ entryId: this.gate.topUp(did, c.gross, c.reference, c.fee).entryId ?? '' }),
      reverse: (did, c) => ({ entryId: this.gate.reverseTopUp(did, c.gross, c.reference)?.entryId ?? '' }),
    });

    this.funding.register('vendor', {
      resolve: (vendorId) => {
        const vendor = this.vendors.get(vendorId);
        return { ...this.money(this.vendors.entityIdOf(vendor)), label: vendor.name };
      },
      credit: (vendorId, c) => ({ entryId: this.vendors.topUpConfirmed(vendorId, c.gross, c.reference, c.fee).entryId }),
      reverse: (vendorId, c) => ({ entryId: this.vendors.reverseTopUp(vendorId, c.gross, c.reference).entryId }),
    });
  }

  /** Which sister collects, and in what money — rule 1, collection follows the payer. */
  private money(entityId: string): { entityId: string; currency: string } {
    const entity = this.entities.get(entityId);
    return { entityId, currency: entity.currency ?? currencyForJurisdiction(entity.jurisdiction) };
  }
}
