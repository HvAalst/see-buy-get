import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { BusinessMemberGuard } from './business-member.guard';
import { BusinessService } from './business.service';
import { InboundService } from './inbound.service';
import { CloseInboundDto, InboundRow, InboundView, ReceivingPointNamed, ReceivingPointView } from './inbound.types';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { SiteService } from './site.service';

/**
 * INBOUND SUPPLY, READING A (see InboundService): a business's receiving points, and what is coming in to them. Its own
 * and nobody else's: a business sign-in, any member reading, a viewer changing nothing (BusinessMemberGuard). Staff are
 * refused by name here — a business keeps its own record — and read a load where they always have.
 */
@Controller('sbg')
@UseGuards(BusinessMemberGuard)
export class InboundController {
  constructor(
    private readonly inbound: InboundService,
    private readonly sites: SiteService,
    private readonly businesses: BusinessService,
  ) {}

  /** What is coming in to this business: its receiving points, and what is addressed to them. */
  @Roles('business')
  @Get('business/me/inbound')
  comingIn(@Actor() actor: IntrospectionResult): InboundView {
    return this.inbound.comingTo(this.own(actor).entity.entityId);
  }

  /**
   * D9 — close what is still expected of a delivered load: it came after all, or it is not coming. One of its people; a
   * viewer reads it. Answers with the load as Coming in reads it now.
   */
  @Roles('business')
  @Post('business/me/inbound/:freightId/close')
  closeExpected(@Param('freightId') freightId: string, @Body() dto: CloseInboundDto, @Actor() actor: IntrospectionResult): InboundRow {
    const acting = this.own(actor);
    return this.inbound.close(acting.entity.entityId, freightId, { how: dto.how, note: dto.note }, { name: acting.member.name, ...(acting.member.personDid ? { did: acting.member.personDid } : {}) });
  }

  /** Its receiving points, with the code each gives its suppliers. */
  @Roles('business')
  @Get('business/me/receiving')
  receivingPoints(@Actor() actor: IntrospectionResult): ReceivingPointView[] {
    return this.inbound.points(this.own(actor).entity.entityId);
  }

  /** Receive goods at one of its own places: the place gets a code to give suppliers. Already receiving, it stays as it is. */
  @Roles('business')
  @Post('business/me/receiving/:siteId')
  openReceiving(@Param('siteId') siteId: string, @Actor() actor: IntrospectionResult): ReceivingPointView {
    const acting = this.own(actor);
    this.sites.openReceiving(acting.entity.entityId, siteId, acting.member.name);
    return this.pointOf(acting.entity.entityId, siteId);
  }

  /** A new code for a receiving point, when the old one went further than it should: the old one names nothing from now. */
  @Roles('business')
  @Post('business/me/receiving/:siteId/code')
  newCode(@Param('siteId') siteId: string, @Actor() actor: IntrospectionResult): ReceivingPointView {
    const acting = this.own(actor);
    this.sites.newReceivingCode(acting.entity.entityId, siteId, acting.member.name);
    return this.pointOf(acting.entity.entityId, siteId);
  }

  /** No longer receive at a place through SeeBuyGet: its code names nothing; what was already sent stays coming. */
  @Roles('business')
  @Delete('business/me/receiving/:siteId')
  closeReceiving(@Param('siteId') siteId: string, @Actor() actor: IntrospectionResult): ReceivingPointView[] {
    const acting = this.own(actor);
    this.sites.closeReceiving(acting.entity.entityId, siteId);
    return this.inbound.points(acting.entity.entityId);
  }

  /**
   * WHAT A "DELIVER TO" CODE NAMES — for a business about to send there: the receiver's name, the place and where it is,
   * which is what sending anything there needs, and nothing more (rule: an identifier opens nothing). Counted per caller,
   * so the codes cannot be walked.
   */
  @Roles('business')
  @Get('receiving/:code')
  @UseGuards(RateLimitGuard)
  @RateLimit(30, 15 * 60)
  named(@Param('code') code: string, @Actor() actor: IntrospectionResult): ReceivingPointNamed {
    this.own(actor);
    const found = this.inbound.named(code);
    if (!found) throw new GlosError('NOT_FOUND', `No receiving point has the code “${code.trim()}”. Check it with the business you are sending to: it gave you the code.`);
    return found;
  }

  /** A business member of this business — staff named and refused: a business keeps its own record. */
  private own(actor: IntrospectionResult) {
    if (actor?.role !== 'business') throw new GlosError('FORBIDDEN', 'A business keeps its own receiving points and reads what comes in: staff read a load where they always have');
    return this.businesses.requireMember(actor);
  }

  private pointOf(entityId: string, siteId: string): ReceivingPointView {
    const point = this.inbound.points(entityId).find((p) => p.siteId === siteId);
    if (!point) throw new GlosError('NOT_FOUND', 'No such receiving point');
    return point;
  }
}
