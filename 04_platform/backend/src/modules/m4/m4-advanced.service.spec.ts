import { Test } from '@nestjs/testing';
import { TrackingService } from './tracking.service';
import { NormalizationService } from './normalization.service';
import { TrackingContextService } from './tracking-context.service';
import { ConnectorRegistry, MobileSdkConnector, RestCarrierConnector } from './connectors/connectors';
import { EtaService } from './eta.service';
import { GeofenceService } from './geofence.service';
import { ExceptionService } from './exception.service';
import { AlertService } from './alert.service';
import { AnalyticsService } from './analytics.service';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';
import { createHmac } from 'crypto';
import { geocode, haversineKm } from './geo';
import { PlannedLeg, PlannedMilestone } from './tracking.types';

const flush = () => new Promise((r) => setImmediate(r));

describe('M4 Sprint 2/3 — ETA, geofences, exceptions, alerts', () => {
  let tracking: TrackingService;
  let context: TrackingContextService;
  let eta: EtaService;
  let geofence: GeofenceService;
  let exceptions: ExceptionService;
  let alerts: AlertService;
  let analytics: AnalyticsService;
  let events: EventBus;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        TrackingService, NormalizationService, TrackingContextService, ConnectorRegistry, RestCarrierConnector, MobileSdkConnector,
        EtaService, GeofenceService, ExceptionService, AlertService, AnalyticsService,
        LedgerService, EventBus, { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
    }).compile();
    tracking = moduleRef.get(TrackingService);
    context = moduleRef.get(TrackingContextService);
    eta = moduleRef.get(EtaService);
    geofence = moduleRef.get(GeofenceService);
    exceptions = moduleRef.get(ExceptionService);
    alerts = moduleRef.get(AlertService);
    analytics = moduleRef.get(AnalyticsService);
    events = moduleRef.get(EventBus);
  });

  const id = 'GLOS-M4ADV';
  function leg(index: number, mode: string, origin: string, destination: string): PlannedLeg {
    return { index, mode, origin, destination, handover: { locationId: `LOC-${destination}`, geofence: { id: `gf-${destination}`, center: geocode(destination), radiusM: 25_000 }, verification: 'geofence' } };
  }
  function registerOceanRoute(shipmentId = id) {
    const legs = [leg(0, 'road', 'Rotterdam', 'Rotterdam Hub'), leg(1, 'ocean', 'Rotterdam Hub', 'Singapore Hub'), leg(2, 'courier', 'Singapore Hub', 'Singapore')];
    const milestones: PlannedMilestone[] = [{ id: 'm0', name: 'PICKUP', legIndex: 0 }, { id: 'm1', name: 'HANDOVER', legIndex: 1 }, { id: 'm2', name: 'DELIVERY', legIndex: 2 }];
    context.register(shipmentId, legs, milestones);
  }

  it('predicts a multi-leg ETA with a 95% CI that shrinks after a handover (VTT-030/031)', () => {
    registerOceanRoute();
    tracking.ingest({ glosShipmentId: id, type: 'PICKUP', source: 'api' });
    const before = eta.predict(id);
    expect(before.hoursRemaining).toBeGreaterThan(0);
    expect(before.perLeg.length).toBe(3);
    expect(before.confidence.level).toBe(0.95);
    expect(new Date(before.confidence.high).getTime()).toBeGreaterThan(new Date(before.confidence.low).getTime());

    tracking.ingest({ glosShipmentId: id, type: 'HANDOVER', source: 'api' });
    const after = eta.predict(id);
    expect(after.perLeg.length).toBe(2);
    expect(after.hoursRemaining).toBeLessThan(before.hoursRemaining); // a leg + a handover buffer drop off
  });

  it('auto-generates GEOFENCE_ENTER/EXIT on position intersection (VTT-045)', () => {
    registerOceanRoute();
    const enter = geofence.evaluate(id, geocode('Singapore'));
    expect(enter.some((c) => c.type === 'GEOFENCE_ENTER')).toBe(true);
    const antipode = { lat: -geocode('Singapore').lat, lng: geocode('Singapore').lng > 0 ? geocode('Singapore').lng - 180 : geocode('Singapore').lng + 180 };
    const exit = geofence.evaluate(id, antipode);
    expect(exit.some((c) => c.type === 'GEOFENCE_EXIT')).toBe(true);
    expect(tracking.getTimeline(id).events.some((e) => e.type === 'GEOFENCE_ENTER')).toBe(true);
  });

  it('raises a classified temperature-breach case from an IoT reading (VTT-013/040/041)', () => {
    registerOceanRoute();
    const c = exceptions.recordSensor(id, 'temperature', 12); // 4°C over the 8°C ceiling → high
    expect(c?.type).toBe('temperature_breach');
    expect(c?.severity).toBe('high');
    expect(c?.anchorTxId).toBeDefined();
    expect(events.getLog().some((e) => e.type === GlosEvent.Tracking.ExceptionRaised)).toBe(true);
    expect(exceptions.list(id)).toHaveLength(1);
  });

  it('detects a route deviation far from the planned route (VTT-040)', () => {
    // A route whose planned points all cluster at one geocode, so an antipodal position is clearly off-route.
    context.register('GLOS-DEV', [leg(0, 'road', 'Hub', 'Hub')], [{ id: 'm0', name: 'PICKUP', legIndex: 0 }]);
    const here = geocode('Hub');
    const far = { lat: -here.lat, lng: here.lng > 0 ? here.lng - 180 : here.lng + 180 };
    expect(haversineKm(here, far)).toBeGreaterThan(200);
    const raised = exceptions.evaluatePosition('GLOS-DEV', far);
    expect(raised.some((c) => c.type === 'route_deviation')).toBe(true);
  });

  it('flags delivery without a proof-of-delivery (VTT-040)', async () => {
    exceptions.onModuleInit();
    registerOceanRoute();
    tracking.ingest({ glosShipmentId: id, type: 'PICKUP', source: 'api' });
    tracking.ingest({ glosShipmentId: id, type: 'OUT_FOR_DELIVERY', source: 'api' });
    tracking.ingest({ glosShipmentId: id, type: 'DELIVERED', source: 'api' }); // no PoD
    await flush();
    expect(exceptions.list(id).some((c) => c.type === 'delivery_without_acceptance')).toBe(true);
  });

  it('runs the exception case lifecycle with mandatory-reason overrides (VTT-042/044)', () => {
    const c = exceptions.recordSensor(id, 'shock', 20)!; // critical
    expect(c.severity).toBe('critical');
    exceptions.acknowledge(c.id, 'ops:sam');
    expect(exceptions.get(c.id).status).toBe('acknowledged');
    expect(() => exceptions.override(c.id, 'low', '')).toThrow(); // reason mandatory
    exceptions.override(c.id, 'medium', 'sensor recalibrated', 'ops:sam');
    expect(exceptions.get(c.id).severity).toBe('medium');
    exceptions.resolve(c.id, 'ops:sam');
    expect(exceptions.get(c.id).status).toBe('resolved');
    expect(exceptions.get(c.id).actions.length).toBeGreaterThanOrEqual(4);
  });

  it('fires alert rules and streams HMAC-signed webhooks on an exception (VTT-050/051/053)', async () => {
    alerts.onModuleInit();
    alerts.addRule({ on: 'exception', minSeverity: 'high', channels: ['in_app'], label: 'Critical exception' });
    const hook = alerts.registerWebhook({ url: 'https://ops.example/hook', secret: 's3cret', events: ['tracking.exception_raised'] });

    exceptions.recordSensor(id, 'temperature', 14); // high → emits exception_raised
    await flush();

    expect(alerts.notificationsFor(id).length).toBeGreaterThanOrEqual(1);
    const outbox = alerts.webhookOutbox();
    expect(outbox.length).toBeGreaterThanOrEqual(1);
    const delivery = outbox[0];
    expect(delivery.url).toBe(hook.url);
    expect(createHmac('sha256', 's3cret').update(delivery.body).digest('hex')).toBe(delivery.signature); // valid signature
  });

  it('rolls up performance analytics (VTT-073)', async () => {
    exceptions.onModuleInit();
    registerOceanRoute();
    tracking.ingest({ glosShipmentId: id, type: 'PICKUP', source: 'api' });
    tracking.ingest({ glosShipmentId: id, type: 'OUT_FOR_DELIVERY', source: 'api' });
    tracking.submitDelivery(id, { type: 'pin', ref: '1234', capturedAt: new Date().toISOString() });
    exceptions.recordSensor(id, 'temperature', 11);
    await flush();

    const a = analytics.summary();
    expect(a.shipments).toBeGreaterThanOrEqual(1);
    expect(a.byState.DELIVERED).toBeGreaterThanOrEqual(1);
    expect(a.exceptions.total).toBeGreaterThanOrEqual(1);
  });
});
