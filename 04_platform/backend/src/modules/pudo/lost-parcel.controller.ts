import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { DeclareLostDto, FoundAgainDto } from './lost-parcel.dto';
import { LostParcelService } from './lost-parcel.service';
import { LostParcelView } from './lost-parcel.types';
import { staffOf } from './staff-of';

/**
 * LOST AND FOUND, for network staff (lost-parcel.service.ts). Declared only after a week without a scan, with where they
 * looked; found again with where it turned up. Named, every time — in staff's own record, not on the parcel.
 */
@Controller('sbg')
export class LostParcelController {
  constructor(private readonly lost: LostParcelService) {}

  @Roles('operator')
  @Get('lost-parcels')
  list(): LostParcelView[] {
    return this.lost.list();
  }

  @Roles('operator')
  @Get('parcels/:id/lost')
  view(@Param('id') id: string): LostParcelView {
    return this.lost.view(id);
  }

  @Roles('operator')
  @Post('parcels/:id/lost')
  declare(@Param('id') id: string, @Body() dto: DeclareLostDto, @Actor() actor: IntrospectionResult): LostParcelView {
    return this.lost.declare(id, dto.reason, staffOf(actor, dto.by));
  }

  @Roles('operator')
  @Post('parcels/:id/found')
  found(@Param('id') id: string, @Body() dto: FoundAgainDto, @Actor() actor: IntrospectionResult): LostParcelView {
    return this.lost.found(id, dto.note, staffOf(actor, dto.by));
  }
}
