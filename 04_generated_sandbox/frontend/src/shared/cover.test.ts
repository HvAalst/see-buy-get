import { describe, expect, it } from 'vitest';
import { t } from './i18n';
import { coverShortfall, coverWords, handlesWords } from './cover';

/**
 * WHERE COVER STANDS — and the answer is never "with us".
 *
 * We do not insure goods on a fleet's own run and are not going to. What we were doing instead was saying
 * NOTHING, and silence on a screen that quotes a price reads as cover. These three answers are the whole
 * of what this file exists for, and the third is the one that had to be written.
 */
describe('what the carrier covers, and what we do not', () => {
  it('says the limit, and says we insure nothing in the same breath', () => {
    expect(coverWords({ limit: 200000 }, 'KES', t)).toBe('The carrier insures up to 200000 KES per load. SeeBuyGet insures nothing.');
    expect(coverWords({ limit: 200000, policy: 'Jubilee GIT/2026/114' }, 'KES', t)).toContain('Jubilee GIT/2026/114');
  });

  it('treats ZERO as a real answer, not as absence', () => {
    // "I carry none" is exactly what a forwarder needs to hear, and a different fact from silence.
    expect(coverWords({ limit: 0 }, 'KES', t)).toContain('travel uninsured');
  });

  it('says the carrier has not said, rather than leaving a blank line', () => {
    // A shipper who reads nothing assumes the network is behind the goods, which it is not.
    expect(coverWords(undefined, 'KES', t)).toContain('has not said what cover');
  });
});

describe('the gap a forwarder can price', () => {
  it('is the declared value beyond the carrier’s limit', () => {
    expect(coverShortfall(450000, { limit: 200000 })).toBe(250000);
  });

  it('is the whole value where the carrier covers nothing at all', () => {
    expect(coverShortfall(450000, { limit: 0 })).toBe(450000);
    expect(coverShortfall(450000, undefined)).toBe(450000);
  });

  it('is nothing where the cover reaches', () => {
    expect(coverShortfall(120000, { limit: 200000 })).toBeNull();
    expect(coverShortfall(200000, { limit: 200000 })).toBeNull();
  });

  it('says nothing at all where no value was declared', () => {
    // Plenty of loads are not worth insuring, and inventing a shortfall against a value nobody stated
    // would be a warning about a number we made up.
    expect(coverShortfall(undefined, { limit: 200000 })).toBeNull();
    expect(coverShortfall(0, { limit: 0 })).toBeNull();
  });
});

describe('what the truck can take', () => {
  it('says it in words, before the form rather than as a refusal after it', () => {
    expect(handlesWords(['coldChain', 'hazmat'], t)).toBe('This vehicle can carry temperature-controlled goods, dangerous goods.');
  });

  it('says nothing for a plain body, rather than "this vehicle can carry nothing"', () => {
    expect(handlesWords([], t)).toBe('');
  });

  it('ignores a capability from a newer server rather than leaking a field name', () => {
    expect(handlesWords(['carriesAntimatter'], t)).toBe('');
  });
});
