import { Body, Controller, Param, Post } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { CloseBagDto } from './bag-closure.types';
import { MdpService } from './mdp.service';

/** Staff pass every role check: a bag is closed by whoever has it in their hands, so a staff sign-in is refused by name. */
const HOLDER_ONLY = 'A bag is closed by the shop or hub that has it: staff read it';

/**
 * ROUND 36 — A BAG CLOSED FOR THE ROAD where it stands (bag-closure.types.ts): a hub's bag, or a bag at a shop that is not
 * the shop's own bag (that one is closed with "Close the bag"). Its coded seal's number and a photograph, or a photograph.
 */
@Controller('sbg')
export class BagClosureController {
  constructor(private readonly mdps: MdpService) {}

  @Roles('agent', 'mdp')
  @Post('totes/:code/close')
  @AtTheCounter()
  close(@Param('code') code: string, @Body() dto: CloseBagDto, @Actor() actor: IntrospectionResult) {
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', HOLDER_ONLY);
    if (!actor?.did) throw new GlosError('UNAUTHORIZED', 'Sign in at the shop or the hub');
    const closure = { seal: dto.seal, photoRef: dto.photoRef };
    if (actor.role === 'mdp') {
      const hub = this.mdps.list().find((m) => m.did === actor.did);
      if (!hub) throw new GlosError('FORBIDDEN', 'Only the hub can do this, from its own sign-in');
      return this.mdps.closeBag(code, { mdpId: hub.mdpId }, actor.actorName, closure, dto.observedAt);
    }
    return this.mdps.closeBag(code, { shopDid: actor.did }, actor.actorName, closure, dto.observedAt);
  }
}
