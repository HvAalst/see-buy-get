import { cellsWithRows, headingKey, numberOf, packingHtml, readPacking, recognise, summarisePacking } from './export-packing';

/** A sheet as the app reads a CSV file or pasted cells: its rows, numbered as the spreadsheet numbers them. */
const cellsOf = (text: string) => cellsWithRows(text).cells;
const sheetOf = (text: string) => { const r = cellsWithRows(text); return { cells: r.cells, rowNumbers: r.rowNumbers }; };
import type { PackingLine } from './export-packing.types';

/*
 * THE PACKING LIST, IMPORTED (the user, 2026-10-28: "a shipper doesn't want to import by hand especially if the packing
 * list is long and detailed, that should be dynamic and adaptable"). A list as a shipper's system exports it: its own
 * heading block on top, its own words for the columns, units in the headings, a total row, and columns we have no
 * field for — all read, none dropped, none typed again.
 */
const sheet = [
  'Thika Avocados Ltd\t\t\t\t\t\t\t\t\t\t',
  'PACKING LIST\tInvoice TA-2026-117\t\t\t\t\t\t\t\t\t',
  '\t\t\t\t\t\t\t\t\t\t',
  'Carton No.\tItem Code\tDescription\tHS Code\tQty\tUnit\tCtns\tN.W. (kg)\tG.W. (lbs)\tCBM\tBatch',
].join('\n');

describe('a packing list read from the shipper’s own file', () => {
  it('reads a heading as its words say — in brackets, with units, however it is punctuated', () => {
    expect(headingKey('Gross Wt. (kg)')).toBe('gross wt');
    expect(recognise('G.W. (lbs)')).toBe('grossKg');
    expect(recognise('Net weight kg')).toBe('netKg');
    expect(recognise('Marks & Nos')).toBe('marks');
    expect(recognise('CTNS')).toBe('packages');
    expect(recognise('m³')).toBe('volumeM3');
    expect(recognise('Batch')).toBeUndefined();
  });

  it('reads numbers as people type them', () => {
    expect(numberOf('1 234,5')).toBe(1234.5);
    expect(numberOf('1,234.5')).toBe(1234.5);
    expect(numberOf('1.234,5')).toBe(1234.5);
    expect(numberOf('2,400')).toBe(2400);
    expect(numberOf('7,5')).toBe(7.5);
    expect(numberOf('12 kg')).toBe(12);
    expect(numberOf('about ten')).toBeUndefined();
  });

  it('passes the heading block and the total row by, converts units, keeps what it has no field for', () => {
    const text = `${sheet}\n` + ['1-400\tHASS-4\tFresh avocados, Hass\t0804.40\t1600\tkg\t400\t1600\t3880\t14.5\tB-0911', '401-800\tHASS-4\tFresh avocados, Hass\t0804.40\t1600\tkg\t400\t1600\t3880\t14.5\tB-0912', 'TOTAL\t\t\t\t3200\t\t800\t3200\t7760\t29'].join('\n');
    const { cells, rowNumbers } = sheetOf(text);
    const r = readPacking(cells, { rowNumbers });
    expect(r.check.refusal).toBeUndefined();
    expect(r.check.headingRow).toBe(4);
    expect(r.check.problems).toEqual([]);
    expect(r.check.columns.map((c) => c.use)).toEqual(['marks', 'itemCode', 'description', 'hsCode', 'quantity', 'unit', 'packages', 'netKg', 'grossKg', 'volumeM3', 'keep']);
    expect(r.check.columns.find((c) => c.use === 'grossKg')).toMatchObject({ convertedFrom: 'lb', because: 'heading' });
    expect(r.lines).toHaveLength(2);
    expect(r.lines[0]).toMatchObject({ marks: '1-400', itemCode: 'HASS-4', hsCode: '080440', packages: 400, netKg: 1600, grossKg: 1759.938, volumeM3: 14.5, extra: { Batch: 'B-0911' } });
    expect(r.check.totals).toMatchObject({ lines: 2, packages: 800, netKg: 3200 });
    expect(r.extraColumns).toEqual(['Batch']);
    expect(r.check.notes.some((n) => /headings were found on row 4/.test(n))).toBe(true);
    expect(r.check.notes.some((n) => /reads as a total and was passed by/.test(n))).toBe(true);
  });

  it('says what is wrong, line by line — never drops a line in silence', () => {
    const text = `${sheet}\n` + ['1-10\t\t\t0804.40\t10\tkg\tten\t10\t22\t1\t', '11-20\tX\tAvocados\t08\t10\tkg\t10\t10\t22\t1\t'].join('\n');
    const r = readPacking(cellsOf(text));
    expect(r.check.problems.map((p) => p.says)).toEqual(expect.arrayContaining(['“ten” under “Ctns” is not a number', '“08” is not an HS code of 6 to 10 digits']));
    // A line with no description but an item code is described by its code; with neither, it is a problem.
    expect(readPacking(cellsOf('Description\tCtns\n\t4')).check.problems).toEqual([{ row: 2, says: 'No description of the goods' }]);
  });

  it('reads a heading as the business matched it — remembered, or chosen now — and kept where nothing matched', () => {
    const text = 'Artikel\tOmschrijving\tDozen\tBruto kg\nA-1\tCoffee beans\t20\t1200';
    const unread = readPacking(cellsOf(text));
    expect(unread.check.refusal).toMatch(/No column reads as the goods’ description/);
    const chosen = readPacking(cellsOf(text), { chosen: { Omschrijving: 'description', Dozen: 'packages', 'Bruto kg': 'grossKg', Artikel: 'itemCode' } });
    expect(chosen.lines).toEqual([{ itemCode: 'A-1', description: 'Coffee beans', packages: 20, grossKg: 1200 }]);
    expect(chosen.mapping).toEqual({ artikel: 'itemCode', omschrijving: 'description', dozen: 'packages', 'bruto kg': 'grossKg' });
    const remembered = readPacking(cellsOf(text), { remembered: chosen.mapping });
    expect(remembered.check.columns.every((c) => c.because === 'remembered')).toBe(true);
    expect(remembered.lines).toEqual(chosen.lines);
  });

  it('finds the separator past a company name on a line of its own — tabs pasted, or a CSV file’s commas or semicolons', () => {
    const pasted = cellsWithRows(['Thika Avocados Ltd', 'Description\tCtns', 'Avocados\t20'].join('\n'));
    expect(pasted.cells).toEqual([['Thika Avocados Ltd'], ['Description', 'Ctns'], ['Avocados', '20']]);
    expect(cellsWithRows(['Thika Avocados Ltd', 'Description;Ctns;Gross', 'Avocados;20;90'].join('\n')).cells[2]).toEqual(['Avocados', '20', '90']);
    expect(readPacking(pasted.cells, { rowNumbers: pasted.rowNumbers }).check).toMatchObject({ headingRow: 2, totals: { packages: 20 } });
  });

  it('counts each line as one package where no column says how many, and says so', () => {
    const r = readPacking(cellsOf('Description\tGross weight\nPallet of tea\t900\nPallet of tea\t880'));
    expect(r.check.totals).toMatchObject({ packages: 2, grossKg: 1780 });
    expect(r.check.notes.some((n) => /each line is counted as one package/.test(n))).toBe(true);
  });
});

