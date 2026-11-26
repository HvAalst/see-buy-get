import { Body, Controller, Delete, Get, Optional, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Public } from '../../foundation/auth/public.decorator';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { MollieConnectService } from '../../foundation/mollie/mollie-connect.service';
import { MollieConnectStarted, MolliePartnerView } from '../../foundation/mollie/mollie.types';
import { auditActor } from '../../foundation/auth/acting';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { AgentService } from './agent.service';
import { DriverService } from './driver.service';
import { FleetManagerService } from './fleet-manager.service';
import { MdpService } from './mdp.service';
import { PartnerLedgerService, type PartnerPayeeKind } from './partner-ledger.service';
import { PartnerPayoutRow, PartnerPayoutService, PartnerPayoutsView } from './partner-payout.service';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PartnerStatementService, PartnerStatementsView } from './partner-statement.service';
import { PaymentHubService } from '../../foundation/payment-hub/payment-hub.service';

/** 4e — one sender's payment into the partner's account: for which parcel, how much, where it stands — never the phone. */
export class PartnerMoneyIn {
  @ApiProperty() reference: string;
  @ApiProperty() amount: number;
  @ApiProperty() currency: string;
  @ApiProperty({ enum: ['asked', 'paid', 'failed'] }) state: 'asked' | 'paid' | 'failed';
  @ApiProperty() at: string;
  @ApiPropertyOptional({ description: 'Given back to the sender: the parcel was voided.' }) givenBack?: boolean;
}

/**
 * 4e — THE PARTNER'S MONEY, as its own people read it (the plan: "Paid in", "Paid out" and "Waiting", live): what senders paid
 * into its account, what went back, what it paid its hands and what waits, what its account holds, and our fee it owes.
 */
export class PartnerMoneyView {
  @ApiProperty() currency: string;
  @ApiPropertyOptional({ description: 'What the account holds, where its provider says.' }) balance?: number;
  @ApiProperty() test: boolean;
  @ApiProperty() paidIn: number;
  @ApiProperty() givenBack: number;
  @ApiProperty() paidOut: number;
  @ApiProperty() waiting: number;
  @ApiProperty() waitingAmount: number;
  @ApiProperty() shortAmount: number;
  @ApiProperty({ description: 'Our fee on its payments, owed by it: a loan until a company of ours can invoice it.' }) feeOwed: number;
  @ApiProperty({ type: [PartnerMoneyIn] }) ins: PartnerMoneyIn[];
  @ApiProperty({ type: [PartnerPayoutRow] }) payouts: PartnerPayoutRow[];
  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, description: 'Each hand paid, by the name the partner knows it by.' }) names: Record<string, string>;
}
import { InvitePartnerMemberDto, PartnerMeView, PartnerMemberService, PartnerMemberView, PartnerMembershipList, PartnerMembershipView, PartnerOwedForPartner, PartnerSession } from './partner-member.service';

/**
 * 2026-11-20 — THE PARTNER APP'S DOORS (the payments plan, 3c; the owner: a separate Partner app). Our staff add and take out
 * a partner's own people; a person signed in as themselves sees the partners they are in or invited to, says yes or no, and
 * opens one; signed in for a partner, they read what it owes its hands — the same record our staff read, live.
 */
@Controller('sbg')
export class PartnerAppController {
  constructor(
    private readonly members: PartnerMemberService,
    private readonly ledger: PartnerLedgerService,
    private readonly agents: AgentService,
    private readonly mdps: MdpService,
    private readonly drivers: DriverService,
    private readonly fleets: FleetManagerService,
    private readonly payouts: PartnerPayoutService,
    @Optional() private readonly hub?: PaymentHubService,
    // 2026-11-24 — what companies of ours owe the partner, week by week (route plan part 4).
    @Optional() private readonly statements?: PartnerStatementService,
    // 2026-11-26 — the partner's own Mollie account, for the money its counters take (the European Union).
    @Optional() private readonly mollie?: MollieConnectService,
  ) {}

  /* ------------------------------------------- the partner's own Mollie account (2026-11-26) -- */

