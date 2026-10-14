import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * A CARD THAT SHOWS A VALUE MUST SAY WHAT THE VALUE IS.
 *
 * `Card` has two props that look interchangeable and are not. `title` is the visible heading. `label` is
 * ONLY the section's `aria-label` — it renders nothing at all. Pair `label` with `aside` and you get a
 * head row containing an empty `<span />` and a value floating on the right: the figure is on screen and
 * the word explaining it exists for a screen reader alone.
 *
 * Found at phone width on the driver's on-shift home, where a pill read "Not checked" with nothing saying
 * what had not been checked. Four cards were doing it, and the worst was a co-op consignment whose LOT
 * CODE was the invisible label — so the card showed a status and a from/to, and which lot it was could
 * not be read off the screen at all.
 *
 * Nothing in the build refused it, which is why it happened four times. `label` on its own is fine and
 * common (a landmark name for a card whose content speaks for itself); it is `label` + `aside` that is
 * always a mistake, because an aside only exists to sit opposite something.
 */
const ROOTS = [join('src', 'apps'), join('src', 'shared')];

/** `withFileTypes` rather than statSync: the hand-written node:fs shim declares only what a test needs. */
function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...tsxFiles(full));
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

/** Each `<Card …>` opening tag, however many lines it is spread over. */
function cardTags(source: string): string[] {
  const tags: string[] = [];
  const re = /<Card(\s)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    // Walk to the matching '>' of the opening tag, skipping any nested braces/strings cheaply.
    let depth = 0;
    let i = re.lastIndex;
    for (; i < source.length; i += 1) {
      const c = source[i];
      if (c === '{') depth += 1;
      else if (c === '}') depth -= 1;
      else if (c === '>' && depth === 0) break;
    }
    tags.push(source.slice(m.index, i + 1));
  }
  return tags;
}

describe('a Card’s label is not a heading', () => {
  const files = ROOTS.flatMap(tsxFiles);

  it('read the app source at all', () => {
    // The guard-must-prove-it-read rule: a reader that silently returns nothing passes every check below.
    expect(files.length).toBeGreaterThan(40);
    expect(files.some((f) => readFileSync(f, 'utf8').includes('<Card'))).toBe(true);
  });

  it('never pairs the invisible `label` with an `aside`', () => {
    const offenders: string[] = [];
    for (const file of files) {
      for (const tag of cardTags(readFileSync(file, 'utf8'))) {
        if (/\slabel=/.test(tag) && /\saside=/.test(tag)) {
          offenders.push(`${file}: ${tag.replace(/\s+/g, ' ').slice(0, 110)}…`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('finds the mistake when it is made', () => {
    // The guard is checked against the defect it was written for, not only against a clean tree.
    const bad = '<Card label={t("x")} aside={<Pill>y</Pill>}>';
    const [tag] = cardTags(bad);
    expect(/\slabel=/.test(tag) && /\saside=/.test(tag)).toBe(true);

    // …and a card that uses title + aside, or label alone, is left alone.
    expect(cardTags('<Card title={t("x")} aside={<b>y</b>}>').every((t) => !/\slabel=/.test(t))).toBe(true);
    expect(cardTags('<Card label={t("x")}>').every((t) => !/\saside=/.test(t))).toBe(true);
  });
});