describe('the letter’s goods, worked out from the list', () => {
  const line = (over: Partial<PackingLine>): PackingLine => ({ description: 'Black tea', packages: 10, packageKind: 'bags', grossKg: 600, ...over });

  it('one line for each description, HS code and kind of package — packages, weights and marks from first to last', () => {
    const goods = summarisePacking([line({ marks: '1-10', hsCode: '090240' }), line({ marks: '11-20', hsCode: '090240', netKg: 580 }), line({ description: 'Green tea', hsCode: '090210', packages: 5, grossKg: 300 })]);
    expect(goods).toEqual([
      { marks: '1-10 – 11-20', packages: 20, packageKind: 'bags', description: 'Black tea', hsCode: '090240', grossKg: 1200, netKg: 580 },
      { packages: 5, packageKind: 'bags', description: 'Green tea', hsCode: '090210', grossKg: 300 },
    ]);
  });

  it('never more lines than a letter holds: past that, one for each HS code', () => {
    const many = Array.from({ length: 40 }, (_, i) => line({ description: `Item ${i + 1}`, hsCode: i < 20 ? '090240' : '090210' }));
    const goods = summarisePacking(many);
    expect(goods).toHaveLength(2);
    expect(goods[0]).toMatchObject({ description: 'Item 1 and 19 other items', packages: 200, hsCode: '090240' });
  });

  it('prints the columns the list uses and the ones it kept, with its totals', () => {
    const html = packingHtml(
      { code: 'EXP-007', shipper: { name: 'Thika Avocados', country: 'KE' }, booking: 'MBA4471', forwarder: 'Pwani Forwarders', loadingPort: 'Mombasa', destCountry: 'NL', container: { number: 'MSCU1234566', seals: [] } },
      [line({ marks: '1-10', extra: { Batch: 'B-0911' } })],
      ['Batch'],
      { version: 1, signedBy: 'Wanjiku', signedAt: '2026-10-28T10:00:00.000Z' },
    );
    for (const fact of ['Packing list — EXP-007 — version 1', 'Marks and numbers', 'Batch', 'B-0911', 'Total — 1 line', 'MSCU1234566']) expect(html).toContain(fact);
    expect(html).not.toContain('<th>HS code</th>');
  });
});
