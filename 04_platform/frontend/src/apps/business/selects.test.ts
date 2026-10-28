import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * NO CHOICE IN THE BUSINESS APP OPENS A POPUP THE PAGE DOES NOT OWN (the user, 2026-10-28: "move them to the same
 * picker", then "You can do those"). The invoice chose its currency, payment terms and trade term in a sheet; then
 * every choice on an export; then the rest — a load's packaging and goods, its seals, its papers, a damage claim, a
 * run, a member's role, the GS1 digit, who a load is sent for. Each is a ConsolePick, and the currency of an invoice
 * is chosen with the countries behind it, never typed. This refuses a new `<select>` or `<datalist>` anywhere in the
 * app, as the console's own guard does for its screens. Comments may name the elements; code may not use them.
 */
const ROOT = join('src', 'apps', 'business');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(path);
    return e.name.endsWith('.tsx') && !e.name.includes('.test.') ? [path] : [];
  });
}

const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the Business app’s choices', () => {
  const files = tsxFiles(ROOT).map((file) => ({ file, src: code(readFileSync(file, 'utf8')) }));

  it('reads the app it guards', () => {
    // A guard that found no files passes for ever: it must have read the screens, and seen the control it asks for.
    expect(files.length).toBeGreaterThan(25);
    expect(files.filter((f) => f.src.includes('<ConsolePick')).length).toBeGreaterThan(12);
    expect(files.some((f) => f.file.endsWith('ExportSli.tsx'))).toBe(true);
  });

  it('opens no native select or datalist anywhere in it', () => {
    const found = files.flatMap(({ file, src }) => [...src.matchAll(/<(select|datalist)\b/g)].map((m) => `${file}: <${m[1]}>`));
    expect(found).toEqual([]);
  });

  it('types no currency: an invoice’s money is chosen from the list', () => {
    const typed = files.filter(({ src }) => /<input[^>]*currency/i.test(src)).map((f) => f.file);
    expect(typed).toEqual([]);
  });
});
