import { Module } from '@nestjs/common';
import { M4Controller } from './m4.controller';
import { TrackingService } from './tracking.service';
import { NormalizationService } from './normalization.service';
import { TrackingContextService } from './tracking-context.service';
import { ConnectorRegistry, MobileSdkConnector, RestCarrierConnector } from './connectors/connectors';
import { EtaService } from './eta.service';
import { GeofenceService } from './geofence.service';
import { ExceptionService } from './exception.service';
import { AlertService } from './alert.service';
import { AnalyticsService } from './analytics.service';

/**
 * M4 — Real-Time Visibility & Tracking Tower (VTT).
 * Epic: 02_epic_domains/epic_m4_visibility_tracking.md.
 * Sprint 0–1 (basic tracking): tracking context (from M2 leg_decomposed), connector framework,
 * normalization + dedup, state-machine ingest, anchored timeline, PoD, oracle events.
 * Sprint 2 (predictive/exception): EtaService, GeofenceService (auto enter/exit), ExceptionService
 * (rules + severity + case lifecycle + IoT). Sprint 3 (alerting/streaming/tower): AlertService
 * (rules + HMAC webhook streaming), AnalyticsService, search/list. Foundations injected globally.
 */
@Module({
  controllers: [M4Controller],
  providers: [
    TrackingService,
    NormalizationService,
    TrackingContextService,
    ConnectorRegistry,
    RestCarrierConnector,
    MobileSdkConnector,
    EtaService,
    GeofenceService,
    ExceptionService,
    AlertService,
    AnalyticsService,
  ],
  exports: [TrackingService, TrackingContextService],
})
export class M4Module {}
