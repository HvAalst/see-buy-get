import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { en } from './en';
import { enTowerAll } from './en.tower';

/*
 * THE CONSOLE'S WORDS STAY IN THE CONSOLE'S CODE (2026-10-22). en.tower.ts is loaded by the console alone, so how the
 * console works is in no other app's code. What is held to here: a word another app shows is in the catalog every app
 * carries — or that app would show its key instead — and none of the console's own words is.
 */
const SRC = 'src';

function sources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return e.name === 'node_modules' ? [] : sources(path);
    return /\.tsx?$/.test(e.name) && !/\.test\.tsx?$/.test(e.name) && !/\.d\.ts$/.test(e.name) ? [path] : [];
  });
}

describe('the console’s words', () => {
  it('every tower.* word another app uses is in the catalog every app carries', () => {
    const slash = (p: string) => p.replace(/\\/g, '/');
    const outside = sources(SRC).filter((f) => !slash(f).includes('src/apps/tower/') && !slash(f).includes('shared/i18n/catalogs/'));
    expect(outside.length).toBeGreaterThan(50);
    const used = new Map<string, string>();
    for (const f of outside) for (const m of readFileSync(f, 'utf8').matchAll(/['"`](tower\.[A-Za-z0-9_.]+)['"`]/g)) used.set(m[1], slash(f));
    // The guard read something: the Business app's places are among what it found.
    expect([...used.keys()]).toContain('tower.settings.placesTitle');
    for (const [key, f] of used) expect(key in en, `${key} is used by ${f}, and only the console loads it`).toBe(true);
  });

  it('the catalog every app carries holds none of the console’s own words', () => {
    const own = Object.keys(enTowerAll);
    expect(own.length).toBeGreaterThan(1000);
    expect(own.filter((k) => k in en)).toEqual([]);
  });
});
