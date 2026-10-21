import { Body, Controller, Param, Post, UseInterceptors } from '@nestjs/common';
import { CounterLogInterceptor } from './shop-staff.controller';
import { Actor } from '../../foundation/auth/actor.decorator';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { CloseBagDto, TakeBagDto } from './bag-closure.types';
import { DriverService } from './driver.service';
import { MdpService } from './mdp.service';

/** Staff pass every role check: a bag is closed by whoever has it in their hands, so a staff sign-in is refused by name. */
const HOLDER_ONLY = 'A bag is closed by the shop or hub that has it: staff read it';

/**
 * ROUND 36 — A BAG CLOSED FOR THE ROAD where it stands (bag-closure.types.ts): a hub's bag, or a bag at a shop that is not
 * the shop's own bag (that one is closed with "Close the bag"). Its coded seal's number and a photograph, or a photograph.
 */
@Controller('sbg')
@UseInterceptors(CounterLogInterceptor)
export class BagClosureController {
  constructor(
    private readonly mdps: MdpService,
    private readonly drivers: DriverService,
  ) {}

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

  /** Round 37 — the driver carrying a bag reads its seal: after a hub or shop loaded it onto them by their pass. */
  @Roles('driver')
  @Post('totes/:code/take')
  take(@Param('code') code: string, @Body() dto: TakeBagDto, @Actor() actor: IntrospectionResult) {
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A bag is read by the driver carrying it');
    if (!actor?.did) throw new GlosError('UNAUTHORIZED', 'Sign in as the driver carrying this bag');
    return this.mdps.takeBag(code, actor.did, actor.actorName || this.drivers.get(actor.did).displayName, { sealNumber: dto.sealNumber, photoRef: dto.photoRef, asClosed: dto.asClosed }, dto.observedAt);
  }
}
