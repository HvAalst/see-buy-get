import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { BusinessService } from './business.service';
import { BusinessMemberGuard } from './business-member.guard';
import { Gs1DisputeService, type Gs1Business } from './gs1-dispute.service';
import { ApproveGs1Dto, Gs1DisputeRow, Gs1DisputeView, OpenGs1DisputeDto, ProposeGs1Dto, SendBackGs1Dto, SendGs1LicenceDto } from './gs1-dispute.types';
import { staffOf } from './staff-of';

const STAFF_DO_NOT_CLAIM = 'Staff decide a dispute about a GS1 prefix; they never open one or send a licence for a business';

/**
 * TWO BUSINESSES SAY ONE GS1 COMPANY PREFIX IS THEIRS (gs1-dispute.types.ts). Two kinds of caller, two doors:
 *  - A BUSINESS, signed in: reads the disputes it is in; an owner opens one with its GS1 licence, sends its own licence
 *    when it uses the prefix, or withdraws the one it opened.
 *  - STAFF read every dispute with both licences, say whose the prefix is, approve, send back. Saying and approving are
 *    never the same person.
 */
@Controller('sbg')
@UseGuards(BusinessMemberGuard)
export class Gs1DisputeController {
  constructor(
    private readonly disputes: Gs1DisputeService,
    private readonly businesses: BusinessService,
  ) {}

  @Roles('business')
  @Get('business/me/gs1/disputes')
  mine(@Actor() actor: IntrospectionResult): { items: Gs1DisputeView[] } {
    const acting = this.businesses.requireMember(actor);
    return { items: this.disputes.forBusiness(acting.entity.entityId) };
  }

  /** "This prefix is ours": opened with the business's GS1 licence. Owner only. */
  @Roles('business')
  @Post('business/me/gs1/disputes')
  open(@Body() dto: OpenGs1DisputeDto, @Actor() actor: IntrospectionResult): Gs1DisputeView {
    return this.disputes.open(this.owner(actor), { companyPrefix: dto.companyPrefix, extensionDigit: dto.extensionDigit, licenceRef: dto.licenceRef, note: dto.note });
  }

  /** The business using the prefix sends its own licence. Owner only. */
  @Roles('business')
  @Post('business/me/gs1/disputes/:disputeId/licence')
  @HttpCode(200)
  licence(@Param('disputeId') disputeId: string, @Body() dto: SendGs1LicenceDto, @Actor() actor: IntrospectionResult): Gs1DisputeView {
    return this.disputes.sendLicence(this.owner(actor), disputeId, { licenceRef: dto.licenceRef, note: dto.note });
  }

  /** The business that opened it takes it back. Owner only. */
  @Roles('business')
  @Post('business/me/gs1/disputes/:disputeId/withdraw')
  @HttpCode(200)
  withdraw(@Param('disputeId') disputeId: string, @Actor() actor: IntrospectionResult): Gs1DisputeView {
    return this.disputes.withdraw(this.owner(actor), disputeId);
  }

  @Roles('operator')
  @Get('gs1-disputes')
  list(): { items: Gs1DisputeRow[] } {
    return { items: this.disputes.list() };
  }

  /** The first member of staff says whose it is, what was checked and why. Changes nothing. */
  @Roles('operator')
  @Post('gs1-disputes/:disputeId/propose')
  @HttpCode(200)
  propose(@Param('disputeId') disputeId: string, @Body() dto: ProposeGs1Dto, @Actor() actor: IntrospectionResult): Gs1DisputeRow {
    return this.disputes.propose(disputeId, staffOf(actor, dto.by), { to: dto.to, what: dto.what, reason: dto.reason });
  }

  /** The second, different member of staff approves — and it is done. */
  @Roles('operator')
  @Post('gs1-disputes/:disputeId/approve')
  @HttpCode(200)
  approve(@Param('disputeId') disputeId: string, @Body() dto: ApproveGs1Dto, @Actor() actor: IntrospectionResult): Gs1DisputeRow {
    return this.disputes.approve(disputeId, staffOf(actor, dto.by));
  }

  @Roles('operator')
  @Post('gs1-disputes/:disputeId/send-back')
  @HttpCode(200)
  sendBack(@Param('disputeId') disputeId: string, @Body() dto: SendBackGs1Dto, @Actor() actor: IntrospectionResult): Gs1DisputeRow {
    return this.disputes.sendBack(disputeId, staffOf(actor, dto.by), dto.why);
  }

  /** An owner of the business acting — and the business as the dispute keeps it. Staff: refused by name. */
  private owner(actor: IntrospectionResult): Gs1Business {
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', STAFF_DO_NOT_CLAIM);
    const acting = this.businesses.requireMember(actor);
    this.businesses.requireOwner(acting);
    return { entityId: acting.entity.entityId, did: acting.entity.did, name: acting.entity.name, by: acting.member.name };
  }
}
