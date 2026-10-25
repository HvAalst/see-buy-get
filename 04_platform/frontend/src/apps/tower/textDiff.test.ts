import { describe, expect, it } from 'vitest';
import { diffCounts, textDiff, wordDiff } from './textDiff';

/* What changed between two versions of a document, as the console shows it: track changes. */
describe('what changed between two versions', () => {
  it('shows a line changed as one line, the words taken out and put in marked', () => {
    const lines = textDiff('## Who\n\n- You agree with SeeBuyGet.\n- Unchanged.', '## Who\n\n- You agree with SeeBuyGet Kenya.\n- Unchanged.');
    expect(lines.map((l) => l.kind)).toEqual(['same', 'same', 'changed', 'same']);
    const changed = lines[2] as { kind: 'changed'; parts: Array<{ kind: string; text: string }> };
    expect(changed.parts).toEqual([
      { kind: 'same', text: '- You agree with ' },
      { kind: 'removed', text: 'SeeBuyGet.' },
      { kind: 'added', text: 'SeeBuyGet Kenya.' },
    ]);
  });

  it('says lines added and taken out as themselves, and counts them', () => {
    const lines = textDiff('a\nb\nc', 'a\nc\nd\ne');
    expect(lines).toEqual([
      { kind: 'same', text: 'a' },
      { kind: 'removed', text: 'b' },
      { kind: 'same', text: 'c' },
      { kind: 'added', text: 'd' },
      { kind: 'added', text: 'e' },
    ]);
    expect(diffCounts(lines)).toEqual({ added: 2, removed: 1, changed: 0 });
  });

  it('keeps the spaces, so a changed line still reads as written', () => {
    expect(wordDiff('kept 90 days', 'kept 180 days').map((p) => p.text).join('')).toBe('kept 90180 days');
  });
});

describe('folding what did not change', () => {
  it('keeps every change with a line either side, and says the stretches between as how many lines', async () => {
    const { foldUnchanged } = await import('./textDiff');
    const before = Array.from({ length: 12 }, (_, i) => `line ${i}`).join('\n');
    const after = before.replace('line 9', 'line nine');
    const folded = foldUnchanged(textDiff(before, after));
    expect(folded[0]).toEqual({ kind: 'fold', count: 8 });
    expect(folded.map((l) => l.kind)).toEqual(['fold', 'same', 'changed', 'same', 'fold']);
    expect(folded[4]).toEqual({ kind: 'fold', count: 1 });
    // Nothing changed: every line, as it reads.
    expect(foldUnchanged(textDiff('a\nb', 'a\nb'))).toHaveLength(2);
  });
});
