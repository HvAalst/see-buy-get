import type { components } from '../../lib/sbg';
import type { Translate } from '../../shared/i18n';
import type { ParcelRow } from './types';

/*
 * 2026-11-18 — PARCELS ABROAD AT A HUB (parcels across a border, step 2c): what the floor has to do with each — hand it to the
 * route's carrier, receive it from them, record customs' decision, or keep it held — kept apart from the card so it can be tested.
 */
export type AbroadRow = components['schemas']['AbroadParcelRow'];

/** The parcels to hand over, by the carrier taking them; the rest by what is to be done. */
export function abroadGroups(rows: AbroadRow[]): { toHand: Array<{ carrier: string; rows: AbroadRow[] }>; coming: AbroadRow[]; customs: AbroadRow[]; held: AbroadRow[] } {
  const byCarrier = new Map<string, AbroadRow[]>();
  for (const r of rows.filter((x) => x.step === 'to_hand')) byCarrier.set(r.carrier, [...(byCarrier.get(r.carrier) ?? []), r]);
  return {
    toHand: [...byCarrier.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([carrier, list]) => ({ carrier, rows: list })),
    coming: rows.filter((r) => r.step === 'coming'),
    customs: rows.filter((r) => r.step === 'customs'),
    held: rows.filter((r) => r.step === 'held'),
  };
}

/** One parcel abroad, in one line: where it goes, by which airports, its seal. */
export function abroadLine(r: AbroadRow, t: Translate): string {
  return t('mdp.abroad.row', { parcel: r.parcelId, country: r.toName, departure: r.departure, arrival: r.arrival, seal: r.seal });
}

/** A held parcel: what customs asks, and its reference; to whom and by when (step 3); or not paid in time. */
export function heldAbroadLine(r: AbroadRow, t: Translate): string {
  if (!r.held) return '';
  const line = t('mdp.abroad.heldLine', { amount: r.held.amount.toFixed(2), currency: r.held.currency, reference: r.held.reference });
  if (r.held.lapsed) return `${line} · ${t('mdp.abroad.lapsed')}`;
  return r.held.payee && r.held.payBy ? `${line} · ${t('mdp.abroad.payTo', { payee: r.held.payee, date: r.held.payBy.slice(0, 10) })}` : line;
}

/** The parcels on this floor never offered to sort: held under the tamper protocol, or set aside for the route abroad. */
export function setAsideIds(inbound: ParcelRow[], mdpId: string | undefined): Set<string> {
  return new Set(inbound.filter((p) => p.atMdpId === mdpId && (p.held || p.abroadAside)).map((p) => p.parcelId));
}
