import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { BusinessSystemDto } from './business.dto';
import { BusinessHookMessageView, BusinessSystemView } from './business-hook.types';
import { BusinessHookService } from './business-hooks.service';
import { BusinessService } from './business.service';
import { BusinessMemberGuard } from './business-member.guard';

/**
 * A BUSINESS'S OWN SYSTEM, TOLD OF ITS LOADS (round 10). Read by anybody in the business; its address and signing secret
 * are an owner's; a test and sending one again, anybody who may act. A business sign-in only — staff never reach a
 * business's own doors (they read counts under Businesses).
 */
@Controller('sbg')
@UseGuards(BusinessMemberGuard)
export class BusinessSystemController {
  constructor(
    private readonly businesses: BusinessService,
    private readonly hooks: BusinessHookService,
  ) {}

  @Roles('business')
  @Get('business/me/system')
  view(@Actor() actor: IntrospectionResult): BusinessSystemView {
    return this.hooks.view(this.businesses.requireMember(actor).entity.entityId);
  }

  /** Where its system is told. The first address makes the signing secret, shown in this answer only. Empty stops the messages. */
  @Roles('business')
  @Put('business/me/system')
  setAddress(@Body() dto: BusinessSystemDto, @Actor() actor: IntrospectionResult): BusinessSystemView {
    return this.hooks.setAddress(this.businesses.requireMember(actor), dto.url);
  }

  /** A new signing secret, shown in this answer only. */
  @Roles('business')
  @Post('business/me/system/secret')
  turnSecret(@Actor() actor: IntrospectionResult): BusinessSystemView {
    return this.hooks.turnSecret(this.businesses.requireMember(actor));
  }

  @Roles('business')
  @Post('business/me/system/test')
  test(@Actor() actor: IntrospectionResult): Promise<BusinessHookMessageView> {
    return this.hooks.test(this.businesses.requireMember(actor));
  }

  @Roles('business')
  @Post('business/me/system/messages/:messageId/resend')
  resend(@Param('messageId') messageId: string, @Actor() actor: IntrospectionResult): Promise<BusinessHookMessageView> {
    return this.hooks.resend(this.businesses.requireMember(actor), messageId);
  }
}
