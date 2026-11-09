import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { auditActor } from '../../foundation/auth/acting';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { CatchmentService, HubZonesView } from './catchment.service';
import { HubCounterService, HubCounterView } from './hub-counter.service';
import { MdpService } from './mdp.service';
import { HubCounterDto, HubZoneServeDto } from './pudo.dto';

/**
 * 2026-11-09 — THE ZONES A HUB SERVES, from its own app (a net of hubs; the owner: "Own zone + hub adds"). The zone its
 * pin stands in is always its own (staff may take it away); it adds neighbouring zones itself, and stops serving those.
 * Read by the hub — its owner and the people on its floor — and by staff; changed by its owner alone, as its space is:
 * staff add or take away a hub on the console's Zones screen, never in the hub's name.
 */
@Controller('sbg')
export class HubZonesController {
  constructor(
    private readonly mdps: MdpService,
    private readonly catchments: CatchmentService,
    private readonly counters: HubCounterService,
  ) {}

  /** 2026-11-09 — what the hub does: sort only, or sort and hand out at its counter (a shop worked in the Shop app). */
  @Roles('mdp', 'operator')
  @Get('mdps/:id/counter')
  @AtTheCounter()
  counter(@Param('id') id: string, @Actor() actor: IntrospectionResult): HubCounterView {
    const hub = this.mdps.require(id); // 404 if unknown
    if (actor?.role !== 'operator' && (!actor?.did || actor.did !== hub.did)) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
    return this.counters.view(id);
  }

  /** Its owner chooses: sort only, or sort and hand out — the first time with the counter's shelf and fee. */
  @Roles('mdp', 'operator')
  @Post('mdps/:id/counter')
  setCounter(@Param('id') id: string, @Body() dto: HubCounterDto, @Actor() actor: IntrospectionResult): HubCounterView {
    const hub = this.mdps.require(id); // 404 if unknown
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A hub chooses whether it hands out, signed in as the hub: staff change nothing in its name');
    if (!actor?.did || actor.did !== hub.did) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
    return dto.mode === 'sort' ? this.counters.sortOnly(id) : this.counters.handOut(id, { rows: dto.rows, cols: dto.cols, pricePerParcel: dto.pricePerParcel }, auditActor(actor));
  }

  @Roles('mdp', 'operator')
  @Get('mdps/:id/zones-served')
  @AtTheCounter()
  read(@Param('id') id: string, @Actor() actor: IntrospectionResult): HubZonesView {
    const hub = this.mdps.require(id); // 404 if unknown
    if (actor?.role !== 'operator' && (!actor?.did || actor.did !== hub.did)) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
    return this.catchments.ofHub(id);
  }

  @Roles('mdp', 'operator')
  @Post('mdps/:id/zones-served/:code')
  serve(@Param('id') id: string, @Param('code') code: string, @Body() dto: HubZoneServeDto, @Actor() actor: IntrospectionResult): HubZonesView {
    const hub = this.mdps.require(id); // 404 if unknown
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A hub adds its own zones, signed in as the hub. Staff add or take away a hub on the Zones screen, never in its name');
    if (!actor?.did || actor.did !== hub.did) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
    return this.catchments.setServingByHub(id, code, dto.serve, auditActor(actor));
  }
}
