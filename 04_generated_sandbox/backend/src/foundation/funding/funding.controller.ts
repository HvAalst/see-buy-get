import { Body, Controller, Get, Headers, Inject, Ip, Param, Post, Query } from '@nestjs/common';
import { ApiExcludeEndpoint, ApiQuery } from '@nestjs/swagger';
import { Public } from '../auth/public.decorator';
import { Roles } from '../auth/scopes.decorator';
import { Actor } from '../auth/actor.decorator';
import { actingTenant, auditActor } from '../auth/acting';
import type { IntrospectionResult } from '../auth/auth.types';
import { GlosError } from '../http/glos-error';
import { isSandbox } from '../runtime/sandbox';
import { FundingService } from './funding.service';
import { FUNDING_RAIL, FundingRail, isPayment } from './funding.types';
import { ApplyFundingDto, ConfirmFundingDto, FundingFailureDto, SimulateFundingDto } from './funding.dto';

/**
 * The door money comes in through, and the operator's view of what is standing outside it.
 *
 * ONE DOOR, TWO KNOCKS. A payment provider's callback arrives here signed; a member of staff reading a
 * bank statement arrives at `/:fundingId/confirm`. They meet in the same `confirm()`, and both leave the
 * same record — a provider name and the provider's own reference. That is deliberate: the sandbox must
 * not be allowed to learn a shortcut that the live deployment does not have, and a statement line is an
 * observed external event exactly as a webhook is. What neither of them is, is the payer's own word.
 *
 * THE CALLBACK IS PUBLIC AND THAT IS THE POINT — a provider has no token of ours. Its authority comes
 * from the signature the rail verifies, not from the network it arrives on.
 */
@Controller('rails/funding')
export class FundingController {
  constructor(
    private readonly funding: FundingService,
    @Inject(FUNDING_RAIL) private readonly rail: FundingRail,
  ) {}

  /**
   * A provider says a payment landed.
   *
   * Answers 200 for anything we have successfully recorded — including a payment we could not attribute
   * to anybody, and including a retry of one we recorded an hour ago. That is not politeness: every one
   * of these providers retries until it gets a 200, and a 4xx for "we do not know whose this is" turns
   * one unattributable payment into a retry storm and still does not tell us whose it is. A bad
   * SIGNATURE is a different matter and is refused.
   */
  @Public()
  @ApiExcludeEndpoint()
  @Post(':provider/callback')
  async callback(
    @Param('provider') provider: string,
    @Headers() headers: Record<string, string | undefined>,
    @Body() body: Record<string, unknown>,
    /**
     * WHERE IT CAME FROM, taken from the connection rather than from a header.
     *
     * For a rail that signs its callbacks this is noise. For M-Pesa it is most of the verification there
     * is — Safaricom does not sign anything, so an allowlist of their published ranges plus a call back
     * to them is the whole of it. `@Ip()` reads Express's `req.ip`, which honours `trust proxy`; a
     * header would be whatever the caller typed.
     */
    @Ip() ip: string,
  ) {
    if (provider !== this.rail.provider) {
      // Named rather than swallowed: a callback for a provider nobody wired up is a deployment mistake,
      // and answering 200 to it would hide a rail that is quietly dropping every payment it carries.
      throw new GlosError('NOT_FOUND', `No payment rail is configured for ${provider}`);
    }
    const outcome = await this.rail.verify(headers, body, { ip });
    /*
     * THE PAYER SAID NO, and that is an answer rather than a failure.
     *
     * A cancelled prompt, a handset that never woke, a wrong PIN. 200, because the provider will retry
     * anything else until it gets one and the outcome is never going to change — and the waiting request
     * is closed, so the shop's screen stops saying "waiting for your payment" and starts saying why.
     */
    if (!isPayment(outcome)) {
      const closed = this.funding.notePaymentRefused(outcome);
      return { ok: true, duplicate: false, status: closed?.status ?? 'unknown', fundingId: closed?.fundingId, note: outcome.reason };
    }
    const result = this.funding.confirm(outcome);
    return {
      ok: true,
      duplicate: result.duplicate,
      status: result.funding?.status ?? 'unmatched',
      fundingId: result.funding?.fundingId,
      /** Said plainly in the answer so a provider's own dashboard shows it, not only our logs. */
      note: result.unmatched?.reason,
    };
  }

  /* ------------------------------------------------------- the operator's side -- */

