/**
 * WHAT CHANGED BETWEEN TWO VERSIONS OF A DOCUMENT — "track changes", as the console shows it (the user, 2026-10-25:
 * "it's usual track of changes timestamped etc.").
 *
 * Line by line first: a document is paragraphs and list items, one to a line. A line taken out and another put in its
 * place is shown as ONE changed line, with the words taken out struck through and the words put in marked — which is
 * what somebody checking a legal text reads; a whole paragraph shown twice hides the one word that moved.
 */
export type WordPart = { kind: 'same' | 'added' | 'removed'; text: string };
export type DiffLine =
  | { kind: 'same'; text: string }
  | { kind: 'added'; text: string }
  | { kind: 'removed'; text: string }
  | { kind: 'changed'; parts: WordPart[] };

/** The longest common subsequence's walk: what stays, what goes, what comes, in order. */
function walk<T>(a: T[], b: T[]): Array<{ op: 'same' | 'del' | 'ins'; a?: T; b?: T }> {
  const n = a.length;
  const m = b.length;
  const lcs: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
  const out: Array<{ op: 'same' | 'del' | 'ins'; a?: T; b?: T }> = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ op: 'same', a: a[i], b: b[j] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) out.push({ op: 'del', a: a[i++] });
    else out.push({ op: 'ins', b: b[j++] });
  }
  while (i < n) out.push({ op: 'del', a: a[i++] });
  while (j < m) out.push({ op: 'ins', b: b[j++] });
  return out;
}

/** The words of one changed line, taken out and put in, with the spaces kept so it reads as it was written. */
export function wordDiff(before: string, after: string): WordPart[] {
  const tokens = (s: string) => s.split(/(\s+)/).filter((t) => t.length > 0);
  const parts: WordPart[] = [];
  const push = (kind: WordPart['kind'], text: string) => {
    const last = parts[parts.length - 1];
    if (last && last.kind === kind) last.text += text;
    else parts.push({ kind, text });
  };
  for (const step of walk(tokens(before), tokens(after))) {
    if (step.op === 'same') push('same', step.a!);
    else if (step.op === 'del') push('removed', step.a!);
    else push('added', step.b!);
  }
  return parts;
}

/** Every line of the newer version against the older one. */
export function textDiff(before: string, after: string): DiffLine[] {
  const lines = (s: string) => s.replace(/\r\n?/g, '\n').split('\n');
  const steps = walk(lines(before), lines(after));
  const out: DiffLine[] = [];
  for (let k = 0; k < steps.length; ) {
    if (steps[k].op === 'same') {
      out.push({ kind: 'same', text: steps[k].a! });
      k++;
      continue;
    }
    // A run of lines taken out and put in: paired up as changed lines, what is left over said as itself.
    const removed: string[] = [];
    const added: string[] = [];
    while (k < steps.length && steps[k].op !== 'same') {
      if (steps[k].op === 'del') removed.push(steps[k].a!);
      else added.push(steps[k].b!);
      k++;
    }
    const pairs = Math.min(removed.length, added.length);
    for (let p = 0; p < pairs; p++) out.push({ kind: 'changed', parts: wordDiff(removed[p], added[p]) });
    for (const text of removed.slice(pairs)) out.push({ kind: 'removed', text });
    for (const text of added.slice(pairs)) out.push({ kind: 'added', text });
  }
  return out;
}

/** A run of unchanged lines left out, so the changes are seen at once in a long document. */
export type FoldedLine = DiffLine | { kind: 'fold'; count: number };

/**
 * The lines worth reading: every change, with `context` unchanged lines either side, and each longer unchanged stretch
 * said as how many lines it is. Nothing changed at all: every line, as it reads.
 */
export function foldUnchanged(lines: DiffLine[], context = 1): FoldedLine[] {
  if (lines.every((l) => l.kind === 'same')) return lines;
  const near = lines.map((_, i) => lines.slice(Math.max(0, i - context), i + context + 1).some((l) => l.kind !== 'same'));
  const out: FoldedLine[] = [];
  for (let i = 0; i < lines.length; ) {
    if (near[i]) {
      out.push(lines[i]);
      i++;
      continue;
    }
    let j = i;
    while (j < lines.length && !near[j]) j++;
    out.push({ kind: 'fold', count: j - i });
    i = j;
  }
  return out;
}

/** How much changed, said as counts: what a list of versions shows beside each. */
export function diffCounts(lines: DiffLine[]): { added: number; removed: number; changed: number } {
  return {
    added: lines.filter((l) => l.kind === 'added').length,
    removed: lines.filter((l) => l.kind === 'removed').length,
    changed: lines.filter((l) => l.kind === 'changed').length,
  };
}
