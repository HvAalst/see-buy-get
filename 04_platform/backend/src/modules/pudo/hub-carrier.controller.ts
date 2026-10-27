import { Body, Controller, Get, Param, Post, Put } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { HubCarrierMoveService } from './hub-carrier-move.service';
import { HubCarrierService } from './hub-carrier.service';
import { CarrierMovesView, CarrierMoveView, CarrierReturnJobDto, CarriersDoneDto, HubCarriersView, SendCarriersDto, SetHubCarriersDto } from './hub-carrier.types';
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
    private readonly moves: HubCarrierMoveService,
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

  /** D11 — its carriers on the move: its own, away; and other hubs', come to it. The floor works these, so its people read them. */
  @Roles('mdp', 'operator')
  @Get('mdps/:id/carrier-moves')
  @AtTheCounter()
  moveList(@Param('id') id: string, @Actor() actor: IntrospectionResult): CarrierMovesView {
    this.assertHub(id, actor, true);
    return this.moves.viewOf(id);
  }

  /** Carriers go with a driver to another hub — the pass scanned, as for a bag — and what happens to them there. Its floor's act. */
  @Roles('mdp', 'operator')
  @Post('mdps/:id/carrier-moves')
  @AtTheCounter()
  send(@Param('id') id: string, @Body() dto: SendCarriersDto, @Actor() actor: IntrospectionResult): CarrierMoveView {
    const hub = this.assertHub(id, actor, false);
    return this.moves.send(id, dto, actor?.actorName?.trim() || hub.name);
  }

  /** The other hub did what was said: counted back out to the driver, taken in as left, or kept aside. Its floor's act. */
  @Roles('mdp', 'operator')
  @Post('mdps/:id/carrier-moves/:moveId/done')
  @AtTheCounter()
  moveDone(@Param('id') id: string, @Param('moveId') moveId: string, @Body() dto: CarriersDoneDto, @Actor() actor: IntrospectionResult): CarrierMoveView {
    const hub = this.assertHub(id, actor, false);
    return this.moves.done(id, moveId, dto.count, actor?.actorName?.trim() || hub.name);
  }

  /**
   * The return job for its carriers kept aside at another hub (the user, 2026-10-27: "Post it as a job"): a load any driver
   * may take, which the hub pays — its owner's to post, as its fee is.
   */
  @Roles('mdp', 'operator')
  @Post('mdps/:id/carrier-moves/:moveId/return-job')
  returnJob(@Param('id') id: string, @Param('moveId') moveId: string, @Body() dto: CarrierReturnJobDto, @Actor() actor: IntrospectionResult): CarrierMoveView {
    const hub = this.assertHub(id, actor, false);
    return this.moves.postReturnJob(id, moveId, dto.weightKg, actor?.actorName?.trim() || hub.name);
  }

  /** The hub, signed in as itself — or, to read, network staff. Staff move nothing in a hub's name. */
  private assertHub(id: string, actor: IntrospectionResult, staffMayRead: boolean) {
    const hub = this.mdps.require(id); // 404 if unknown
    if (actor?.role === 'operator') {
      if (staffMayRead) return hub;
      throw new GlosError('FORBIDDEN', 'A hub moves its carriers signed in as the hub. Staff move nothing in its name');
    }
    if (!actor?.did || actor.did !== hub.did) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
    return hub;
  }
}
