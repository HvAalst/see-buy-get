import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { weekForm } from '../fleet/sites';
import { bulkBody, feeEach, feesLine } from './arrivals';
import { feeAskLines } from './logic';

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

describe('fees above the country’s ceiling (the owner’s D3, 2026-11-12)', () => {
  it('says what waits for SeeBuyGet, sort and pass-on, in its own money; a refusal with why once it has not asked again', () => {
    expect(feeAskLines(null, t)).toEqual([]);
    expect(feeAskLines({ currency: 'KES' }, t)).toEqual([]);
    const both = feeAskLines({ currency: 'KES', feeAsked: { pricePerParcel: 45, passOnFee: 30, at: '2026-11-12T08:00:00Z' } }, t).map(plain);
    expect(both).toEqual(['Waiting for SeeBuyGet to approve KES 45.00 a parcel. Until then you are paid your fee as it was.', 'Waiting for SeeBuyGet to approve KES 30.00 a bag passed on. Until then you are paid your fee as it was.']);
    expect(feeAskLines({ currency: 'KES', feeAsked: { passOnFee: 30, at: '2026-11-12T08:00:00Z' } }, t)).toHaveLength(1);
    const refused = { by: 'Amina', reason: 'Above every hub on this road', at: '2026-11-12T09:00:00Z' };
    expect(feeAskLines({ currency: 'KES', feeRefused: refused }, t)).toEqual(['SeeBuyGet did not approve the fee you asked: Above every hub on this road']);
    // Asked again since: what waits now, not the old refusal.
    expect(feeAskLines({ currency: 'KES', feeRefused: refused, feeAsked: { pricePerParcel: 40, at: '2026-11-12T10:00:00Z' } }, t).join(' ')).not.toContain('did not approve');
  });
});
