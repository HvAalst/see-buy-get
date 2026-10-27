import { formatMoney, type Translate } from '../../shared/i18n';

/**
 * STAFF WITHDRAW A PERSON'S PARCEL (the user, 2026-10-27: "Back to its shop, sender pays"). Not yet handed in, or still at
 * the shop it was handed in at: withdrawn there. At a hub: turned round to the shop it was handed in at, as a new parcel to
 * its sender, who pays the way back in cash there as they collect it. A store's parcel is the store's to call off.
 */
export interface WithdrawView {
  parcelId: string;
  outcome: 'void' | 'turn_round' | 'no';
  amount?: number;
  currency?: string;
  backTo?: string;
  atHub?: string;
  atShop?: string;
  why?: string;
}

export interface WithdrawnView {
  parcelId: string;
  status: string;
  outcome: 'void' | 'turn_round';
  amount?: number;
  currency?: string;
  returnParcelId?: string;
  backTo?: string;
  atHub?: string;
}

/** Where staff may ask at all: not yet handed in, at the shop it was handed in at, or at a hub. */
export const WITHDRAWABLE: ReadonlyArray<string> = ['Created', 'At_PUDO', 'At_MDP'];

/** What withdrawing it would do, in staff's words — said before they do it. */
export function withdrawSays(view: WithdrawView, t: Translate): string {
  if (view.outcome === 'no') return view.why ?? '';
  if (view.outcome === 'void') return view.atShop ? t('tower.withdraw.voidAtShop', { shop: view.atShop }) : t('tower.withdraw.voidBooked');
  return t('tower.withdraw.turnRound', { hub: view.atHub ?? '', shop: view.backTo ?? '', amount: formatMoney(view.amount ?? 0, view.currency) });
}

/** A few words at least: what staff write is kept on the parcel's history. */
export const withdrawReasonOk = (reason: string): boolean => reason.trim().length >= 3;
