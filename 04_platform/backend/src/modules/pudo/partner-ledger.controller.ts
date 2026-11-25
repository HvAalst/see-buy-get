import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { actingTenant, auditActor } from '../../foundation/auth/acting';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { EntityService } from '../../foundation/entity/entity.service';
import { GlosError } from '../../foundation/http/glos-error';
import { HubPaymentView, PartnerFeeDto, PaymentAccountRead, PaymentAccountView, TryPaymentDto } from '../../foundation/payment-hub/hub.types';
import { PaymentHubService } from '../../foundation/payment-hub/payment-hub.service';
import { DriverService } from './driver.service';
import { MdpService } from './mdp.service';
import { MyPartnerOwed, PartnerLedgerService, PartnerLedgerView } from './partner-ledger.service';
import { PartnerPayoutService, PartnerPayoutsView } from './partner-payout.service';
import { PartnerChecksService, PartnerChecksView, PartnerFlagLookedDto, PartnerFlagRow, PartnerReviewRow } from './partner-checks.service';
import { PartnerStatementPaidDto, PartnerStatementService, PartnerStatementView, PartnerStatementsView } from './partner-statement.service';

/**
 * 2026-11-20 — WHAT A PARTNER OWES, READ (the payments plan, 3a; the owner: "console for staff"; the hands see it, "named"). Our
 * staff read a partner's whole record, by the partner company; a shop, a hub, a courier and a fleet's office each read what the
 * partners owe them. Nothing here moves money.
 */
@Controller('sbg')
export class PartnerLedgerController {
  constructor(
    private readonly ledger: PartnerLedgerService,
    private readonly entities: EntityService,
    private readonly drivers: DriverService,
    private readonly mdps: MdpService,
    private readonly checks: PartnerChecksService,
    private readonly hub: PaymentHubService,
    private readonly payouts: PartnerPayoutService,
    // 2026-11-24 — what a company of ours owes the partner, week by week (route plan part 4).
    private readonly statements: PartnerStatementService,
  ) {}

  /** 2026-11-24 — what companies of ours owe a partner, week by week, Sunday to Saturday (route plan part 4), for our staff. */
  @Roles('operator')
  @Get('entities/:entityId/partner-statements')
  statementsOf(@Param('entityId') entityId: string): PartnerStatementsView {
    this.requirePartner(entityId);
    return this.statements.statementsOf(entityId);
  }

  /** …paid by bank transfer: said by staff with the transfer's reference, and booked paid by the company that owed it. */
  @Roles('operator')
  @Post('entities/:entityId/partner-statements/:statementId/paid')
  statementPaid(@Param('entityId') entityId: string, @Param('statementId') statementId: string, @Body() dto: PartnerStatementPaidDto, @Actor() actor: IntrospectionResult): PartnerStatementView {
    this.requirePartner(entityId);
    return this.statements.markPaid(entityId, statementId, { by: auditActor(actor, dto.by) ?? 'SeeBuyGet staff', reference: dto.reference });
  }

  /** A partner's record, for our staff: every line it owes, and what it owes each hand in all. */
  @Roles('operator')
  @ApiQuery({ name: 'payeeId', required: false, description: 'Only what it owes this one hand.' })
  @Get('entities/:entityId/partner-owed')
  ofPartner(@Param('entityId') entityId: string, @Query('payeeId') payeeId?: string): PartnerLedgerView {
    this.requirePartner(entityId);
    return this.ledger.ledgerOf(entityId, { ...(payeeId ? { payeeId } : {}), paidLineIds: this.payouts.paidLineIds() });
  }

  /** 3b — the checks on a partner's figures, for our staff: what is still to look at, what was looked at, the last AI review. */
  @Roles('operator')
  @Get('entities/:entityId/partner-checks')
  checksOf(@Param('entityId') entityId: string): PartnerChecksView {
    this.requirePartner(entityId);
    return this.checks.checksOf(entityId);
  }

  /** Looked at, by name, with what was found. */
  @Roles('operator')
  @Post('entities/:entityId/partner-checks/:flagId/looked')
  looked(@Param('entityId') entityId: string, @Param('flagId') flagId: string, @Body() dto: PartnerFlagLookedDto, @Actor() actor: IntrospectionResult): PartnerFlagRow {
    this.requirePartner(entityId);
    return this.checks.markLooked(entityId, flagId, auditActor(actor), dto.note);
  }

