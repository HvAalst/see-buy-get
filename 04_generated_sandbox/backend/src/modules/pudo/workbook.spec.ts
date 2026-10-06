import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { crc32 } from '../../foundation/archive/zip';
import { readOrderRows } from './order-sheet';
import { MAX_WORKBOOK_BYTES, dayOfSerial, readWorkbook, type WorkbookReading } from './workbook';

/**
 * AN EXCEL WORKBOOK, READ. Two kinds of proof, because one alone would be circular:
 *
 *  - `fixtures/orders-from-excel.xlsx` was saved BY EXCEL (scratch script make-xlsx.ps1 drives the real program). It
 *    is what a workbook actually looks like — typed dates in three formats, numbers as numbers, a formula, a line left
 *    empty, a second sheet, a bold heading — and nothing here wrote it.
 *  - the workbooks built below are the ones Excel would not make for us on demand: the 1904 calendar, a hidden first
 *    sheet, cells with no address, and the files that must be refused.
 */

/* A ZIP writer for the tests only: deflated parts, like the real thing, and able to lie about its sizes. */
function zipOf(parts: Array<{ name: string; text: string; store?: boolean; flags?: number; claimSize?: number }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const p of parts) {
    const raw = Buffer.from(p.text, 'utf8');
    const data = p.store ? raw : deflateRawSync(raw);
    const name = Buffer.from(p.name, 'utf8');
    const head = (sig: number, extra: number) => {
      const b = Buffer.alloc(extra);
      b.writeUInt32LE(sig, 0);
      return b;
    };
    const local = head(0x04034b50, 30);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(p.flags ?? 0, 6);
    local.writeUInt16LE(p.store ? 0 : 8, 8);
    local.writeUInt32LE(crc32(raw), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    const central = head(0x02014b50, 46);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(p.flags ?? 0, 8);
    central.writeUInt16LE(p.store ? 0 : 8, 10);
    central.writeUInt32LE(crc32(raw), 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(p.claimSize ?? raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(local, name, data);
    centrals.push(central, name);
    offset += 30 + name.length + data.length;
  }
  const dir = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(parts.length, 8);
  end.writeUInt16LE(parts.length, 10);
  end.writeUInt32LE(dir.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, dir, end]);
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
/** A workbook by hand: sheets (name, the inside of sheetData), and whatever else the case needs. */
function xlsx(o: { sheets: Array<{ name: string; data: string; state?: string }>; shared?: string[]; styles?: string; date1904?: boolean; extra?: Parameters<typeof zipOf>[0] }): Buffer {
  return zipOf([
    { name: 'xl/workbook.xml', text: `<workbook ${NS}><workbookPr${o.date1904 ? ' date1904="1"' : ''}/><sheets>${o.sheets.map((s, i) => `<sheet name="${s.name}" sheetId="${i + 1}"${s.state ? ` state="${s.state}"` : ''} r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', text: `<Relationships>${o.sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://x/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId99" Type="http://x/sharedStrings" Target="sharedStrings.xml"/></Relationships>` },
    ...o.sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, text: `<worksheet ${NS}><sheetData>${s.data}</sheetData></worksheet>` })),
    ...(o.shared ? [{ name: 'xl/sharedStrings.xml', text: `<sst ${NS}>${o.shared.join('')}</sst>` }] : []),
    ...(o.styles ? [{ name: 'xl/styles.xml', text: `<styleSheet ${NS}>${o.styles}</styleSheet>` }] : []),
    ...(o.extra ?? []),
  ]);
}
const read = (b: Buffer): WorkbookReading => {
  const r = readWorkbook(b);
  if ('refusal' in r) throw new Error('refused: ' + r.refusal);
  return r;
};
const refusal = (b: Buffer): string => {
  const r = readWorkbook(b);
  return 'refusal' in r ? r.refusal : 'READ IT';
};

