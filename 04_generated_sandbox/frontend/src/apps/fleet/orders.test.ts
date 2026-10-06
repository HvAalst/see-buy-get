import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { ADVISER_HISTORY, base64Of, historyOf, isWorkbook, keptOff, putOnto, ruleLine, windowLine, rulesAsk, withoutRule, type PlanRule } from './orders';
import { askOf, byDay, dayOf, daySummary, dayWord, handOnLine, hoursWords, mayHandOn, importVerdictLine, leftByReason, mayWithdraw, notASheet, orderTag, sendLine, weightWords, type DayPlan, type FleetOrder, type PlanLeft, type PlanSendTruck } from './orders';

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
    role: 'own',
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
    expect(sum).toEqual({ orders: 3, kg: 7000, unplanned: 1, late: 0, delivered: 1, handedOn: 0 });
  });

  it('says today and tomorrow in words, and other days as dates', () => {
    const now = new Date(2026, 9, 5, 12, 0);
    expect(dayOf(now, 1)).toBe('2026-10-06');
    expect(dayWord('2026-10-05', now, t)).toBe('Today');
    expect(dayWord('2026-10-06', now, t)).toBe('Tomorrow');
    expect(dayWord('2026-10-09', now, t)).toBe('2026-10-09');
  });

  it('takes an Excel workbook as it is, and refuses by name the spreadsheet files nothing here reads', () => {
    expect(notASheet('orders.xlsx')).toBeNull();
    expect([isWorkbook('orders.xlsx'), isWorkbook('Orders.XLSM'), isWorkbook('orders.csv'), isWorkbook('orders.xls'), isWorkbook('xlsx')]).toEqual([true, true, false, false, false]);
    expect(notASheet('Orders.XLS')).toBe('fleet.upload.notText');
    expect(notASheet('orders.ods')).toBe('fleet.upload.notText');
    expect(notASheet('orders.numbers')).toBe('fleet.upload.notText');
    expect(notASheet('scan.pdf')).toBe('fleet.upload.notSheet');
    expect(notASheet('orders.csv')).toBeNull();
    expect(notASheet('export')).toBeNull();
  });

  it('sends a workbook’s bytes as base64, whole — every byte value, and more of them than one call takes', () => {
    expect(base64Of(new Uint8Array([80, 75, 3, 4]))).toBe('UEsDBA==');
    const all = new Uint8Array(100_000).map((_, i) => i % 256);
    const back = Uint8Array.from(atob(base64Of(all)), (ch) => ch.charCodeAt(0));
    expect(back).toHaveLength(100_000);
    expect(back.every((b, i) => b === i % 256)).toBe(true);
    expect(base64Of(new Uint8Array(0))).toBe('');
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

  it('tags an order by where it has been handed, and counts a day by what is really in nobody’s hands', () => {
    const at = '2026-10-05T12:00:00Z';
    const offered = order({ handOn: { state: 'offered', at, by: 'Amina', offeredTo: [{ fleetDid: 'b', fleetName: 'Pwani' }] } });
    const withPartner = order({ handOn: { state: 'partner', at, by: 'Amina', partner: { fleetDid: 'b', fleetName: 'Pwani' } } });
    const onBoard = order({ status: 'available', handOn: { state: 'board', at, by: 'Amina' } });
    const toMe = order({ role: 'offered', handOn: { state: 'offered', at, by: 'X' }, late: true });
    const mineNow = order({ role: 'partner', handOn: { state: 'partner', at, by: 'X', partner: { fleetDid: 'me', fleetName: 'Me' } } });
    expect([offered, withPartner, onBoard, toMe, mineNow].map((o) => orderTag(o))).toEqual(['onOffer', 'withPartner', 'onBoard', 'offeredToYou', 'unplanned']);
    // Offered to me is not my day yet; what I took from a partner is, and it has no truck.
    expect(daySummary([offered, withPartner, onBoard, toMe, mineNow, order()])).toMatchObject({ orders: 5, unplanned: 2, handedOn: 3 });
    expect(mayHandOn(order())).toBe(true);
    expect([offered, withPartner, onBoard, toMe, mineNow, order({ status: 'claimed' })].map((o) => mayHandOn(o))).toEqual([false, false, false, false, false, false]);
  });

  it('says what came of handing a batch on, the refusals included', () => {
    expect(handOnLine('offer', { done: ['FRT-1', 'FRT-2'], refused: [], to: ['Pwani Haulage', 'Rift Carriers'] }, t)).toBe('2 orders offered to Pwani Haulage, Rift Carriers.');
    expect(handOnLine('release', { done: ['FRT-1'], refused: [{ freightId: 'x', why: 'This order is claimed — it can no longer be released' }], to: [] }, t)).toBe(
      '1 order is on the open board. 1 could not be: This order is claimed — it can no longer be released.',
    );
    expect(handOnLine('offer', { done: [], refused: [], to: [] }, t)).toBe('Nothing was handed on.');
  });

  it('says minutes the way a working day is said', () => {
    expect(hoursWords(45)).toBe('45 min');
    expect(hoursWords(570)).toBe('9 h 30');
    expect(hoursWords(600)).toBe('10 h');
    expect(hoursWords(605)).toBe('10 h 05');
  });

  /* P5 — the rules on a plan, and the talk with the adviser. */
  const rule = (kind: PlanRule['kind'], freightId: string, vehicleId: string): PlanRule => ({ kind, freightId, code: freightId.toUpperCase(), vehicleId, plate: vehicleId.toUpperCase() });

  it('plans a day again under the rules its accepted plan was made with', () => {
    const accepted = {
      settings: { dayStart: '07:00', dayHours: 10, speedKmh: 30, loadMin: 15, unloadMin: 20 },
      vehicles: [{ vehicleId: 'v1', plate: 'A', vehicleClass: 'truck', capacityKg: 8000, excluded: false }],
      rules: [rule('keep_off', 'f1', 'v1'), rule('put_on', 'f2', 'v2'), rule('keep_off', 'f3', 'v2')],
    } as unknown as DayPlan;
    const ask = askOf('2026-10-06', accepted);
    expect(ask.keepOff).toEqual([
      { freightId: 'f1', vehicleId: 'v1' },
      { freightId: 'f3', vehicleId: 'v2' },
    ]);
    expect(ask.putOn).toEqual([{ freightId: 'f2', vehicleId: 'v2' }]);
    // No rules, no lists: an ask stays as short as what the office changed.
    expect(askOf('2026-10-06', { ...accepted, rules: [] } as DayPlan)).not.toHaveProperty('keepOff');
  });

  it('takes one rule off and leaves the others — both lists always sent, so the server replaces what it had', () => {
    const rules = [rule('keep_off', 'f1', 'v1'), rule('put_on', 'f1', 'v2'), rule('keep_off', 'f2', 'v1')];
    expect(withoutRule(rules, rules[0])).toEqual({ keepOff: [{ freightId: 'f2', vehicleId: 'v1' }], putOn: [{ freightId: 'f1', vehicleId: 'v2' }] });
    // The last of a kind: an EMPTY list, not a missing one — a missing one would mean "leave as it is".
    expect(withoutRule([rules[1]], rules[1])).toEqual({ keepOff: [], putOn: [] });
    // The same order and vehicle under the other kind is another rule.
    expect(withoutRule(rules, rule('put_on', 'f1', 'v1'))).toEqual(rulesAsk(rules));
  });

  it('keeps an order off a vehicle by hand — once, beside the rules already there, and over a put-on that said the opposite', () => {
    const rules = [rule('keep_off', 'f1', 'v1'), rule('put_on', 'f2', 'v1'), rule('put_on', 'f3', 'v2')];
    expect(keptOff(rules, { freightId: 'f9', vehicleId: 'v1' })).toEqual({
      keepOff: [
        { freightId: 'f1', vehicleId: 'v1' },
        { freightId: 'f9', vehicleId: 'v1' },
      ],
      putOn: [
        { freightId: 'f2', vehicleId: 'v1' },
        { freightId: 'f3', vehicleId: 'v2' },
      ],
    });
    // Asked again: still one rule.
    expect(keptOff(rules, { freightId: 'f1', vehicleId: 'v1' }).keepOff).toHaveLength(1);
    // f2 was put on v1; now it is kept off v1. The put-on goes — and the one for another order stays.
    expect(keptOff(rules, { freightId: 'f2', vehicleId: 'v1' }).putOn).toEqual([{ freightId: 'f3', vehicleId: 'v2' }]);
    // f3 is put on v2 and kept off v1: both stand, they agree.
    expect(keptOff(rules, { freightId: 'f3', vehicleId: 'v1' }).putOn).toHaveLength(2);
  });

  it('puts an order on a vehicle by hand — its one vehicle, over an earlier one and over a keep-off that said the opposite', () => {
    const rules = [rule('put_on', 'f1', 'v1'), rule('keep_off', 'f1', 'v2'), rule('keep_off', 'f1', 'v3'), rule('put_on', 'f2', 'v1')];
    expect(putOnto(rules, { freightId: 'f1', vehicleId: 'v2' })).toEqual({
      // Kept off v3 still stands; kept off v2 cannot, it is now ON v2.
      keepOff: [{ freightId: 'f1', vehicleId: 'v3' }],
      // f1's earlier vehicle is gone; f2's rule is another order's.
      putOn: [
        { freightId: 'f2', vehicleId: 'v1' },
        { freightId: 'f1', vehicleId: 'v2' },
      ],
    });
    // Asked again: still one rule for the order.
    expect(putOnto(rules, { freightId: 'f1', vehicleId: 'v1' }).putOn.filter((p) => p.freightId === 'f1')).toEqual([{ freightId: 'f1', vehicleId: 'v1' }]);
  });

  it('says what came of a delivery window — late and early loudest, an unread window next, a wait quietly, on time not at all', () => {
    expect(windowLine({ deliveryWindow: '8-12', window: '08:00–12:00' }, t)).toBeNull();
    expect(windowLine({}, t)).toBeNull();
    expect(windowLine({ deliveryWindow: '8-12', window: '08:00–12:00', lateMin: 40 }, t)).toEqual({ tone: 'danger', text: 'About 40 min after its window (08:00–12:00). It is planned all the same.' });
    expect(windowLine({ window: 'from 18:00', earlyMin: 150 }, t)).toEqual({ tone: 'danger', text: 'About 2 h 30 before its window opens (from 18:00): the day has no room to wait.' });
    expect(windowLine({ deliveryWindow: 'morning', windowUnread: true }, t)).toEqual({ tone: 'warn', text: '"morning" is not a time the plan could read, so it is planned to the day only. Write it as 8-12, or before 14:00.' });
    expect(windowLine({ window: 'from 15:00', waitMin: 25 }, t)).toEqual({ tone: 'idle', text: 'The vehicle waits 25 min for the window to open (from 15:00).' });
    // Late outranks the wait a later door might also have had.
    expect(windowLine({ window: '08:00–12:00', lateMin: 5, waitMin: 10 }, t)?.tone).toBe('danger');
  });

  it('says a rule the way the office would', () => {
    expect(ruleLine({ kind: 'keep_off', code: 'FRT-12', plate: 'KPL 008T' }, t)).toBe('FRT-12 stays off KPL 008T');
    expect(ruleLine({ kind: 'put_on', code: 'FRT-12', plate: 'KPL 003T' }, t)).toBe('FRT-12 goes on KPL 003T, or on no vehicle');
  });

  it('sends the adviser the words of the talk so far, the newest only — never its own account of what changed', () => {
    const turns = Array.from({ length: 10 }, (_, i) => [
      { role: 'user' as const, text: `Q${i}` },
      { role: 'assistant' as const, text: `A${i}`, changed: ['Vehicles leave at 06:00 (was 07:00)'] },
    ]).flat();
    const sent = historyOf([...turns, { role: 'assistant', text: '  ' }]);
    expect(sent).toHaveLength(ADVISER_HISTORY);
    expect(sent[sent.length - 1]).toEqual({ role: 'assistant', text: 'A9' });
    expect(sent.every((x) => Object.keys(x).sort().join() === 'role,text')).toBe(true);
    expect(historyOf([{ role: 'user', text: 'x'.repeat(5000) }])[0].text).toHaveLength(4000);
  });

  it('weighs a day in tonnes and a small order in kilos', () => {
    expect(weightWords(38_400)).toMatch(/^38\.4 t$/);
    expect(weightWords(800)).toBe('800 kg');
  });
});
