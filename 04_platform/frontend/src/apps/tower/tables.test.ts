import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * NO CONSOLE TABLE RUNS OFF A PHONE, AND NO STACKED ROW GOES UNLABELLED.
 *
 * The same defect was fixed screen by screen, one screenshot at a time, until an audit counted twenty-three
 * tables of four or more columns that did not stack — a table that wide runs off a phone, and on the
 * shops list the screenshot showed three columns of six before the rest vanished past the edge. Nothing in
 * the build refuses it, so it kept being written.
 *
 * TWO RULES, and each is a class of defect that fails in silence:
 *
 *   WIDE   a table of four or more columns must stack (ctbl--stack) or carry a written reason below.
 *   BARE   a stacked table hides its header, so its row must label its cells with real ctbl__lbl spans —
 *          otherwise a stacked row reads "1326 / 43 days / DEL…" with nothing saying which is which.
 *
 * The row is followed into a child component when the table renders one (`<ClaimRowView/>`), because that
 * is where the cells live and where the labels were put.
 */
const DIR = join('src', 'apps', 'tower', 'screens');

/**
 * THE EXCEPTIONS, EACH WITH ITS REASON. Keyed by file and the table's first header, so a new table cannot
 * inherit an old table's permission. Adding a line here is a decision somebody has to write down.
 */
const EXEMPT: Record<string, string> = {
  'ImportsScreen.tsx|tower.imports.col.code':
    'desk only — below 1100px the same list renders as conversation rows through useWideScreen, so this table never reaches a phone',
  'RatesScreen.tsx|tower.rates.col.lane':
    'the lane editor spans its columns (nine headers over three cells per row); it is an operator desk tool and a positional stack would mislabel it',
};

interface TableFound {
  file: string;
  firstHeader: string;
  columns: number;
  stacked: boolean;
  labelled: boolean;
}

function tablesIn(file: string, src: string): TableFound[] {
  const out: TableFound[] = [];
  for (const m of src.matchAll(/<table class="([^"]*)">([\s\S]*?)<\/table>/g)) {
    const [, cls, body] = m;
    const thead = body.match(/<thead>([\s\S]*?)<\/thead>/)?.[1] ?? '';
    const heads = [...thead.matchAll(/<th\b[^>]*?\/>|<th\b[^>]*>([\s\S]*?)<\/th>/g)];
    const firstHeader = heads[0]?.[1]?.match(/t\('([^']+)'\)/)?.[1] ?? '(none)';
    // Where the cells live: inline, or in the one component the tbody renders.
    let row = body;
    const tbody = body.match(/<tbody>([\s\S]*?)<\/tbody>/)?.[1] ?? '';
    if (!tbody.includes('<tr')) {
      const comp = tbody.match(/<([A-Z][A-Za-z0-9]*)\b/)?.[1];
      const at = comp ? src.search(new RegExp(`function ${comp}\\b`)) : -1;
      if (at >= 0) row = src.slice(at, src.indexOf('</tr>', at));
    }
    out.push({ file, firstHeader, columns: heads.length, stacked: cls.split(/\s+/).includes('ctbl--stack'), labelled: row.includes('ctbl__lbl') });
  }
  return out;
}

const found: TableFound[] = readdirSync(DIR, { withFileTypes: true })
  .filter((e) => !e.isDirectory() && e.name.endsWith('.tsx'))
  .flatMap((e) => tablesIn(e.name, readFileSync(join(DIR, e.name), 'utf8')));

describe('console tables at phone width', () => {
  it('read the screens at all — a guard that saw nothing proves nothing', () => {
    // The project has been caught once by a guard passing thirty-one checks against empty strings.
    expect(found.length).toBeGreaterThan(20);
    expect(found.some((t) => t.file === 'NetworkScreen.tsx' && t.stacked)).toBe(true);
  });

  it('stack every table of four or more columns, or say why not', () => {
    const offenders = found
      .filter((t) => t.columns >= 4 && !t.stacked && !EXEMPT[`${t.file}|${t.firstHeader}`])
      .map((t) => `${t.file} (${t.columns} columns, first "${t.firstHeader}")`);
    expect(offenders).toEqual([]);
  });

  it('label the cells of every stacked table, because the header is hidden', () => {
    // Only where there IS a header to hide. A headerless table (the required-papers list) has cells that
    // describe themselves — a paper's name, its state, its controls — and stacking it hides nothing; this
    // test found it on its first run and it was right to ask, but the answer is that nothing is missing.
    const bare = found.filter((t) => t.stacked && t.columns > 0 && !t.labelled).map((t) => `${t.file} (first "${t.firstHeader}")`);
    expect(bare).toEqual([]);
  });

  it('keep no exception for a table that no longer exists', () => {
    // A reason outliving its table is a permission waiting for the next table to be given that key.
    const live = new Set(found.map((t) => `${t.file}|${t.firstHeader}`));
    expect(Object.keys(EXEMPT).filter((k) => !live.has(k))).toEqual([]);
  });
});
