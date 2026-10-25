import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/*
 * A SUM OF MONEY IS NEVER SAID BARE. Every company of ours keeps its own money, so "120.00" beside no currency reads
 * as a unit this network does not have. Found 2026-10-15 by reading every app for a figure made with toFixed and handed
 * to the words; two were left (the Send app's holding fee, the console's payment for a disposed parcel) until
 * 2026-10-25. What is held to here: an amount made with toFixed and handed to the words goes with its currency in the
 * same breath — or it is a figure formatMoney() makes, with its money.
 */
const SRC = 'src';

/** Every source file under src/, as 'apps/home/main.tsx'. (node-fs.d.ts declares just enough of node for this.) */
function allFiles(dir = ''): string[] {
  return readdirSync(join(SRC, dir), { withFileTypes: true }).flatMap((e) => {
    const rel = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : allFiles(rel);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) ? [rel] : [];
  });
}

/**
 * Said bare on purpose, each until a question is answered:
 * the front page's market shows a rate per kilometre from the network's own rate card, which is in no one country's
 * money — which money that card is in is the money model's question (progress.html, "Three money figures").
 */
const WAITING = ['apps/home/screens/MarketScreen.tsx:home.market.perKm'];

describe('a sum of money said in words', () => {
  it('goes with its currency', () => {
    const found: string[] = [];
    const bare: string[] = [];
    for (const f of allFiles()) {
      readFileSync(join(SRC, f), 'utf8')
        .split('\n')
        .forEach((line) => {
          if (!/\bamount\s*:\s*[^,}]+\.toFixed\(/.test(line)) return;
          const key = /t\(\s*['"`]([^'"`]+)['"`]/.exec(line)?.[1] ?? '';
          found.push(`${f}:${key}`);
          if (!/\bcurrency\s*:/.test(line) && !WAITING.includes(`${f}:${key}`)) bare.push(`${f}: ${line.trim().slice(0, 140)}`);
        });
    }
    // The guard read something: the cover a damage report states is among what it found, with its currency.
    expect(found).toContain('shared/damage/damageReport.ts:dreport.terms.covered');
    expect(bare).toEqual([]);
    // What waits is still there — once it is answered, take it off the list.
    for (const w of WAITING) expect(found, w).toContain(w);
  });
});
