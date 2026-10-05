import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { askOf, byDay, dayOf, daySummary, dayWord, hoursWords, importVerdictLine, leftByReason, mayWithdraw, notASheet, orderTag, sendLine, weightWords, type DayPlan, type FleetOrder, type PlanLeft, type PlanSendTruck } from './orders';

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

  it('tags an order that is in the accepted plan as planned — until it is on a truck, or late', () => {
    const planned = { day: '2026-10-06', vehicleId: 'v', plate: 'KPL 008T', tripNo: 1, seq: 1, arrive: '09:40', at: 'x' };
    expect(orderTag(order({ planned }))).toBe('planned');
    expect(orderTag(order({ planned, status: 'claimed' }))).toBe('onTruck');
    expect(orderTag(order({ planned, late: true }))).toBe('late');
    // And a planned order is no longer "without a truck" in the day's count.
    expect(daySummary([order({ planned }), order()]).unplanned).toBe(1);
  });

  it('groups what a plan left out by why, pinning first — the one thing the office can do at once', () => {
    const left = (reason: PlanLeft['reason'], id: string): PlanLeft => ({ freightId: id, code: id, description: 'x', shipperName: 's', destLabel: 'd', weightKg: 1, reason });
    const groups = leftByReason([left('too_heavy', 'a'), left('no_time', 'b'), left('no_pin', 'c'), left('no_time', 'd')]);
    expect(groups.map((g) => [g.reason, g.orders.map((o) => o.freightId)])).toEqual([
      ['no_pin', ['c']],
      ['no_time', ['b', 'd']],
      ['too_heavy', ['a']],
    ]);
  });

  it('says what happened to each truck when its next trip was sent, refusals in their own words', () => {
    const truck = (over: Partial<PlanSendTruck>): PlanSendTruck => ({ vehicleId: 'v', plate: 'KPL 005T', state: 'sent', sent: [], held: [], ...over });
    expect(sendLine(truck({ driverName: 'Wanjiru', tripNo: 2, sent: ['FRT-1', 'FRT-2'] }), t)).toBe('KPL 005T: trip 2 is with Wanjiru — 2 orders.');
    expect(sendLine(truck({ state: 'no_driver' }), t)).toBe('KPL 005T: nobody is on a shift in it yet.');
    expect(sendLine(truck({ state: 'carrying', driverName: 'Wanjiru' }), t)).toMatch(/Wanjiru still has goods aboard/);
    expect(sendLine(truck({ state: 'nothing_left' }), t)).toBe('KPL 005T: every trip planned on it has gone out.');
    expect(sendLine(truck({ driverName: 'Wanjiru', tripNo: 1, held: [{ code: 'FRT-9', why: 'On duty 14 h — over the 13 h limit' }] }), t)).toBe('KPL 005T: nothing of trip 1 could go on. FRT-9 did not go on: On duty 14 h — over the 13 h limit.');
  });

  it('plans a day again from the settings its accepted plan was made with — a truck left out stays out', () => {
    expect(askOf('2026-10-06')).toEqual({ day: '2026-10-06' });
    const accepted = {
      settings: { dayStart: '06:30', dayHours: 12, speedKmh: 40, loadMin: 10, unloadMin: 25 },
      vehicles: [
        { vehicleId: 'v1', plate: 'A', vehicleClass: 'truck', capacityKg: 8000, excluded: true },
        { vehicleId: 'v2', plate: 'B', vehicleClass: 'truck', capacityKg: 5000, excluded: false },
      ],
    } as unknown as DayPlan;
    expect(askOf('2026-10-06', accepted)).toEqual({ day: '2026-10-06', dayStart: '06:30', dayHours: 12, speedKmh: 40, loadMin: 10, unloadMin: 25, excludeVehicleIds: ['v1'] });
  });

  it('says minutes the way a working day is said', () => {
    expect(hoursWords(45)).toBe('45 min');
    expect(hoursWords(570)).toBe('9 h 30');
    expect(hoursWords(600)).toBe('10 h');
    expect(hoursWords(605)).toBe('10 h 05');
  });

  it('weighs a day in tonnes and a small order in kilos', () => {
    expect(weightWords(38_400)).toMatch(/^38\.4 t$/);
    expect(weightWords(800)).toBe('800 kg');
  });
});
