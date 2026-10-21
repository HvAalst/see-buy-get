import type { Translate } from './i18n';

/**
 * Round 38 — THE CUSTODY CAP, as a capped shop or rider reads it (the user: "Count cap that grows"). A new shop holds at
 * most so many parcels at once here, a new independent rider carries at most so many; each limit grows by one with every
 * parcel handed on, and lifts after so many. Set by each country's company; the server says where the caller stands
 * (GET sbg/custody-cap), and nothing when no cap applies to them now.
 */
export interface CustodyCapView {
  capped: boolean;
  kind?: 'shop' | 'rider';
  holds?: number;
  cap?: number;
  completed?: number;
  liftedAfter?: number;
  /** Round 39 — a light courier whose ID nobody has seen yet: held at the start until somebody has. */
  idUnseen?: boolean;
}

/** The line a capped shop or rider reads — what they hold, the most they may now, how it grows. Null when nothing caps them. */
export function capLine(v: CustodyCapView | null | undefined, t: Translate): { title: string; detail: string; full: boolean } | null {
  if (!v?.capped || v.cap == null || v.holds == null) return null;
  const full = v.holds >= v.cap;
  const rider = v.kind === 'rider';
  // Round 39 — a rider whose ID nobody has seen: it does not grow yet, and what makes it grow is said instead.
  const grows = v.idUnseen ? t('common.cap.unseen') : t('common.cap.grows', { completed: v.completed ?? 0, lifted: v.liftedAfter ?? 0 });
  return {
    full,
    title: t(rider ? 'common.cap.riderTitle' : 'common.cap.shopTitle', { holds: v.holds, cap: v.cap }),
    detail: full ? `${t(rider ? 'common.cap.riderFull' : 'common.cap.shopFull')} ${grows}` : grows,
  };
}
