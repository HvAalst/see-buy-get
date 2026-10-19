import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { eventWords, messageLine, positionsLines, subjectOf, systemSummary, type PositionsView, type SystemMessage, type SystemView } from './system';

const message = (over: Partial<SystemMessage> = {}, data: Record<string, unknown> = { order: { freightId: 'frt_1', code: 'FRT-012' } }): SystemMessage => ({
  id: 'fh_1',
  event: 'order.received',
  at: '2026-10-19T07:00:00.000Z',
  state: 'pending',
  attempts: 0,
  nextTryAt: '2026-10-19T07:00:00.000Z',
  body: JSON.stringify({ event: over.event ?? 'order.received', data, at: '2026-10-19T07:00:00.000Z' }),
  ...over,
});

/** Every event the server sends a fleet's system (backend fleet-hook.types.ts), and the two beside them. */
const SERVER_EVENTS = [
  'order.received', 'order.changed', 'order.removed', 'order.cancelled',
  'load.assigned', 'load.taken', 'load.handed_back', 'load.picked_up', 'load.delivery_failed', 'load.delivered', 'load.cancelled', 'load.claim_opened', 'load.claim_decided',
  'vehicle.broke_down', 'vehicle.breakdown_ended', 'vehicle.loads_moved', 'vehicle.position',
  'run.booked', 'run.booking_cancelled', 'run.cancelled', 'plan.accepted', 'test',
];

describe('a fleet’s own system, as the screen says it', () => {
  it('has words for every step the server sends, and names what each is about from the body that was sent', () => {
    for (const e of SERVER_EVENTS) expect(eventWords(e, t)).not.toBe(e);
    expect(new Set(SERVER_EVENTS.map((e) => eventWords(e, t))).size).toBe(SERVER_EVENTS.length);
    expect(eventWords('order.something_new', t)).toBe('order.something_new');
    expect(subjectOf(message())).toBe('FRT-012');
    expect(subjectOf(message({ event: 'load.assigned' }, { load: { code: 'FRT-020' } }))).toBe('FRT-020');
    expect(subjectOf(message({ event: 'load.handed_back' }, { handBack: { code: 'FRT-021', reason: 'Full' } }))).toBe('FRT-021');
    expect(subjectOf(message({ event: 'vehicle.broke_down' }, { breakdown: { plate: 'KDA 123T' } }))).toBe('KDA 123T');
    expect(subjectOf(message({ event: 'run.booked' }, { run: { lineName: 'Mombasa – Nairobi' } }))).toBe('Mombasa – Nairobi');
    expect(subjectOf(message({ event: 'plan.accepted' }, { plan: { day: '2026-10-20' } }))).toBe('2026-10-20');
    expect(subjectOf(message({ body: 'not json' }))).toBeUndefined();
  });

  it('says what became of a message: arrived, being sent, tried again by itself and why, or given up', () => {
    expect(messageLine(message({ state: 'delivered', attempts: 1, deliveredAt: '2026-10-19T07:00:02.000Z' }), t)).toMatchObject({ warn: false, text: expect.stringMatching(/^Arrived /) });
    expect(messageLine(message(), t)).toEqual({ warn: false, text: 'Being sent.' });
    expect(messageLine(message({ attempts: 2, nextTryAt: '2026-10-19T07:20:00.000Z', lastError: 'No answer in time.' }), t).text).toMatch(/^Not arrived yet: tried 2 times, tried again by itself .+\. Last time: No answer in time\.$/);
    expect(messageLine(message({ state: 'failed', attempts: 8, lastError: 'No answer in time' }), t)).toEqual({ warn: true, text: 'Not arrived: given up after 8 tries. Put your system right, then send it again. Last time: No answer in time.' });
  });

  it('says where its vehicles are is off, or how often, who turned it on, and how the sending goes', () => {
    expect(positionsLines(undefined, t)).toEqual([{ warn: false, text: 'Off: nothing about where your vehicles are is sent.' }]);
    const on: PositionsView = { everyMin: 5, setAt: '2026-10-19T06:00:00.000Z', setBy: 'Amina Manager', delivered: 12, notDelivered: 0, lastDeliveredAt: '2026-10-19T07:00:00.000Z' };
    const lines = positionsLines(on, t);
    expect(lines[0].text).toMatch(/^Sent at most every 5 minutes a vehicle\. Turned on by Amina Manager, /);
    expect(lines[1].text).toMatch(/^12 arrived, 0 did not\. The last arrived /);
    expect(lines).toHaveLength(2);
    expect(positionsLines({ ...on, everyMin: 1 }, t)[0].text).toMatch(/^Sent at most every minute a vehicle\./);
    // A failure since the last arrival is said, as a warning; one older than it is history.
    const failing = positionsLines({ ...on, notDelivered: 3, lastError: 'Your endpoint refused it.', lastErrorAt: '2026-10-19T07:05:00.000Z' }, t);
    expect(failing[2]).toEqual({ warn: true, text: 'The last one did not arrive: Your endpoint refused it. Each is tried once, and the next takes its place.' });
    expect(positionsLines({ ...on, lastError: 'Old', lastErrorAt: '2026-10-19T06:30:00.000Z' }, t)).toHaveLength(2);
  });

  it('sums it up on the dashboard: not set up, where it goes, or how many have not arrived', () => {
    const view = (over: Partial<SystemView> = {}): SystemView => ({ hasSecret: true, events: [], messages: [], url: 'https://tms.example.com/hooks', ...over });
    expect(systemSummary(null, t).text).toMatch(/Not set up\.$/);
    expect(systemSummary(view({ url: undefined }), t).warn).toBe(false);
    expect(systemSummary(view(), t)).toEqual({ warn: false, text: 'Told each step of your work, at https://tms.example.com/hooks.' });
    // Being sent for the first time is not "not arrived"; tried and waiting, or given up, is.
    const stuck = view({ messages: [message(), message({ id: 'b', attempts: 2 }), message({ id: 'c', state: 'failed', attempts: 8 }), message({ id: 'd', state: 'delivered', attempts: 1 })] });
    expect(systemSummary(stuck, t)).toEqual({ warn: true, text: '2 messages have not arrived at your system.' });
  });
});
