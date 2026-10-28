import { Body, Controller, Get, Header, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiQuery, ApiTags } from '@nestjs/swagger';
import { actingTenant, auditActor } from '../../foundation/auth/acting';
import { Actor } from '../../foundation/auth/actor.decorator';
import { Roles } from '../../foundation/auth/scopes.decorator';
import type { IntrospectionResult } from '../../foundation/auth/auth.types';
import { EntityService } from '../../foundation/entity/entity.service';
import { GlosError } from '../../foundation/http/glos-error';
import { BusinessMemberGuard } from './business-member.guard';
import { ExportService } from './export.service';
import { ExportBillOfLadingDto, ExportContainerDto, ExportDetail, ExportLadenLegDto, ExportPaperDto, ExportRow, ExportVgmDto, RegisterExportDto } from './export.types';

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
    return this.exports.supplyPaper(exportId, this.ownCompany(actor), dto, auditActor(actor));
  }

  @Roles('business', 'entity_admin')
  @Post(':exportId/bill-of-lading')
  billOfLading(@Param('exportId') exportId: string, @Body() dto: ExportBillOfLadingDto, @Actor() actor: IntrospectionResult): ExportDetail {
    return this.exports.recordBillOfLading(exportId, this.ownCompany(actor), dto.number, auditActor(actor));
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
