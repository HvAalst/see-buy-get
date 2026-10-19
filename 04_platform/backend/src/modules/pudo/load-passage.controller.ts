import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { DispatchService } from './dispatch.service';
import { LoadPassageService } from './load-passage.service';
import { BorderWaitRow, PassageRecorded, RecordPassageDto } from './load-passage.types';

/**
 * A LOAD AT A BORDER OR A HUB (round 14). The driver carrying it says the step from the load in their app; staff read
 * every post's measured wait. The shipper, its system, the fleet's system and the tracking page read the steps with the
 * load (DispatchService.passageFacts), not here.
 */
@Controller('sbg')
export class LoadPassageController {
  constructor(
    private readonly dispatch: DispatchService,
    private readonly passages: LoadPassageService,
  ) {}

  /**
   * At a border post, cleared it, at a hub — said by the driver carrying the load, and nobody else: it is their word
   * about where they are. Staff pass every role check, so they are refused here by name rather than allowed to say it
   * in a driver's place.
   */
  @Roles('driver')
  @Post('dispatch/freight/:id/passages')
  record(@Param('id') id: string, @Body() dto: RecordPassageDto, @Actor() actor: IntrospectionResult): PassageRecorded {
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'A border or a hub is said by the driver carrying the load');
    if (!actor?.did) throw new GlosError('UNAUTHORIZED', 'Sign in as the driver carrying this load');
    return this.dispatch.recordPassage(id, actor.did, { kind: dto.kind, post: dto.post, hub: dto.hub, location: dto.location, observedAt: dto.observedAt, seals: dto.seals });
  }

  /** Every post's measured wait over the last ninety days, with how many crossings each rests on. */
  @Roles('operator')
  @Get('border-waits')
  waits(): BorderWaitRow[] {
    return this.passages.board();
  }
}
