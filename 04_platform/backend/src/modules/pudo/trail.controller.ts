import { Controller, Get, Param } from '@nestjs/common';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { TrailService } from './trail.service';
import { TrailView } from './trail.types';

/** THE TRAIL (trail.types.ts): a load's or a bag's anchored steps, checked, for staff. */
@Controller('sbg')
export class TrailController {
  constructor(private readonly trail: TrailService) {}

  @Roles('operator')
  @Get('ops/trail/:ref')
  of(@Param('ref') ref: string): TrailView {
    return this.trail.of(ref);
  }
}
