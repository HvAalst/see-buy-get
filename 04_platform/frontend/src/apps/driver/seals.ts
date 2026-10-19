import type { SealToFind } from '../../shared/seals';
import type { Claimable } from './types';

/**
 * ROUND 15 — the driver's part in a load's seals, as the gates judge it: every seal read and photographed at pickup and
 * none found to be another number; clearing a border, the seals as they were or which customs replaced (each with its
 * new number and photograph). The server judges the same again; these keep the button honest, signal or not.
 */

/** One seal read at pickup: the number as read, its close-up, and whether it is the number written (null: not checked). */
export interface SealRead {
  number: string;
  photoRef: string;
  ok: boolean | null;
}

export const sealsOn = (claim: Pick<Claimable, 'seals'>): SealToFind[] => (claim.seals ?? []).filter((s) => s.state === 'on');

/** Every seal on the load read, photographed, and not found to be another number. */
export function pickupSealsReady(claim: Pick<Claimable, 'seals'>, reads: Record<string, SealRead>): boolean {
  return sealsOn(claim).every((s) => Boolean(reads[s.sealId]?.number.trim() && reads[s.sealId]?.photoRef) && reads[s.sealId]?.ok !== false);
}

/** What the driver says of the seals on clearing a border. */
export interface SealsAtPost {
  asTheyWere: boolean | null;
  replaced: Record<string, { newNumber: string; photoRef: string; officer: string }>;
}
export const EMPTY_AT_POST: SealsAtPost = { asTheyWere: null, replaced: {} };

export function atPostReady(claim: Pick<Claimable, 'seals'>, v: SealsAtPost): boolean {
  if (!sealsOn(claim).length) return true;
  if (v.asTheyWere === true) return true;
  const chosen = Object.values(v.replaced);
  return v.asTheyWere === false && chosen.length > 0 && chosen.every((r) => Boolean(r.newNumber.trim() && r.photoRef));
}

export function atPostBody(claim: Pick<Claimable, 'seals'>, v: SealsAtPost): { asTheyWere?: boolean; replaced?: Array<{ sealId: string; newNumber: string; photoRef: string; officer?: string }> } | undefined {
  if (!sealsOn(claim).length) return undefined;
  if (v.asTheyWere) return { asTheyWere: true };
  return { replaced: Object.entries(v.replaced).map(([sealId, r]) => ({ sealId, newNumber: r.newNumber.trim(), photoRef: r.photoRef, ...(r.officer.trim() ? { officer: r.officer.trim() } : {}) })) };
}
