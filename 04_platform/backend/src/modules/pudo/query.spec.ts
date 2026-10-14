import { pageBounds, paginate, textMatch, toCsv, withinDates, PAGE_DEFAULT_LIMIT, PAGE_MAX_LIMIT } from './query';

describe('query helpers (R0)', () => {
  describe('textMatch', () => {
    it('is a case-insensitive substring over the given fields, skipping undefined', () => {
      expect(textMatch(['Ankara shirt', undefined, 42], 'ankara')).toBe(true);
      expect(textMatch(['Ankara shirt'], 'SHIRT')).toBe(true);
      expect(textMatch([undefined, null, 100], '10')).toBe(true); // matches the number 100
      expect(textMatch(['Ankara shirt'], 'kitenge')).toBe(false);
    });
    it('an empty / whitespace query matches everything', () => {
      expect(textMatch(['x'], '')).toBe(true);
      expect(textMatch(['x'], '   ')).toBe(true);
      expect(textMatch([], undefined)).toBe(true);
    });
  });

  describe('withinDates', () => {
    const d = '2026-08-04T12:00:00Z';
    it('passes when no bounds are given', () => expect(withinDates(d)).toBe(true));
    it('respects from/to (to is inclusive to end-of-day for a bare date)', () => {
      expect(withinDates(d, '2026-08-04', '2026-08-04')).toBe(true); // same bare day
      expect(withinDates(d, '2026-08-05')).toBe(false); // before from
      expect(withinDates(d, undefined, '2026-08-03')).toBe(false); // after to
    });
    it('excludes a missing/unparseable timestamp when a bound is set', () => {
      expect(withinDates(undefined, '2026-08-01')).toBe(false);
      expect(withinDates('nonsense', '2026-08-01')).toBe(false);
    });
  });

  describe('pageBounds', () => {
    it('defaults + caps + floors', () => {
      expect(pageBounds()).toEqual({ limit: PAGE_DEFAULT_LIMIT, offset: 0 });
      expect(pageBounds('50', '10')).toEqual({ limit: 50, offset: 10 });
      expect(pageBounds(9999)).toEqual({ limit: PAGE_MAX_LIMIT, offset: 0 }); // capped
      expect(pageBounds(-5, -5)).toEqual({ limit: PAGE_DEFAULT_LIMIT, offset: 0 }); // negatives ignored
      expect(pageBounds('nope')).toEqual({ limit: PAGE_DEFAULT_LIMIT, offset: 0 });
    });
  });

  describe('paginate', () => {
    const rows = Array.from({ length: 45 }, (_, i) => i);
    it('slices to a page and reports the full total', () => {
      const p = paginate(rows, 10, 0);
      expect(p.total).toBe(45);
      expect(p.items).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
      expect(paginate(rows, 10, 40).items).toEqual([40, 41, 42, 43, 44]); // last partial page
      expect(paginate(rows, 10, 100).items).toEqual([]); // past the end
    });
  });

  describe('toCsv', () => {
    it('renders headers + rows, quoting only when needed (CRLF ends)', () => {
      const csv = toCsv(['A', 'B'], [['plain', 'has,comma'], ['has"quote', 'has\nnewline']]);
      expect(csv).toBe('A,B\r\nplain,"has,comma"\r\n"has""quote","has\nnewline"');
    });
    it('renders empty cells for null/undefined', () => {
      expect(toCsv(['A'], [[null], [undefined], [0]])).toBe('A\r\n\r\n\r\n0');
    });

    it('neutralises formula-injection in STRING cells but leaves numeric negatives alone', () => {
      // A malicious product name / a buyer phone gets a leading apostrophe; a negative NUMBER does not.
      expect(toCsv(['X'], [['=WEBSERVICE("http://evil")']])).toBe(`X\r\n"'=WEBSERVICE(""http://evil"")"`);
      expect(toCsv(['X'], [['+254700111222']])).toBe("X\r\n'+254700111222");
      expect(toCsv(['X'], [['@cmd'], ['-hack']])).toBe("X\r\n'@cmd\r\n'-hack");
      expect(toCsv(['X'], [[-12.34]])).toBe('X\r\n-12.34'); // a real negative number is untouched
      expect(toCsv(['X'], [['Ankara shirt']])).toBe('X\r\nAnkara shirt'); // ordinary text untouched
    });
  });
});
