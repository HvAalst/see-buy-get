import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * THE STYLESHEET NOBODY COMPILES.
 *
 * A broken rule in a .css file is the quietest failure in this repository. TypeScript never sees it,
 * vite never complains, every test stays green, and the browser silently throws the rule away — so the
 * only report is somebody looking at the screen and saying it is not professional.
 *
 * Which is what happened, twice, in two different shapes:
 *
 *  1. A RULE THE PARSER DISCARDS. Comments in console.css had been split by later edits landing between
 *     a comment's first line and its last, leaving their tails stranded above the rules they described.
 *     A parser reads a stranded sentence as the start of a selector, runs on looking for a `{`, and
 *     throws the next rule away with it. `.cons__caveat` went that way — on twenty-three screens, with
 *     no padding, no background, no border and no max-width on any of them.
 *  2. A CLASS THAT TAKES A CELL OUT OF ITS TABLE. `.chint` was given `display: block`, and three
 *     `<td class="chint">` on the imports table stopped being cells: the browser wrapped all three into
 *     one anonymous cell, so the route, the agent and the papers stacked into the ROUTE column while
 *     the button beside them slid left under AGENT. Valid markup, green suite, wrong headings.
 *
 * So the suite reads the stylesheets the way a browser does, and then asks what the classes in them do
 * to the elements they are put on. Two deliberate choices about how:
 *
 *  - NO CSS LIBRARY. postcss is here only as something vite happens to depend on, and a guard that
 *    disappears when a transitive dependency is hoisted differently is not a guard.
 *  - THE FILES ARE READ OFF DISK. The first version of this suite used vite's `?raw` import, to stay
 *    inside the no-@types/node rule — and vitest short-circuits CSS modules, so every stylesheet came
 *    back as an EMPTY STRING and all 31 checks passed against nothing. No error, no warning, a green
 *    suite reporting that something was being watched. See node-fs.d.ts for how the boundary is kept.
 *    Hence `readsSomething`, below: a guard has to prove it read the thing it is guarding.
 */

function walk(dir: string, ext: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, ext, out);
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

function readAll(ext: string): Record<string, string> {
  return Object.fromEntries(walk('src', ext).map((p) => [p.split('\\').join('/'), readFileSync(p, 'utf8')]));
}

const SHEETS = readAll('.css');
const FILES = Object.keys(SHEETS).sort();

/** Every comment in the file, paired the way a browser pairs them: an opener runs to the NEXT closer. */
function comments(css: string): { open: number; close: number }[] {
  const found: { open: number; close: number }[] = [];
  for (let i = 0; i < css.length - 1; i += 1) {
    if (css[i] === '/' && css[i + 1] === '*') {
      const end = css.indexOf('*/', i + 2);
      found.push({ open: i, close: end === -1 ? css.length : end + 2 });
      i = end === -1 ? css.length : end + 1;
    }
  }
  return found;
}

/**
 * Every block in the file as a prelude and a body. The prelude is what a parser has to make a selector
 * (or an at-rule) out of, and it is where a comment that closed in the wrong place leaves its wreckage.
 */
function rules(css: string): { prelude: string; body: string }[] {
  let src = css;
  for (const c of comments(css).reverse()) src = src.slice(0, c.open) + ' '.repeat(c.close - c.open) + src.slice(c.close);
  const out: { prelude: string; body: string }[] = [];
  const open: { prelude: string; at: number }[] = [];
  let buf = '';
  let quote = '';
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    if (quote) {
      if (ch === quote) quote = '';
      buf += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (ch === '{') {
      open.push({ prelude: buf.trim(), at: i + 1 });
      buf = '';
    } else if (ch === '}') {
      const started = open.pop();
      if (started) out.push({ prelude: started.prelude, body: src.slice(started.at, i) });
      buf = '';
    } else if (ch === ';') {
      buf = '';
    } else {
      buf += ch;
    }
  }
  return out.filter((r) => r.prelude);
}

/** Classes that change `display` to something a table cell cannot be. */
function blockClasses(css: string): Map<string, string> {
  const found = new Map<string, string>();
  for (const { prelude, body } of rules(css)) {
    if (prelude.startsWith('@')) continue;
    const display = /(?:^|[;\s])display:\s*([a-z-]+)/i.exec(body)?.[1]?.toLowerCase();
    if (!display || display.startsWith('table') || display === 'inherit' || display === 'revert') continue;
    for (const selector of prelude.split(',')) {
      // A plain class selector, optionally with a state. A descendant selector says WHERE it applies,
      // and this guard is about what a class does wherever it lands.
      const m = /^\s*\.([A-Za-z0-9_-]+)(?::[a-z-]+(?:\([^)]*\))?)*\s*$/.exec(selector);
      if (m) found.set(m[1], display);
    }
  }
  return found;
}

