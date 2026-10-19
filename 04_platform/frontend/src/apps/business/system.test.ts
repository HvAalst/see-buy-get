import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { eventWords, loadCodeOf, systemLine, type SystemMessage } from './system';

const message = (over: Partial<SystemMessage> = {}): SystemMessage => ({
  id: 'bh_1',
  event: 'load.delivered',
  at: '2026-10-19T07:00:00.000Z',
  state: 'pending',
  attempts: 0,
  nextTryAt: '2026-10-19T07:00:00.000Z',
  body: JSON.stringify({ event: 'load.delivered', data: { load: { freightId: 'frt_1', code: 'LD-7Q2' } }, at: '2026-10-19T07:00:00.000Z' }),
  ...over,
});

describe('a business’s own system, as the screen says it', () => {
  it('names each step of a load in words, and the load by its code from the body that was sent', () => {
    expect(['load.taken', 'load.picked_up', 'load.delivered', 'load.claim_opened', 'test'].map((e) => eventWords(e, t))).toEqual(['A carrier took it', 'Picked up', 'Delivered', 'A problem reported', 'A test']);
    expect(eventWords('load.something_new', t)).toBe('load.something_new');
    expect(loadCodeOf(message())).toBe('LD-7Q2');
    expect(loadCodeOf(message({ body: 'not json' }))).toBeUndefined();
  });

  it('says what became of a message: arrived, being sent, tried again by itself and why, or given up', () => {
    expect(systemLine(message({ state: 'delivered', attempts: 1, deliveredAt: '2026-10-19T07:00:02.000Z' }), t)).toMatchObject({ warn: false, text: expect.stringMatching(/^Arrived /) });
    expect(systemLine(message(), t)).toEqual({ warn: false, text: 'Being sent.' });
    expect(systemLine(message({ attempts: 1, nextTryAt: '2026-10-19T07:05:00.000Z', lastError: 'Your endpoint had an error of its own. We will try again.' }), t).text).toMatch(/^Not arrived yet: tried once, tried again by itself .+\. Last time: Your endpoint had an error of its own\. We will try again\.$/);
    expect(systemLine(message({ state: 'failed', attempts: 8, lastError: 'No answer in time' }), t)).toEqual({ warn: true, text: 'Not arrived: given up after 8 tries. Put your system right, then send it again. Last time: No answer in time.' });
  });
});
