import { Body, Controller, Get, HttpCode, Param, Post, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Public } from '../../foundation/auth/public.decorator';
import { Roles, SignedIn } from '../../foundation/auth/scopes.decorator';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { DamageReportService } from './damage-report.service';
import { AddDamageReportNoteDto, DamageReportLinkList, DamageReportLinkRow, DamageReportLinkView, DamageReportList, DamageReportNote, DamageReportTokenDto, DamageReportView, MadeDamageReportLink } from './damage-report.types';
import { AtTheCounter } from '../../foundation/auth/at-the-counter';

/**
 * THE DAMAGE CLAIM REPORT, from both ends.
 *
 * Signed in: whoever the report is for reads it, takes the file, and makes a link to pass on. WHO THAT IS is asked
 * inside, of the parcel itself (DamageReportService.reading): the receiver, the store on its own order, the shop that
 * reported it at its counter, staff. Anybody else is told there is no such report.
 *
 * Not signed in: whoever was handed a link opens it. Two public routes, the key in the request's BODY — a key in an
 * address is a key in every log that address passes through — and both limited per caller, like everything else here
 * a stranger can ask for.
 */
@Controller('sbg')
export class DamageReportController {
  constructor(private readonly reports: DamageReportService) {}

  /** Every problem reported, newest first. Staff read; nothing here is decided by them. */
  @Roles('operator')
  @Get('damage-reports')
  list(): DamageReportList {
    return { items: this.reports.list() };
  }

  /** The report on one parcel, for whoever it is for. */
  @SignedIn()
  @Get('parcels/:id/damage-report')
  @AtTheCounter()
  read(@Param('id') id: string, @Actor() actor: IntrospectionResult): DamageReportView {
    return this.reports.read(id, actor);
  }

  /** The file: the report to read or print, the same facts for a machine, and the photographs. */
  @SignedIn()
  @Get('parcels/:id/damage-report/file')
  @AtTheCounter()
  file(@Param('id') id: string, @Actor() actor: IntrospectionResult, @Res({ passthrough: true }) res: Response): StreamableFile {
    const file = this.reports.file(id, actor);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(file.bytes, { type: 'application/zip' });
  }

  /** The links the caller made on this report. */
  /**
   * The receiver adds what they found after the parcel was handed over: a note beside the report, which itself does not
   * change. Refused to anybody else, and before handover (DamageReportService.addNote).
   */
  @SignedIn()
  @Post('parcels/:id/damage-report/notes')
  @AtTheCounter()
  addNote(@Param('id') id: string, @Body() dto: AddDamageReportNoteDto, @Actor() actor: IntrospectionResult): DamageReportNote {
    return this.reports.addNote(id, actor, { text: dto.text, photoRefs: dto.photoRefs });
  }

  @SignedIn()
  @Get('parcels/:id/damage-report/links')
  @AtTheCounter()
  links(@Param('id') id: string, @Actor() actor: IntrospectionResult): DamageReportLinkList {
    return { items: this.reports.linksFor(id, actor) };
  }

  /** Make a link to pass on. The address in the answer is shown this once: the key is not kept. */
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @SignedIn()
  @Post('parcels/:id/damage-report/links')
  @AtTheCounter()
  makeLink(@Param('id') id: string, @Actor() actor: IntrospectionResult): MadeDamageReportLink {
    return this.reports.makeLink(id, actor);
  }

  /** Cancel one: it opens nothing from now on. */
  @SignedIn()
  @Post('parcels/:id/damage-report/links/:linkId/cancel')
  @HttpCode(200)
  @AtTheCounter()
  cancelLink(@Param('id') id: string, @Param('linkId') linkId: string, @Actor() actor: IntrospectionResult): DamageReportLinkRow {
    return this.reports.cancelLink(id, linkId, actor);
  }

  /** What this link is, before the file is taken — or which way it stopped. */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(60, 15 * 60)
  @Post('damage-report-links/look')
  @HttpCode(200)
  look(@Body() dto: DamageReportTokenDto): DamageReportLinkView {
    return this.reports.look(dto.token);
  }

  /** The file, for whoever holds a link that still opens. */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('damage-report-links/fetch')
  @HttpCode(200)
  fetch(@Body() dto: DamageReportTokenDto, @Res({ passthrough: true }) res: Response): StreamableFile {
    const file = this.reports.fetch(dto.token);
    res.setHeader('Content-Disposition', `attachment; filename="${file.filename}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return new StreamableFile(file.bytes, { type: 'application/zip' });
  }
}
