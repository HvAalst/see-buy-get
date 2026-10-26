import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { weekForm } from '../fleet/sites';
import { bulkBody, feeEach, feesLine } from './arrivals';

/** The money words keep the currency and the sum together with a no-break space; compared as plain spaces. */
const plain = (s: string | null) => s?.replace(/[\u00a0\u202f]/g, ' ') ?? null;

const week = weekForm({ mon: { open: '07:00', close: '18:00' } });

describe('what a hub charges to take in each unit (D12; the user, 2026-10-26: “Its own fee”)', () => {
  it('sends each kind as a sum of money to the cent, or nothing where the box is blank', () => {
    const made = bulkBody(true, week, '', { pallet: '150', carton: '12,5', cage: '', sack: '0' });
    expect(made).toEqual({ body: { open: true, hours: week, doors: null, fees: { pallet: 150, carton: 12.5, cage: null, sack: null } } });
  });

  it('refuses a fee that is not a sum of money before anything is sent', () => {
    for (const bad of ['abc', '1.234', '-5', '1e3', '2000000']) expect(bulkBody(true, week, '', { pallet: bad })).toEqual({ error: 'mdp.bulk.errFee' });
  });

  it('leaves the fees alone where the sheet asks nothing of them', () => {
    expect(bulkBody(true, week, '')).toEqual({ body: { open: true, hours: week, doors: null } });
  });

  it('says what it charges, kind by kind, in its own money — and nothing where it charges for none', () => {
    expect(plain(feeEach('pallet', 150, 'KES', t))).toBe('KES 150.00 a pallet');
    expect(plain(feesLine({ fees: { pallet: 150, sack: 5 }, feeCurrency: 'KES' }, t))).toBe('KES 150.00 a pallet · KES 5.00 a sack');
    expect(feesLine({ fees: {}, feeCurrency: 'KES' }, t)).toBeNull();
    expect(feesLine(undefined, t)).toBeNull();
  });
});