/** Every class named literally on a `<td>` or `<th>` in a component, with the line it is on. */
function cellClasses(tsx: string): { cls: string; line: number }[] {
  const out: { cls: string; line: number }[] = [];
  const tags = /<t[dh]\b[^>]*>/g;
  for (let m = tags.exec(tsx); m; m = tags.exec(tsx)) {
    // Literal class text only. A class name built at runtime is beyond a regex, and the static half of
    // a template literal is still worth checking.
    for (const text of m[0].matchAll(/class=(?:"([^"]*)"|\{`([^`]*)`\})/g)) {
      for (const cls of (text[1] ?? text[2] ?? '').split(/[\s${}?:'"]+/).filter(Boolean)) {
        out.push({ cls, line: tsx.slice(0, m.index).split('\n').length });
      }
    }
  }
  return out;
}

describe('every stylesheet parses the way a browser parses it', () => {
  it('reads something — the check this suite failed at first', () => {
    // GUARDING THE GUARD. It is not enough to find the files: the first version of this suite found
    // fifteen of them and read every one as "". Assert a rule that is certainly in there.
    expect(FILES.length).toBeGreaterThan(3);
    expect(Object.values(SHEETS).every((css) => css.length > 0)).toBe(true);
    expect(Object.values(SHEETS).join('')).toContain('.cons__caveat {');
  });

  it.each(FILES)('%s has no rule a parser would throw away', (file) => {
    const bad = rules(SHEETS[file])
      .map((r) => r.prelude)
      .filter((p) => {
        if (p.startsWith('@')) return false;
        // Comment markers left in a selector mean a comment ended somewhere other than where it looks
        // like it ended, and what follows has been swallowed into a prelude nobody will apply.
        if (p.includes('/*') || p.includes('*/')) return true;
        // A sentence, not a selector: a full stop followed by a space cannot occur in one, and neither
        // can a comma-free prelude of more than eight bare words.
        return /\.\s/.test(p) || (!p.includes(',') && p.split(/\s+/).length > 8);
      });
    expect({ file, unparseable: bad }).toEqual({ file, unparseable: [] });
  });

  it.each(FILES)('%s opens no comment before closing the last one', (file) => {
    // The cause rather than the symptom: two openers running together, and one closer with nothing left
    // to close. Harmless to read, and fatal to the rule that follows it.
    const css = SHEETS[file];
    const spans = comments(css);
    const reopened: number[] = [];
    for (let i = css.indexOf('/*'); i !== -1; i = css.indexOf('/*', i + 2)) {
      if (spans.some((s) => i > s.open && i < s.close)) reopened.push(css.slice(0, i).split('\n').length);
    }
    expect({ file, reopenedAtLine: reopened }).toEqual({ file, reopenedAtLine: [] });
  });
});

describe('no table cell is given a class that stops it being a cell', () => {
  const SOURCES = readAll('.tsx');
  const COMPONENTS = Object.keys(SOURCES).sort();
  const BLOCKY = new Map<string, string>();
  for (const css of Object.values(SHEETS)) for (const [cls, display] of blockClasses(css)) BLOCKY.set(cls, display);

  it('knows which classes change display, and reads the components', () => {
    // `.chint` is the one that caused this; if it ever stops being a block the guard should be re-aimed
    // rather than quietly passing on an empty set.
    expect(BLOCKY.get('chint')).toBe('block');
    expect(COMPONENTS.length).toBeGreaterThan(20);
    expect(Object.values(SOURCES).every((tsx) => tsx.length > 0)).toBe(true);
  });

  it.each(COMPONENTS)('%s puts no display-changing class on a td or th', (file) => {
    const bad = cellClasses(SOURCES[file])
      .filter(({ cls }) => BLOCKY.has(cls))
      .map(({ cls, line }) => `${cls} (display: ${BLOCKY.get(cls)}) on line ${line}`);
    expect({ file, cellsThatAreNotCells: bad }).toEqual({ file, cellsThatAreNotCells: [] });
  });
});
