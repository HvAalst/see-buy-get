import { describe, expect, it } from 'vitest';
import { relabelRows } from './screens/RelabelCard';
import type { ParcelRow } from './types';

const row = (parcelId: string, over: Partial<ParcelRow> = {}): ParcelRow => ({ parcelId, size: 'M', status: 'At_MDP', destZone: 'NorthTown', atMdpId: 'MDP-1', ...over });

describe('the new labels a hub puts on (the user, 2026-10-27: “Comes back, store pays”)', () => {
  it('lists every parcel called off here and not sorted yet — its new label beside the old one it goes over', () => {
    const inbound = [
      row('PUD-NEW1', { returnOf: { parcelId: 'PUD-OLD1', atMdpId: 'MDP-1', at: '2026-10-27T08:00:00.000Z' } }),
      row('PUD-SORTED', { toteId: 'T-1', returnOf: { parcelId: 'PUD-OLD2', atMdpId: 'MDP-1', at: '2026-10-27T08:00:00.000Z' } }),
      row('PUD-OTHERHUB', { atMdpId: 'MDP-2', returnOf: { parcelId: 'PUD-OLD3', atMdpId: 'MDP-2', at: '2026-10-27T08:00:00.000Z' } }),
      row('PUD-PLAIN'),
    ];
    expect(relabelRows(inbound, 'MDP-1', null)).toEqual([{ oldId: 'PUD-OLD1', newId: 'PUD-NEW1' }]);
  });

  it('puts the one just scanned under its old label first, once — even before the list has caught up', () => {
    expect(relabelRows([], 'MDP-1', { oldId: 'PUD-OLD9', newId: 'PUD-NEW9' })).toEqual([{ oldId: 'PUD-OLD9', newId: 'PUD-NEW9' }]);
    const inbound = [row('PUD-NEW9', { returnOf: { parcelId: 'PUD-OLD9', atMdpId: 'MDP-1', at: '2026-10-27T08:00:00.000Z' } })];
    expect(relabelRows(inbound, 'MDP-1', { oldId: 'PUD-OLD9', newId: 'PUD-NEW9' })).toEqual([{ oldId: 'PUD-OLD9', newId: 'PUD-NEW9' }]);
  });
});
