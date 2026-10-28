import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * NO CHOICE IN THE STORE APP OPENS THE PHONE'S OWN LIST (the user, 2026-10-28: "move them both" — the store's dropdown
 * and the store's parcel invoice currency, after the Business app's). Every choice is the shared `Choice`: chips for a
 * short list, a sheet for a long one; the money on a parcel's papers is chosen with the countries behind it. This
 * refuses a new `<select>`, `<datalist>` or typed currency box anywhere in the app. Comments may name the elements.
 */
const ROOT = join('src', 'apps', 'vendor');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(path);
    return e.name.endsWith('.tsx') && !e.name.includes('.test.') ? [path] : [];
  });
}

const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '').replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

describe('the store app’s choices', () => {
  const files = tsxFiles(ROOT).map((file) => ({ file, src: code(readFileSync(file, 'utf8')) }));

  it('reads the app it guards', () => {
    // A guard that found no files passes for ever: it must have read the screens, and seen the control it asks for.
    expect(files.length).toBeGreaterThan(12);
    expect(files.filter((f) => f.src.includes('<Choice')).length).toBeGreaterThanOrEqual(6);
    expect(files.some((f) => f.file.endsWith('PapersCard.tsx'))).toBe(true);
  });

  it('opens no native select or datalist anywhere in it', () => {
    const found = files.flatMap(({ file, src }) => [...src.matchAll(/<(select|datalist)\b/g)].map((m) => `${file}: <${m[1]}>`));
    expect(found).toEqual([]);
  });

  it('types no currency: the money on the papers is chosen from the list', () => {
    const typed = files.filter(({ src }) => /<input[^>]*currency/i.test(src) || /'papers-currency'[^\n]*\(v\)/.test(src)).map((f) => f.file);
    expect(typed).toEqual([]);
  });
});
