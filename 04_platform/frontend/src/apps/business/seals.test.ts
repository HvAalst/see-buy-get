import { describe, expect, it } from 'vitest';
import { EMPTY_SEAL, sealBody, sealGaps } from './seals';

describe('the Business app — a seal written on a load (round 15)', () => {
  it('asks for the number, the ISO 17712 class and the three photographs, in that order; the maker is the shipper’s to add', () => {
    expect(sealGaps(EMPTY_SEAL)).toEqual(['number', 'sealClass', 'loadedOpen', 'closedWithSeal', 'sealCloseUp']);
    const full = { ...EMPTY_SEAL, number: ' KE 1234-567 ', sealClass: 'H' as const, loadedOpen: 'm1', closedWithSeal: 'm2', sealCloseUp: 'm3' };
    expect(sealGaps(full)).toEqual([]);
    expect(sealGaps({ ...full, closedWithSeal: '' })).toEqual(['closedWithSeal']);
  });

  it('sends the number as written, the maker only where given', () => {
    const full = { ...EMPTY_SEAL, number: ' KE 1234-567 ', sealClass: 'H' as const, loadedOpen: 'm1', closedWithSeal: 'm2', sealCloseUp: 'm3' };
    expect(sealBody(full)).toEqual({ number: 'KE 1234-567', sealClass: 'H', appliedBy: 'sender', photos: { loadedOpen: 'm1', closedWithSeal: 'm2', sealCloseUp: 'm3' } });
    expect(sealBody({ ...full, maker: ' Leghorn ', appliedBy: 'customs' })).toMatchObject({ maker: 'Leghorn', appliedBy: 'customs' });
  });
});
