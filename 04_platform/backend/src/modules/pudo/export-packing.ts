import { createHash } from 'crypto';
import { catalogueEntry } from '../../foundation/countries/catalogue';
import { cleanHsCode, hsDisplay } from './commercial-invoice.service';
import { delimiterOf } from './order-sheet';
import { MAX_PACKING_LINES, PACKING_FIELDS, PACKING_USES, type PackingCheck, type PackingColumn, type PackingColumnUse, type PackingField, type PackingLine, type PackingProblem, type PackingTotals } from './export-packing.types';
import { MAX_SLI_LINES, type SliLine } from './export-sli.types';

/**
 * THE PACKING LIST — its reading and its page. The shapes are in export-packing.types.ts.
 *
 * A packing list is the shipper's own, out of its own system, and every system words its headings its own way. So this
 * reads HEADINGS, not positions: each is recognised from the common words for it ("Gross weight", "G.W.", "Gross kg"),
 * or as the business matched it before, or as it chooses now; a heading recognised as nothing is KEPT and printed as
 * it is, never dropped. A heading block above the table — the company's name, an address, a reference — is passed by
 * until the row that reads as headings. A total row is passed by too: totals are worked out, never read.
 */

/** The common words for each field, as a heading reads once lower-cased with its punctuation and units taken off. */
const ALIASES: Record<PackingField, string[]> = {
  marks: ['marks', 'marks and numbers', 'marks and nos', 'marks nos', 'shipping marks', 'carton no', 'carton nos', 'carton number', 'case no', 'case nos', 'package no', 'pkg no', 'box no'],
  itemCode: ['item', 'item code', 'item no', 'sku', 'article', 'article no', 'article number', 'part no', 'part number', 'product code', 'code', 'ref', 'reference'],
  description: ['description', 'description of goods', 'goods', 'goods description', 'item description', 'product', 'product description', 'commodity', 'contents'],
  hsCode: ['hs', 'hs code', 'hs no', 'tariff', 'tariff code', 'commodity code', 'hts', 'hts code', 'customs code'],
  quantity: ['quantity', 'qty', 'pcs', 'pieces', 'units', 'quantity shipped', 'qty shipped'],
  unit: ['unit', 'uom', 'unit of measure', 'units of measure'],
  packages: ['packages', 'no of packages', 'number of packages', 'pkgs', 'cartons', 'ctns', 'no of cartons', 'cases', 'bags', 'boxes', 'pallets', 'drums', 'bales', 'sacks', 'colli'],
  packageKind: ['package type', 'type of package', 'kind of package', 'kind of packages', 'packaging', 'pkg type', 'packing'],
  netKg: ['net', 'net weight', 'net wt', 'net kg', 'n w', 'nw', 'net mass'],
  grossKg: ['gross', 'gross weight', 'gross wt', 'gross kg', 'g w', 'gw', 'gross mass', 'weight'],
  volumeM3: ['volume', 'cbm', 'm3', 'measurement', 'cubic metres', 'cubic meters', 'cube'],
  lengthCm: ['length', 'l', 'len'],
  widthCm: ['width', 'w', 'breadth'],
  heightCm: ['height', 'h', 'ht'],
};

