import type { MessageKey } from '../../shared/i18n';

/**
 * D9 (assessment.html; the user, 2026-10-25: "Yes, A then B") — WHAT THE RECEIVER FOUND AT THE HANDOVER, written down by the
 * driver with them: packages short, more than the note says, damaged (with a photograph, always), or not the goods the note
 * describes. It goes on the consignment note beside the receiver's name, and the delivery still stands. The server holds the
 * same rules (DispatchService.receivingExceptionsOf); they are said here before the tap, so nobody stands at a gate with a
 * refusal and a truck waiting.
 */
export type FoundKind = 'short' | 'over' | 'damaged' | 'wrong';
export const FOUND_KINDS: readonly FoundKind[] = ['short', 'over', 'damaged', 'wrong'];

/** What the driver typed: a count for each kind (empty, or 0, is none), and a photograph of the damaged — and of the wrong, where taken. */
export interface FoundForm {
  counts: Record<FoundKind, string>;
  photos: Partial<Record<FoundKind, string>>;
}

export const noneFound = (): FoundForm => ({ counts: { short: '', over: '', damaged: '', wrong: '' }, photos: {} });

/** What each kind is called on the sheet, and what its photograph is called where it has one. */
export const FOUND_KEYS: Record<FoundKind, { label: MessageKey; photo?: MessageKey }> = {
  short: { label: 'driver.found.short' },
  over: { label: 'driver.found.over' },
  damaged: { label: 'driver.found.damaged', photo: 'driver.found.damagedPhoto' },
  wrong: { label: 'driver.found.wrong', photo: 'driver.found.wrongPhoto' },
};

/** A count as typed: a whole number, nothing for an empty box or 0, NaN for anything that is not a whole number. */
export function countOf(raw: string | undefined): number | undefined {
  const s = (raw ?? '').trim();
  if (!s) return undefined;
  if (!/^\d+$/.test(s)) return Number.NaN;
  const n = Number(s);
  return n === 0 ? undefined : n;
}

/** Why what was written cannot go on the note yet — in the order the server would say it — or null when it can. */
export type FoundProblem = { kind: 'count'; what: FoundKind } | { kind: 'photo' } | { kind: 'none_came'; packages: number } | { kind: 'more_than_came'; what: 'damaged' | 'wrong'; came: number } | null;

export function foundProblem(form: FoundForm, packages?: number): FoundProblem {
  for (const k of FOUND_KINDS) {
    const n = countOf(form.counts[k]);
    if (n !== undefined && !(Number.isInteger(n) && n <= 100_000)) return { kind: 'count', what: k };
  }
  const n = (k: FoundKind) => countOf(form.counts[k]) ?? 0;
  if (n('damaged') > 0 && !form.photos.damaged) return { kind: 'photo' };
  if (packages) {
    if (n('short') >= packages) return { kind: 'none_came', packages };
    const came = packages - n('short') + n('over');
    for (const k of ['damaged', 'wrong'] as const) if (n(k) > came) return { kind: 'more_than_came', what: k, came };
  }
  return null;
}

/**
 * The unload check as it stands once the receiver has said what they found: goods found damaged are not called intact —
 * "Cargo intact" comes off, and the damage goes on the note instead. The server asks exactly the same (requiredUnloadKeys).
 */
export function unloadItemsAfter<T extends { key: string }>(items: readonly T[], form: FoundForm, open: boolean): T[] {
  const damaged = open && (countOf(form.counts.damaged) ?? 0) > 0;
  return items.filter((i) => !(damaged && i.key === 'intact'));
}

/** What the delivery sends: each kind with a count, in the note's order, with its photograph. Nothing when nothing was found. */
export function foundBody(form: FoundForm): Array<{ kind: FoundKind; count: number; photoRefs?: string[] }> | undefined {
  const lines = FOUND_KINDS.flatMap((k) => {
    const n = countOf(form.counts[k]);
    if (n === undefined || !Number.isInteger(n)) return [];
    const photo = FOUND_KEYS[k].photo ? form.photos[k] : undefined;
    return [{ kind: k, count: n, ...(photo ? { photoRefs: [photo] } : {}) }];
  });
  return lines.length ? lines : undefined;
}
