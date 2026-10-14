import { Test } from '@nestjs/testing';
import { TrackingService } from './tracking.service';
import { NormalizationService } from './normalization.service';
import { TrackingContextService } from './tracking-context.service';
import { ConnectorRegistry, MobileSdkConnector, RestCarrierConnector } from './connectors/connectors';
import { LedgerService } from '../../foundation/ledger/ledger.service';
import { InMemoryLedgerAdapter } from '../../foundation/ledger/in-memory-ledger.adapter';
import { LEDGER_ADAPTER } from '../../foundation/ledger/ledger.types';
import { EventBus } from '../../foundation/events/event-bus.service';
import { GlosEvent } from '../../foundation/events/glos-events';

describe('TrackingService (M4 oracle)', () => {
  let tracking: TrackingService;
  let context: TrackingContextService;
  let events: EventBus;

  beforeEach(async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        TrackingService,
        NormalizationService,
        TrackingContextService,
        ConnectorRegistry,
        RestCarrierConnector,
        MobileSdkConnector,
        LedgerService,
        EventBus,
        { provide: LEDGER_ADAPTER, useClass: InMemoryLedgerAdapter },
      ],
    }).compile();
    tracking = moduleRef.get(TrackingService);
    context = moduleRef.get(TrackingContextService);
    events = moduleRef.get(EventBus);
  });

  const id = 'GLOS-ABC';

  it('ingests the happy path, anchors events, and emits oracle events', () => {
    const t1 = '2026-06-26T08:00:00.000Z';
    const r1 = tracking.ingest({ glosShipmentId: id, type: 'PICKUP', occurredAt: t1, source: 'api' });
    expect(r1.status).toBe('accepted');
    tracking.ingest({ glosShipmentId: id, type: 'OUT_FOR_DELIVERY', occurredAt: '2026-06-26T09:00:00.000Z', source: 'api' });
    const del = tracking.submitDelivery(id, { type: 'signature', ref: 'sig-1', capturedAt: '2026-06-26T10:00:00.000Z' });

    const timeline = tracking.getTimeline(id);
    expect(timeline.currentState).toBe('DELIVERED');
    expect(timeline.events).toHaveLength(3);
    expect(timeline.events.every((e) => e.anchorTxId.startsWith('glostx_'))).toBe(true);
    expect(timeline.events.find((e) => e.type === 'DELIVERED')?.pod?.type).toBe('signature');

    const topics = events.getLog().map((e) => e.type);
    expect(topics).toContain(GlosEvent.Tracking.PickupOk);
    expect(topics).toContain(GlosEvent.Tracking.Delivered);
    expect(del.status).toBe('accepted');
  });

  it('flags an illegal transition as an anomaly and emits ExceptionRaised', () => {
    const res = tracking.ingest({ glosShipmentId: id, type: 'DELIVERED', source: 'api' });
    expect(res.anomaly).toBe(true);
    expect(tracking.getTimeline(id).currentState).toBe('START'); // state not advanced
    expect(events.getLog().some((e) => e.type === GlosEvent.Tracking.ExceptionRaised)).toBe(true);
  });

  it('an anomalous event neither advances state nor blocks a later valid event', () => {
    tracking.ingest({ glosShipmentId: id, type: 'PICKUP', occurredAt: '2026-06-26T08:00:00.000Z', source: 'api' });
    const bad = tracking.ingest({ glosShipmentId: id, type: 'DELIVERED', occurredAt: '2026-06-26T08:30:00.000Z', source: 'api' });
    expect(bad.anomaly).toBe(true);
    expect(tracking.getTimeline(id).currentState).toBe('PICKUP'); // not advanced
    tracking.ingest({ glosShipmentId: id, type: 'OUT_FOR_DELIVERY', occurredAt: '2026-06-26T09:00:00.000Z', source: 'api' });
    const good = tracking.submitDelivery(id, { type: 'pin', ref: '1234', capturedAt: '2026-06-26T10:00:00.000Z' });
    expect(good.status).toBe('accepted');
    expect(tracking.getTimeline(id).currentState).toBe('DELIVERED'); // the valid delivery still lands
  });

  it('deduplicates an identical event', () => {
    const ev = { glosShipmentId: id, type: 'PICKUP' as const, occurredAt: '2026-06-26T08:00:00.000Z', source: 'api' as const };
    expect(tracking.ingest(ev).status).toBe('accepted');
    expect(tracking.ingest(ev).status).toBe('duplicate');
    expect(tracking.getTimeline(id).events).toHaveLength(1);
  });

  it('resolves a same-slot conflict by source priority, preserving the loser', () => {
    const at = '2026-06-26T08:00:00.000Z';
    tracking.ingest({ glosShipmentId: id, type: 'PICKUP', occurredAt: at, source: 'api', carrierDid: 'did:glos:carrier' });
    const manual = tracking.ingest({ glosShipmentId: id, type: 'PICKUP', occurredAt: at, source: 'manual' });
    expect(manual.status).toBe('conflict_preserved');
    const timeline = tracking.getTimeline(id);
    expect(timeline.events).toHaveLength(1); // api kept as primary
    expect(timeline.conflictsPreserved).toBe(1); // manual preserved for audit
  });

  it('picks up the planned route from the M2 leg_decomposed event', async () => {
    context.onModuleInit(); // wire the subscription
    await events.publish(GlosEvent.Shipment.LegDecomposed, {
      glosShipmentId: id,
      legs: [{ index: 0, mode: 'courier', origin: 'A', destination: 'B', handover: { locationId: 'LOC-1', verification: 'signature' } }],
      milestones: [{ id: 'ms-pickup', name: 'PICKUP', legIndex: 0 }, { id: 'ms-delivery', name: 'DELIVERY', legIndex: 0 }],
    });
    expect(context.has(id)).toBe(true);

    const res = tracking.ingest({ glosShipmentId: id, type: 'PICKUP', source: 'api' });
    expect(res.hasContext).toBe(true);
    expect(tracking.getTimeline(id).milestoneProgress).toEqual({ total: 2, reached: 1 });
  });

  it('ingests via a carrier connector', () => {
    const res = tracking.ingestViaConnector('rest-carrier', { shipmentId: id, status: 'picked_up', ts: '2026-06-26T08:00:00.000Z', lat: 1, lng: 2, carrier: 'did:glos:c' });
    expect(res.status).toBe('accepted');
    expect(res.type).toBe('PICKUP');
  });
});
