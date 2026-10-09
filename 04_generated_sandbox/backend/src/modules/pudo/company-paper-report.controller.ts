import { Body, Controller, Get, Header, HttpCode, Param, Post, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { CompanyPaperReportService, PaperCaseView, type Reporter } from '../../foundation/entity/company-paper-reports.service';
import { EntityService } from '../../foundation/entity/entity.service';
import { GlosError } from '../../foundation/http/glos-error';
import { AnswerPaperReportDto, DecidePaperReportDto, PaperCaseList, ReportPaperDto } from './pudo.dto';
import { staffOf } from './staff-of';


/**
 * A COMPANY'S PAPER, REPORTED (company-paper-reports.service.ts). Three kinds of caller, three doors:
 *
 *  - SOMEBODY SIGNED IN AND CONNECTED TO THE COMPANY reports a paper they can see. Today a company's papers are shown
 *    to network staff and to the administrators of the company and of the company above it; those are the reporters.
 *  - THE COMPANY answers: one of its own administrators, and never staff in its place.
 *  - STAFF read the reports and what was attached, dismiss one, or strike the paper — proposed by one of them and
 *    approved by another.
 *
 * `@Roles` keeps everybody BUT staff out of a route (a staff token passes every labelled one), so the two doors that
 * are not staff's say so themselves.
 */
@Controller('sbg')
export class CompanyPaperReportController {
  constructor(
    private readonly reports: CompanyPaperReportService,
    private readonly entities: EntityService,
  ) {}

  @Roles('operator', 'entity_admin')
  @Post('entities/:entityId/documents/:documentId/report')
  async report(@Param('entityId') entityId: string, @Param('documentId') documentId: string, @Body() dto: ReportPaperDto, @Actor() actor: IntrospectionResult) {
    const reporter = this.connected(actor, entityId, dto.by);
    const made = await this.reports.report({ entityId, documentId, category: dto.category, note: dto.note, evidenceDataUrl: dto.evidenceDataUrl, reporter });
    // Not who was told, and nothing of the case: the reporter learns that it was taken, and until when the company may answer.
    return { caseId: made.caseId, reportId: made.reportId, answerBy: made.answerBy };
  }

  @Roles('entity_admin')
  @Post('paper-reports/:caseId/answer')
  @HttpCode(200)
  answer(@Param('caseId') caseId: string, @Body() dto: AnswerPaperReportDto, @Actor() actor: IntrospectionResult): PaperCaseView {
    // The company answers for itself. Staff answering in its place would be staff deciding both sides.
    if (actor?.role !== 'entity_admin' || !this.entities.mayAdminister(actor.tenant, this.reports.entityOf(caseId))) throw new GlosError('NOT_FOUND', 'No such report');
    return this.reports.answer({ caseId, note: dto.note, evidenceDataUrl: dto.evidenceDataUrl, by: actor.actorName });
  }

  @Roles('operator')
  @Get('paper-reports')
  list(@Actor() actor: IntrospectionResult): PaperCaseList {
    return { items: this.reports.list(this.keyOf(actor)), waiting: this.reports.waiting() };
  }

  @Roles('operator')
  @Get('paper-reports/:caseId')
  one(@Param('caseId') caseId: string, @Actor() actor: IntrospectionResult): PaperCaseView {
    return this.reports.one(caseId, this.keyOf(actor));
  }

  /** What a reporter, or the company, attached — with the fingerprint it arrived under and whether the bytes still match it. */
  @Roles('operator')
  @Get('paper-reports/:caseId/evidence/:evidenceId')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  evidence(@Param('caseId') caseId: string, @Param('evidenceId') evidenceId: string, @Res({ passthrough: true }) res: Response): StreamableFile {
    const file = this.reports.evidenceFile(caseId, evidenceId);
    res.setHeader('X-Fingerprint', file.fingerprint);
    res.setHeader('X-Fingerprint-Intact', String(file.intact));
    res.setHeader('Access-Control-Expose-Headers', 'X-Fingerprint, X-Fingerprint-Intact');
    return new StreamableFile(file.bytes, { type: file.contentType });
  }

  @Roles('operator')
  @Post('paper-reports/:caseId/dismiss')
  @HttpCode(200)
  dismiss(@Param('caseId') caseId: string, @Body() dto: DecidePaperReportDto, @Actor() actor: IntrospectionResult): Promise<PaperCaseView> {
    return this.reports.dismiss(caseId, dto.reason, staffOf(actor, dto.by));
  }

  @Roles('operator')
  @Post('paper-reports/:caseId/strike/propose')
  @HttpCode(200)
  proposeStrike(@Param('caseId') caseId: string, @Body() dto: DecidePaperReportDto, @Actor() actor: IntrospectionResult): PaperCaseView {
    return this.reports.proposeStrike(caseId, dto.reason, staffOf(actor, dto.by));
  }

  @Roles('operator')
  @Post('paper-reports/:caseId/strike/approve')
  @HttpCode(200)
  approveStrike(@Param('caseId') caseId: string, @Body() dto: DecidePaperReportDto, @Actor() actor: IntrospectionResult): Promise<PaperCaseView> {
    return this.reports.approveStrike(caseId, staffOf(actor, dto.by));
  }

  /**
   * WHO MAY REPORT: somebody signed in and CONNECTED to the company (the user, 2026-10-09). A member of staff; or an
   * administrator of the company itself or of the company above it. A stranger is told there is no such company —
   * not that there is one they may not report.
   */
  private connected(actor: IntrospectionResult, entityId: string, typed?: string): Reporter {
    if (actor?.role === 'operator') {
      const staff = staffOf(actor, typed);
      return { key: staff.key, name: staff.name, role: 'SeeBuyGet staff' };
    }
    if (actor?.role === 'entity_admin' && actor.actorName && this.entities.mayAdminister(actor.tenant, entityId)) {
      return { key: actor.revocationKey ?? `administrator:${actor.actorName}`, name: actor.actorName, role: actor.tenant === entityId ? 'an administrator of the company' : 'an administrator of the company above it' };
    }
    throw new GlosError('NOT_FOUND', `No such company: ${entityId}`);
  }

  /** Which member of staff is reading, where the sign-in can say: it is what "you proposed this" is told from. */
  private keyOf(actor: IntrospectionResult): string | undefined {
    try {
      return staffOf(actor).key;
    } catch {
      return undefined;
    }
  }
}
