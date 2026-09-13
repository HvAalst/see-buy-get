import { Injectable, OnModuleInit } from '@nestjs/common';
import { PayoutService } from '../../foundation/payouts/payout.service';
import { PresenceService } from '../../foundation/presence/presence.service';
import { AgentService } from './agent.service';

/**
 * WHO MAY BE PAID OUT — "owed, not paid" (user, 2026-09-13).
 *
 * A shop in a country we only MATCH can do work on a sale one of our sisters made (P4): the sister books the
 * cost and owes the shop. What it may not do is send that money across a border to a supplier in a country
 * whose withholding and exchange rules nobody has reviewed. So the debt stays on the books, visibly, and the
 * payout run names why it did not pay.
 *
 * Its own provider, registered once at boot, rather than a dependency added to AgentService or a parameter on
 * `runFor`: the first would break every spec that hand-lists AgentService's providers, and the second is a
 * thing every call site forgets.
 */
@Injectable()
export class PayeeStandingRegistrar implements OnModuleInit {
  constructor(
    private readonly payouts: PayoutService,
    private readonly agents: AgentService,
    private readonly presence: PresenceService,
  ) {}

  onModuleInit(): void {
    this.payouts.registerPayeeGate((payeeDid) => this.reasonNotToPay(payeeDid));
  }

  /**
   * Why this payee may not be paid out today, or null. Only a SHOP can stand where no sister does: hubs,
   * fleets and couriers are registered only where one exists, so they are never barred here.
   */
  reasonNotToPay(payeeDid: string): string | null {
    const shop = this.agents.list().find((a) => a.did === payeeDid);
    if (!shop) return null;
    const country = this.agents.countryOf(shop);
    if (this.presence.can(country, 'payouts')) return null;
    return `${shop.shopName} is owed this, but we cannot pay out in ${country} yet — it stays on the books until we can`;
  }
}
