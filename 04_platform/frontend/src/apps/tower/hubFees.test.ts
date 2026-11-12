import { describe, expect, it } from 'vitest';
import { asksFor, type HubFeeAsk } from './screens/HubFeesFold';

const ask = (mdpId: string, country: string, at: string): HubFeeAsk => ({ mdpId, name: mdpId, country, currency: 'KES', pricePerParcel: 30, passOnFee: 30, asked: { pricePerParcel: 60, at }, ceiling: { sort: 45, passOn: 45, multiple: 1.5 } });

describe('hub fees waiting for approval, on the console (the owner’s D3, 2026-11-12)', () => {
  it('lists the company’s own country’s asks, the oldest first', () => {
    const rows = [ask('b', 'KE', '2026-11-12T10:00:00Z'), ask('x', 'ET', '2026-11-12T07:00:00Z'), ask('a', 'KE', '2026-11-12T08:00:00Z')];
    expect(asksFor(rows, 'KE').map((r) => r.mdpId)).toEqual(['a', 'b']);
    expect(asksFor(rows, undefined).map((r) => r.mdpId)).toEqual(['x', 'a', 'b']);
    expect(asksFor([], 'KE')).toEqual([]);
  });
});
