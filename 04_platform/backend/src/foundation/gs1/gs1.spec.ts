import { graiFromScan, graiHumanReadable, graiOf, isGrai } from './gs1';
import { CODE128_PATTERNS, cleanGln, cleanPrefix, glnProblem, gs1CheckDigit, gsinCapacity, gsinFromScan, gsinHumanReadable, gsinOf, isGsin, gs1_128SvgGroup, gs1_128Values, gs1_128Width, gs1_128Widths, isSscc, serialCapacity, ssccFromScan, ssccHumanReadable, ssccOf, ssccSpaced } from './gs1';

describe('GS1 — the global code on a package', () => {
  describe('the GRAI (2026-11-09)', () => {
    it('is a 0, the prefix and the asset type, their check digit, then the serial', () => {
      const g = graiOf('8712345', 99_999, 'BAG-007');
      expect(g.slice(0, 13)).toBe('0871234599999');
      expect(g[13]).toBe(String(gs1CheckDigit('0871234599999')));
      expect(g.slice(14)).toBe('BAG-007');
      expect(isGrai(g)).toBe(true);
      expect(isGrai(`${g.slice(0, 13)}${(Number(g[13]) + 1) % 10}BAG-007`)).toBe(false);
      expect(graiOf('871234567890', 0, 'BAG-1')).toBe(`0871234567890${gs1CheckDigit('0871234567890')}BAG-1`);
      expect(() => graiOf('8712345', 100_000, 'BAG-1')).toThrow(/asset type out of range/);
      expect(() => graiOf('8712345', 1, 'bag-1')).toThrow(/GRAI serial/);
      expect(() => graiOf('8712345', 1, 'BAG-12345678901234')).toThrow(/GRAI serial/);
      expect(graiHumanReadable(g)).toBe(`(8003) ${g}`);
    });

    it('is read in any form a scanner hands over — and an SSCC or a GLN is not one', () => {
      const g = graiOf('8712345', 99_999, 'BAG-007');
      for (const scan of [g, `(8003)${g}`, `(8003) ${g}`, `8003${g}`, `]C18003${g}`]) expect([scan, graiFromScan(scan)]).toEqual([scan, g]);
      expect(graiFromScan(ssccOf('8712345', 3, 99))).toBeUndefined();
      expect(graiFromScan('8712345000011')).toBeUndefined();
      expect(graiFromScan('BAG-007')).toBeUndefined();
      expect(graiFromScan(undefined)).toBeUndefined();
    });

    it('goes into a GS1-128 barcode: its digits in subset C, its serial in subset B, one check symbol over all', () => {
      // Start C, FNC1, "80", Code B, "A", "1", the check (105 + 102·1 + 80·2 + 100·3 + 33·4 + 17·5 = 884; 884 mod 103 = 60), stop.
      expect(gs1_128Values('80', 'A1')).toEqual([105, 102, 80, 100, 33, 17, 60, 106]);
      expect(gs1_128Values('8003')).toEqual(gs1_128Values('8003', ''));
      expect(gs1_128Width('80', 1, 'A1')).toBe(gs1_128Width('80', 1) + 3 * 11);
      expect(() => gs1_128Values('80', 'é')).toThrow(/printable/);
    });
  });

  describe('the GSIN (2026-11-09)', () => {
    it('is the prefix, the extension digit and the serial, then the check digit: 17 digits — GS1’s own example', () => {
      expect(gsinOf('0614141', 1, 23456789)).toBe('06141411234567890'); // GS1 General Specifications' example GSIN
      const g = gsinOf('616123456789', 7, 42);
      expect(g).toHaveLength(17);
      expect(g.slice(0, 12)).toBe('616123456789');
      expect(g[12]).toBe('7');
      expect(g.slice(13, 16)).toBe('042');
      expect(isGsin(g)).toBe(true);
      expect(isGsin(`${g.slice(0, 16)}${(Number(g[16]) + 1) % 10}`)).toBe(false);
      expect(gsinCapacity('616123456789')).toBe(1000);
      expect(gsinCapacity('6161234')).toBe(100_000_000);
      expect(() => gsinOf('616123456789', 7, 1000)).toThrow(/serial out of range/);
      expect(() => gsinOf('6161', 7, 1)).toThrow(/not a GS1 company prefix/);
      expect(gsinHumanReadable(g)).toBe(`(402) ${g}`);
    });

    it('is read in any form a scanner or a person hands over — and an SSCC or a GLN is not one', () => {
      const g = gsinOf('6161234', 3, 99);
      for (const scan of [g, `(402)${g}`, `(402) ${g}`, `402${g}`, `]C1402${g}`, `${g.slice(0, 7)} ${g.slice(7)}`]) expect([scan, gsinFromScan(scan)]).toEqual([scan, g]);
      expect(gsinFromScan(ssccOf('6161234', 3, 99))).toBeUndefined();
      expect(gsinFromScan(`${g.slice(0, 16)}${(Number(g[16]) + 1) % 10}`)).toBeUndefined();
      expect(gsinFromScan('8712345678906')).toBeUndefined();
      expect(gsinFromScan(undefined)).toBeUndefined();
    });
  });

  describe('the GLN (2026-11-09)', () => {
    const gln = (body: string) => `${body}${gs1CheckDigit(body)}`;
    it('is 13 digits whose last is the check digit — spaces and dashes as typed dropped', () => {
      expect(gln('871234567890')).toHaveLength(13);
      expect(glnProblem(gln('871234567890'))).toBeUndefined();
      expect(cleanGln(` ${gln('871234567890').slice(0, 7)}-${gln('871234567890').slice(7)} `)).toBe(gln('871234567890'));
      expect(glnProblem(gln('061414100001'))).toBeUndefined(); // GS1 US — a leading 0 is a country, not padding
      expect(glnProblem('87123456789')).toBe('digits');
      expect(glnProblem('87123456789012')).toBe('digits');
      expect(glnProblem(undefined)).toBe('digits');
      const good = gln('616123456789');
      expect(glnProblem(`${good.slice(0, 12)}${(Number(good[12]) + 1) % 10}`)).toBe('check');
      expect(cleanGln(`${good.slice(0, 12)}${(Number(good[12]) + 1) % 10}`)).toBeUndefined();
    });

    it('refuses the ranges GS1 keeps for something other than locations', () => {
      for (const body of ['021234567890', '029999999999', '041234567890', '051234567890', '201234567890', '299999999999', '951234567890', '952234567890', '961234567890', '977123456789', '978123456789', '979123456789', '980123456789', '991234567890']) {
        expect([body, glnProblem(gln(body))]).toEqual([body, 'range']);
      }
      for (const body of ['011234567890', '031234567890', '061234567890', '191234567890', '300123456789', '871234567890', '950123456789', '953123456789', '959123456789', '970123456789', '976123456789']) {
        expect([body, glnProblem(gln(body))]).toEqual([body, undefined]);
      }
    });
  });

  describe('the check digit', () => {
    it('is the published one for GTINs and for the SSCCs in the GS1 specifications', () => {
      expect(gs1CheckDigit('400638133393')).toBe(1); // GTIN-13 4006381333931
      expect(gs1CheckDigit('03600029145')).toBe(2); // UPC-A 036000291452
      expect(ssccOf('0614141', 0, 123456789)).toBe('006141411234567890');
      expect(ssccOf('0614141', 1, 123456789)).toBe('106141411234567897');
    });

    it('catches a single wrong digit and two digits swapped', () => {
      const sscc = ssccOf('6161234', 3, 4711);
      expect(isSscc(sscc)).toBe(true);
      expect(isSscc(`${sscc.slice(0, 5)}${(Number(sscc[5]) + 1) % 10}${sscc.slice(6)}`)).toBe(false);
      const swapped = `${sscc.slice(0, 10)}${sscc[11]}${sscc[10]}${sscc.slice(12)}`;
      if (sscc[10] !== sscc[11]) expect(isSscc(swapped)).toBe(false);
      expect(isSscc('12345')).toBe(false);
      expect(isSscc(undefined)).toBe(false);
    });
  });

  describe('the SSCC', () => {
    it('is the extension digit, the prefix, the serial filling the room left, and the check digit: 18 digits', () => {
      const sscc = ssccOf('616123456789', 9, 42);
      expect(sscc).toHaveLength(18);
      expect(sscc.slice(0, 1)).toBe('9');
      expect(sscc.slice(1, 13)).toBe('616123456789');
      expect(sscc.slice(13, 17)).toBe('0042');
      expect(ssccSpaced(sscc, 12)).toBe(`9 616123456789 0042 ${sscc[17]}`);
      expect(ssccHumanReadable(sscc)).toBe(`(00) ${sscc}`);
    });

    it('refuses a serial the prefix has no room for, an extension digit that is not one, and a prefix that is not one', () => {
      expect(serialCapacity('616123456789')).toBe(10_000);
      expect(() => ssccOf('616123456789', 0, 10_000)).toThrow();
      expect(() => ssccOf('6161234', 10, 1)).toThrow();
      expect(() => ssccOf('61612', 0, 1)).toThrow();
    });

    it('takes a prefix as people type it, and nothing that is not 6 to 12 digits', () => {
      expect(cleanPrefix(' 616 1234-5 ')).toBe('61612345');
      expect(cleanPrefix('61612')).toBeUndefined();
      expect(cleanPrefix('6161234567890')).toBeUndefined();
      expect(cleanPrefix('616ABC1')).toBeUndefined();
      expect(cleanPrefix(null)).toBeUndefined();
    });

    it('is read back from whatever a scanner hands over', () => {
      const sscc = ssccOf('6161234', 0, 7);
      for (const raw of [sscc, `00${sscc}`, `(00)${sscc}`, `(00) ${sscc}`, `]C100${sscc}`]) expect(ssccFromScan(raw)).toBe(sscc);
      const wrong = `${sscc.slice(0, 17)}${(Number(sscc[17]) + 1) % 10}`;
      expect(ssccFromScan(`00${wrong}`)).toBeUndefined();
      expect(ssccFromScan('sbg:parcel:PCL-1')).toBeUndefined();
    });
  });

  describe('the GS1-128 barcode', () => {
    it('has 107 Code 128 symbols, each 11 modules wide and all different, and a 13-module stop', () => {
      expect(CODE128_PATTERNS).toHaveLength(107);
      const width = (p: string) => [...p].reduce((a, c) => a + Number(c), 0);
      CODE128_PATTERNS.slice(0, 106).forEach((p) => expect(width(p)).toBe(11));
      expect(width(CODE128_PATTERNS[106])).toBe(13);
      expect(new Set(CODE128_PATTERNS).size).toBe(107);
    });

    it('starts with Start C and FNC1 — which is what makes it GS1-128 — then the digits in pairs, the check symbol and the stop', () => {
      const values = gs1_128Values(`00${ssccOf('0614141', 1, 123456789)}`);
      expect(values.slice(0, 3)).toEqual([105, 102, 0]); // Start C, FNC1, "00"
      expect(values.slice(3, 12)).toEqual([10, 61, 41, 41, 12, 34, 56, 78, 97]);
      const check = values.slice(1, 12).reduce((sum, v, i) => sum + v * (i + 1), 105) % 103;
      expect(values[12]).toBe(check);
      expect(values[13]).toBe(106);
      expect(() => gs1_128Values('123')).toThrow();
    });

    it('draws a bar for every other width, inside quiet zones of ten modules', () => {
      const digits = `00${ssccOf('6161234', 0, 1)}`;
      const widths = gs1_128Widths(digits);
      const svg = gs1_128SvgGroup(digits, 0, 0, 0.5, 30);
      expect((svg.match(/<rect /g) ?? []).length).toBe(Math.ceil(widths.length / 2));
      expect(svg).toContain('<rect x="5" ');
      // Start, FNC1, ten pairs and the check: 13 symbols of 11 modules, a stop of 13, 20 modules of quiet zone. At half a
      // millimetre a module, 88 mm: it fits a 100 mm label.
      expect(gs1_128Width(digits, 0.5)).toBe(88);
    });
  });
});