  /**
   * Whether the counters' payments go into the partner's own Mollie account in its country, and if so whether it is connected.
   * Connected by the partner's own people, who sign in to Mollie themselves: nobody types a key, and we never hold one.
   */
  @Roles('partner')
  @Get('partner/me/mollie')
  myMollie(@Actor() actor: IntrospectionResult): MolliePartnerView {
    const { entity } = this.members.requireMember(actor);
    return this.mollie?.partnerView(entity.entityId, entity.jurisdiction) ?? { available: false, why: 'off' };
  }

  /** Mollie's own sign-in, back to the Partner app; kept by the name of the member who connected it. */
  @Roles('partner')
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('partner/me/mollie/connect')
  connectMollie(@Actor() actor: IntrospectionResult): MollieConnectStarted {
    const { entity, member } = this.members.requireMember(actor);
    if (!this.mollie) throw new GlosError('INVALID_STATE', 'Mollie is not set up on this server yet');
    return this.mollie.connectPartner(entity.entityId, entity.jurisdiction, member.name);
  }

  /** Disconnected: its counters take test money again until it is connected once more. */
  @Roles('partner')
  @Delete('partner/me/mollie')
  disconnectMollie(@Actor() actor: IntrospectionResult): Promise<MolliePartnerView> {
    const { entity } = this.members.requireMember(actor);
    if (!this.mollie) throw new GlosError('INVALID_STATE', 'Mollie is not set up on this server yet');
    return this.mollie.disconnectPartner(entity.entityId, entity.jurisdiction);
  }

  /**
   * The page a sender comes back to after paying on Mollie's page, opened from a counter's QR code: how the payment went, and nothing
   * else. Public — the sender is nobody here — and named by our own payment's id, which nobody can guess.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(120, 15 * 60)
  @Get('payment-hub/paid/:paymentId')
  async paidPage(@Param('paymentId') paymentId: string, @Res() res: Response): Promise<void> {
    const html = this.hub ? await this.hub.paidPage(paymentId) : '<!doctype html><title>SeeBuyGet</title><p>This link is not known.</p>';
    res.status(200).type('html').send(html);
  }

  /** 2026-11-24 — what SeeBuyGet's companies owe this partner for its hands' work on parcels they sold, week by week. */
  @Roles('partner')
  @Get('partner/me/statements')
  myStatements(@Actor() actor: IntrospectionResult): PartnerStatementsView {
    const { entity } = this.members.requireMember(actor);
    return this.statements?.statementsOf(entity.entityId) ?? { statements: [], unpaid: {} };
  }

  /* ------------------------------------------------------------------ our staff -- */

  @Roles('operator')
  @Get('entities/:entityId/partner-members')
  membersOf(@Param('entityId') entityId: string): PartnerMemberView[] {
    return this.members.membersOf(entityId);
  }

  @Roles('operator')
  @Post('entities/:entityId/partner-members')
  invite(@Param('entityId') entityId: string, @Body() dto: InvitePartnerMemberDto, @Actor() actor: IntrospectionResult): PartnerMemberView {
    return this.members.invite(entityId, dto, auditActor(actor));
  }

  @Roles('operator')
  @Delete('entities/:entityId/partner-members/:memberId')
  remove(@Param('entityId') entityId: string, @Param('memberId') memberId: string, @Actor() actor: IntrospectionResult): PartnerMemberView {
    return this.members.remove(entityId, memberId, auditActor(actor));
  }

  /* ------------------------------------------------------- a person, as themselves -- */

  /** The partners this person is in, and the ones they are invited to. */
  @Roles('consumer')
  @Get('partner/mine')
  mine(@Actor() actor: IntrospectionResult): PartnerMembershipList {
    return { items: this.members.mine(personOf(actor)) };
  }

  @Roles('consumer')
  @Post('partner/invitations/:memberId/accept')
  accept(@Param('memberId') memberId: string, @Actor() actor: IntrospectionResult): PartnerMembershipView {
    return this.members.accept(personOf(actor), memberId);
  }

  @Roles('consumer')
  @Post('partner/invitations/:memberId/decline')
  decline(@Param('memberId') memberId: string, @Actor() actor: IntrospectionResult): { declined: true } {
    return this.members.decline(personOf(actor), memberId);
  }

