import { Body, Controller, Get, Param, Post, Put, UseGuards } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { BusinessSystemDto } from './business.dto';
import { BusinessHookMessageView, BusinessSystemView } from './business-hook.types';
import { BusinessHookService } from './business-hooks.service';
import { BusinessService } from './business.service';
import { BusinessMemberGuard } from './business-member.guard';
import { CompanyKeyService } from './company-key.service';
import { CompanyKeyIssued, CompanyKeyList, CompanyKeyView, IssueCompanyKeyDto } from './company-key.types';

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
    private readonly keyring: CompanyKeyService,
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

  /* -- round 12: its keys, for its own systems to post and read its loads (company-api.controller.ts) -- */

  /** Every key it holds or held — any member reads them; never a key itself. */
  @Roles('business')
  @Get('business/me/keys')
  keys(@Actor() actor: IntrospectionResult): CompanyKeyList {
    return { items: this.keyring.list({ kind: 'business', id: this.businesses.requireMember(actor).entity.entityId }) };
  }

  /** A new key — an owner's act, under their name. The key itself is in this answer only. */
  @Roles('business')
  @Post('business/me/keys')
  issueKey(@Body() dto: IssueCompanyKeyDto, @Actor() actor: IntrospectionResult): CompanyKeyIssued {
    const acting = this.businesses.requireMember(actor);
    this.businesses.requireOwner(acting);
    return this.keyring.issue({ kind: 'business', id: acting.entity.entityId }, dto.mode, dto.label, acting.member.name);
  }

  /** Take a key away, now — an owner's act, under their name. */
  @Roles('business')
  @Post('business/me/keys/:keyId/revoke')
  revokeKey(@Param('keyId') keyId: string, @Actor() actor: IntrospectionResult): CompanyKeyView {
    const acting = this.businesses.requireMember(actor);
    this.businesses.requireOwner(acting);
    return this.keyring.revoke({ kind: 'business', id: acting.entity.entityId }, keyId, acting.member.name);
  }
}
