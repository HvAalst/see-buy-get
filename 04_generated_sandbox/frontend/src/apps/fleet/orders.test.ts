import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { byDay, dayOf, daySummary, dayWord, orderTag, weightWords, type FleetOrder } from './orders';

const order = (over: Partial<FleetOrder> = {}): FleetOrder =>
  ({
    freightId: 'frt_1',
    code: 'FRT-001',
    contract: { contractId: 'ctr_1', fleetDid: 'did:f', fleetName: 'Kilima', shipperName: 'Jenga Bricks' },
    deliverOn: '2026-10-06',
    description: 'Bricks',
    weightKg: 4000,
    packaging: 'palletised',
    pickupLabel: 'Yard',
    pickupLocation: { lat: 0, lng: 0 },
    destLabel: 'Site',
    status: 'ordered',
    createdAt: '2026-10-05T10:00:00Z',
    late: false,
    trackingKey: 'T-1',
    trackingUrl: 'http://x/?track=T-1',
    ...over,
  }) as FleetOrder;

describe('P1 — a fleet’s orders', () => {
  it('tags each order from its facts, and late outranks everything but done and withdrawn', () => {
    expect(orderTag(order())).toBe('unplanned');
    expect(orderTag(order({ status: 'claimed' }))).toBe('onTruck');
    expect(orderTag(order({ status: 'in_transit' }))).toBe('onRoad');
    expect(orderTag(order({ status: 'claimed', late: true }))).toBe('late');
    expect(orderTag(order({ status: 'delivered', late: false }))).toBe('delivered');
    expect(orderTag(order({ status: 'cancelled' }))).toBe('withdrawn');
  });

  it('groups by the day it must arrive, in day order', () => {
    const groups = byDay([order({ freightId: 'b', deliverOn: '2026-10-07' }), order({ freightId: 'a' }), order({ freightId: 'c' })]);
    expect(groups.map((g) => [g.day, g.orders.map((o) => o.freightId)])).toEqual([
      ['2026-10-06', ['a', 'c']],
      ['2026-10-07', ['b']],
    ]);
  });

  it('sums a day the way a dispatcher reads it — withdrawn orders count for nothing', () => {
    const sum = daySummary([order(), order({ status: 'claimed', weightKg: 2500 }), order({ status: 'delivered', weightKg: 500 }), order({ status: 'cancelled', weightKg: 9000 })]);
    expect(sum).toEqual({ orders: 3, kg: 7000, unplanned: 1, late: 0, delivered: 1 });
  });

  it('says today and tomorrow in words, and other days as dates', () => {
    const now = new Date(2026, 9, 5, 12, 0);
    expect(dayOf(now, 1)).toBe('2026-10-06');
    expect(dayWord('2026-10-05', now, t)).toBe('Today');
    expect(dayWord('2026-10-06', now, t)).toBe('Tomorrow');
    expect(dayWord('2026-10-09', now, t)).toBe('2026-10-09');
  });

  it('weighs a day in tonnes and a small order in kilos', () => {
    expect(weightWords(38_400)).toMatch(/^38\.4 t$/);
    expect(weightWords(800)).toBe('800 kg');
  });
});
