import type { MessageKey } from './i18n';

/**
 * D9 (assessment.html; the user, 2026-10-25: "Yes, A then B") — WHAT THE RECEIVER FOUND AT THE HANDOVER, as a party to the
 * load reads it (backend ReceivingExceptionView): packages short, more than the note says, damaged, not the goods the note
 * describes — the photographs on the note counted, never handed out. Said one way in every app that shows it: the
 * receiver's Coming in, the sender's Loads, the counter's freight list.
 */
export type FoundKind = 'short' | 'over' | 'damaged' | 'wrong' | 'refused';

export interface FoundLine {
  kind: FoundKind;
  count: number;
  photos: number;
}

const KEYS: Record<FoundKind, MessageKey> = {
  short: 'common.found.short',
  over: 'common.found.over',
  damaged: 'common.found.damaged',
  wrong: 'common.found.wrong',
  // A part the receiver refused (2026-10-27): the rest was delivered, the sender decides where these go.
  refused: 'common.found.refused',
};

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

/** "3 packages short, 2 packages damaged" — in the note's order. Empty where nothing was found; a kind this build does not know is left out. */
export function foundWords(lines: readonly FoundLine[] | undefined, t: Translate): string {
  return (lines ?? [])
    .filter((l) => l.kind in KEYS)
    .map((l) => t(KEYS[l.kind], { n: l.count }))
    .join(', ');
}

/** How many photographs of it are on the note. */
export function foundPhotos(lines: readonly FoundLine[] | undefined): number {
  return (lines ?? []).reduce((n, l) => n + (l.photos ?? 0), 0);
}
