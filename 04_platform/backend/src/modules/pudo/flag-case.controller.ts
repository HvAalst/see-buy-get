import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { CaseDoneDto, CaseNoteDto, CaseStaffDto } from './flag-case.dto';
import { FlagCaseService } from './flag-case.service';
import { FlagCase, FlagCaseList } from './flag-case.types';
import { staffOf } from './staff-of';

/**
 * THE FLAGS AS CASES, for network staff (flag-case.types.ts): the live ones, the most pressing first, and the acts a
 * member of staff does on one — take it, let it go, note what was done, close it with a reason. Named, every time.
 */
@Controller('sbg')
export class FlagCaseController {
  constructor(private readonly cases: FlagCaseService) {}

  @Roles('operator')
  @Get('flag-cases')
  list(@Query('which') which?: string, @Query('kind') kind?: string): FlagCaseList {
    return this.cases.board(which === 'closed' || which === 'taken' ? which : 'live', kind || undefined);
  }

  @Roles('operator')
  @Post('flag-cases/:caseId/take')
  take(@Param('caseId') caseId: string, @Body() dto: CaseStaffDto, @Actor() actor: IntrospectionResult): FlagCase {
    return this.cases.take(caseId, staffOf(actor, dto?.by));
  }

  @Roles('operator')
  @Post('flag-cases/:caseId/let-go')
  letGo(@Param('caseId') caseId: string, @Body() dto: CaseStaffDto, @Actor() actor: IntrospectionResult): FlagCase {
    return this.cases.letGo(caseId, staffOf(actor, dto?.by));
  }

  @Roles('operator')
  @Post('flag-cases/:caseId/note')
  note(@Param('caseId') caseId: string, @Body() dto: CaseNoteDto, @Actor() actor: IntrospectionResult): FlagCase {
    return this.cases.note(caseId, staffOf(actor, dto.by), dto.text);
  }

  @Roles('operator')
  @Post('flag-cases/:caseId/done')
  done(@Param('caseId') caseId: string, @Body() dto: CaseDoneDto, @Actor() actor: IntrospectionResult): FlagCase {
    return this.cases.done(caseId, staffOf(actor, dto.by), dto.reason, dto.recheckHours ?? 24);
  }
}