  /** Open one partner: a session that reads for it, for a person who is in it. */
  @Roles('consumer')
  @Post('partner/:entityId/session')
  session(@Param('entityId') entityId: string, @Actor() actor: IntrospectionResult): PartnerSession {
    return this.members.session(personOf(actor), entityId);
  }

  /* ------------------------------------------------------- reading for the partner -- */

  @Roles('partner')
  @Get('partner/me')
  me(@Actor() actor: IntrospectionResult): PartnerMeView {
    return this.members.me(actor);
  }

  /** 4c — the partner's own payouts to its hands: what waits, and why (the account short above all), and what was paid. */
  @Roles('partner')
  @Get('partner/me/payouts')
  myPayouts(@Actor() actor: IntrospectionResult): PartnerPayoutsView {
    const { entity } = this.members.requireMember(actor);
    return this.payouts.viewOf(entity.entityId);
  }

  /** 4e — the partner's money: paid in, given back, paid out, waiting — live, with each hand by its name. */
  @Roles('partner')
  @Get('partner/me/money')
  async myMoney(@Actor() actor: IntrospectionResult): Promise<PartnerMoneyView> {
    const { entity } = this.members.requireMember(actor);
    const id = entity.entityId;
    const account = this.hub ? await this.hub.accountView(id) : undefined;
    const totals = this.hub?.totalsOf(id) ?? { paidIn: 0, givenBack: 0, paidOut: 0 };
    const out = this.payouts.viewOf(id);
    const kept = this.hub?.kept(id) ?? [];
    const back = new Set(kept.filter((p) => p.kind === 'refund' && p.state === 'paid' && p.refundOf).map((p) => p.refundOf as string));
    const ins = kept
      .filter((p) => p.kind === 'in' && !p.askedBy)
      .reverse()
      .slice(0, 100)
      .map((p) => ({ reference: p.reference, amount: p.amount, currency: p.currency, state: p.state, at: p.settledAt ?? p.askedAt, ...(back.has(p.paymentId) ? { givenBack: true } : {}) }));
    const names: Record<string, string> = {};
    for (const r of out.rows) {
      if (names[r.payeeId]) continue;
      const name = this.nameOf(r.payeeKind, r.payeeId);
      if (name) names[r.payeeId] = name;
    }
    return {
      currency: account?.currency ?? out.currency,
      ...(account?.balance != null ? { balance: account.balance } : {}),
      test: account?.test ?? true,
      ...totals,
      waiting: out.waiting,
      waitingAmount: out.waitingAmount,
      shortAmount: out.shortAmount,
      feeOwed: account?.feeOwed ?? 0,
      ins,
      payouts: out.rows.slice(0, 100),
      names,
    };
  }

  /** What the partner owes its hands: in all, per hand, every step — the record our staff read on its page. */
  @Roles('partner')
  @Get('partner/me/owed')
  owed(@Actor() actor: IntrospectionResult): PartnerOwedForPartner {
    const { entity } = this.members.requireMember(actor);
    const view = this.ledger.ledgerOf(entity.entityId, { paidLineIds: this.payouts.paidLineIds() });
    // Each hand by the name the partner knows it by — it contracts them — and never a phone number.
    const names: Record<string, string> = {};
    for (const h of [...view.byPayee, ...view.lines]) {
      if (names[h.payeeId]) continue;
      const name = this.nameOf(h.payeeKind, h.payeeId);
      if (name) names[h.payeeId] = name;
    }
    return { ...view, names };
  }

  private nameOf(kind: PartnerPayeeKind, id: string): string | undefined {
    try {
      if (kind === 'shop') return this.agents.get(id).shopName;
      if (kind === 'hub') return this.mdps.require(id).name;
      if (kind === 'driver') return this.drivers.get(id).displayName;
      const fleet = this.fleets.get(id);
      return fleet.tradingName ?? fleet.companyName;
    } catch {
      return undefined;
    }
  }
}

function personOf(actor: IntrospectionResult): string {
  const did = actor?.personDid ?? actor?.did;
  if (!did) throw new GlosError('FORBIDDEN', 'Sign in first');
  return did;
}
