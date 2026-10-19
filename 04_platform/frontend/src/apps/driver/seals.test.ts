import { describe, expect, it } from 'vitest';
import { atPostBody, atPostReady, EMPTY_AT_POST, pickupSealsReady } from './seals';

const seal = (sealId: string, no: number, state: 'on' | 'replaced' | 'broken' = 'on') => ({ sealId, no, sealClass: 'H' as const, appliedBy: 'sender' as const, state, check: 'x' });
const claim = { seals: [seal('s1', 1), seal('s2', 2), seal('s0', 3, 'replaced')] };

describe('the seals from the cab (round 15)', () => {
  it('lets the load go only with every seal on it read, photographed and not found to be another number', () => {
    expect(pickupSealsReady({ seals: [] }, {})).toBe(true);
    expect(pickupSealsReady(claim, {})).toBe(false);
    const read = { s1: { number: 'KE1', photoRef: 'm1', ok: true }, s2: { number: 'KE2', photoRef: 'm2', ok: null } };
    // Not yet checked on the phone (it cannot hash): the server answers instead.
    expect(pickupSealsReady(claim, read)).toBe(true);
    expect(pickupSealsReady(claim, { ...read, s2: { ...read.s2, ok: false } })).toBe(false);
    expect(pickupSealsReady(claim, { ...read, s2: { ...read.s2, photoRef: '' } })).toBe(false);
    // A seal customs replaced is not on the door any more: it is not asked for.
    expect(pickupSealsReady({ seals: [seal('s0', 1, 'replaced')] }, {})).toBe(true);
  });

  it('clearing a border asks what became of the seals: as they were, or which customs replaced, each with its new number and photograph', () => {
    expect(atPostReady({ seals: [] }, EMPTY_AT_POST)).toBe(true);
    expect(atPostBody({ seals: [] }, EMPTY_AT_POST)).toBeUndefined();
    expect(atPostReady(claim, EMPTY_AT_POST)).toBe(false);
    expect(atPostReady(claim, { asTheyWere: true, replaced: {} })).toBe(true);
    expect(atPostBody(claim, { asTheyWere: true, replaced: {} })).toEqual({ asTheyWere: true });
    expect(atPostReady(claim, { asTheyWere: false, replaced: {} })).toBe(false);
    const replaced = { asTheyWere: false, replaced: { s1: { newNumber: ' UG 990011 ', photoRef: 'm9', officer: ' J. Okello ' } } };
    expect(atPostReady(claim, replaced)).toBe(true);
    expect(atPostReady(claim, { ...replaced, replaced: { s1: { ...replaced.replaced.s1, photoRef: '' } } })).toBe(false);
    expect(atPostBody(claim, replaced)).toEqual({ replaced: [{ sealId: 's1', newNumber: 'UG 990011', photoRef: 'm9', officer: 'J. Okello' }] });
  });
});
