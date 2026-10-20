import type { MessageKey, Translate } from './i18n';
import { heldWhen } from './tamper';

/*
 * A LOAD HELD BY THE POLICE OR CUSTOMS (backend load-detention.types.ts): said by the driver carrying it, and let go the
 * same way. The driver's card, the shipper's row and the console say who holds it and where, in the driver's words; the
 * tracking page, which anybody with the label's key reads, says only that it is held on the way.
 */

export type HeldBy = 'police' | 'customs' | 'other';
export const HELD_BY: HeldBy[] = ['police', 'customs', 'other'];

export interface HeldByAuthorityView {
  by: HeldBy;
  who?: string;
  note?: string;
  since: string;
  receivedAt?: string;
  letGoAt?: string;
  letGoNote?: string;
}

const BY_KEY: Record<HeldBy, MessageKey> = {
  police: 'common.held.by.police',
  customs: 'common.held.by.customs',
  other: 'common.held.by.other',
};

/** "the police", "customs", "an authority". */
export function heldByWords(by: HeldBy, t: Translate): string {
  return t(BY_KEY[by] ?? BY_KEY.other);
}

/** "Held by the police (Traffic police, Athi River) since 20 Oct 10:42." — and, let go, until when. */
export function heldByLine(h: HeldByAuthorityView, t: Translate, when: (iso: string) => string = heldWhen): string {
  const by = heldByWords(h.by, t);
  const who = h.who ? ` (${h.who})` : '';
  return h.letGoAt ? t('common.held.wasLine', { by, who, since: when(h.since), until: when(h.letGoAt) }) : t('common.held.line', { by, who, since: when(h.since) });
}

/** The driver's form: who holds it, who and where in their words, anything else. */
export interface HeldForm {
  by: HeldBy | null;
  who: string;
  note: string;
}

export const EMPTY_HELD: HeldForm = { by: null, who: '', note: '' };

export function heldReady(f: HeldForm): boolean {
  return f.by !== null;
}

export function heldBody(f: HeldForm): { by: HeldBy; who?: string; note?: string } {
  return { by: f.by as HeldBy, ...(f.who.trim() ? { who: f.who.trim() } : {}), ...(f.note.trim() ? { note: f.note.trim() } : {}) };
}
