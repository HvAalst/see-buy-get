import { CODE128_PATTERNS, cleanPrefix, gs1CheckDigit, gs1_128SvgGroup, gs1_128Values, gs1_128Width, gs1_128Widths, isSscc, serialCapacity, ssccFromScan, ssccHumanReadable, ssccOf, ssccSpaced } from './gs1';

describe('GS1 — the global code on a package', () => {
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
