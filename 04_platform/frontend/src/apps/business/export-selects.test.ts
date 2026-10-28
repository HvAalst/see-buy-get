import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * AN EXPORT'S CHOICES ARE THE CONSOLE'S PICKER, NEVER A NATIVE POPUP (the user, 2026-10-28: "move them to the same
 * picker"). The invoice chose its currency, payment terms and trade term in a sheet; the letter of instruction, the
 * packing list and the export itself still opened the phone's own list. Now every choice on an export is a
 * ConsolePick — and this refuses a new `<select>` or `<datalist>` in any of those screens, as the console's guard does.
 */
const ROOT = join('src', 'apps', 'business', 'screens');
const code = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

describe('the export screens’ choices', () => {
  const files = readdirSync(ROOT)
    .filter((name) => /^Export.*\.tsx$/.test(name))
    .map((name) => ({ file: name, src: code(readFileSync(join(ROOT, name), 'utf8')) }));

  it('reads the screens it guards', () => {
    // A guard that found nothing passes for ever: the export, its letter, its packing list and its invoice.
    expect(files.map((f) => f.file).sort()).toEqual(expect.arrayContaining(['ExportInvoice.tsx', 'ExportPacking.tsx', 'ExportSli.tsx', 'ExportsScreen.tsx']));
    expect(files.filter((f) => f.src.includes('<ConsolePick')).length).toBe(files.length);
  });

  it('opens no native select or datalist in any of them', () => {
    const found = files.flatMap(({ file, src }) => [...src.matchAll(/<(select|datalist)\b/g)].map((m) => `${file}: <${m[1]}>`));
    expect(found).toEqual([]);
  });
});
