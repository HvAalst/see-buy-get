import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ShipmentService, CreateShipmentInput, EnrichShipmentInput } from './shipment.service';
import { LegDecompositionService } from './leg-decomposition.service';
import { IngestionService } from './ingestion/ingestion.service';
import { TemplateService } from './templates/template.service';
import { HsCodeService } from './schema/hs-code.service';
import { DangerousGoodsService } from './constraints/dangerous-goods.service';
import { LabelService } from './label/label.service';
import { AnchoringService } from './anchoring/anchoring.service';
import { LegAccessService } from './legs/leg-access.service';
import { RouteLeg, RouteTemplateService } from './legs/route-template.service';
import { StandardsService } from './schema/standards.service';
import { EWAYBILL_JSON_SCHEMA } from './schema/ewaybill-schema';
import { EWAYBILL_PROTO } from './schema/standards';
import { HANDLING_CODES } from './handling-codes';
import {
  AcceptTermsDto, AssignCarrierDto, BatchIngestDto, CreateShipmentDto, EnrichShipmentDto,
  LabelOverlayDto, LegConstraintDto, ProposeTermsDto, SaveRouteDto, SaveTemplateDto, ViaPluginDto,
} from './shipment.dto';
import { Shipment } from './shipment.types';

/** M2 shipment endpoints. DID-authenticated. The digital twin is born here. */
@Controller('shipments')
export class M2Controller {
  constructor(
    private readonly shipments: ShipmentService,
    private readonly legs: LegDecompositionService,
    private readonly ingestion: IngestionService,
    private readonly templates: TemplateService,
    private readonly hsCode: HsCodeService,
    private readonly dangerousGoods: DangerousGoodsService,
    private readonly labels: LabelService,
    private readonly anchoring: AnchoringService,
    private readonly legAccess: LegAccessService,
    private readonly routes: RouteTemplateService,
    private readonly standards: StandardsService,
  ) {}

  @Get('module-info')
  info() {
    return {
      module: 'M2',
      name: 'Universal Shipment Digitization & Standards (UDS)',
      epic: '02_epic_domains/epic_m2_shipment_digitization.md',
      status: 'active',
      ingestionChannels: ['rest', 'batch-json', 'batch-csv', ...this.ingestion.listPlugins().map((p) => `plugin:${p}`), 'template'],
    };
  }

  // --- static routes (before :id) ---

  /** Published open schema (NFR-M2-06): ?format=json-schema (default) | proto. */
  @Get('schema')
  schema(@Query('format') format?: string) {
    return format === 'proto' ? EWAYBILL_PROTO : EWAYBILL_JSON_SCHEMA;
  }

  /** Standards + field-level crosswalk (NFR-M2-05). */
  @Get('schema/standards')
  standardsCrosswalk() {
    return this.standards.crosswalk();
  }

  @Get('handling-codes')
  handlingCodes() {
    return HANDLING_CODES;
  }

  @Get('hs-code/suggest')
  suggestHs(@Query('q') q: string) {
    return this.hsCode.suggest(q ?? '') ?? { code: null };
  }

  @Post('classify-dg')
  classifyDg(@Body() body: { unNumber?: string; description?: string }) {
    return this.dangerousGoods.classify(body ?? {}) ?? { classification: null };
  }

  @Get('templates')
  listTemplates() {
    return this.templates.list();
  }

  @Get('routes')
  listRoutes() {
    return this.routes.list();
  }

  @Post()
  create(@Body() dto: CreateShipmentDto): Shipment {
    return this.shipments.create(dto as unknown as CreateShipmentInput);
  }

  @Post('batch')
  batch(@Body() dto: BatchIngestDto) {
    return dto.csv ? this.ingestion.ingestCsvBatch(dto.csv) : this.ingestion.ingestJsonBatch((dto.items ?? []) as unknown as CreateShipmentInput[]);
  }

  @Post('via/:plugin')
  via(@Param('plugin') plugin: string, @Body() dto: ViaPluginDto): Shipment {
    return this.ingestion.ingestViaPlugin(plugin, dto.order);
  }

