import { Body, Controller, Get, Optional, Param, Post, Query, Req } from '@nestjs/common';
import { COUNTRY_PICKED_HEADER, pickedScope } from '../../foundation/auth/staff-country.interceptor';
import { StaffCountryRegistry } from '../../foundation/auth/staff-country.registry';
import { EVERY_COUNTRY, reaches } from '../../foundation/auth/staff-countries';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { BagOfferDto, CaseDoneDto, CaseNoteDto, CaseStaffDto } from './flag-case.dto';
import { FlagCaseService } from './flag-case.service';
import { BagOfferService } from './bag-offer.service';
import { FlagCase, FlagCaseList } from './flag-case.types';
import { staffOf } from './staff-of';

/**
 * THE FLAGS AS CASES, for network staff (flag-case.types.ts): the live ones, the most pressing first, and the acts a
 * member of staff does on one — take it, let it go, note what was done, close it with a reason. Named, every time.
 */
@Controller('sbg')
export class FlagCaseController {
  constructor(
    private readonly cases: FlagCaseService,
    @Optional() private readonly countries?: StaffCountryRegistry,
    @Optional() private readonly bags?: BagOfferService,
  ) {}

  /** 2026-11-06 — a Bags_Waiting case's bags: where each goes, how long it has waited, and whether a driver is coming. */
  @Roles('operator')
  @Get('flag-cases/:caseId/bags')
  caseBags(@Param('caseId') caseId: string) {
    return this.bags!.bagsOf(caseId);
  }

  /** The working drivers an offer of this bag would reach now, nearest first. */
  @Roles('operator')
  @Get('totes/:code/drivers')
  bagDrivers(@Param('code') code: string) {
    return this.bags!.drivers(code);
  }

  /** Offer the bag straight to the driver staff chose: their own offer, a notice that opens it, a note on its case. */
  @Roles('operator')
  @Post('totes/:code/offer')
  offerBag(@Param('code') code: string, @Body() dto: BagOfferDto, @Actor() actor: IntrospectionResult) {
    return this.bags!.offer(code, dto.driverDid, staffOf(actor, dto.by));
  }

  @Roles('operator')
  @Get('flag-cases')
  list(@Query('which') which?: string, @Query('kind') kind?: string, @Actor() actor?: IntrospectionResult, @Req() req?: { header(name: string): string | undefined }): FlagCaseList {
    // The console's country picker, read off the request (not a parameter of the contract: nobody is asked to send it).
    const picked = req?.header(COUNTRY_PICKED_HEADER);
    // 2026-11-03 — a colleague in some countries only counts the cases of theirs (the rows are kept to them as well, by the
    // staff-country interceptor); somebody who works everywhere, and picked nothing, counts them all.
    const scope = actor?.staffCountries && this.countries ? pickedScope(picked, actor.staffCountries) : null;
    const inScope = scope
      ? (c: FlagCase) => {
          const touched = this.countries!.countriesOf('flag-subject', c.subject);
          return touched !== null && (touched.includes(EVERY_COUNTRY) || reaches(scope, touched));
        }
      : undefined;
    return this.cases.board(which === 'closed' || which === 'taken' ? which : 'live', kind || undefined, Date.now(), inScope);
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
