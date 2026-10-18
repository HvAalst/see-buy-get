import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { lostLine, lostReasonBlocker, type LostParcelRow } from './lost';

const day = (iso: string) => iso.slice(0, 10);

describe('a lost parcel in the console', () => {
  it('asks for where staff looked before a parcel is declared lost: the sender reads it', () => {
    expect(lostReasonBlocker('gone', t)).toBe('Say where you looked and what you found: the sender reads it.');
    expect(lostReasonBlocker('Looked on the shelf and in the back room.', t)).toBeNull();
  });

  it('says who declared it and, once it turned up, who found it', () => {
    const row: LostParcelRow = { parcelId: 'P1', status: 'Lost', declaredAt: '2026-10-10T08:00:00Z', acts: [{ act: 'declared', by: 'Achieng', at: '2026-10-10T08:00:00Z', words: 'x' }] };
    expect(lostLine(row, t, day)).toBe('Declared lost by Achieng on 2026-10-10');
    const found = { ...row, status: 'At_PUDO', foundAt: '2026-10-12T09:00:00Z', acts: [...row.acts, { act: 'found' as const, by: 'Baraka', at: '2026-10-12T09:00:00Z', words: 'y' }] };
    expect(lostLine(found, t, day)).toBe('Declared lost by Achieng on 2026-10-10 · Found by Baraka on 2026-10-12');
  });
});
