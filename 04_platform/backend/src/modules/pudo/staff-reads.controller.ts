import { Controller, Get, Query } from '@nestjs/common';
import { ApiQuery } from '@nestjs/swagger';
import { Actor } from '../../foundation/auth/actor.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { StaffReadService } from './staff-reads.service';
import { StaffReadList } from './staff-reads.types';

/** WHAT STAFF OPENED (staff-reads.types.ts): the log, to staff — and their reading it noted in it too. */
@Controller('sbg')
export class StaffReadController {
  constructor(private readonly reads: StaffReadService) {}

  @Roles('operator')
  @Get('staff-reads')
  @ApiQuery({ name: 'by', required: false, description: 'A member of staff, by name (part of it will do).' })
  @ApiQuery({ name: 'record', required: false, description: 'A record, by its number, code or id (part of it will do).' })
  list(@Query('by') by: string | undefined, @Query('record') record: string | undefined, @Actor() actor: IntrospectionResult): StaffReadList {
    const answer = this.reads.list({ by, record });
    this.reads.note(actor, 'GET /v1/sbg/staff-reads', [by ? `by ${by.trim()}` : '', record ? `record ${record.trim()}` : ''].filter(Boolean).join(' · ') || 'the whole log');
    return answer;
  }
}
