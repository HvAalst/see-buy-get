import { inflateRawSync } from 'node:zlib';

/**
 * AN EXCEL WORKBOOK, READ — the first sheet of an .xlsx file, as rows of cells in the words a person sees.
 *
 * The office's orders arrive "as a spreadsheet", and a spreadsheet on somebody's desk is a workbook, not a CSV. Until
 * now the app refused one by name and asked for it to be saved as something else. This reads it instead.
 *
 * An .xlsx file is a ZIP of XML: the sheet's cells, a table of the strings they share, and the styles that say which
 * numbers are dates. That is all this needs, so that is all it reads — with the platform's own inflate and nothing
 * else. It is pure (bytes in, rows out) and it does not guess:
 *
 *  - a number Excel shows as a DATE comes out as 2026-10-06, whatever format the cell wears; a time alone as 14:30;
 *  - a number comes out as the number typed (36.962, not 36.962000000000003), a formula as its last result;
 *  - only the FIRST visible sheet is read, and the caller is told its name and the names of the ones left unread;
 *  - what it cannot read is refused in words that say what to do: an old .xls, a password, a file that is too large.
 *
 * It is handed files typed by strangers, so every size is bounded before anything is unpacked.
 */

/** The largest workbook file read. A sheet of a few hundred orders is tens of kilobytes. */
export const MAX_WORKBOOK_BYTES = 1_000_000;
/** The most one part of the workbook may unpack to — a small file can be made to unpack to a very large one. */
const MAX_PART_BYTES = 24_000_000;
/** More rows or columns than this is not a sheet of orders; the sheet reader has its own, smaller, limit on orders. */
const MAX_ROWS = 5_000;
const MAX_COLUMNS = 200;

export interface WorkbookReading {
  /** The cells of the first visible sheet, a row a line, empty lines left out. */
  rows: string[][];
  /** The number Excel shows beside each of those rows — a line left empty is skipped, and still counted. */
  lines: number[];
  /** The sheet that was read, and the ones that were not. */
  sheet: string;
  otherSheets: string[];
}

export type WorkbookResult = WorkbookReading | { refusal: string };

const NOT_A_WORKBOOK = 'This is not an Excel workbook this can read. Save the sheet as .xlsx or as CSV and upload that';

/* -------------------------------------------------------------------- the zip -- */

interface ZipPart {
  method: number;
  compressedSize: number;
  size: number;
  offset: number;
  encrypted: boolean;
}

/** The parts of a ZIP by name, from its central directory. Undefined when the bytes are not a ZIP this understands. */
function partsOf(buf: Buffer): Map<string, ZipPart> | undefined {
  // The end-of-central-directory record is at the very end, before an optional comment of up to 64 KB.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return undefined;
  const count = buf.readUInt16LE(eocd + 10);
  let at = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || at === 0xffffffff) return undefined;
  const parts = new Map<string, ZipPart>();
  for (let i = 0; i < count; i++) {
    if (at + 46 > buf.length || buf.readUInt32LE(at) !== 0x02014b50) return undefined;
    const nameLen = buf.readUInt16LE(at + 28);
    const name = buf.toString('utf8', at + 46, at + 46 + nameLen);
    parts.set(name, { encrypted: (buf.readUInt16LE(at + 8) & 1) === 1, method: buf.readUInt16LE(at + 10), compressedSize: buf.readUInt32LE(at + 20), size: buf.readUInt32LE(at + 24), offset: buf.readUInt32LE(at + 42) });
    at += 46 + nameLen + buf.readUInt16LE(at + 30) + buf.readUInt16LE(at + 32);
  }
  return parts;
}

/** One part, unpacked, as text. Throws when it is too large, encrypted, or packed in a way this does not read. */
function textOf(buf: Buffer, part: ZipPart): string {
  if (part.encrypted) throw new Error('encrypted');
  if (part.size > MAX_PART_BYTES) throw new Error('too large');
  if (part.offset + 30 > buf.length || buf.readUInt32LE(part.offset) !== 0x04034b50) throw new Error('damaged');
  const start = part.offset + 30 + buf.readUInt16LE(part.offset + 26) + buf.readUInt16LE(part.offset + 28);
  const data = buf.subarray(start, start + part.compressedSize);
  if (part.method === 0) return data.toString('utf8');
  if (part.method === 8) return inflateRawSync(data, { maxOutputLength: MAX_PART_BYTES }).toString('utf8');
  throw new Error('unknown packing');
}

