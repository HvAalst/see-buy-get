import { useT } from '../../../shared/i18n';
import { Pill } from '../../../shared/ui';
import type { ParcelRow } from '../types';

/**
 * 2026-11-06 — LATE, OR ON TIME (the owner: "when we show 'late' we can also show 'on time'"): beside a parcel in the
 * hub's queue, against the time it was promised — said by the server, which knows the promise and the plan as made again.
 * Nothing where it has no plan to measure against.
 */
export function DueTag({ due }: { due?: ParcelRow['due'] }) {
  const t = useT();
  if (!due) return null;
  return due === 'late' ? <Pill tone="warn">{t('mdp.due.late')}</Pill> : <Pill tone="ok">{t('mdp.due.onTime')}</Pill>;
}

/** Each parcel's late-or-on-time by its id, from the hub's list. */
export function dueById(rows: ParcelRow[]): Map<string, NonNullable<ParcelRow['due']>> {
  const out = new Map<string, NonNullable<ParcelRow['due']>>();
  for (const r of rows) if (r.due) out.set(r.parcelId, r.due);
  return out;
}
