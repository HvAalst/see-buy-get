import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { roadSays } from './logic';

const when = (iso: string) => iso.slice(11, 16);
const wait = { from: 'KE', to: 'UG', post: 'Malaba', hours: 9, basis: 'measured' as const, crossings: 23 };

describe('the Business app — a load on the road, as its driver said it (round 14)', () => {
  it('crossing a border: where it has got to, the allowance and what it rests on, and when it is expected', () => {
    const at = roadSays({ status: 'in_transit', passages: [{ kind: 'at_border', post: 'Malaba', at: '2026-10-19T13:40:00.000Z' }], crossing: { state: 'at_post', from: 'KE', to: 'UG', post: 'Malaba', since: '2026-10-19T13:40:00.000Z', wait, expectedAt: '2026-10-20T06:10:00.000Z' } }, t, when);
    expect(at).toEqual({
      row: 'At the border, Malaba, since 13:40',
      wait: 'Allowed 9 h at this post: the middle of the last 23 crossings measured here',
      expected: 'Expected about 06:10',
    });
    // Across: what it waited, and no allowance left to wait.
    const across = roadSays({ status: 'in_transit', crossing: { state: 'cleared', from: 'KE', to: 'UG', post: 'Malaba', clearedAt: '2026-10-19T22:10:00.000Z', waitedMin: 510, wait } }, t, when);
    expect(across).toEqual({ row: 'Cleared Malaba — 22:10, after 8 h 30 min there' });
    // Across and on at a hub: the hub is where it is now.
    const passages = [
      { kind: 'cleared_border' as const, post: 'Malaba', at: '2026-10-19T22:10:00.000Z', waitedMin: 510 },
      { kind: 'at_hub' as const, hub: 'Kampala ICD', at: '2026-10-20T04:30:00.000Z' },
    ];
    expect(roadSays({ status: 'in_transit', passages, crossing: { state: 'cleared', from: 'KE', to: 'UG', post: 'Malaba', clearedAt: '2026-10-19T22:10:00.000Z', waitedMin: 510, wait, expectedAt: '2026-10-20T05:10:00.000Z' } }, t, when)).toEqual({
      row: 'At Kampala ICD — 04:30',
      expected: 'Expected about 05:10',
    });
  });

  it('a load in one country says the last hub it was at; nothing while it is not on the road', () => {
    expect(roadSays({ status: 'in_transit', passages: [{ kind: 'at_hub', hub: 'Naivasha ICD', at: '2026-10-19T09:00:00.000Z' }] }, t, when)).toEqual({ row: 'At Naivasha ICD — 09:00' });
    expect(roadSays({ status: 'in_transit' }, t, when)).toBeNull();
    expect(roadSays({ status: 'delivered', passages: [{ kind: 'at_hub', hub: 'Naivasha ICD', at: '2026-10-19T09:00:00.000Z' }] }, t, when)).toBeNull();
  });
});
