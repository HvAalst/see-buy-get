import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { t } from '../../shared/i18n';
import { ComingInCard, COMING_IN_SHOWN } from './screens/ComingInCard';
import type { ExpectedDropOff } from './types';

/*
 * 2026-11-05 — PRE-DROP-OFF: the counter sees what is booked to be handed in here, each holding a place on its shelf for 24
 * hours from booking (the owner). Before this it heard of a booking only in the bell.
 */
const NOW = Date.parse('2026-11-05T12:00:00Z');
const HOUR = 3_600_000;
const booked = (over: Partial<ExpectedDropOff> = {}): ExpectedDropOff => ({
  parcelId: `P-${Math.random()}`,
  from: 'store',
  name: 'Nairobi Threads',
  size: 'M',
  heldUntil: new Date(NOW + 10 * HOUR).toISOString(),
  state: 'held',
  nextStop: 'Westlands Hub',
  ...over,
});
const card = (expected: ExpectedDropOff[] | undefined, held?: number) => renderToString(<ComingInCard expected={expected} held={held} now={NOW} />);

describe('booked to be handed in here', () => {
  it('says nothing when nothing is booked', () => {
    expect(card([])).toBe('');
    expect(card(undefined)).toBe('');
  });

  it('names the store, never the sender, and the time its place is held for', () => {
    const html = card([booked(), booked({ from: 'sender', name: undefined, heldUntil: new Date(NOW + 2 * HOUR).toISOString() })], 2);
    expect(html).toContain(t('agent.home.comingTitle'));
    expect(html).toContain(t('agent.home.comingFromStore', { store: 'Nairobi Threads' }));
    expect(html).toContain(t('agent.home.comingFromSender'));
    expect(html).toContain(t('agent.home.comingLeft', { hours: 10 }));
    expect(html).toContain(t('agent.home.comingLeft', { hours: 2 }));
    expect(html).toContain(t('agent.home.comingTo', { place: 'Westlands Hub' }));
    expect(html).toContain(t('agent.home.comingLede', { count: 2 }));
  });

  it('a place that ran out is still shown: the booking stands, taken in if there is room', () => {
    const html = card([booked({ state: 'lapsed', heldUntil: new Date(NOW - HOUR).toISOString() })], 0);
    expect(html).toContain(t('agent.home.comingLapsed'));
  });

  it('a same-shop booking says it is collected here', () => {
    expect(card([booked({ sameShop: true, nextStop: undefined })], 1)).toContain(t('agent.home.comingHere'));
  });

  it('names the driver who took on the parcels for that stop ahead (2026-11-05, the driver side)', () => {
    expect(card([booked({ takenBy: 'Amos' })], 1)).toContain(t('agent.home.comingTakenBy', { name: 'Amos' }));
  });

  it('shows the first few and counts the rest', () => {
    const many = Array.from({ length: COMING_IN_SHOWN + 3 }, () => booked());
    expect(card(many, many.length)).toContain(t('agent.home.comingMore', { count: 3 }));
  });
});
