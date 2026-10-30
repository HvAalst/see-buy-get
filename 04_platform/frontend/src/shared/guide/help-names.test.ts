import { describe, expect, it } from 'vitest';
import { en } from '../i18n/catalogs/en';
import { enApps } from '../i18n/catalogs/en.apps';
import { enTowerAll } from '../i18n/catalogs/en.tower';
import { enHelp } from '../i18n/catalogs/en.help';
import { enHelpApp } from '../i18n/catalogs/en.help-app';
import { articles } from './articles';

/**
 * A NAME THE HELP QUOTES IS A NAME ON A SCREEN. Help puts a button, a heading or a menu path in curly quotes, “Domestic ›
 * Loads › Post a load”, so the reader can find it; a name that is not on any screen sends them looking for something
 * that is not there (the audit of 2026-10-30 found “Loads” where the screen says “Domestic”, and a button that had
 * been renamed). Every piece of every quoted name in every article must be one of the words the screens show — the
 * catalogs of the apps and the console, the help's own two catalogs left out — or a part of one.
 */
const HELP = new Set([...Object.keys(enHelp), ...Object.keys(enHelpApp)]);
const SCREEN_WORDS: string[] = Object.entries({ ...en, ...enApps, ...enTowerAll } as Record<string, string>)
  .filter(([k]) => !HELP.has(k))
  .map(([, v]) => String(v));

/** A screen's word with its {placeholders} — a plural's forms included — as a gap a quoted name may fill. */
const GAP = '\u0000';
const withGaps = (s: string) => {
  let out = '';
  let depth = 0;
  for (const ch of s) {
    if (ch === '{') {
      if (depth === 0) out += GAP;
      depth++;
    } else if (ch === '}') depth = Math.max(0, depth - 1);
    else if (depth === 0) out += ch;
  }
  return out;
};
const ALL_RAW = SCREEN_WORDS.join('\n');
const WITH_GAPS = SCREEN_WORDS.map(withGaps);

/** A piece is on a screen when it is inside one of its words, a gap or “…” in either standing for anything. */
function onScreen(piece: string): boolean {
  if (ALL_RAW.includes(piece)) return true;
  // “Put on <name>”, “Carried by …, and not insured by it”: the parts around the gap, in order, in one word.
  const parts = piece.split(/<[^>]+>|…|\{[^}]*\}/).map((p) => p.trim()).filter(Boolean);
  if (parts.length === 0) return true;
  return WITH_GAPS.some((w) => {
    let at = 0;
    for (const p of parts) {
      const i = w.indexOf(p, at);
      if (i < 0) return false;
      at = i + p.length;
    }
    return true;
  });
}

/**
 * Quoted, but not a name on our screens — each for its reason. Keyed by the article and the words quoted.
 * Whoever adds one says why; a name that IS on a screen belongs in the help as the screen says it, not here.
 */
const NOT_A_SCREEN_NAME: Record<string, string> = {
  // On a screen, but not one of the catalogs'.
  'thermal-labels: Open printer tools › Action › Send file': 'the printer maker’s own tool (Zebra Setup Utilities), not ours',
  'follow-shop-order: Sign up to follow it': 'the checkout widget on a store’s own page: its words are in widget/logic.ts, which carries no catalog',
  'bag-seals: Close the bag first': 'the server’s refusal (BAG_NOT_CLOSED, backend error-codes.ts), shown as the server says it',
  // Quoted as words, not as a name to look for.
  'quotations: who said this was paid': 'the question the record answers',
  'papers-that-expire: grounded': 'a word no record carries, quoted to say so',
};

describe('the names help quotes', () => {
  it('are on a screen: every piece of every quoted name and path is one of the screens’ own words', () => {
    let checked = 0;
    const missing: string[] = [];
    for (const a of articles()) {
      for (const text of [a.title, a.summary, ...(a.steps ?? []), ...(a.notes ?? [])]) {
        for (const m of text.matchAll(/“([^”]+)”/g)) {
          const quoted = m[1];
          if (NOT_A_SCREEN_NAME[`${a.id}: ${quoted}`]) continue;
          for (const piece of quoted.split(' › ')) {
            checked++;
            if (!onScreen(piece.trim())) missing.push(`${a.id}: “${quoted}” — “${piece.trim()}”`);
          }
        }
      }
    }
    // The guard read the help: a guard that read nothing passes for ever.
    expect(SCREEN_WORDS.length).toBeGreaterThan(5000);
    expect(checked).toBeGreaterThan(100);
    expect(missing).toEqual([]);
  });

  it('allows nothing it does not need: every exception is still quoted somewhere, and still on no screen', () => {
    const quoted = new Set<string>();
    for (const a of articles()) for (const text of [a.title, a.summary, ...(a.steps ?? []), ...(a.notes ?? [])]) for (const m of text.matchAll(/“([^”]+)”/g)) quoted.add(`${a.id}: ${m[1]}`);
    for (const key of Object.keys(NOT_A_SCREEN_NAME)) {
      expect(quoted.has(key), `${key} is no longer quoted`).toBe(true);
      const words = key.slice(key.indexOf(': ') + 2);
      expect(words.split(' › ').every((p) => onScreen(p.trim())), `${key} is on a screen now`).toBe(false);
    }
  });
});
