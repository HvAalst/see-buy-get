import { describe, expect, it } from 'vitest';
import { proposalOf, termsLine } from './businessRates';

const t = (key: string, p?: Record<string, string | number>) => `${key}${p ? ' ' + JSON.stringify(p) : ''}`;
const steps = [1, 5, 15, 30];
const draft = { vendorId: 'v-big', kind: 'card' as const, prices: ['60', '90', '150', '240'], extraKg: '', pct: '', note: '' };

describe('a large sender’s own rate, on the console (the owner’s D3, 2026-11-12)', () => {
  it('says a contract card weight by weight, a discount in per cent', () => {
    const card = termsLine({ kind: 'card', steps, prices: [60, 90, 150, 240] }, 'KES', t as never);
    expect(card).toContain('tower.rates.big.card');
    expect(card).toContain('1 kg KES 60 · 5 kg KES 90 · 15 kg KES 150 · 30 kg KES 240');
    expect(termsLine({ kind: 'discount', discountPct: 0.125 }, 'KES', t as never)).toContain('"pct":12.5');
  });

  it('sends a card only with a price for every weight, and a discount from more than nothing to half, as a share', () => {
    expect(proposalOf(draft, steps)).toEqual({ vendorId: 'v-big', kind: 'card', prices: [60, 90, 150, 240], perExtraKg: 0 });
    expect(proposalOf({ ...draft, prices: ['60', '', '150', '240'] }, steps)).toBeNull();
    expect(proposalOf({ ...draft, extraKg: '4,5', note: ' Two years ' }, steps)).toMatchObject({ perExtraKg: 4.5, note: 'Two years' });
    expect(proposalOf({ ...draft, vendorId: '' }, steps)).toBeNull();
    expect(proposalOf({ ...draft, kind: 'discount', pct: '10' }, steps)).toEqual({ vendorId: 'v-big', kind: 'discount', discountPct: 0.1 });
    expect(proposalOf({ ...draft, kind: 'discount', pct: '60' }, steps)).toBeNull();
    expect(proposalOf({ ...draft, kind: 'discount', pct: '0' }, steps)).toBeNull();
  });
});
