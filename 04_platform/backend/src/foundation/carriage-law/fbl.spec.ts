import { checkFbl, FBL_BOXES, FIATA_VERIFY_URL, SDR_RATE, type HeldFblFacts } from './fbl';

/*
 * THE FIATA BILL OF LADING, HELD AND EXPLAINED (the user, 2026-10-28: "if we optimize for FBL, we must know and report for
 * our users"). Checked 2026-10-29 against the 1992 conditions FIATA still reprints: limits, deadlines, negotiability.
 */
const all = [...FBL_BOXES];
const bill = (over: Partial<HeldFblFacts> = {}): HeldFblFacts => ({ form: 'fbl', printed: all, seaLeg: true, issuerCountry: 'KE', countries: ['KE', 'NL'], electronic: false, ...over });

describe('a held FIATA bill, checked against its form', () => {
  it('every box printed is complete; a missing signature or number of originals is not', () => {
    expect(checkFbl(bill()).complete).toBe(true);
    const c = checkFbl(bill({ printed: all.filter((b) => b !== 'signature' && b !== 'originals') }));
    expect(c.complete).toBe(false);
    expect(c.findings.map((f) => [f.key, f.kind])).toEqual([['originals', 'missing'], ['signature', 'missing']]);
    expect(c.findings[1].rule).toMatch(/UCP 600 Art\. 19\(a\)\(i\)/);
  });

  it('a gap that depends on the carriage is asked, never counted: the vessel only where there is a sea leg', () => {
    const noVessel = all.filter((b) => b !== 'vessel');
    expect(checkFbl(bill({ printed: noVessel })).findings).toEqual([{ key: 'vessel', rule: 'The form’s face', kind: 'ask' }]);
    expect(checkFbl(bill({ printed: noVessel })).complete).toBe(true);
    expect(checkFbl(bill({ printed: noVessel, seaLeg: false })).findings).toEqual([]);
  });

  it('a waybill (FWB) is not negotiable, and asks for no number of originals or delivery agent', () => {
    const c = checkFbl(bill({ form: 'fwb', printed: all.filter((b) => b !== 'originals' && b !== 'deliveryAgent') }));
    expect(c.negotiable).toBe(false);
    expect(c.complete).toBe(true);
    expect(c.meaning[0]).toMatch(/^Not negotiable/);
  });
});

describe('what it means, in plain words', () => {
  it('the limits in SDR, with about-dollars at a dated rate: 666.67 a package or 2 a kilogram with a sea leg, 8.33 without', () => {
    expect(SDR_RATE).toMatchObject({ on: '2026-10-28' });
    expect(checkFbl(bill()).limits[0]).toBe('At most 666.67 SDR a package (about US$901) or 2 SDR a kilogram of gross weight (about US$2.70), whichever is higher, unless a higher value was declared and accepted before it was taken in charge (FBL cl. 8.3).');
    expect(checkFbl(bill({ seaLeg: false })).limits[0]).toBe('No sea or inland waterway in the carriage: at most 8.33 SDR a kilogram of gross weight (about US$11.26) (FBL cl. 8.5).');
    expect(checkFbl(bill()).claims.join(' ')).toMatch(/within 6 days after delivery.*within 9 months/);
  });

  it('negotiable: one original surrendered endorsed; a copy we keep is never one', () => {
    expect(checkFbl(bill()).meaning.join(' ')).toMatch(/what SeeBuyGet keeps is not one/);
  });

  it('a country’s own law is said where it changes the meaning — Ethiopia’s limits, Kenya’s electronic documents of title', () => {
    expect(checkFbl(bill({ countries: ['ET', 'DJ'], issuerCountry: 'ET' })).country.map((c) => c.country)).toEqual(['ET', 'DJ']);
    expect(checkFbl(bill()).country.map((c) => c.country)).toEqual(['KE']);
    expect(checkFbl(bill({ issuerCountry: 'NL', countries: ['NL', 'DE'] })).country).toEqual([]);
  });

  it('where to look it up: FIATA’s page for an electronic bill, the association for paper — and what neither proves', () => {
    const e = checkFbl(bill({ electronic: true })).genuine;
    expect(e.where).toBe(FIATA_VERIFY_URL);
    expect(e.says).toMatch(/does not say who holds it now/);
    // We check nobody's membership: the holder looks the issuer up in FIATA's own directory (the user, 2026-10-29).
    expect(checkFbl(bill()).genuine).toMatchObject({ where: 'https://fiata.org/directory/', directory: 'https://fiata.org/directory/', says: expect.stringMatching(/SeeBuyGet checks nobody’s membership/) });
  });
});