/** Lower-case, punctuation to spaces, a unit in brackets taken off: "Gross Wt. (kg)" → "gross wt". */
export function headingKey(raw: string): string {
  return String(raw ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)|\[[^\]]*\]/g, ' ')
    .replace(/&/g, ' and ')
    .replace(/[.,:;#/\\_\-–—'’"*]+/g, ' ')
    .replace(/³/g, '3')
    .replace(/\s+/g, ' ')
    .trim();
}

/** What a heading's own words say it is, if anything. */
export function recognise(raw: string): PackingField | undefined {
  const key = headingKey(raw);
  if (!key) return undefined;
  for (const field of PACKING_FIELDS) if (ALIASES[field].includes(key)) return field;
  // "Gross weight kg", "Net weight in kg": the words with a unit after them.
  const bare = key.replace(/\b(kg|kgs|kilos?|lbs?|pounds?|g|grams?|cm|mm|in|inch(es)?|m|cbm|m3|cft|cu ft|ltrs?|litres?|liters?)\b/g, '').replace(/\s+/g, ' ').trim();
  for (const field of PACKING_FIELDS) if (ALIASES[field].includes(bare)) return field;
  return undefined;
}

/** The unit a heading names, and what it takes to make it ours (kg, m³, cm). */
function unitOf(raw: string, field: PackingField | 'keep' | 'ignore'): { factor: number; from?: string } {
  const h = String(raw ?? '').toLowerCase();
  if (field === 'netKg' || field === 'grossKg') {
    if (/\blbs?\b|pound/.test(h)) return { factor: 0.45359237, from: 'lb' };
    if (/\(g\)|\bgrams?\b|\bgr\b/.test(h)) return { factor: 0.001, from: 'g' };
    if (/\btonnes?\b|\btons?\b|\(t\)/.test(h)) return { factor: 1000, from: 't' };
  }
  if (field === 'volumeM3') {
    if (/cft|cu\.? ?ft|cubic f(ee|oo)t/.test(h)) return { factor: 0.0283168466, from: 'cubic feet' };
    if (/cm3|cm³|ccm|\bcc\b/.test(h)) return { factor: 0.000001, from: 'cubic centimetres' };
    if (/\blit(re|er)s?\b|\bltrs?\b|\(l\)/.test(h)) return { factor: 0.001, from: 'litres' };
  }
  if (field === 'lengthCm' || field === 'widthCm' || field === 'heightCm') {
    if (/\(mm\)|\bmm\b/.test(h)) return { factor: 0.1, from: 'mm' };
    if (/\(in\)|\binch(es)?\b/.test(h)) return { factor: 2.54, from: 'inches' };
    if (/\(m\)/.test(h)) return { factor: 100, from: 'm' };
  }
  return { factor: 1 };
}

/** A number as a person types it: "1 234,5", "1,234.5", "1.234,5", "12 kg". Undefined where it is not one. */
export function numberOf(raw: string): number | undefined {
  const s = String(raw ?? '').trim().replace(/[a-zA-Z³]+\.?$/, '').trim();
  if (!s) return undefined;
  let d = s.replace(/[\s'’]/g, '');
  if (d.includes(',') && d.includes('.')) d = d.lastIndexOf(',') > d.lastIndexOf('.') ? d.replace(/\./g, '').replace(',', '.') : d.replace(/,/g, '');
  else if (/,\d{3}(\D|$)/.test(d) && !/,\d{3}\d/.test(d)) d = d.replace(/,/g, '');
  else d = d.replace(',', '.');
  if (!/^-?\d+(\.\d+)?$/.test(d)) return undefined;
  const n = Number(d);
  return Number.isFinite(n) ? n : undefined;
}

const TOTAL_ROW = /^(grand\s*)?(sub\s*)?totals?\b|^sum\b|^in total\b/i;

/**
 * Rows of cells from a CSV file's text or cells pasted from a spreadsheet — with the row number each had, blank rows
 * counted, so "row 8" in a problem is row 8 in the shipper's own sheet.
 */
export function cellsWithRows(text: string, delimiter = delimiterOf(text)): { cells: string[][]; rowNumbers: number[] } {
  const rows: string[][] = [];
  const numbers: number[] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else {
        if (ch === '\n') line++;
        cell += ch;
      }
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      numbers.push(start);
      line++;
      start = line;
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  numbers.push(start);
  const keep = rows.map((r, i) => ({ r: r.map((c) => c.trim()), n: numbers[i] })).filter(({ r }) => r.some((c) => c !== ''));
  return { cells: keep.map((k) => k.r), rowNumbers: keep.map((k) => k.n) };
}

/** The row its headings are on: the first, among the first thirty, that reads as two fields or more, one of them the goods. */
function headingRowOf(cells: string[][]): number {
  for (let i = 0; i < Math.min(cells.length, 30); i += 1) {
    const found = cells[i].map(recognise).filter(Boolean) as PackingField[];
    if (new Set(found).size >= 2 && (found.includes('description') || found.includes('itemCode'))) return i;
  }
  return 0;
}

export interface PackingReading {
  check: Omit<PackingCheck, 'imported'>;
  lines: PackingLine[];
  extraColumns: string[];
  /** Every heading as it was read this time — what is remembered for the business on import. */
  mapping: Record<string, PackingColumnUse>;
}

/**
 * READ A SHEET OF CELLS INTO A PACKING LIST. `chosen` is what the shipper matched now, `remembered` what it matched
 * before (both keyed by headingKey); nothing is kept here — the caller decides whether to keep it.
 */
export function readPacking(cells: string[][], opts: { chosen?: Record<string, string>; remembered?: Record<string, PackingColumnUse>; rowNumbers?: number[] } = {}): PackingReading {
  const empty = (refusal: string): PackingReading => ({
    check: { columns: [], headingRow: 0, totals: { lines: 0, packages: 0, grossKg: 0, netKg: 0, volumeM3: 0 }, preview: [], problems: [], notes: [], refusal },
    lines: [],
    extraColumns: [],
    mapping: {},
  });
  if (!cells.length) return empty('The file holds no rows');
  const rowNo = (i: number) => opts.rowNumbers?.[i] ?? i + 1;
  const h = headingRowOf(cells);
  const headings = cells[h];
  const chosen = Object.fromEntries(Object.entries(opts.chosen ?? {}).map(([k, v]) => [headingKey(k), v]));
  const columns: PackingColumn[] = [];
  const used = new Set<PackingField>();
  const notes: string[] = [];
  if (h > 0) notes.push(`The headings were found on row ${rowNo(h)}; the ${h === 1 ? 'row' : `${h} rows`} above them were passed by.`);
  headings.forEach((heading) => {
    const key = headingKey(heading);
    let use: PackingColumnUse;
    let because: PackingColumn['because'];
    const pick = chosen[key];
    if (!key) {
      use = 'ignore';
      because = 'chosen';
    } else if (pick && (PACKING_USES as readonly string[]).includes(pick)) {
      use = pick as PackingColumnUse;
      because = 'chosen';
    } else if (opts.remembered?.[key]) {
      use = opts.remembered[key];
      because = 'remembered';
    } else {
      const field = recognise(heading);
      use = field ?? 'keep';
      because = field ? 'heading' : 'kept';
    }
    // One column to a field: a second "gross weight" is kept as it is, and said.
    if (use !== 'keep' && use !== 'ignore') {
      if (used.has(use)) {
        notes.push(`Two columns read as one field — “${heading}” is kept as it is beside the first.`);
        use = 'keep';
        because = 'kept';
      } else used.add(use);
    }
    const unit = unitOf(heading, use);
    columns.push({ heading: heading || '(no heading)', use, because, ...(unit.from ? { convertedFrom: unit.from } : {}) });
  });

  const problems: PackingProblem[] = [];
  const lines: PackingLine[] = [];
  const extraColumns = columns.filter((c) => c.use === 'keep').map((c) => c.heading);
  if (!used.has('packages')) notes.push('No column says how many packages a line is: each line is counted as one package. Match the column if there is one.');
  if (!used.has('grossKg')) notes.push('No gross weight column: the letter of instruction needs a gross weight for its goods.');
  if (!used.has('description') && !used.has('itemCode')) return empty('No column reads as the goods’ description — match the column that describes them');

  for (let i = h + 1; i < cells.length; i += 1) {
    const row = cells[i];
    if (!row.some((c) => c && c.trim())) continue;
    const first = row.find((c) => c && c.trim()) ?? '';
    if (TOTAL_ROW.test(first.trim())) {
      notes.push(`Row ${rowNo(i)} reads as a total and was passed by: the totals are worked out from the lines.`);
      continue;
    }
    if (lines.length >= MAX_PACKING_LINES) return empty(`More than ${MAX_PACKING_LINES.toLocaleString('en')} lines — send the list for this box only`);
    const line: PackingLine = { description: '', packages: 1 };
    const extra: Record<string, string> = {};
    columns.forEach((col, j) => {
      const raw = (row[j] ?? '').trim();
      if (!raw || col.use === 'ignore') return;
      if (col.use === 'keep') {
        extra[col.heading] = raw.slice(0, 120);
        return;
      }
      const field = col.use;
      const numeric: PackingField[] = ['quantity', 'packages', 'netKg', 'grossKg', 'volumeM3', 'lengthCm', 'widthCm', 'heightCm'];
      if (numeric.includes(field)) {
        const n = numberOf(raw);
        if (n == null || n < 0) {
          problems.push({ row: rowNo(i), says: `“${raw}” under “${col.heading}” is not a number` });
          return;
        }
        const value = n * unitOf(headings[j], field).factor;
        if (field === 'packages') {
          if (!Number.isInteger(n) || n < 1) problems.push({ row: rowNo(i), says: `“${raw}” packages is not a whole number of one or more` });
          else line.packages = n;
        } else (line as unknown as Record<string, number>)[field] = Math.round(value * 1000) / 1000;
        return;
      }
      if (field === 'hsCode') {
        const hs = cleanHsCode(raw);
        if (hs) line.hsCode = hs;
        else problems.push({ row: rowNo(i), says: `“${raw}” is not an HS code of 6 to 10 digits` });
        return;
      }
      (line as unknown as Record<string, string>)[field] = raw.slice(0, field === 'description' ? 300 : 120);
    });
    if (!line.description) {
      if (line.itemCode) line.description = line.itemCode;
      else {
        problems.push({ row: rowNo(i), says: 'No description of the goods' });
        continue;
      }
    }
    if (Object.keys(extra).length) line.extra = extra;
    lines.push(line);
  }
  if (!lines.length && !problems.length) return empty('No lines under the headings');
  const mapping: Record<string, PackingColumnUse> = {};
  headings.forEach((heading, j) => {
    const key = headingKey(heading);
    if (key) mapping[key] = columns[j].use;
  });
  return { check: { columns, headingRow: rowNo(h), totals: totalsOf(lines), preview: lines.slice(0, 20), problems: problems.slice(0, 50), notes }, lines, extraColumns, mapping };
}

export function totalsOf(lines: PackingLine[]): PackingTotals {
  const r = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
  return {
    lines: lines.length,
    packages: lines.reduce((s, l) => s + l.packages, 0),
    grossKg: r(lines.reduce((s, l) => s + (l.grossKg ?? 0), 0), 1),
    netKg: r(lines.reduce((s, l) => s + (l.netKg ?? 0), 0), 1),
    volumeM3: r(lines.reduce((s, l) => s + (l.volumeM3 ?? 0), 0), 3),
  };
}

/**
 * THE LETTER'S GOODS, WORKED OUT FROM THE LIST: one line for each description, HS code and kind of package, with its
 * packages, weights and volume added up and its marks from the first to the last. Never more lines than a letter holds:
 * past that, one line for each HS code.
 */
export function summarisePacking(lines: PackingLine[]): SliLine[] {
  const group = (keyOf: (l: PackingLine) => string, describe: (ls: PackingLine[]) => string): SliLine[] => {
    const groups = new Map<string, PackingLine[]>();
    for (const l of lines) groups.set(keyOf(l), [...(groups.get(keyOf(l)) ?? []), l]);
    return [...groups.values()].map((ls) => {
      const marks = ls.map((l) => l.marks).filter(Boolean) as string[];
      const t = totalsOf(ls);
      return {
        ...(marks.length ? { marks: marks.length === 1 || marks[0] === marks[marks.length - 1] ? marks[0] : `${marks[0]} – ${marks[marks.length - 1]}` } : {}),
        packages: t.packages,
        packageKind: ls[0].packageKind ?? 'packages',
        description: describe(ls).slice(0, 300),
        ...(ls[0].hsCode ? { hsCode: ls[0].hsCode } : {}),
        grossKg: t.grossKg,
        ...(t.netKg ? { netKg: t.netKg } : {}),
        ...(t.volumeM3 ? { volumeM3: Math.round(t.volumeM3 * 100) / 100 } : {}),
      };
    });
  };
  const fine = group((l) => [l.description, l.hsCode ?? '', l.packageKind ?? ''].join('|'), (ls) => ls[0].description);
  if (fine.length <= MAX_SLI_LINES) return fine;
  return group(
    (l) => [l.hsCode ?? '', l.packageKind ?? ''].join('|'),
    (ls) => {
      const others = new Set(ls.map((l) => l.description)).size - 1;
      return others > 0 ? `${ls[0].description} and ${others} other item${others === 1 ? '' : 's'}` : ls[0].description;
    },
  ).slice(0, MAX_SLI_LINES);
}

/** The list's own fingerprint: what the letter was signed from, so a changed list is a changed letter. */
export function packingBasis(lines: PackingLine[]): string {
  return createHash('sha256').update(JSON.stringify(summarisePacking(lines)), 'utf8').digest('hex');
}

const esc = (s: string) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const utc = (iso: string) => `${iso.slice(0, 10)} ${iso.slice(11, 16)} UTC`;

export interface PackingFacts {
  code: string;
  shipper: { name: string; address?: string; country: string };
  consignee?: string;
  booking: string;
  forwarder: string;
  vessel?: string;
  loadingPort: string;
  destCountry: string;
  container: { type?: string; number?: string; seals: string[] };
}

/** THE PRINTED LIST: every line, with the columns the list actually uses and those it kept, and its totals. */
export function packingHtml(f: PackingFacts, lines: PackingLine[], extraColumns: string[], sign: { version: number; signedBy: string; signedAt: string } | 'draft'): string {
  const has = (k: keyof PackingLine) => lines.some((l) => l[k] != null && l[k] !== '');
  const n = (x: number | undefined, dp = 1) => (x == null ? '' : x.toLocaleString('en', { maximumFractionDigits: dp }));
  const cols: Array<{ head: string; cell: (l: PackingLine) => string; right?: boolean }> = [
    ...(has('marks') ? [{ head: 'Marks and numbers', cell: (l: PackingLine) => esc(l.marks ?? '') }] : []),
    ...(has('itemCode') ? [{ head: 'Item', cell: (l: PackingLine) => esc(l.itemCode ?? '') }] : []),
    { head: 'Description', cell: (l) => esc(l.description) },
    ...(has('hsCode') ? [{ head: 'HS code', cell: (l: PackingLine) => (l.hsCode ? esc(hsDisplay(l.hsCode)) : '') }] : []),
    ...(has('quantity') ? [{ head: 'Quantity', right: true, cell: (l: PackingLine) => `${n(l.quantity, 3)}${l.unit ? ` ${esc(l.unit)}` : ''}` }] : []),
    { head: 'Packages', right: true, cell: (l) => `${n(l.packages, 0)}${l.packageKind ? ` ${esc(l.packageKind)}` : ''}` },
    ...(has('netKg') ? [{ head: 'Net kg', right: true, cell: (l: PackingLine) => n(l.netKg) }] : []),
    ...(has('grossKg') ? [{ head: 'Gross kg', right: true, cell: (l: PackingLine) => n(l.grossKg) }] : []),
    ...(has('volumeM3') ? [{ head: 'm³', right: true, cell: (l: PackingLine) => n(l.volumeM3, 3) }] : []),
    ...(has('lengthCm') || has('widthCm') || has('heightCm') ? [{ head: 'L × W × H cm', cell: (l: PackingLine) => [l.lengthCm, l.widthCm, l.heightCm].map((x) => n(x)).join(' × ') }] : []),
    ...extraColumns.map((head) => ({ head, cell: (l: PackingLine) => esc(l.extra?.[head] ?? '') })),
  ];
  const t = totalsOf(lines);
  const draft = sign === 'draft';
  const title = `${draft ? 'DRAFT — ' : ''}Packing list — ${f.code}${draft ? '' : ` — version ${sign.version}`}`;
  const rows = lines.map((l, i) => `<tr><td class="r">${i + 1}</td>${cols.map((c) => `<td${c.right ? ' class="r"' : ''}>${c.cell(l)}</td>`).join('')}</tr>`).join('');
  const totals = `<tr class="tot"><th></th>${cols.map((c) => `<th${c.right ? ' class="r"' : ''}>${c.head === 'Packages' ? n(t.packages, 0) : c.head === 'Net kg' ? n(t.netKg) : c.head === 'Gross kg' ? n(t.grossKg) : c.head === 'm³' ? n(t.volumeM3, 3) : c.head === 'Description' ? `Total — ${t.lines.toLocaleString('en')} line${t.lines === 1 ? '' : 's'}` : ''}</th>`).join('')}</tr>`;
  const country = catalogueEntry(f.shipper.country)?.name ?? f.shipper.country;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{font:12px/1.4 system-ui,sans-serif;color:#111;margin:20px auto;max-width:1100px;padding:0 14px}h1{font-size:18px;margin:0 0 4px}.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:8px;margin:10px 0 14px}.box{border:1px solid #ddd;border-radius:6px;padding:7px 9px}.h{font-size:10px;color:#555;text-transform:uppercase;letter-spacing:.04em}table{border-collapse:collapse;width:100%}th,td{border-bottom:1px solid #e3e3e3;padding:3px 5px;text-align:left;vertical-align:top}th{font-weight:600;background:#f6f6f6}.r{text-align:right}.tot th{background:#eee}.draft{color:#b00020;font-weight:700}.note{color:#555;font-size:11px;margin-top:14px}@media print{body{margin:0}th{background:#fff}}</style></head><body>
<h1>${esc(title)}</h1>
${draft ? '<p class="draft">A draft: not signed.</p>' : ''}
<div class="meta"><div class="box"><div class="h">Shipper</div><b>${esc(f.shipper.name)}</b>${f.shipper.address ? `<br>${esc(f.shipper.address)}` : ''}<br>${esc(country)}</div>${f.consignee ? `<div class="box"><div class="h">Consignee</div>${esc(f.consignee)}</div>` : ''}<div class="box"><div class="h">Booking</div>${esc(f.booking)} — ${esc(f.forwarder)}${f.vessel ? `<br>${esc(f.vessel)}` : ''}<br>From ${esc(f.loadingPort)} to ${esc(catalogueEntry(f.destCountry)?.name ?? f.destCountry)}</div><div class="box"><div class="h">Container</div>${esc(f.container.number ?? '—')}${f.container.type ? ` (${esc(f.container.type)})` : ''}<br>Seal ${esc(f.container.seals.join(', ') || '—')}</div></div>
<table><tr><th class="r">#</th>${cols.map((c) => `<th${c.right ? ' class="r"' : ''}>${esc(c.head)}</th>`).join('')}</tr>${rows}${totals}</table>
<p>${draft ? '<span class="draft">Not signed.</span>' : `Signed by ${esc(sign.signedBy)}, for ${esc(f.shipper.name)}, on ${esc(utc(sign.signedAt))} — version ${sign.version}.`}</p>
<p class="note">The shipper’s own list, imported from its file and printed on SeeBuyGet. Every line, weight and HS code is the shipper’s; SeeBuyGet classifies nothing. A signed version is kept exactly as signed; a change is a new version.</p>
</body></html>`;
}
