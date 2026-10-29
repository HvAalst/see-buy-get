import { Body, Controller, Delete, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { BusinessService } from './business.service';
import { BusinessMemberGuard } from './business-member.guard';
import { BusinessParcelService, memberActor } from './business-parcel.service';
import { VendorLedgerQueryDto, VendorOrdersQueryDto } from './pudo.dto';
import {
  BusinessCallOffDto,
  BusinessCallOffView,
  BusinessCollectFromDto,
  BusinessFillBagDto,
  BusinessOpenBagDto,
  BusinessSealBagDto,
  DockView,
  ParcelPriceQueryDto,
  ParcelPriceView,
  BusinessParcelAccountView,
  BusinessParcelDetail,
  BusinessParcelDto,
  BusinessParcelLabel,
  BusinessParcelList,
  BusinessParcelSent,
  BusinessTopUpDto,
  ParcelBook,
} from './business-parcel.types';

/**
 * A BUSINESS'S PARCELS (the user, 2026-10-29): its parcel account and the parcels paid from it. A business sign-in only —
 * staff send nothing in a business's name, and a viewer reads (BusinessMemberGuard).
 *
 * Declared static routes first, so `account` or `book` is never read as a parcel id.
 */
@Controller('sbg')
@UseGuards(BusinessMemberGuard)
export class BusinessParcelController {
  constructor(
    private readonly businesses: BusinessService,
    private readonly parcels: BusinessParcelService,
  ) {}

  /** The parcel account: its balance, a payment waiting to be confirmed — or whether one can be opened here. */
  @Roles('business')
  @Get('business/me/parcels/account')
  account(@Actor() actor: IntrospectionResult): BusinessParcelAccountView {
    return this.parcels.account(memberActor(this.businesses.requireMember(actor)));
  }

  /** Open it. Asked again, it answers the one there is. */
  @Roles('business')
  @Post('business/me/parcels/account')
  open(@Actor() actor: IntrospectionResult): BusinessParcelAccountView {
    return this.parcels.open(memberActor(this.businesses.requireMember(actor)));
  }

  /** Ask to pay money in, by M-Pesa or bank. A payment rail confirms it; nothing is credited before. */
  @Roles('business')
  @Post('business/me/parcels/top-up')
  topUp(@Body() dto: BusinessTopUpDto, @Actor() actor: IntrospectionResult): Promise<BusinessParcelAccountView> {
    return this.parcels.topUp(memberActor(this.businesses.requireMember(actor)), dto.amount, dto.phone);
  }

  /** The account's book: top-ups, parcels paid, money back. */
  @Roles('business')
  @Get('business/me/parcels/book')
  book(@Query() query: VendorLedgerQueryDto, @Actor() actor: IntrospectionResult): ParcelBook {
    return this.parcels.book(memberActor(this.businesses.requireMember(actor)), query);
  }

  /** What a parcel would cost: from a shop or from its own place (`origin=own`), to a shop. */
  @Roles('business')
  @Get('business/me/parcels/price')
  price(@Query() q: ParcelPriceQueryDto, @Actor() actor: IntrospectionResult): ParcelPriceView {
    return this.parcels.price(memberActor(this.businesses.requireMember(actor)), { origin: q.origin, dest: q.dest, l: q.l, w: q.w, h: q.h, kg: q.kg, fragile: q.fragile === 'true' });
  }

  /** One of its own places as where drivers collect its parcels (2026-10-29). */
  @Roles('business')
  @Post('business/me/parcels/collect-from')
  collectFrom(@Body() dto: BusinessCollectFromDto, @Actor() actor: IntrospectionResult): BusinessParcelAccountView {
    return this.parcels.collectFrom(memberActor(this.businesses.requireMember(actor)), dto.siteId, dto.bays);
  }

  /** Stop collecting there. */
  @Roles('business')
  @Delete('business/me/parcels/collect-from')
  stopCollecting(@Actor() actor: IntrospectionResult): BusinessParcelAccountView {
    return this.parcels.stopCollecting(memberActor(this.businesses.requireMember(actor)));
  }

  /** The day's bagging at its own place. */
  @Roles('business')
  @Get('business/me/parcels/dock')
  dock(@Actor() actor: IntrospectionResult): DockView {
    return this.parcels.dockView(memberActor(this.businesses.requireMember(actor)));
  }

  @Roles('business')
  @Post('business/me/parcels/dock/bags')
  openBag(@Body() dto: BusinessOpenBagDto, @Actor() actor: IntrospectionResult): DockView {
    return this.parcels.openBag(memberActor(this.businesses.requireMember(actor)), dto.destZone);
  }

  @Roles('business')
  @Post('business/me/parcels/dock/bags/:code/parcels')
  fillBag(@Param('code') code: string, @Body() dto: BusinessFillBagDto, @Actor() actor: IntrospectionResult): DockView {
    return this.parcels.fillBag(memberActor(this.businesses.requireMember(actor)), code, dto.parcelId);
  }

  /** Close a bag for the road: drivers near are told it is ready. */
  @Roles('business')
  @Post('business/me/parcels/dock/bags/:code/seal')
  sealBag(@Param('code') code: string, @Body() dto: BusinessSealBagDto, @Actor() actor: IntrospectionResult): DockView {
    return this.parcels.sealBag(memberActor(this.businesses.requireMember(actor)), code, dto);
  }

  /** The parcels it sent, newest first, searched and paged. */
  @Roles('business')
  @Get('business/me/parcels')
  list(@Query() query: VendorOrdersQueryDto, @Actor() actor: IntrospectionResult): BusinessParcelList {
    return this.parcels.list(memberActor(this.businesses.requireMember(actor)), query);
  }

  /** Send one, from a shop to a shop. Paid from the balance; its label is given once paid. */
  @Roles('business')
  @Post('business/me/parcels')
  send(@Body() dto: BusinessParcelDto, @Actor() actor: IntrospectionResult): BusinessParcelSent {
    return this.parcels.send(memberActor(this.businesses.requireMember(actor)), dto);
  }

  @Roles('business')
  @Get('business/me/parcels/:parcelId')
  detail(@Param('parcelId') parcelId: string, @Actor() actor: IntrospectionResult): BusinessParcelDetail {
    return this.parcels.detail(memberActor(this.businesses.requireMember(actor)), parcelId);
  }

  /** Its label, to print, once paid. */
  @Roles('business')
  @Get('business/me/parcels/:parcelId/label')
  label(@Param('parcelId') parcelId: string, @Actor() actor: IntrospectionResult): BusinessParcelLabel {
    return this.parcels.label(memberActor(this.businesses.requireMember(actor)), parcelId);
  }

  /** Pay for one the balance did not cover when it was sent. */
  @Roles('business')
  @Post('business/me/parcels/:parcelId/pay')
  pay(@Param('parcelId') parcelId: string, @Actor() actor: IntrospectionResult): BusinessParcelSent {
    return this.parcels.settle(memberActor(this.businesses.requireMember(actor)), parcelId);
  }

  /** What calling it off would do now. */
  @Roles('business')
  @Get('business/me/parcels/:parcelId/call-off')
  @ApiQuery({ name: 'backTo', required: false, description: 'Collected from its own place and at a hub: door, to bring it back there' })
  callOffPreview(@Param('parcelId') parcelId: string, @Query('backTo') backTo: string | undefined, @Actor() actor: IntrospectionResult): BusinessCallOffView {
    return this.parcels.callOffPreview(memberActor(this.businesses.requireMember(actor)), parcelId, backTo === 'door' ? 'door' : undefined);
  }

  /** Call it off: withdrawn with its money back, or brought back from a hub at a price. */
  @Roles('business')
  @Post('business/me/parcels/:parcelId/call-off')
  callOff(@Param('parcelId') parcelId: string, @Body() dto: BusinessCallOffDto, @Actor() actor: IntrospectionResult): BusinessCallOffView {
    return this.parcels.callOff(memberActor(this.businesses.requireMember(actor)), parcelId, dto.reason, { ...(dto.backTo ? { backTo: dto.backTo } : {}), ...(dto.maxSpend != null ? { maxSpend: dto.maxSpend } : {}) });
  }
}
