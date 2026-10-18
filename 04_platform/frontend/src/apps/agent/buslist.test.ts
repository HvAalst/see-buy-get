import { describe, expect, it } from 'vitest';
import { busScan, type BusList } from './logic';

/** The bus at the counter (the user, 2026-10-18: "scan at the bus handover"): what a scanned sticker means. */
describe('a parcel scanned at the bus', () => {
  const list: BusList = {
    destZone: 'Westlands',
    parcels: [
      { parcelId: 'PUD-1', size: 'S', destZone: 'Westlands' },
      { parcelId: 'PUD-2', size: 'M', destZone: 'Westlands', binSlot: 'A2' },
    ],
  };
  const waitingHere = [
    { parcelId: 'PUD-1', destZone: 'Westlands' },
    { parcelId: 'PUD-2', destZone: 'Westlands' },
    { parcelId: 'PUD-9', destZone: 'Kisumu' },
  ];

  it('goes on when it is on this bus’s list, once', () => {
    expect(busScan(list, [], waitingHere, 'PUD-2')).toEqual({ kind: 'added' });
    expect(busScan(list, ['PUD-2'], waitingHere, 'PUD-2')).toEqual({ kind: 'again' });
  });

  it('is refused when it waits here for another bus — said with where it goes — or is not here at all', () => {
    expect(busScan(list, [], waitingHere, 'PUD-9')).toEqual({ kind: 'otherBus', zone: 'Kisumu' });
    expect(busScan(list, [], waitingHere, 'PUD-404')).toEqual({ kind: 'notHere' });
  });
});