describe('reading an Excel workbook', () => {
  describe('one that Excel itself saved', () => {
    const file = readFileSync(join(__dirname, 'fixtures', 'orders-from-excel.xlsx'));
    const wb = read(file);

    it('reads the first sheet, and names it and the one it did not read', () => {
      expect(wb.sheet).toBe('Orders');
      expect(wb.otherSheets).toEqual(['Prices']);
      expect(wb.rows[0]).toEqual(['Order number', 'Goods', 'Weight (kg)', 'Deliver to', 'Lat', 'Lng', 'Delivery date', 'Window', 'Contact', 'Phone', 'Packaging', 'Internal code']);
    });

    it('gives every cell in the words a person sees: a date as a day, a number as it was typed, a formula as its answer', () => {
      // Line 2: a typed date (shown dd/mm/yyyy), numbers as numbers — and 36.962 not Excel's 36.962000000000003.
      expect(wb.rows[1]).toEqual(['WS-2001', 'Bricks, 4 pallets', '4000', 'Plot 12, Kitengela', '-1.478', '36.962', '2031-03-09', '8-12', 'J. Mwangi', '+254700000000', 'palletised', 'A & B <1>']);
      // Line 3: the order number is a NUMBER in the file, the weight a formula (60 × 50.5), the date shown yyyy-mm-dd.
      expect(wb.rows[2].slice(0, 7)).toEqual(['10432', 'Cement, 60 bags', '3030', 'Mlolongo site', '', '', '2031-03-10']);
      // Line 5: typed as text, so left exactly as typed — it is the sheet reader's to judge.
      expect([wb.rows[3][2], wb.rows[3][6]]).toEqual(['1.2 t', '11/03/2031']);
      // Line 6: a date WITH a time of day ("12 March 2031 14:30") is the day.
      expect(wb.rows[4][6]).toBe('2031-03-12');
    });

    it('leaves the empty line out, and still counts it: every row keeps the number Excel shows beside it', () => {
      expect(wb.rows).toHaveLength(6);
      expect(wb.lines).toEqual([1, 2, 3, 5, 6, 7]);
    });

    it('goes through the same judging as a pasted sheet, line for line — problems against the numbers on the screen', () => {
      const reading = readOrderRows(wb.rows, '2031-01-01', wb.lines);
      expect(reading.refusal).toBeUndefined();
      expect(reading.ignored).toEqual(['Internal code']);
      expect(reading.orders.map((o) => [o.line, o.reference, o.weightKg, o.deliverOn, o.problems])).toEqual([
        [2, 'WS-2001', 4000, '2031-03-09', []],
        [3, '10432', 3030, '2031-03-10', []],
        [5, 'WS-2003', 1200, '2031-03-11', []],
        [6, 'WS-2004', 2200, '2031-03-12', []],
        [7, '', 0, '2031-03-12', ['No order number', '"heavy" is not a weight']],
      ]);
      expect(reading.orders[0]).toMatchObject({ destLocation: { lat: -1.478, lng: 36.962 }, window: '8-12', contactPhone: '+254700000000', packaging: 'palletised' });
      expect(reading.orders[1].packaging).toBe('bagged');
    });
  });

  describe('the workbooks Excel would not make on demand', () => {
    const c = (ref: string, inner: string, attrs = '') => `<c r="${ref}"${attrs}>${inner}</c>`;

    it('reads strings wherever they are kept: shared, in the cell, and a formula’s — with rich text joined and phonetic guides dropped', () => {
      const wb = read(
        xlsx({
          shared: ['<si><t>plain</t></si>', '<si><r><rPr><b/></rPr><t>Bri</t></r><r><t xml:space="preserve">cks </t></r><rPh sb="0" eb="1"><t>ブリ</t></rPh></si>', '<si><t>line_x000A_two &amp; &#233; &#x41;</t></si>', '<si/>'],
          sheets: [{ name: 'S', data: `<row r="1">${c('A1', '<v>0</v>', ' t="s"')}${c('B1', '<v>1</v>', ' t="s"')}${c('C1', '<v>2</v>', ' t="s"')}${c('D1', '<v>3</v>', ' t="s"')}${c('E1', '<is><t>in the cell</t></is>', ' t="inlineStr"')}${c('F1', '<f>A1&amp;"!"</f><v>plain!</v>', ' t="str"')}${c('G1', '<v>1</v>', ' t="b"')}${c('H1', '<v>#N/A</v>', ' t="e"')}</row>` }],
        }),
      );
      expect(wb.rows).toEqual([['plain', 'Bricks', 'line\ntwo & é A', '', 'in the cell', 'plain!', 'TRUE', '#N/A']]);
    });

    it('puts a cell in its own column, whatever was skipped before it — and reads on when cells carry no address', () => {
      const wb = read(xlsx({ sheets: [{ name: 'S', data: `<row r="1">${c('B1', '<v>1</v>')}${c('E1', '<v>2</v>')}${c('AA1', '<v>3</v>')}</row><row><c><v>7</v></c><c><v>8</v></c></row><row r="9"/><row r="10">${c('A10', '')}</row>` }] }));
      expect(wb.rows[0]).toEqual(['', '1', '', '', '2', ...Array(21).fill(''), '3']);
      expect(wb.rows[1]).toEqual(['7', '8']);
      // Rows with nothing in them are not rows; the second had no number of its own and took the next.
      expect(wb.lines).toEqual([1, 2]);
    });

    it('knows a date by the cell’s format, not by the look of the number', () => {
      const styles = `<numFmts><numFmt numFmtId="170" formatCode="[$-409]d\\ mmm\\ yy;@"/><numFmt numFmtId="171" formatCode="0.0 &quot;days&quot;"/><numFmt numFmtId="172" formatCode="hh:mm"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="14"/><xf numFmtId="170"/><xf numFmtId="171"/><xf numFmtId="172"/><xf numFmtId="2"/></cellXfs>`;
      const wb = read(xlsx({ styles, sheets: [{ name: 'S', data: `<row r="1">${c('A1', '<v>47916</v>')}${c('B1', '<v>47916</v>', ' s="1"')}${c('C1', '<v>47916</v>', ' s="2"')}${c('D1', '<v>47916</v>', ' s="3"')}${c('E1', '<v>0.604166666666667</v>', ' s="4"')}${c('F1', '<v>47916.5</v>', ' s="5"')}</row>` }] }));
      // General · built-in date · a custom date · a number with the WORD "days" in its format · a time · a plain decimal.
      expect(wb.rows[0]).toEqual(['47916', '2031-03-09', '2031-03-09', '47916', '14:30', '47916.5']);
    });

    it('counts days the way the workbook does: from 1900 with Excel’s famous extra day, or from 1904', () => {
      expect([dayOfSerial(1), dayOfSerial(59), dayOfSerial(61), dayOfSerial(45000), dayOfSerial(47916.999)]).toEqual(['1900-01-01', '1900-02-28', '1900-03-01', '2023-03-15', '2031-03-09']);
      expect(dayOfSerial(46454, true)).toBe('2031-03-09');
      expect([dayOfSerial(-1), dayOfSerial(Number.NaN), dayOfSerial(9_999_999)]).toEqual([undefined, undefined, undefined]);
      const styles = '<cellXfs><xf numFmtId="14"/></cellXfs>';
      const wb = read(xlsx({ styles, date1904: true, sheets: [{ name: 'S', data: `<row r="1">${c('A1', '<v>46454</v>', ' s="0"')}</row>` }] }));
      expect(wb.rows[0]).toEqual(['2031-03-09']);
    });

    it('gives a number as it was typed', () => {
      const wb = read(xlsx({ sheets: [{ name: 'S', data: `<row r="1">${['36.962000000000003', '0.1', '1.2E-3', '100000', '-1.4780000000000001', '3030'].map((v, i) => c(`${'ABCDEF'[i]}1`, `<v>${v}</v>`)).join('')}</row>` }] }));
      expect(wb.rows[0]).toEqual(['36.962', '0.1', '0.0012', '100000', '-1.478', '3030']);
    });

    it('reads the first sheet a person can SEE, and says what it left', () => {
      const wb = read(xlsx({ sheets: [{ name: 'Lookup', state: 'hidden', data: `<row r="1">${c('A1', '<v>1</v>')}</row>` }, { name: 'Orders &amp; more', data: `<row r="1">${c('A1', '<v>2</v>')}</row>` }, { name: 'Notes', data: '' }] }));
      expect(wb).toMatchObject({ sheet: 'Orders & more', otherSheets: ['Notes'], rows: [['2']] });
      expect(refusal(xlsx({ sheets: [{ name: 'Only', state: 'veryHidden', data: '' }] }))).toMatch(/no sheet to read/);
    });

    it('hands an empty sheet on as no rows — the sheet reader says "empty" in its own words', () => {
      const wb = read(xlsx({ sheets: [{ name: 'S', data: '' }] }));
      expect(wb.rows).toEqual([]);
      expect(readOrderRows(wb.rows, '2031-01-01', wb.lines).refusal).toBe('The sheet is empty');
    });
  });

  describe('what it will not read, and says so in words that say what to do', () => {
    const sheet = { name: 'S', data: '<row r="1"><c r="A1"><v>1</v></c></row>' };

    it('refuses an old .xls and a password-protected workbook — they begin with the same bytes', () => {
      expect(refusal(Buffer.concat([Buffer.from('d0cf11e0a1b11ae1', 'hex'), Buffer.alloc(600)]))).toMatch(/older Excel file \(\.xls\), or a workbook protected with a password/);
    });

    it('refuses what is not a workbook at all: nothing, noise, a picture, another kind of zip, an OpenDocument sheet', () => {
      expect(refusal(Buffer.alloc(0))).toBe('The file is empty');
      expect(refusal(Buffer.from('Order number,Goods\nWS-1,Bricks'))).toMatch(/not an Excel workbook/);
      expect(refusal(Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(100)]))).toMatch(/not an Excel workbook/);
      expect(refusal(zipOf([{ name: 'word/document.xml', text: '<w/>' }]))).toMatch(/not an Excel workbook/);
      expect(refusal(zipOf([{ name: 'mimetype', text: 'application/vnd.oasis.opendocument.spreadsheet', store: true }, { name: 'content.xml', text: '<x/>' }]))).toMatch(/OpenDocument sheet \(\.ods\)/);
    });

    it('refuses a file that is too large before unpacking any of it', () => {
      expect(refusal(Buffer.concat([xlsx({ sheets: [sheet] }), Buffer.alloc(MAX_WORKBOOK_BYTES)]))).toMatch(/larger than 1 MB/);
    });

    it('is not made to unpack more than a sheet of orders holds — by a part that says it is huge, or one that only is', () => {
      const big = '<row r="1"><c r="A1" t="inlineStr"><is><t>' + 'x'.repeat(25_000_000) + '</t></is></c></row>';
      // 25 MB of one letter packs to a few kilobytes: a small file, and a very large sheet.
      const bomb = xlsx({ sheets: [{ name: 'S', data: big }] });
      expect(bomb.length).toBeLessThan(MAX_WORKBOOK_BYTES);
      expect(refusal(bomb)).toMatch(/unpacks to far more than a sheet of orders holds/);
      // The same sheet, lying about its size in the directory: the inflate itself is bounded, not only the claim.
      const lying = zipOf([
        { name: 'xl/workbook.xml', text: `<workbook ${NS}><sheets><sheet name="S" sheetId="1" r:id="rId1"/></sheets></workbook>` },
        { name: 'xl/_rels/workbook.xml.rels', text: '<Relationships><Relationship Id="rId1" Type="http://x/worksheet" Target="worksheets/sheet1.xml"/></Relationships>' },
        { name: 'xl/worksheets/sheet1.xml', text: `<worksheet><sheetData>${big}</sheetData></worksheet>`, claimSize: 100 },
      ]);
      expect(refusal(lying)).toMatch(/unpacks to far more than a sheet of orders holds/);
    });

    it('refuses a sheet with more lines than any sheet of orders has', () => {
      const data = Array.from({ length: 5001 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}"><v>${i}</v></c></row>`).join('');
      expect(refusal(xlsx({ sheets: [{ name: 'S', data }] }))).toMatch(/more than 5000 lines/);
    });

    it('refuses a workbook whose parts are encrypted, or cut short, without falling over', () => {
      const locked = zipOf([{ name: 'xl/workbook.xml', text: '<workbook/>', flags: 1 }]);
      expect(refusal(locked)).toMatch(/protected with a password/);
      const whole = xlsx({ sheets: [sheet] });
      // The directory survives, the parts it points at are gone.
      const cut = Buffer.concat([Buffer.alloc(4, 0).fill(Buffer.from('504b0304', 'hex')), Buffer.alloc(40), whole.subarray(whole.length - 400)]);
      expect(refusal(cut)).toMatch(/damaged|not an Excel workbook/);
      for (const n of [10, 60, 200]) expect(typeof refusal(whole.subarray(0, whole.length - n))).toBe('string');
    });
  });
});
