import { describe, expect, it } from 'vitest';

/**
 * THE STYLESHEET NOBODY COMPILES.
 *
 * A broken rule in a .css file is the quietest failure in this repository. TypeScript never sees it,
 * vite never complains, every test stays green, and the browser silently throws the rule away — so the
 * only report is somebody looking at the screen and saying it is not professional.
 *
 * Which is what happened. Two comments in console.css had been split by later edits landing between a
 * comment's first line and its last, leaving their tails stranded above the rules they described:
 *
 *     one of these, and so should anything else an operator must not forget while reading a table. --/
 *     .cons__caveat { ... }
 *
 * A parser reads that sentence as the start of a selector, runs on through `.cons__caveat` looking for
 * a `{`, and discards the whole thing as one unparseable rule. `.cons__caveat` is on twenty-three
 * screens; it had no padding, no background, no border and no max-width on any of them, so a standing
 * caveat at the top of a console screen rendered as bare text running off the right edge of the window.
 * `.cons__gates` went the same way.
 *
 * So the suite reads the stylesheets the way the browser does. Two deliberate choices about how:
 *
 * - NO CSS LIBRARY. postcss is here only as something vite happens to depend on, and a guard that
 *   disappears when a transitive dependency is hoisted differently is not a guard.
 * - NO `node:fs`. This project ships no @types/node on purpose (see raw-import.d.ts), so the files
 *   arrive through the bundler's own glob — which also means the suite covers every stylesheet in the
 *   tree without being told where they are.
 */

const SHEETS = import.meta.glob('../**/*.css', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
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
 * The prelude of every block in the file — the text between the last `}`, `;` or `{` and the next `{`.
 * That is what a parser has to make a selector (or an at-rule) out of, and it is where a comment that
 * closed in the wrong place leaves its wreckage.
 */
function preludes(css: string): string[] {
  let src = css;
  for (const c of comments(css).reverse()) src = src.slice(0, c.open) + ' '.repeat(c.close - c.open) + src.slice(c.close);
  const out: string[] = [];
  let buf = '';
  let quote = '';
  for (const ch of src) {
    if (quote) {
      if (ch === quote) quote = '';
      buf += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      buf += ch;
    } else if (ch === '{') {
      out.push(buf.trim());
      buf = '';
    } else if (ch === '}' || ch === ';') {
      buf = '';
    } else {
      buf += ch;
    }
  }
  return out.filter(Boolean);
}

describe('every stylesheet parses the way a browser parses it', () => {
  it('finds stylesheets to check at all', () => {
    // Guarding the guard: a glob that silently matches nothing is a suite that passes for ever.
    expect(FILES.length).toBeGreaterThan(3);
  });

  it.each(FILES)('%s has no rule a parser would throw away', (file) => {
    const bad = preludes(SHEETS[file]).filter((p) => {
      if (p.startsWith('@')) return false;
      // Comment markers left in a selector mean a comment ended somewhere other than where it looks like
      // it ended, and everything after it has been swallowed into a prelude nobody will apply.
      if (p.includes('/*') || p.includes('*/')) return true;
      // A sentence, not a selector: a full stop followed by a space cannot occur in one, and neither can
      // a comma-free prelude of more than eight bare words.
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
