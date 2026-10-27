import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { HubCarrierService } from './hub-carrier.service';
import { HubCarriersView, SetHubCarriersDto } from './hub-carrier.types';
import { MdpService } from './mdp.service';

/**
 * A HUB'S CARRIERS — the pallets, roll cages and crates it moves bags on between hubs (hub-carrier.types.ts). Read by the
 * hub, its owner and the people working its floor, and by network staff; written by its owner alone, as the hub's own word.
 */
@Controller('sbg')
export class HubCarrierController {
  constructor(
    private readonly carriers: HubCarrierService,
    private readonly mdps: MdpService,
  ) {}

  /** The kinds the hub keeps, each with what it holds, worked out. */
  @Roles('mdp', 'operator')
  @Get('mdps/:id/carriers')
  @AtTheCounter()
  read(@Param('id') id: string, @Actor() actor: IntrospectionResult): HubCarriersView {
    const hub = this.mdps.require(id); // 404 if unknown
    if (actor?.role !== 'operator' && (!actor?.did || actor.did !== hub.did)) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
    return this.carriers.viewOf(id);
  }

  /** Its owner writes the list, whole. Not its people, and not network staff: what a hub moves bags on is its own word. */
  @Roles('mdp', 'operator')
  @Put('mdps/:id/carriers')
  write(@Param('id') id: string, @Body() dto: SetHubCarriersDto, @Actor() actor: IntrospectionResult): HubCarriersView {
    const hub = this.mdps.require(id); // 404 if unknown
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A hub says what it moves bags on, signed in as the hub. Staff change nothing in its name');
    if (!actor?.did || actor.did !== hub.did) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
    return this.carriers.set(id, dto.carriers, actor?.actorName?.trim() || hub.name);
  }
}
