import { StaffOnlyOutsideSandbox } from '../../foundation/auth/engine-surface';
import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { TrackingService } from './tracking.service';
import { TrackingContextService } from './tracking-context.service';
import { ConnectorRegistry } from './connectors/connectors';
import { EtaService } from './eta.service';
import { GeofenceService } from './geofence.service';
import { ExceptionService } from './exception.service';
import { AlertService } from './alert.service';
import { AnalyticsService } from './analytics.service';
import { AlertRuleDto, ConnectorIngestDto, DeadlineDto, DeliveryDto, GeofenceDto, IngestEventDto, OverrideDto, PositionDto, ReasonDto, RegisterContextDto, SensorDto, WebhookDto } from './tracking.dto';
import { PlannedLeg, PlannedMilestone } from './tracking.types';
import { ShipmentState } from './event-vocabulary';

interface ModuleInfo {
  module: string;
  name: string;
  epic: string;
  status: 'active';
  connectors: string[];
}

/**
 * M4 — Visibility & Tracking Tower. DID-authenticated (global guard; no @Public).
 */
@StaffOnlyOutsideSandbox()
@Controller('tracking')
export class M4Controller {
  constructor(
    private readonly tracking: TrackingService,
    private readonly context: TrackingContextService,
    private readonly connectors: ConnectorRegistry,
    private readonly eta: EtaService,
    private readonly geofence: GeofenceService,
    private readonly exceptions: ExceptionService,
    private readonly alerts: AlertService,
    private readonly analytics: AnalyticsService,
  ) {}

  @Get('module-info')
  info(): ModuleInfo {
    return { module: 'M4', name: 'Real-Time Visibility & Tracking Tower (VTT)', epic: '02_epic_domains/epic_m4_visibility_tracking.md', status: 'active', connectors: this.connectors.list() };
  }

  // --- ingestion (Sprint 0/1) ---

  @Post('contexts')
  register(@Body() dto: RegisterContextDto) {
    return this.context.register(dto.glosShipmentId, dto.legs as PlannedLeg[], dto.milestones as PlannedMilestone[]);
  }

  @Post('events')
  ingest(@Body() dto: IngestEventDto) {
    return this.tracking.ingest(dto);
  }

  @Post('events/via/:connector')
  ingestVia(@Param('connector') connector: string, @Body() dto: ConnectorIngestDto) {
    return this.tracking.ingestViaConnector(connector, dto.payload);
  }

  @Post(':id/delivery')
  delivery(@Param('id') id: string, @Body() dto: DeliveryDto) {
    return this.tracking.submitDelivery(id, { type: dto.type, ref: dto.ref, capturedAt: new Date().toISOString(), location: dto.location }, dto.location);
  }

  // --- search / timeline / analytics (Sprint 3) ---

  /** Search/list tracked shipments (VTT-071). */
  @Get()
  search(@Query('state') state?: string, @Query('carrier') carrier?: string) {
    return this.tracking.list({ state: state as ShipmentState, carrierDid: carrier });
  }

  /** Performance analytics dashboard (VTT-073). */
  @Get('analytics')
  analyticsSummary() {
    return this.analytics.summary();
  }

  @Get(':id/timeline')
  timeline(@Param('id') id: string) {
    return this.tracking.getTimeline(id);
  }

  // --- predictive ETA (Sprint 2) ---

  /** Continuously-updated ETA with multi-leg breakdown + 95% CI (VTT-030/031). */
  @Get(':id/eta')
  predictEta(@Param('id') id: string) {
    return this.eta.predict(id);
  }

  // --- geofence + exceptions (Sprint 2) ---

  /** A GPS position update → geofence ENTER/EXIT auto-events + position-based exceptions. */
  @Post(':id/position')
  position(@Param('id') id: string, @Body() dto: PositionDto) {
    const crossings = this.geofence.evaluate(id, dto);
    const exceptions = this.exceptions.evaluatePosition(id, dto);
    return { crossings, exceptions };
  }

  /** IoT sensor reading → temperature/shock breach exception (VTT-013). */
  @Post(':id/sensor')
  sensor(@Param('id') id: string, @Body() dto: SensorDto) {
    return this.exceptions.recordSensor(id, dto.metric, dto.value) ?? { ok: true, breach: false };
  }

  /** Missed-window check against an SLA deadline (VTT-040). */
  @Post(':id/check-deadline')
  checkDeadline(@Param('id') id: string, @Body() dto: DeadlineDto) {
    return this.exceptions.checkDeadline(id, dto.deadline) ?? { ok: true, late: false };
  }

  @Get(':id/exceptions')
  shipmentExceptions(@Param('id') id: string) {
    return this.exceptions.list(id);
  }

  @Get('exceptions')
  allExceptions() {
    return this.exceptions.list();
  }

  @Post('exceptions/:caseId/acknowledge')
  ackException(@Param('caseId') caseId: string, @Body() dto: ReasonDto) {
    return this.exceptions.acknowledge(caseId, dto.by);
  }

  @Post('exceptions/:caseId/resolve')
  resolveException(@Param('caseId') caseId: string, @Body() dto: ReasonDto) {
    return this.exceptions.resolve(caseId, dto.by);
  }

  @Post('exceptions/:caseId/false-alarm')
  falseAlarm(@Param('caseId') caseId: string, @Body() dto: ReasonDto) {
    return this.exceptions.falseAlarm(caseId, dto.reason ?? '', dto.by);
  }

  @Post('exceptions/:caseId/override')
  overrideException(@Param('caseId') caseId: string, @Body() dto: OverrideDto) {
    return this.exceptions.override(caseId, dto.severity, dto.reason, dto.by);
  }

  // --- geofence library (Sprint 2) ---

  @Get('geofences')
  geofenceLibrary() {
    return this.geofence.library();
  }

  @Post('geofences')
  addGeofence(@Body() dto: GeofenceDto) {
    return this.geofence.addGeofence(dto);
  }

  // --- alerts + webhooks (Sprint 3) ---

  @Post('alerts/rules')
  addRule(@Body() dto: AlertRuleDto) {
    return this.alerts.addRule(dto);
  }

  @Get('alerts/rules')
  listRules() {
    return this.alerts.listRules();
  }

  @Get('alerts')
  notifications(@Query('shipment') shipment?: string) {
    return this.alerts.notificationsFor(shipment);
  }

  @Post('webhooks')
  registerWebhook(@Body() dto: WebhookDto) {
    return this.alerts.registerWebhook(dto);
  }

  @Get('webhooks/outbox')
  webhookOutbox() {
    return this.alerts.webhookOutbox();
  }
}
