import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n'; // English is the base catalog, so the real `t` yields the English literals
import { selectablePoints, takeInTermsNotice, termsBlock } from './logic';
import type { NetworkPoint, TakeInTerms } from './types';

describe('the destination picker at a counter', () => {
  it('never offers a shop in another country — a walk-up cannot cross a border', () => {
    const pt = (did: string, country?: string): NetworkPoint => ({ did, shopName: did, zone: 'Z', country, openState: 'open', pricePerParcel: 1 });
    const pts = [pt('nairobi', 'KE'), pt('dar', 'TZ'), pt('legacy')];
    expect(selectablePoints(pts, undefined, null, 'KE').map((p) => p.did)).toEqual(['legacy', 'nairobi']);
    expect(selectablePoints(pts, undefined, null).map((p) => p.did)).toEqual(['dar', 'legacy', 'nairobi']);
  });
});

const terms = (over: Partial<TakeInTerms> = {}): TakeInTerms => ({
  promise: 'ours',
  jurisdiction: 'KE',
  level: 'established',
  answeredBy: 'SBG Kenya',
  coverLimit: 5000,
  coverBasis: 'free-limit',
  currency: 'KES',
  cashAccepted: true,
  paidOut: true,
  ...over,
});

describe('P3 — what the counter says before it takes goods in', () => {
  it('names the sister and the figure it pays up to', () => {
    const n = takeInTermsNotice(terms(), t);
    expect(n.title).toBe('Covered by SBG Kenya');
    expect(n.detail).toContain('up to 5000.00 KES');
  });

  it('says the work is owed but not paid out, where the country cannot be paid out in', () => {
    expect(takeInTermsNotice(terms({ jurisdiction: 'DE', paidOut: false }), t).detail).toMatch(/cannot pay out in DE yet/);
    expect(takeInTermsNotice(terms(), t).detail).not.toMatch(/pay out/);
  });

  it('never invents a figure where the sister stated none', () => {
    const n = takeInTermsNotice(terms({ coverLimit: 0, coverBasis: 'no-stated-limit' }), t);
    expect(n.detail).not.toMatch(/\d/);
    expect(n.detail).toMatch(/case by case/);
  });

  it('says the carrier answers, and that our cover is zero, where the promise is theirs', () => {
    const n = takeInTermsNotice(terms({ promise: 'theirs', jurisdiction: 'TZ', answeredBy: undefined, coverLimit: 0, coverBasis: 'none' }), t);
    expect(n.tone).toBe('warn');
    expect(n.title).toMatch(/carrier answers/);
    expect(n.detail).toMatch(/TZ/);
    expect(n.detail).toMatch(/cover is zero/);
  });

  it('blocks until the terms are known — a failed load is not consent', () => {
    expect(termsBlock(null, 'loading', false, t)).toMatch(/Checking/);
    expect(termsBlock(null, 'error', false, t)).toMatch(/Could not check/);
    expect(termsBlock(terms(), 'ready', false, t)).toBeNull();
  });

  it('blocks a carrier take-in until the customer has been told, and refuses NONE outright', () => {
    const theirs = terms({ promise: 'theirs', coverBasis: 'none', coverLimit: 0 });
    expect(termsBlock(theirs, 'ready', false, t)).toMatch(/tick the box/);
    expect(termsBlock(theirs, 'ready', true, t)).toBeNull();
    expect(termsBlock(terms({ promise: 'none' }), 'ready', true, t)).toMatch(/Nothing can be taken in/);
  });
});
