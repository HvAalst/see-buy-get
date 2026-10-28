import { Body, Controller, Get, Header, Param, Post, Query, Res, StreamableFile, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { actingTenant, auditActor } from '../../foundation/auth/acting';
import { Actor } from '../../foundation/auth/actor.decorator';
import { Roles } from '../../foundation/auth/scopes.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { EntityService } from '../../foundation/entity/entity.service';
import { GlosError } from '../../foundation/http/glos-error';
import { BusinessMemberGuard } from './business-member.guard';
import { ExportService } from './export.service';
import {
  isExportPaperKey,
  ExportAddPaperDto,
  ExportAppointAgentDto,
  ExportBillOfLadingDto,
  ExportContainerDto,
  ExportDetail,
  ExportEndAgentDto,
  ExportFeeDto,
  ExportFreeDaysDto,
  ExportOwnBoxDto,
  ExportLadenLegDto,
  ExportMomentDto,
  ExportPaperDto,
  ExportPaperRefusalDto,
  ExportRow,
  ExportVgmDto,
  RegisterExportDto,
  type ExportPaperKey,
} from './export.types';

/**
 * EXPORTS TO THE PORT (the user, 2026-10-27; design 05_engineering/exports_to_the_port.md). The exporter's — a business, or
 * a company's administrator — to write; network staff read every one and write none: what an exporter booked with its
 * forwarder, what it weighed and which papers it holds are its own word, never staff's in its name.
 */
@ApiTags('sbg')
@Controller('sbg/exports')
@UseGuards(BusinessMemberGuard)
export class ExportController {
  constructor(
    private readonly exports: ExportService,
    private readonly entities: EntityService,
  ) {}

  @Roles('business', 'entity_admin')
  @Post()
  register(@Body() dto: RegisterExportDto, @Actor() actor: IntrospectionResult) {
    const exporterEntityId = this.ownCompany(actor, dto.exporterEntityId);
    return this.exports.register({ ...dto, exporterEntityId }, auditActor(actor, dto.by));
  }

  @Roles('business', 'entity_admin', 'operator')
  @ApiQuery({ name: 'entityId', required: false })
  @Get()
  list(@Actor() actor: IntrospectionResult, @Query('entityId') entityId?: string): { items: ExportRow[] } {
    if (actor?.role === 'operator') return { items: this.exports.list(entityId ?? '', { all: !entityId }) };
    return { items: this.exports.list(this.ownCompany(actor, entityId)) };
  }

  @Roles('business', 'entity_admin', 'operator')
  @Get(':exportId')
  detail(@Param('exportId') exportId: string, @Actor() actor: IntrospectionResult): ExportDetail {
    return actor?.role === 'operator' ? this.exports.detail(exportId, '', { all: true }) : this.exports.detail(exportId, this.ownCompany(actor));
  }

  /** The file the forwarder takes at the gate, printable. */
  @Roles('business', 'entity_admin', 'operator')
  @Header('Content-Type', 'text/html; charset=utf-8')
  @Get(':exportId/handover.html')
  handover(@Param('exportId') exportId: string, @Actor() actor: IntrospectionResult): string {
    return actor?.role === 'operator' ? this.exports.handoverHtml(exportId, '', { all: true }) : this.exports.handoverHtml(exportId, this.ownCompany(actor));
  }

  @Roles('business', 'entity_admin')
  @Post(':exportId/container')
  container(@Param('exportId') exportId: string, @Body() dto: ExportContainerDto, @Actor() actor: IntrospectionResult): ExportDetail {
    return this.exports.setContainer(exportId, this.ownCompany(actor), dto.containerNo);
  }

  @Roles('business', 'entity_admin')
  @Post(':exportId/empty-leg')
  emptyLeg(@Param('exportId') exportId: string, @Actor() actor: IntrospectionResult): ExportDetail {
    return this.exports.mintEmptyLeg(exportId, this.ownCompany(actor), auditActor(actor));
  }

  @Roles('business', 'entity_admin')
  @Post(':exportId/laden-leg')
  ladenLeg(@Param('exportId') exportId: string, @Body() dto: ExportLadenLegDto, @Actor() actor: IntrospectionResult): ExportDetail {
    return this.exports.mintLadenLeg(exportId, this.ownCompany(actor), { weightKg: dto.weightKg }, auditActor(actor));
  }

  @Roles('business', 'entity_admin')
  @Post(':exportId/vgm')
  vgm(@Param('exportId') exportId: string, @Body() dto: ExportVgmDto, @Actor() actor: IntrospectionResult): ExportDetail {
    return this.exports.declareVgm(exportId, this.ownCompany(actor), dto, auditActor(actor));
  }

  @Roles('business', 'entity_admin')
  @Post(':exportId/papers')
  paper(@Param('exportId') exportId: string, @Body() dto: ExportPaperDto, @Actor() actor: IntrospectionResult): ExportDetail {
    // The exporter supplies its papers; its appointed agent gives the export entry (the service tells them apart).
    return this.exports.supplyPaper(exportId, this.ownCompany(actor), dto, auditActor(actor));
  }

  @Roles('business', 'entity_admin')
  @Post(':exportId/bill-of-lading')
  billOfLading(@Param('exportId') exportId: string, @Body() dto: ExportBillOfLadingDto, @Actor() actor: IntrospectionResult): ExportDetail {
    return this.exports.recordBillOfLading(exportId, this.ownCompany(actor), dto.number, auditActor(actor));
  }

  /* ------------------------------------------------------- EX6 the box's clock -- */

  /** How many free days the line gives, outside the terminal (detention) or inside it (demurrage) — the exporter's figure. */
  @Roles('business', 'entity_admin')
  @Post(':exportId/free-days')
  freeDays(@Param('exportId') exportId: string, @Body() dto: ExportFreeDaysDto, @Actor() actor: IntrospectionResult): ExportDetail {
    return this.exports.claimFreeDays(exportId, this.ownCompany(actor), dto.kind, dto.days, auditActor(actor));
  }

  /** When the empty left the depot, where no load of ours fetched it. */
  @Roles('business', 'entity_admin')
  @Post(':exportId/empty-out')
  emptyOut(@Param('exportId') exportId: string, @Body() dto: ExportMomentDto, @Actor() actor: IntrospectionResult): ExportDetail {
    return this.exports.recordEmptyOut(exportId, this.ownCompany(actor), dto.at, auditActor(actor));
  }

  /** Loaded on board, from the forwarder's or the line's word: the box's clock stops. */
  @Roles('business', 'entity_admin')
  @Post(':exportId/loaded')
  loaded(@Param('exportId') exportId: string, @Body() dto: ExportMomentDto, @Actor() actor: IntrospectionResult): ExportDetail {
    return this.exports.recordLoaded(exportId, this.ownCompany(actor), dto.at, auditActor(actor));
  }

  /** The box is the exporter's own (a shipper-owned container) — or the line's after all. */
  @Roles('business', 'entity_admin')
  @Post(':exportId/own-box')
  ownBox(@Param('exportId') exportId: string, @Body() dto: ExportOwnBoxDto, @Actor() actor: IntrospectionResult): ExportDetail {
    return this.exports.setOwnBox(exportId, this.ownCompany(actor), dto.own, auditActor(actor));
  }

  /* ------------------------------------------------------- EX8 the agent's fee -- */

  /** The appointed agent quotes its fee: a quotation to the exporter, never a payment through us. */
  @Roles('business', 'entity_admin')
  @Post(':exportId/fee')
  quoteFee(@Param('exportId') exportId: string, @Body() dto: ExportFeeDto, @Actor() actor: IntrospectionResult): ExportDetail {
    return this.exports.quoteFee(exportId, this.ownCompany(actor), dto, auditActor(actor));
  }

  /** The exporter agrees to the figure. Whether it is paid, either of them says on the quotation itself. */
  @Roles('business', 'entity_admin')
  @Post(':exportId/fee/accept')
  acceptFee(@Param('exportId') exportId: string, @Actor() actor: IntrospectionResult): ExportDetail {
    return this.exports.acceptFee(exportId, this.ownCompany(actor), auditActor(actor));
  }

  /* --------------------------------------------------- EX7 the clearing agent -- */

  /** Appoint a clearing agent, chosen from the agents' directory — the exporter's decision alone. */
  @Roles('business', 'entity_admin')
  @Post(':exportId/agent')
  appointAgent(@Param('exportId') exportId: string, @Body() dto: ExportAppointAgentDto, @Actor() actor: IntrospectionResult): ExportDetail {
    return this.exports.appointAgent(exportId, this.ownCompany(actor), dto.agentEntityId, auditActor(actor));
  }

  /** End the appointment: at once, and the agent is told. */
  @Roles('business', 'entity_admin')
  @Post(':exportId/agent/end')
  endAgent(@Param('exportId') exportId: string, @Body() dto: ExportEndAgentDto, @Actor() actor: IntrospectionResult): ExportDetail {
    return this.exports.endAgent(exportId, this.ownCompany(actor), auditActor(actor), dto.reason);
  }

  /** Ask for a paper these goods need — the exporter, or its appointed clearing agent. */
  @Roles('business', 'entity_admin')
  @Post(':exportId/papers/add')
  addPaper(@Param('exportId') exportId: string, @Body() dto: ExportAddPaperDto, @Actor() actor: IntrospectionResult): ExportDetail {
    return this.exports.addPaper(exportId, this.ownCompany(actor), dto, auditActor(actor));
  }

  /** Off the list again: only by whoever asked for it, and only while nothing was given for it. */
  @Roles('business', 'entity_admin')
  @Post(':exportId/papers/:key/remove')
  removePaper(@Param('exportId') exportId: string, @Param('key') key: string, @Actor() actor: IntrospectionResult): ExportDetail {
    return this.exports.removePaper(exportId, this.ownCompany(actor), paperKey(key));
  }

  /** The appointed agent accepts a paper. */
  @Roles('business', 'entity_admin')
  @Post(':exportId/papers/:key/accept')
  acceptPaper(@Param('exportId') exportId: string, @Param('key') key: string, @Actor() actor: IntrospectionResult): ExportDetail {
    return this.exports.acceptPaper(exportId, this.ownCompany(actor), paperKey(key), auditActor(actor));
  }

  /** The appointed agent sends a paper back, with its reason; the exporter is told. */
  @Roles('business', 'entity_admin')
  @Post(':exportId/papers/:key/refuse')
  refusePaper(@Param('exportId') exportId: string, @Param('key') key: string, @Body() dto: ExportPaperRefusalDto, @Actor() actor: IntrospectionResult): ExportDetail {
    return this.exports.refusePaper(exportId, this.ownCompany(actor), paperKey(key), dto.reason, auditActor(actor));
  }

  /**
   * The paper attached on a line, for the exporter, its appointed agent, or staff. One the caller may not read answers
   * NOT FOUND, never FORBIDDEN — the import's rule: a probe learns nothing about what exists.
   */
  @Roles('business', 'entity_admin', 'operator')
  @Get(':exportId/papers/:key/file')
  @Header('Cache-Control', 'private, no-store')
  @Header('X-Content-Type-Options', 'nosniff')
  paperFile(@Param('exportId') exportId: string, @Param('key') key: string, @Actor() actor: IntrospectionResult, @Res({ passthrough: true }) res: Response): StreamableFile {
    const file = actor?.role === 'operator' ? this.exports.paperFile(exportId, '', paperKey(key), { all: true }) : this.exports.paperFile(exportId, this.ownCompany(actor), paperKey(key));
    res.setHeader('X-Fingerprint', file.fingerprint);
    res.setHeader('X-Fingerprint-Intact', String(file.intact));
    res.setHeader('Access-Control-Expose-Headers', 'X-Fingerprint, X-Fingerprint-Intact');
    return new StreamableFile(file.bytes, { type: file.contentType });
  }

  /** The company this sign-in acts for — its own and no other. Staff act for none here (the roles above keep them out). */
  private ownCompany(actor: IntrospectionResult, typed?: string): string {
    if (actor?.role === 'operator') throw new GlosError('FORBIDDEN', 'An export is the exporter’s to write, signed in as itself: staff read it, and write nothing in its name');
    const own = actingTenant(actor);
    if (!own) throw new GlosError('FORBIDDEN', 'This sign-in carries no company');
    if (typed && typed !== own) throw new GlosError('FORBIDDEN', 'You act for one company, and it is not that one');
    return this.entities.get(own).entityId;
  }
}

/** A paper's key from the path — one of the four this export keeps, or no such paper. */
function paperKey(key: string): ExportPaperKey {
  if (!isExportPaperKey(key)) throw new GlosError('NOT_FOUND', 'No such paper on this export');
  return key as ExportPaperKey;
}