/* -------------------------------------------------------------------- the xml -- */

const attr = (tag: string, name: string): string | undefined => new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(tag)?.[1];

/** XML's own escapes, and the `_x000D_` form Excel uses for characters XML cannot hold. */
function plain(s: string): string {
  return s
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/_x([0-9a-fA-F]{4})_/g, (_, h: string) => String.fromCharCode(parseInt(h, 16)));
}

/** The text of a string item: every `<t>` in it, in order, without the phonetic guides some languages carry. */
function stringOf(xml: string): string {
  let out = '';
  for (const m of xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '').matchAll(/<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g)) out += m[1] ?? '';
  return plain(out);
}

/* ------------------------------------------------------------------ the dates -- */

/** The number formats Excel builds in that show a date or a time. */
const BUILT_IN_DATES = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** A format of the user's own: a date when, with its quoted words and bracketed conditions taken out, it asks for a day, month, year, hour or second. */
function isDateFormat(code: string): boolean {
  const bare = code.replace(/"[^"]*"/g, '').replace(/\\./g, '').replace(/\[[^\]]*\]/g, '');
  return /[dmyhs]/i.test(bare) && !/^general$/i.test(bare.trim());
}

/** Which cell styles show their number as a date. */
function dateStylesOf(stylesXml: string | undefined): boolean[] {
  if (!stylesXml) return [];
  const custom = new Map<number, string>();
  for (const m of stylesXml.matchAll(/<numFmt\b([^>]*)\/?>/g)) {
    const id = Number(attr(m[1], 'numFmtId'));
    const code = attr(m[1], 'formatCode');
    if (Number.isFinite(id) && code !== undefined) custom.set(id, plain(code));
  }
  const xfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(stylesXml)?.[1] ?? '';
  return [...xfs.matchAll(/<xf\b([^>]*)\/?>/g)].map((m) => {
    const id = Number(attr(m[1], 'numFmtId') ?? 0);
    return custom.has(id) ? isDateFormat(custom.get(id)!) : BUILT_IN_DATES.has(id);
  });
}

/**
 * A date cell's number as the day it shows. Excel counts days from the end of 1899 (and believes 1900 was a leap
 * year, which only matters before March of that year); a workbook made on an old Mac counts from 1904. A number with
 * no whole days in it is a time of day.
 */
