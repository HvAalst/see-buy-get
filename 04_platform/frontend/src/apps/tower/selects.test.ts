import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * NO CHOICE IN THE CONSOLE OPENS A POPUP THE PAGE DOES NOT OWN.
 *
 * The user, on a container at phone width: the list "goes outside the screen". A `<datalist>` is drawn,
 * placed and sized by the browser; a `<select>` is better behaved but still a popup the page cannot place, and
 * at that width it opens off the edge of the thing it was opened from. ConsolePick replaced the first two, and
 * then twenty-eight more were counted across borders, companies, the company record, the papers register,
 * gate accounts, free days and customs holds — the same shape, written again each time because nothing in the
 * build refused it. This does.
 *
 * A choice in this console is a ConsolePick: a sheet with the console's own rows, `bare` and `small` where it
 * stands in a row of controls. Comments may still name the elements; code may not use them.
 */
const ROOT = join('src', 'apps', 'tower');

function tsxFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const path = join(dir, e.name);
    if (e.isDirectory()) return tsxFiles(path);
    return e.name.endsWith('.tsx') ? [path] : [];
  });
}

/** The source as the compiler sees it, without what is only said about it. */
function code(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
}

describe('the console’s choices', () => {
  const files = tsxFiles(ROOT).map((file) => ({ file, src: code(readFileSync(file, 'utf8')) }));

  it('reads the console it guards', () => {
    // A guard that found no files passes for ever: it must have read the screens, and seen the control it asks for.
    expect(files.length).toBeGreaterThan(40);
    expect(files.filter((f) => f.src.includes('<ConsolePick')).length).toBeGreaterThan(8);
  });

  it('opens no native select or datalist anywhere in it', () => {
    const found = files.flatMap(({ file, src }) => [...src.matchAll(/<(select|datalist)\b/g)].map((m) => `${file}: <${m[1]}>`));
    expect(found).toEqual([]);
  });
});
