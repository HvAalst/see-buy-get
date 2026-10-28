import { checkRailNote, cteKeyProblem, isRailParty, RAIL_INSTRUMENTS, RAIL_PARTICULARS, RAILWAYS, railRegimeOf, railwaysIn, type HeldRailNote } from './rail';

/*
 * THE LAW OF A RAIL CONSIGNMENT, AND WHETHER ITS NOTE CARRIES WHAT THAT LAW ASKS (the user, 2026-10-28: "for now we hold
 * the note but we should be able to see whether it is valid"). Checked 2026-10-28 against OTIF's and OSJD's lists: no
 * East African state is in the CIM or the SMGS.
 */
const day = '2026-10-28';
const all = [...RAIL_PARTICULARS];
const note = (over: Partial<HeldRailNote>): HeldRailNote => ({ from: 'DE', to: 'AT', madeOutOn: day, load: 'container', printed: all, ...over });

describe('the law of a rail lane, from membership', () => {
  it('reads the lists it was given: 51 CIM states (two suspended apart), 26 SMGS parties', () => {
    expect(Object.keys(RAIL_INSTRUMENTS.cim.parties)).toHaveLength(49);
    expect(RAIL_INSTRUMENTS.cim.suspended).toEqual(['IQ', 'SY']);
    expect(Object.keys(RAIL_INSTRUMENTS.smgs.parties)).toHaveLength(26);
    expect(isRailParty('cim', 'IQ', day)).toBe(false);
  });

  it('no East African state is in the CIM or the SMGS; in Africa only Algeria, Morocco and Tunisia are in the CIM', () => {
    for (const c of ['KE', 'UG', 'TZ', 'RW', 'BI', 'ET', 'DJ', 'SS', 'CD', 'ZA', 'ZM']) {
      expect(isRailParty('cim', c, day)).toBe(false);
      expect(isRailParty('smgs', c, day)).toBe(false);
    }
    for (const c of ['DZ', 'MA', 'TN']) expect(isRailParty('cim', c, day)).toBe(true);
  });

  it('names the regime of each lane', () => {
    expect(railRegimeOf('KE', 'KE', day)).toBe('national');
    expect(railRegimeOf('DE', 'AT', day)).toBe('cim');
    expect(railRegimeOf('CN', 'KZ', day)).toBe('smgs');
    // Russia applies the CIM only on its listed lines; with Poland, both are SMGS parties.
    expect(railRegimeOf('RU', 'PL', day)).toBe('smgs');
    expect(railRegimeOf('RU', 'DE', day)).toBe('cim_lines');
    expect(railRegimeOf('DE', 'CN', day)).toBe('cim_smgs');
    expect(railRegimeOf('MA', 'MR', day)).toBe('cim_if_agreed');
    expect(railRegimeOf('BR', 'AR', day)).toBe('atit');
    expect(railRegimeOf('KE', 'UG', day)).toBe('contract');
    expect(railRegimeOf('IQ', 'TR', day)).toBe('cim_if_agreed');
  });

  it('every railway names its source, the day it was checked, and what a holder needs when something goes wrong', () => {
    for (const r of RAILWAYS) {
      expect(r.source).toMatch(/^https:\/\//);
      expect(r.checkedOn).toBe(day);
      expect(r.limits.length + r.claims.length).toBeGreaterThan(0);
      // A railway whose note rules we have not read must say so.
      if (!r.particulars) expect(r.caveat).toBeTruthy();
    }
    expect(railwaysIn('TZ').map((r) => r.key)).toEqual(['trc', 'tazara']);
  });
});

describe('the check of a held rail note', () => {
  it('a CIM note with everything printed is complete; without the CIM statement it is not, and says which article', () => {
    expect(checkRailNote(note({})).complete).toBe(true);
    const c = checkRailNote(note({ printed: all.filter((p) => p !== 'statement') }));
    expect(c.complete).toBe(false);
    expect(c.findings).toEqual([{ key: 'statement', rule: 'CIM Art. 7 §1 (p)', kind: 'missing' }]);
    expect(c.limits[0]).toMatch(/17 SDR a kilogram/);
  });

  it('a gap the note alone cannot settle is asked about, never counted missing', () => {
    const c = checkRailNote(note({ printed: all.filter((p) => p !== 'documents') }));
    expect(c.findings).toEqual([{ key: 'documents', rule: 'CIM Art. 7 §1 (n)', kind: 'ask', unless: 'no_documents' }]);
    expect(c.complete).toBe(true);
  });

  it('asks for what the load is: a container’s number, a wagon’s, or packages and their marks', () => {
    const none = all.filter((p) => !['container', 'wagon', 'packages', 'marks', 'dangerous'].includes(p));
    expect(checkRailNote(note({ printed: none })).findings.map((f) => f.key)).toEqual(['container']);
    expect(checkRailNote(note({ printed: none, load: 'wagon' })).findings.map((f) => f.key)).toEqual(['wagon']);
    expect(checkRailNote(note({ printed: none, load: 'packages', dangerous: true })).findings.map((f) => f.key)).toEqual(['dangerous', 'packages', 'marks']);
  });

  it('a Kenya Railways note is read against its Tariff Book, with KSh 20,000 where no value is declared', () => {
    const c = checkRailNote(note({ from: 'KE', to: 'KE', railway: 'krc', printed: all.filter((p) => p !== 'consignorSigned') }));
    expect(c.regime).toBe('national');
    expect(c.findings).toEqual([{ key: 'consignorSigned', rule: 'Conditions cl. 7', kind: 'missing' }]);
    expect(c.limits.join(' ')).toMatch(/KSh 20,000/);
    expect(c.claims.join(' ')).toMatch(/within 7 days/);
  });

  it('a Kenya–Uganda note is under the railway’s conditions, and says the Northern Corridor accepts it', () => {
    const c = checkRailNote(note({ from: 'KE', to: 'UG', railway: 'krc' }));
    expect(c.regime).toBe('contract');
    expect(c.complete).toBe(true);
    expect(c.caveats.join(' ')).toMatch(/Northern Corridor states accept the Standard Rail Waybill/);
  });

  it('a railway whose conditions we have not read is not checked, and says so — never “complete”', () => {
    const c = checkRailNote(note({ from: 'ZA', to: 'ZA', railway: 'transnet' }));
    expect(c.complete).toBe(false);
    expect(c.notChecked).toMatch(/Transnet Freight Rail’s note must carry was not checked/);
    expect(checkRailNote(note({ from: 'UG', to: 'UG' })).notChecked).toMatch(/Name the railway/);
  });

  it('a CIM-if-agreed lane is CIM when the note carries the statement, and the railway’s conditions when not', () => {
    expect(checkRailNote(note({ from: 'MA', to: 'MR' })).rules[0]).toMatch(/CIM/);
    expect(checkRailNote(note({ from: 'MA', to: 'MR', printed: all.filter((p) => p !== 'statement') })).notChecked).toMatch(/Name the railway/);
  });

  it('between a CIM state and an SMGS one, both lists apply — the SMGS asks for the border stations', () => {
    const c = checkRailNote(note({ from: 'DE', to: 'CN', printed: all.filter((p) => p !== 'borderStations') }));
    expect(c.findings).toEqual([{ key: 'borderStations', rule: 'SMGS Art. 15 §1 (6)', kind: 'missing' }]);
  });
});

describe('an electronic rail note', () => {
  // A CT-e key built from its parts, its check digit worked out here by weights 2–9 counted from the right.
  const body = '35' + '2610' + '12345678000195' + '57' + '001' + '000004321' + '1' + '87654321';
  const dv = (() => {
    const s = body.split('').reduce((sum, d, i) => sum + Number(d) * (2 + ((42 - i) % 8)), 0) % 11;
    return s < 2 ? 0 : 11 - s;
  })();
  const key = body + dv;

  it('Brazil’s CT-e key: 44 digits, model 57, its check digit', () => {
    expect(body).toHaveLength(43);
    expect(cteKeyProblem(key)).toBeUndefined();
    expect(cteKeyProblem(key.slice(0, 43))).toBe('length');
    expect(cteKeyProblem(body.slice(0, 20) + '55' + body.slice(22) + dv)).toBe('model');
    expect(cteKeyProblem(body + ((dv + 1) % 10))).toBe('check_digit');
  });

  it('a Brazilian note is electronic by law; a mistyped key is caught', () => {
    expect(checkRailNote(note({ from: 'BR', to: 'BR', railway: 'brazil' })).electronic.map((e) => e.code)).toEqual(['electronic_required']);
    expect(checkRailNote(note({ from: 'BR', to: 'BR', railway: 'brazil', electronic: { reference: key } })).electronic).toEqual([]);
    expect(checkRailNote(note({ from: 'BR', to: 'BR', railway: 'brazil', electronic: { reference: body + ((dv + 1) % 10) } })).electronic.map((e) => e.code)).toEqual(['cte_check_digit']);
  });

  it('Russia’s waybill is electronic from 1 September 2026: a paper one made out before that is fine', () => {
    expect(checkRailNote(note({ from: 'RU', to: 'RU', railway: 'rzd' })).electronic.map((e) => e.code)).toEqual(['electronic_required']);
    expect(checkRailNote(note({ from: 'RU', to: 'RU', railway: 'rzd', madeOutOn: '2026-08-31' })).electronic).toEqual([]);
  });

  it('a printout of an electronic CIM note must carry its printout line', () => {
    const c = checkRailNote(note({ electronic: { reference: 'E-CIM 1', printoutLine: false } }));
    expect(c.electronic.map((e) => e.code)).toEqual(['printout_line']);
    expect(c.complete).toBe(false);
  });
});
