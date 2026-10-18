import type { Translate } from '../../shared/i18n';

/*
 * LOST, DECLARED BY STAFF AFTER A SEARCH (backend lost-parcel.service.ts; the user, 2026-10-18). A parcel not seen for a
 * week opens a search case; staff declare it lost from the case with where they looked, and mark it found when it turns
 * up. Who did each is staff's record.
 */

export interface LostAct {
  act: 'declared' | 'found';
  by: string;
  at: string;
  words: string;
}

export interface LostParcelRow {
  parcelId: string;
  status: string;
  declaredAt?: string;
  reason?: string;
  lastSeenAt?: string;
  foundAt?: string;
  foundNote?: string;
  from?: string;
  to?: string;
  acts: LostAct[];
}

/** The flag kind whose case is the search: the one a parcel can be declared lost from. */
export const SEARCH_KIND = 'Not_Seen';

/** The sender reads what is written, so a word or two is not enough: where you looked, and what you found. */
export const LOST_REASON_MIN = 10;

export function lostReasonBlocker(reason: string, t: Translate): string | null {
  return reason.trim().length < LOST_REASON_MIN ? t('tower.lost.reasonShort') : null;
}

/** One line under a lost parcel: who declared it and when — and, once it turned up, who found it. */
export function lostLine(row: LostParcelRow, t: Translate, day: (iso: string) => string): string {
  const declared = row.acts.find((a) => a.act === 'declared');
  const found = row.acts.find((a) => a.act === 'found');
  const parts = [declared ? t('tower.lost.declaredBy', { name: declared.by, when: day(declared.at) }) : row.declaredAt ? t('tower.lost.declaredOn', { when: day(row.declaredAt) }) : ''];
  if (row.foundAt) parts.push(found ? t('tower.lost.foundBy', { name: found.by, when: day(row.foundAt) }) : t('tower.lost.foundOn', { when: day(row.foundAt) }));
  return parts.filter(Boolean).join(' · ');
}