  @Post('templates')
  saveTemplate(@Body() dto: SaveTemplateDto) {
    return this.templates.save(dto.name, dto.fields as Partial<CreateShipmentInput>);
  }

  @Post('routes')
  saveRoute(@Body() dto: SaveRouteDto) {
    return this.routes.save(dto.name, dto.legs as unknown as RouteLeg[]);
  }

  @Post('from-template/:templateId')
  fromTemplate(@Param('templateId') templateId: string, @Body() overrides: Record<string, unknown>): Shipment {
    return this.shipments.create(this.templates.merge(templateId, overrides as Partial<CreateShipmentInput>));
  }

  // --- :id reads ---

  @Get(':id')
  get(@Param('id') id: string): Shipment {
    return this.shipments.require(id);
  }

  @Get(':id/job-requirements')
  jobRequirements(@Param('id') id: string) {
    return this.legs.buildJobRequirementVector(this.shipments.require(id));
  }

  /** Smart label, optionally rendered (M2-040/042): ?format=json|svg|zpl|epl. */
  @Get(':id/label')
  label(@Param('id') id: string, @Query('format') format?: 'json' | 'svg' | 'zpl' | 'epl') {
    return this.labels.render(id, format ?? 'json');
  }

  /** Lightweight ledger verification (M2-052). */
  @Get(':id/verify')
  verify(@Param('id') id: string) {
    return this.anchoring.verify(id);
  }

  /** Standards conformance report (NFR-M2-05). */
  @Get(':id/conformance')
  conformance(@Param('id') id: string) {
    return this.standards.conformance(this.shipments.require(id).ewaybill);
  }

  /** Selective disclosure (M2-053): ?attribute=TEMP_2_8C. */
  @Get(':id/disclose')
  disclose(@Param('id') id: string, @Query('attribute') attribute: string) {
    return this.anchoring.disclose(id, attribute);
  }

  /** Scoped leg view — data isolated per leg (§5.3): ?requester=DID. */
  @Get(':id/legs/:index/view')
  legView(@Param('id') id: string, @Param('index') index: string, @Query('requester') requester: string) {
    return this.legAccess.view(id, Number(index), requester);
  }

  // --- :id writes ---

  @Post(':id/enrich')
  enrich(@Param('id') id: string, @Body() dto: EnrichShipmentDto): Shipment {
    return this.shipments.enrich(id, dto as unknown as EnrichShipmentInput);
  }

  @Post(':id/decompose')
  decompose(@Param('id') id: string): Shipment {
    return this.legs.decompose(id);
  }

  /** Decompose from a saved route template (M2-063). */
  @Post(':id/apply-route/:routeId')
  applyRoute(@Param('id') id: string, @Param('routeId') routeId: string): Shipment {
    return this.legs.decomposeFromRoute(id, this.routes.get(routeId));
  }

  @Post(':id/label')
  generateLabel(@Param('id') id: string) {
    return this.labels.generate(id);
  }

  @Post(':id/label/overlay')
  overlay(@Param('id') id: string, @Body() dto: LabelOverlayDto) {
    return this.labels.addOverlay(id, dto);
  }

  // --- per-leg assignment + negotiation (data isolated, M2-062) ---

  @Post(':id/legs/:index/assign')
  assign(@Param('id') id: string, @Param('index') index: string, @Body() dto: AssignCarrierDto) {
    return this.legAccess.assignCarrier(id, Number(index), dto.carrierDid);
  }

  @Post(':id/legs/:index/constraints')
  legConstraint(@Param('id') id: string, @Param('index') index: string, @Body() dto: LegConstraintDto) {
    return this.legAccess.addLegConstraint(id, Number(index), dto.code, dto.requesterDid);
  }

  @Post(':id/legs/:index/proposals')
  propose(@Param('id') id: string, @Param('index') index: string, @Body() dto: ProposeTermsDto) {
    return this.legAccess.propose(id, Number(index), dto.fromDid, dto);
  }

  @Post(':id/legs/:index/accept')
  acceptTerms(@Param('id') id: string, @Param('index') index: string, @Body() dto: AcceptTermsDto) {
    return this.legAccess.accept(id, Number(index), dto.byDid, dto.proposalId);
  }
}
