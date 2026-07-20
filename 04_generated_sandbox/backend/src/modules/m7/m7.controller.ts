import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { DigitalTwinService } from './digital-twin.service';
import { EtaService } from './eta.service';
import { DisruptionService } from './disruption.service';
import { OrchestrationService } from './orchestration.service';
import { SignalIngestService } from './signal-ingest.service';
import { SimulationService } from './simulation.service';
import { CarbonService } from './carbon.service';
import { NetworkDesignService } from './network-design.service';
import { DisruptionSignalDto, ExecuteActionDto, PolicyDto, RawSignalDto, ScenarioDto } from './m7.dto';

interface ModuleInfo {
  module: string;
  name: string;
  epic: string;
  status: 'active';
}

/** M7 AI Control Tower endpoints. DID-authenticated (global guard; no @Public). */
@Controller('control-tower')
export class M7Controller {
  constructor(
    private readonly twin: DigitalTwinService,
    private readonly eta: EtaService,
    private readonly disruption: DisruptionService,
    private readonly orchestration: OrchestrationService,
    private readonly signals: SignalIngestService,
    private readonly simulation: SimulationService,
    private readonly carbon: CarbonService,
    private readonly networkDesign: NetworkDesignService,
  ) {}

  @Get('module-info')
  info(): ModuleInfo {
    return { module: 'M7', name: 'AI Orchestration & Control Tower (AIOCT)', epic: '02_epic_domains/epic_m7_ai_orchestration.md', status: 'active' };
  }

  // --- digital twin (M7-010/011/012) ---

  /** All shipment nodes (optionally geo/state filtered). M7-011. */
  @Get('twin/shipments')
  shipments(@Query('lat') lat?: string, @Query('lng') lng?: string, @Query('radiusKm') radiusKm?: string, @Query('state') state?: string) {
    const center = lat != null && lng != null ? { lat: Number(lat), lng: Number(lng) } : undefined;
    return this.twin.query({ center, radiusKm: radiusKm != null ? Number(radiusKm) : undefined, state: state as never });
  }

  @Get('twin/shipments/:id')
  shipment(@Param('id') id: string) {
    const node = this.twin.shipment(id);
    if (!node) throw new BadRequestException(`Shipment not in twin: ${id}`);
    return { node, legs: this.twin.legs(id), edges: this.twin.edgesFrom(`shipment:${id}`) };
  }

  /** Density / delay heatmap for the control-tower view. M7-012. */
  @Get('twin/heatmap')
  heatmap(@Query('precision') precision?: string) {
    return this.twin.heatmap(precision != null ? Number(precision) : 1);
  }

  // --- predictive ETA (M7-020) ---

  @Get('eta/:id')
  predict(@Param('id') id: string) {
    return this.eta.predict(id);
  }

  // --- real-signal feeds (M7-021 feed layer) ---

  /** Registered feed connectors. */
  @Get('signals/sources')
  signalSources() {
    return this.signals.listSources();
  }

  /** Recently processed advisories (newest first). */
  @Get('signals/recent')
  recentSignals() {
    return this.signals.recent();
  }

  /** Push path: an external feed/webhook submits a raw advisory → classified + auto-responded. */
  @Post('signals')
  submitSignal(@Body() dto: RawSignalDto) {
    return this.signals.submit({ source: dto.source ?? 'webhook', zone: dto.zone, headline: dto.headline, type: dto.type, severity: dto.severity, center: dto.center, radiusKm: dto.radiusKm, externalId: dto.externalId });
  }

  /** Poll path: pull current advisories from every registered connector. */
  @Post('signals/poll')
  pollSignals() {
    return this.signals.pollAll();
  }

  // --- disruption (M7-021/022) ---

  /** Active disruptions (newest-known). */
  @Get('disruptions')
  listDisruptions() {
    return this.disruption.active();
  }

  /** Ingest + classify a disruption signal directly (operator-entered). M7-021. */
  @Post('disruptions')
  ingest(@Body() dto: DisruptionSignalDto) {
    return this.disruption.ingest(dto);
  }

  /** Blast radius: ranked most-critical impacted shipments. M7-022. */
  @Get('disruptions/:id/impact')
  impact(@Param('id') id: string) {
    return this.disruption.impact(id);
  }

  // --- prescriptive + autonomy (M7-030/031/050/051/052) ---

  /** Ranked prescriptive options for a (possibly disrupted) shipment. M7-030. */
  @Get('recommend/:id')
  recommend(@Param('id') id: string, @Query('disruptionId') disruptionId?: string) {
    return this.orchestration.recommend(id, disruptionId);
  }

  /** What-if simulation: project a hypothetical scenario against the twin (read-only). M7-040. */
  @Post('simulate')
  simulate(@Body() dto: ScenarioDto) {
    return this.simulation.run(dto);
  }

  // --- sustainability / carbon (M7-042) ---

  /** Network-wide carbon roll-up for the dashboard. */
  @Get('carbon/network')
  carbonNetwork() {
    return this.carbon.network();
  }

  /** Per-shipment footprint + greener-alternative comparison. */
  @Get('carbon/:id')
  carbonFootprint(@Param('id') id: string) {
    return this.carbon.footprint(id);
  }

  // --- network design (M7-041) ---

  /** Strategic network-design recommendations from accumulated flow. */
  @Get('network-design')
  networkDesignReport() {
    return this.networkDesign.analyze();
  }

  /** Register a shipper if-then orchestration policy. M7-031. */
  @Post('policies')
  registerPolicy(@Body() dto: PolicyDto) {
    return this.orchestration.registerPolicy(dto);
  }

  /** Evaluate a shipper's policies against a disruption → autonomous action (behind the gate). M7-031. */
  @Post('disruptions/:id/evaluate/:shipmentId')
  evaluate(@Param('id') disruptionId: string, @Param('shipmentId') shipmentId: string) {
    return this.orchestration.evaluate(shipmentId, disruptionId) ?? { fired: false };
  }

  /** Manually execute a chosen prescriptive option (still gated/anomaly-checked). M7-050. */
  @Post('actions')
  execute(@Body() dto: ExecuteActionDto) {
    const option = this.orchestration.recommend(dto.glosShipmentId, dto.disruptionId).find((o) => o.action === dto.action);
    if (!option) throw new BadRequestException(`No option for action: ${dto.action}`);
    return this.orchestration.execute(dto.glosShipmentId, option, dto.policyId);
  }

  @Post('actions/:id/approve')
  approve(@Param('id') id: string) {
    return this.orchestration.approve(id);
  }

  @Post('actions/:id/reject')
  reject(@Param('id') id: string) {
    return this.orchestration.reject(id);
  }

  @Post('actions/:id/rollback')
  rollback(@Param('id') id: string) {
    return this.orchestration.rollback(id);
  }

  @Get('actions')
  audit(@Query('shipment') shipment?: string) {
    return this.orchestration.auditTrail(shipment);
  }

  @Get('actions/:id')
  action(@Param('id') id: string) {
    return this.orchestration.getAction(id);
  }
}
