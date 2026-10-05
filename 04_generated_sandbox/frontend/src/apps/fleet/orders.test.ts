import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { byDay, dayOf, daySummary, dayWord, importVerdictLine, mayWithdraw, notASheet, orderTag, weightWords, type FleetOrder } from './orders';

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
    uploaded: false,
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

  it('refuses a workbook by its name, before reading a zip as if it were text', () => {
    expect(notASheet('orders.xlsx')).toBe('fleet.upload.notText');
    expect(notASheet('Orders.XLS')).toBe('fleet.upload.notText');
    expect(notASheet('scan.pdf')).toBe('fleet.upload.notSheet');
    expect(notASheet('orders.csv')).toBeNull();
    expect(notASheet('export')).toBeNull();
  });

  it('says a refused line as a sentence: which line, which order, everything wrong with it', () => {
    expect(importVerdictLine({ line: 4, reference: 'WS-2', problems: ['"heavy" is not a weight', 'No delivery address'] }, t)).toBe('Line 4, order WS-2: "heavy" is not a weight; No delivery address');
    expect(importVerdictLine({ line: 5, reference: '', problems: ['No order number'] }, t)).toBe('Line 5: No order number');
  });

  it('lets the office withdraw only what it uploaded, and only before it is on the road', () => {
    expect(mayWithdraw(order({ uploaded: true }))).toBe(true);
    expect(mayWithdraw(order({ uploaded: true, status: 'claimed' }))).toBe(true);
    expect(mayWithdraw(order({ uploaded: true, status: 'in_transit' }))).toBe(false);
    expect(mayWithdraw(order({ uploaded: false }))).toBe(false);
  });

  it('weighs a day in tonnes and a small order in kilos', () => {
    expect(weightWords(38_400)).toMatch(/^38\.4 t$/);
    expect(weightWords(800)).toBe('800 kg');
  });
});