export function dayOfSerial(serial: number, date1904 = false): string | undefined {
  if (!Number.isFinite(serial) || serial < 0 || serial > 2_958_465) return undefined;
  if (serial < 1) {
    const minutes = Math.round(serial * 1440);
    return `${String(Math.floor(minutes / 60) % 24).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  }
  const days = Math.floor(serial + 1e-9);
  const epoch = date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, days < 61 ? 31 : 30);
  return new Date(epoch + days * 86_400_000).toISOString().slice(0, 10);
}

/** A number as it was typed: Excel stores 36.962 as 36.962000000000003, and nobody typed that. */
function numberWords(raw: string): string {
  const n = Number(raw);
  if (!Number.isFinite(n)) return raw.trim();
  return String(Number(n.toPrecision(15)));
}

/* --------------------------------------------------------------- the workbook -- */

/** The column a cell is in, from its reference ("AB12" → 27). */
function columnOf(ref: string | undefined): number | undefined {
  const letters = /^([A-Za-z]+)/.exec(ref ?? '')?.[1];
  if (!letters) return undefined;
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readWorkbook(bytes: Buffer): WorkbookResult {
  if (bytes.length === 0) return { refusal: 'The file is empty' };
  if (bytes.length > MAX_WORKBOOK_BYTES) return { refusal: `The workbook is larger than ${MAX_WORKBOOK_BYTES / 1_000_000} MB. A sheet of orders is far smaller — send only the sheet with the orders, or save it as CSV` };
  // The older binary format, and a workbook locked with a password, both begin with these bytes.
  if (bytes.length >= 8 && bytes.readUInt32BE(0) === 0xd0cf11e0) return { refusal: 'This is an older Excel file (.xls), or a workbook protected with a password. Save it as .xlsx without a password, or as CSV, and upload that' };
  const parts = bytes.length >= 22 && bytes.readUInt32LE(0) === 0x04034b50 ? partsOf(bytes) : undefined;
  if (!parts) return { refusal: NOT_A_WORKBOOK };
  if (!parts.has('xl/workbook.xml')) {
    return { refusal: parts.has('content.xml') ? 'This is an OpenDocument sheet (.ods). Save it as .xlsx or as CSV and upload that' : NOT_A_WORKBOOK };
  }
  try {
    const read = (name: string) => (parts.has(name) ? textOf(bytes, parts.get(name)!) : undefined);
    const workbook = read('xl/workbook.xml')!;
    const rels = new Map<string, { target: string; type: string }>();
    for (const m of (read('xl/_rels/workbook.xml.rels') ?? '').matchAll(/<Relationship\b([^>]*)\/?>/g)) {
      const id = attr(m[1], 'Id');
      const target = attr(m[1], 'Target');
      if (id && target) rels.set(id, { target: plain(target), type: attr(m[1], 'Type') ?? '' });
    }
    const pathOf = (target: string) => (target.startsWith('/') ? target.slice(1) : `xl/${target}`);

    const sheets = [...workbook.matchAll(/<sheet\b([^>]*)\/?>/g)].map((m) => ({ name: plain(attr(m[1], 'name') ?? ''), rid: attr(m[1], 'r:id') ?? '', hidden: /^(hidden|veryHidden)$/.test(attr(m[1], 'state') ?? '') }));
    const visible = sheets.filter((s) => !s.hidden);
    const first = visible[0];
    if (!first) return { refusal: 'The workbook has no sheet to read' };
    const sheetXml = read(rels.has(first.rid) ? pathOf(rels.get(first.rid)!.target) : 'xl/worksheets/sheet1.xml');
    if (sheetXml === undefined) return { refusal: NOT_A_WORKBOOK };

    const sharedPath = [...rels.values()].find((r) => r.type.endsWith('/sharedStrings'))?.target;
    const shared = [...(read(sharedPath ? pathOf(sharedPath) : 'xl/sharedStrings.xml') ?? '').matchAll(/<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g)].map((m) => stringOf(m[1] ?? ''));
    const dateStyle = dateStylesOf(read('xl/styles.xml'));
    const date1904 = /<workbookPr\b[^>]*\bdate1904="(1|true)"/.test(workbook);

    const rows: string[][] = [];
    const lines: number[] = [];
    let line = 0;
    for (const r of sheetXml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      const said = Number(attr(r[1], 'r'));
      line = Number.isInteger(said) && said > line ? said : line + 1;
      if (rows.length >= MAX_ROWS) return { refusal: `The sheet has more than ${MAX_ROWS} lines. Send only the lines with the orders` };
      const cells: string[] = [];
      let next = 0;
      for (const c of (r[2] ?? '').matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const col = columnOf(attr(c[1], 'r')) ?? next;
        next = col + 1;
        if (col >= MAX_COLUMNS) continue;
        const type = attr(c[1], 't');
        const body = c[2] ?? '';
        const v = /<v\b[^>]*>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let words = '';
        if (type === 'inlineStr') words = stringOf(body);
        else if (v === undefined) words = '';
        else if (type === 's') words = shared[Number(v)] ?? '';
        else if (type === 'str' || type === 'e') words = plain(v);
        else if (type === 'b') words = v.trim() === '1' ? 'TRUE' : 'FALSE';
        else words = dateStyle[Number(attr(c[1], 's') ?? -1)] ? (dayOfSerial(Number(v), date1904) ?? numberWords(v)) : numberWords(v);
        while (cells.length < col) cells.push('');
        cells[col] = words.trim();
      }
      if (cells.some((x) => x !== '')) {
        rows.push(cells);
        lines.push(line);
      }
    }
    return { rows, lines, sheet: first.name, otherSheets: visible.slice(1).map((s) => s.name) };
  } catch (e) {
    // Read by its fields, not by `instanceof`: the platform's own errors are not always this module's Error.
    const { message: why = '', code = '' } = (e ?? {}) as { message?: string; code?: string };
    if (why === 'encrypted') return { refusal: 'This workbook is protected with a password. Save it without one, or as CSV, and upload that' };
    if (why === 'too large' || code === 'ERR_BUFFER_TOO_LARGE') return { refusal: 'The workbook unpacks to far more than a sheet of orders holds. Send only the sheet with the orders, or save it as CSV' };
    return { refusal: 'The workbook is damaged and cannot be read. Open it in Excel, save it again as .xlsx or as CSV, and upload that' };
  }
}
