import { Body, Controller, Get, Param, Put } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { MdpService } from './mdp.service';
import { SetHubSpaceDto } from './pudo.dto';
import { HubSpaceView } from './pudo.types';

/**
 * 2026-11-02 — A HUB'S SPACE (the owner: "shouldn't a hub also declare its space?"; hub-space.ts): how many bags its floor
 * holds and how many parcels it sorts a day, against what stands there now. Read by the hub — its owner and the people
 * working its floor — and by network staff; said by its owner alone, as its fee is: not its people (the guard refuses
 * them every door not marked for the floor), and not staff, who change nothing in a hub's name.
 */
@Controller('sbg')
export class HubSpaceController {
  constructor(private readonly mdps: MdpService) {}

  /** What its floor holds now: bags waiting to be sorted and going out, of its places; parcels sorted today, of its day's. */
  @Roles('mdp', 'operator')
  @Get('mdps/:id/space')
  @AtTheCounter()
  read(@Param('id') id: string, @Actor() actor: IntrospectionResult): HubSpaceView {
    const hub = this.mdps.require(id); // 404 if unknown
    if (actor?.role !== 'operator' && (!actor?.did || actor.did !== hub.did)) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
    return this.mdps.spaceOf(hub);
  }

  /** Its owner says how many bags its floor holds at once, and how many parcels it sorts in a day. */
  @Roles('mdp', 'operator')
  @Put('mdps/:id/space')
  write(@Param('id') id: string, @Body() dto: SetHubSpaceDto, @Actor() actor: IntrospectionResult): HubSpaceView {
    const hub = this.mdps.require(id); // 404 if unknown
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A hub says its own space, signed in as the hub: how many bags its floor holds is its owner’s word. Staff change nothing in its name');
    if (!actor?.did || actor.did !== hub.did) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
    return this.mdps.setSpace(id, { bagPlaces: dto.bagPlaces, sortPerDay: dto.sortPerDay });
  }
}