  /** The AI review now, rather than at the day's turn: once an hour at most, as each one is paid for. */
  @Roles('operator')
  @Post('entities/:entityId/partner-checks/review')
  reviewNow(@Param('entityId') entityId: string): Promise<PartnerReviewRow> {
    this.requirePartner(entityId);
    return this.checks.review(entityId, Date.now(), { asked: true });
  }

  /**
   * 4a — THE PARTNER'S PAYMENT ACCOUNT, for our staff (the payments plan, step 4): which provider its money goes through —
   * the stand-in, test money, until its own provider is added and switched live — what the account holds, and its payments.
   */
  @Roles('operator')
  @Get('entities/:entityId/payment-account')
  async paymentAccount(@Param('entityId') entityId: string): Promise<PaymentAccountRead> {
    this.requirePartner(entityId);
    return { account: await this.hub.accountView(entityId), totals: this.hub.totalsOf(entityId), payments: this.hub.paymentsOf(entityId) };
  }

  /** A try of the account: a payment prompt to a phone, on test money, by name — the whole loop seen working before any parcel. */
  @Roles('operator')
  @Post('entities/:entityId/payment-account/try')
  tryPayment(@Param('entityId') entityId: string, @Body() dto: TryPaymentDto, @Actor() actor: IntrospectionResult): Promise<HubPaymentView> {
    this.requirePartner(entityId);
    return this.hub.tryPayment(entityId, dto, auditActor(actor));
  }

  /**
   * 4b — OUR FEE ON THE PARTNER'S PAYMENTS (P4-c): a percentage of every payment into its account, set by our staff who keep the
   * money, by name. Counted on each payment as it is paid, and owed by the partner — a loan until a company of ours can
   * invoice it (L62).
   */
  @Roles('operator')
  @Post('entities/:entityId/payment-account/fee')
  async setFee(@Param('entityId') entityId: string, @Body() dto: PartnerFeeDto, @Actor() actor: IntrospectionResult): Promise<PaymentAccountView> {
    this.requirePartner(entityId);
    this.hub.setFee(entityId, dto.pct, auditActor(actor));
    return this.hub.accountView(entityId);
  }

  /** 4c — a partner's payouts to its hands, for our staff: what waits and why, what was paid. */
  @Roles('operator')
  @Get('entities/:entityId/partner-payouts')
  payoutsOf(@Param('entityId') entityId: string): PartnerPayoutsView {
    this.requirePartner(entityId);
    return this.payouts.viewOf(entityId);
  }

  /** Pay the partner's hands now, rather than at the day's hour — by name: to try it, or after the account was topped up. */
  @Roles('operator')
  @Post('entities/:entityId/partner-payouts/run')
  payNow(@Param('entityId') entityId: string, @Actor() actor: IntrospectionResult): Promise<PartnerPayoutsView> {
    this.requirePartner(entityId);
    return this.payouts.payNow(entityId, auditActor(actor));
  }

  private requirePartner(entityId: string): void {
    const entity = this.entities.get(entityId);
    if (entity.kind !== 'partner') throw new GlosError('NOT_FOUND', `${entity.name} is not a partner company`);
  }

  /** A hand's own: what any partner owes it — a courier its own, a fleet's office its fleet's, a hub and a shop theirs. */
  @Roles('agent', 'mdp', 'driver', 'fleet_manager')
  @Get('partner-owed/mine')
  mine(@Actor() actor: IntrospectionResult): MyPartnerOwed {
    return this.ledger.owedTo(this.payeeIdsOf(actor), this.payouts.paidLineIds());
  }

  private payeeIdsOf(actor: IntrospectionResult | undefined): string[] {
    if (actor?.role === 'agent' && actor.did) return [actor.did];
    if (actor?.role === 'mdp' && actor.did) {
      const hub = this.mdps.list().find((m) => m.did === actor.did);
      return hub ? [hub.mdpId] : [];
    }
    if (actor?.role === 'driver' && actor.did) {
      // A fleet driver's road is its fleet's to be paid for: its office reads it.
      return this.drivers.get(actor.did).managerDid ? [] : [actor.did];
    }
    if (actor?.role === 'fleet_manager') {
      const fleet = actingTenant(actor);
      return fleet ? [fleet] : [];
    }
    throw new GlosError('FORBIDDEN', 'Only a shop, a hub, a driver or a fleet’s office reads what a partner owes it');
  }
}
