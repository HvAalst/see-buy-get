import { describe, expect, it } from 'vitest';
import { t } from '../../shared/i18n';
import { cleanPrefix, maySendLicence, mayTakeBack, type Gs1DisputeView } from '../../shared/gs1';
import { ssccWords, storeDisputeLine, storeGs1Line } from './gs1';

/** Round 29 — a store's GS1 prefix and the disputes it is in, as the Store app says them. */
describe('a store’s GS1 prefix', () => {
  const gs1 = { companyPrefix: '6161234', extensionDigit: 2, left: 999_999_998, setAt: '2026-10-20T08:00:00Z', setBy: 'Duka Bora' };
  const day = (iso: string) => iso.slice(0, 10);
  const base: Gs1DisputeView = {
    disputeId: 'gd_1',
    companyPrefix: '6161234',
    extensionDigit: 2,
    side: 'holder',
    state: 'open',
    openedAt: '2026-10-20T08:00:00Z',
    answerBy: '2026-10-27T08:00:00Z',
    claimantName: 'Jenga Bricks',
    holderNames: ['Duka Bora'],
    licenceSent: false,
  };

  it('says the prefix, the digit and the codes left — and takes a prefix only as GS1 gives one', () => {
    expect(storeGs1Line(gs1, t)).toContain('Prefix 6161234, extension digit 2');
    expect(cleanPrefix(' 616-1234 ')).toBe('6161234');
    expect(cleanPrefix('61612')).toBeUndefined();
  });

  it('asks a store using a disputed prefix for its licence, by a date — loudly — and never offers it the claimant’s undo', () => {
    const asked = storeDisputeLine(base, t, day);
    expect(asked.tone).toBe('warn');
    expect(asked.text).toContain('Jenga Bricks says prefix 6161234, which you use, is theirs');
    expect(asked.text).toContain('2026-10-27');
    expect(maySendLicence(base)).toBe(true);
    expect(mayTakeBack(base)).toBe(false);
    expect(storeDisputeLine({ ...base, licenceSent: true }, t, day).tone).toBe('idle');
  });

  it('says a decision in the store’s own terms: its parcels keep their codes', () => {
    const lost = storeDisputeLine({ ...base, state: 'decided', decided: { mine: false, reason: 'The licence is theirs', at: '2026-10-28T08:00:00Z' } }, t, day);
    expect(lost.tone).toBe('danger');
    expect(lost.text).toContain('the parcels you sent keep the codes they were given');
    expect(lost.text).not.toContain('loads');
    const won = storeDisputeLine({ ...base, side: 'claimant', state: 'decided', decided: { mine: true, reason: 'Licensed to the store', at: '2026-10-28T08:00:00Z' } }, t, day);
    expect(won).toEqual({ text: expect.stringContaining('is yours. Their reason: Licensed to the store'), tone: 'ok' });
    expect(mayTakeBack({ ...base, side: 'claimant' })).toBe(true);
  });

  it('says one holder in the singular and several in the plural', () => {
    const claimed = { ...base, side: 'claimant' as const, holderNames: ['Jenga Bricks'] };
    expect(storeDisputeLine(claimed, t, day).text).toContain('Jenga Bricks uses it, and has until 2026-10-27 to send its GS1 licence');
    expect(storeDisputeLine({ ...claimed, holderNames: ['Jenga Bricks', 'Duka Bora'] }, t, day).text).toContain('Jenga Bricks, Duka Bora use it, and have until 2026-10-27 to send their GS1 licence');
  });

  it('spaces an order’s SSCC at the prefix while the store holds it, and gives the eighteen digits as they are otherwise', () => {
    const sscc = '261612340000000018'; // extension digit 2, prefix 6161234, serial 1, check digit 8
    expect(ssccWords(sscc, gs1)).toBe('2 6161234 000000001 8');
    expect(ssccWords(sscc, undefined)).toBe(sscc);
    expect(ssccWords(sscc, { ...gs1, companyPrefix: '6169999' })).toBe(sscc);
  });
});
