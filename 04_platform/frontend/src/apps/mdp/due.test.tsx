import { describe, expect, it } from 'vitest';
import { renderToString } from 'preact-render-to-string';
import { DueTag, dueById } from './screens/DueTag';
import { SortScreen } from './screens/SortScreen';
import type { ParcelRow } from './types';

/*
 * 2026-11-06 — LATE, OR ON TIME, in the hub's queue (the owner: "when we show 'late' we can also show 'on time'"): each
 * parcel waiting to be sorted says which, as the server measured it against the time it was promised; nothing where it
 * has no plan to measure against.
 */
describe('late, or on time, beside a parcel in the hub’s queue', () => {
  const row = (parcelId: string, due?: ParcelRow['due']): ParcelRow => ({ parcelId, size: 'S', status: 'At_MDP', destZone: 'Kisumu', atMdpId: 'MDP-1', ...(due ? { due } : {}) });

  it('says late in the warning tone, on time in the good one — and nothing without a plan', () => {
    expect(renderToString(<DueTag due="late" />)).toBe('<span class="pill pill--warn">late</span>');
    expect(renderToString(<DueTag due="on_time" />)).toBe('<span class="pill pill--ok">on time</span>');
    expect(renderToString(<DueTag />)).toBe('');
  });

  it('on the sort screen, beside each parcel a worker can tap', () => {
    const state = { form: { sortId: '' }, queue: ['PUD-1', 'PUD-2', 'PUD-3'], inbound: [row('PUD-1', 'late'), row('PUD-2', 'on_time'), row('PUD-3')], totes: [], handovers: [], hub: { did: 'did:hub:1', mdpId: 'MDP-1' }, last: null, busy: null, error: null };
    const html = renderToString(<SortScreen state={state as never} actions={{} as never} />);
    expect(html).toContain('<span class="mono">PUD-1</span><span class="pill pill--warn">late</span>');
    expect(html).toContain('<span class="mono">PUD-2</span><span class="pill pill--ok">on time</span>');
    expect(html).toContain('<span class="mono">PUD-3</span></button>');
  });

  it('finds each parcel’s by its id, from the hub’s list', () => {
    const due = dueById([row('PUD-1', 'late'), row('PUD-2', 'on_time'), row('PUD-3')]);
    expect(due.get('PUD-1')).toBe('late');
    expect(due.get('PUD-2')).toBe('on_time');
    expect(due.has('PUD-3')).toBe(false);
  });
});
