import { Controller, Get } from '@nestjs/common';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { PilotService } from './pilot.service';
import { PilotBoard } from './pilot.types';

/** THE PILOT, WEEK BY WEEK, for network staff (pilot.types.ts): the week so far, every frozen week, the targets. */
@Controller('sbg')
export class PilotController {
  constructor(private readonly pilot: PilotService) {}

  @Roles('operator')
  @Get('pilot')
  board(): PilotBoard {
    return this.pilot.board();
  }
}