  /** Every funding request for a sister, newest first, with the payments that could not be attributed. */
  @Roles('operator', 'entity_admin')
  @ApiQuery({ name: 'entityId', required: false, description: 'Staff only: one company, instead of every company.' })
  @Get()
  list(@Actor() actor: IntrospectionResult, @Query('entityId') asked?: string) {
    /*
     * A company administrator sees its own company's requests and nobody else's; staff see the company
     * they ask about, or every company when they ask about none.
     *
     * The refusal in the middle is the lesson from `lesson-a-tenant-is-not-a-role`, which cost a session:
     * an administrator whose token carries NO tenant would otherwise fall through to `list({})` — no
     * filter — and be handed every company's money movements. "No tenant" is a missing answer, never
     * "all of them". A member of STAFF asking for none is a different thing: they may see everything,
     * and the console asks for one because its money screen is about one company at a time.
     */
    const staff = actor?.role === 'operator';
    const entityId = staff ? asked?.trim() || undefined : actingTenant(actor);
    if (!staff && !entityId) throw new GlosError('FORBIDDEN', 'This token does not say which company it administers');
    return {
      items: this.funding.list(entityId ? { entityId } : {}),
      // Network-wide, and only for staff: an unattributed payment has no company on it yet, which is
      // precisely what makes it a problem, so it cannot be filtered to one.
      unmatched: actor?.role === 'operator' ? this.funding.unmatchedPayments() : [],
    };
  }

  /**
   * A member of staff confirms a payment they can see on a bank statement.
   *
   * The fallback that has to exist: not every shop pays by mobile money, and a transfer into the bank
   * account has no webhook behind it. It is deliberately NOT the ordinary path — the user's words,
   * 2026-09-22: *"sbg staff confirming every top up is a tough call"* — and it is recorded as what it is,
   * with the person who confirmed it and the statement reference they were reading. A top-up nobody can
   * point at a statement line for cannot be entered here.
   */
  @Roles('operator')
  @Post(':fundingId/confirm')
  confirmByHand(@Param('fundingId') fundingId: string, @Body() dto: ConfirmFundingDto, @Actor() actor: IntrospectionResult) {
    const request = this.funding.get(fundingId);
    const result = this.funding.confirm({
      provider: dto.provider?.trim() || 'statement',
      providerRef: dto.providerRef.trim(),
      reference: request.reference,
      amount: dto.amount,
      currency: request.currency,
      fee: dto.fee ?? 0,
      payerLabel: `confirmed by ${auditActor(actor)}`,
    });
    return result.funding ?? { unmatched: result.unmatched };
  }

  /**
   * SANDBOX ONLY — stand in for the provider, and go through its front door to do it.
   *
   * This builds a callback, signs it with the rail's own secret and feeds it to the same `verify()` a
   * real provider's POST meets. Nothing is bypassed: if the signature check breaks, every demo breaks
   * with it, which is the only way a lock gets tested before the day it matters. 404 in production,
   * where a payment is confirmed by a provider and by nobody wearing our badge.
   */
  @Roles('operator')
  @Post(':fundingId/simulate')
  simulate(@Param('fundingId') fundingId: string, @Body() dto: SimulateFundingDto) {
    if (!isSandbox() || !this.rail.simulate) throw new GlosError('NOT_FOUND', 'Not available');
    const request = this.funding.get(fundingId);
    const { headers, body } = this.rail.simulate({
      providerRef: dto.providerRef.trim(),
      // What the payer is pretended to have quoted. `undefined` means "use the real one"; an empty string
      // means they quoted nothing at all, which is how the unmatched case is reached in a demo.
      reference: dto.reference === undefined ? request.reference : dto.reference.trim(),
      amount: dto.amount,
      currency: request.currency,
      fee: dto.fee ?? 0,
      paidAt: new Date().toISOString(),
    });
    // Through the front door, and standing where the provider stands: the loopback address is what a
    // real callback from this machine would arrive on, so even the sandbox's own knock is placed.
    return this.callback(this.rail.provider, headers, body, '127.0.0.1');
  }

  /**
   * SAY WHOSE AN UNATTRIBUTED PAYMENT WAS, and credit it.
   *
   * The only way out of the unmatched list. A person looked at a payment with a mistyped reference, rang
   * the shop, and now says it is theirs — so their name goes on it, from the token rather than the body.
   * The route is under `unmatched/` because the id is a payment, never a funding request.
   */
  @Roles('operator')
  @Post('unmatched/:id/apply')
  applyUnmatched(@Param('id') id: string, @Body() dto: ApplyFundingDto, @Actor() actor: IntrospectionResult) {
    return this.funding.apply(id, { payerKind: dto.payerKind, payerDid: dto.payerDid }, auditActor(actor, dto.by));
  }

  /** The payer said no, or the rail did. Nothing moved, so nothing is unwound. */
  @Roles('operator')
  @Post(':fundingId/fail')
  fail(@Param('fundingId') fundingId: string, @Body() dto: FundingFailureDto) {
    return this.funding.fail(fundingId, dto.reason);
  }

  /** Nobody ever paid it — close the request so the list stops reading as money on its way. */
  @Roles('operator')
  @Post(':fundingId/expire')
  expire(@Param('fundingId') fundingId: string, @Body() dto: FundingFailureDto) {
    return this.funding.expire(fundingId, dto.reason);
  }

  /** It arrived and went back. Its own entry, never an unwinding of the first. */
  @Roles('operator')
  @Post(':fundingId/reverse')
  reverse(@Param('fundingId') fundingId: string, @Body() dto: FundingFailureDto) {
    return this.funding.reverse(fundingId, dto.reason);
  }
}
