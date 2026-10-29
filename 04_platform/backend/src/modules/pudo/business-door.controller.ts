import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { actingDid } from '../../foundation/auth/acting';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';
import { GlosError } from '../../foundation/http/glos-error';
import { AgentService } from './agent.service';
import { BusinessDoorService, type ShopDoorHandover } from './business-door.service';
import { HandToDriverDto } from './call-off.types';

/**
 * AT THE SHOP'S COUNTER: A BUSINESS'S PARCEL GOING ON TO ITS OWN DOOR (the user, 2026-10-29: "At the nearest shop"). The shop
 * keeps it on its shelf and hands it only to the driver who took its load — their pass scanned at the counter, as a hub hands
 * a store's box over. The shop's own act: staff read the list to help, and hand nothing over in a shop's name.
 */
@Controller('sbg')
export class BusinessDoorController {
  constructor(
    private readonly doors: BusinessDoorService,
    private readonly agents: AgentService,
  ) {}

  /** The parcels here waiting for the driver of the load that takes them to their business's door. */
  @Roles('agent', 'operator')
  @Get('agents/:did/door-handovers')
  @AtTheCounter()
  handovers(@Param('did') did: string, @Actor() actor: IntrospectionResult): ShopDoorHandover[] {
    this.shop(did, actor, true);
    return this.doors.handoversAt(did);
  }

  /** Hand one to the driver who took its load, by their pass. */
  @Roles('agent', 'operator')
  @Post('agents/:did/door-handovers/:parcelId')
  @AtTheCounter()
  hand(@Param('did') did: string, @Param('parcelId') parcelId: string, @Body() dto: HandToDriverDto, @Actor() actor: IntrospectionResult): ShopDoorHandover[] {
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A shop hands over at its own counter, signed in as the shop. Staff hand nothing over in its name');
    const shop = this.shop(did, actor);
    return this.doors.hand(did, parcelId, dto.badge, actor?.actorName?.trim() || shop.shopName);
  }

  private shop(did: string, actor: IntrospectionResult, staffMayRead = false) {
    const shop = this.agents.get(did); // 404 if unknown
    if (staffMayRead && actor?.role === 'operator') return shop;
    if (actingDid(actor) !== did) throw new GlosError('FORBIDDEN', 'Only the shop can do this, from its own sign-in');
    return shop;
  }
}
