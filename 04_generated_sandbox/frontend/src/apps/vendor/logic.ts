/**
 * Pure vendor domain logic — no DOM, no fetch, no Preact. Deterministic and unit-tested.
 * The mint wizard's gating, the order-status wording and the drop-off pricing rows decide
 * what a merchant is told their shipment costs and where it stands.
 */

import type { IconName } from '../../shared/ui/Icon';
import type { CheckoutRow, NetworkPoint, OriginOption, ParcelStatus, QuoteView, ShippingPolicy } from './types';

/* ------------------------------------------------------------------ money -- */

export function money(v: number | null | undefined): string {
  return (Number(v) || 0).toFixed(2);
}

/* ----------------------------------------------------------------- policy -- */

/** The split policy in plain words — what the BUYER pays at checkout. */
export function policyLine(p: ShippingPolicy): string {
  if (p.mode === 'full') return 'The buyer pays the whole shipping price at checkout.';
  return `The buyer pays at most ${money(p.buyerContributionCap)} — free for them on orders over ${money(p.freeOverSubtotal)}. Your store absorbs the rest.`;
}

/* ----------------------------------------------------------------- status -- */

export interface StatusPresentation {
  word: string;
  icon: IconName;
  tone: 'ok' | 'info' | 'warn' | 'danger';
}

/** The order ladder as the MERCHANT reads it. */
export function orderStatus(status: ParcelStatus): StatusPresentation {
  switch (status) {
    case 'Created':
      return { word: 'Label made — drop it off', icon: 'edit', tone: 'warn' };
    case 'At_PUDO':
      return { word: 'At the drop-off shop', icon: 'home', tone: 'info' };
    case 'On_Bus':
      return { word: 'On the bus', icon: 'truck', tone: 'info' };
    case 'At_MDP':
      return { word: 'At the sort hub', icon: 'grid', tone: 'info' };
    case 'Ready_For_Pickup':
      return { word: 'Ready for the buyer', icon: 'box', tone: 'ok' };
    case 'Delivered':
      return { word: 'Collected', icon: 'check', tone: 'ok' };
    case 'Disputed':
      return { word: 'Problem reported', icon: 'warning', tone: 'danger' };
    case 'Voided':
      return { word: 'Cancelled', icon: 'block', tone: 'danger' };
  }
}

export function paidWord(paidStatus: string): { word: string; tone: 'ok' | 'warn' } {
  return paidStatus === 'ParcelPaid' ? { word: 'Paid', tone: 'ok' } : { word: 'Unpaid', tone: 'warn' };
}

/* ------------------------------------------------------------------- mint -- */

export interface MintForm {
  checkoutId: string | null;
  destDid: string;
  originDid: string;
  l: string;
  w: string;
  h: string;
  kg: string;
  derivedSize: string | null;
  dedicatedCargo: boolean; // S32c — the load classified P4+ (needs dedicated freight, not the parcel network)
  photoRef: string;
  fragile: boolean;
  routeMode: 'flexible' | 'locked';
  buyerMobile: string;
  buyerEmail: string;
  externalOrderId: string;
}

export const EMPTY_MINT: MintForm = {
  checkoutId: null,
  destDid: '',
  originDid: '',
  l: '',
  w: '',
  h: '',
  kg: '',
  derivedSize: null,
  dedicatedCargo: false,
  photoRef: '',
  fragile: false,
  routeMode: 'locked',
  buyerMobile: '',
  buyerEmail: '',
  externalOrderId: '',
};

/** All four measurements present and positive — the classify call's gate. */
export function dimsComplete(f: Pick<MintForm, 'l' | 'w' | 'h' | 'kg'>): boolean {
  return [f.l, f.w, f.h, f.kg].every((v) => Number(v) > 0);
}

/** What still blocks the mint, in wizard order — the CTA subtitle reads it out. */
export function mintMissing(f: MintForm): string | null {
  if (!dimsComplete(f)) return 'Measure the parcel — length, width, height and weight.';
  if (!f.photoRef) return 'Take the contents photo.';
  if (!f.destDid) return 'Pick where the buyer collects.';
  if (!f.originDid) return 'Pick your drop-off shop.';
  return null;
}

/** Prefill from a captured checkout handoff — the buyer already chose the destination. */
export function fromHandoff(f: MintForm, c: CheckoutRow): MintForm {
  return {
    ...f,
    checkoutId: c.id,
    destDid: c.destAgentDid,
    buyerMobile: c.buyerMobile ?? '',
    buyerEmail: c.buyerEmail,
    externalOrderId: c.externalOrderId ?? '',
  };
}

export function handoffLine(c: CheckoutRow): string {
  const items = c.items?.length ? `${c.items.reduce((n, i) => n + i.qty, 0)} item${c.items.length === 1 && c.items[0].qty === 1 ? '' : 's'}` : 'order';
  const ref = c.externalOrderId ? ` · ${c.externalOrderId}` : '';
  return `${items}${ref} · ${c.buyerEmail}`;
}

/* ---------------------------------------------------------------- origins -- */

export interface OriginRow {
  point: NetworkPoint;
  total: number | null;
}

/**
 * The drop-off picker: every OPEN shop, priced against the buyer's destination where a
 * route exists, CHEAPEST FIRST; unroutable shops sink to the bottom rather than vanish —
 * a merchant standing next to one deserves to see why it offers no price.
 */
export function originRows(points: NetworkPoint[] | null, destDid: string, options: OriginOption[] | null): OriginRow[] {
  const totals = new Map((options ?? []).map((o) => [o.did, o.quote?.locked.total ?? null]));
  return (points ?? [])
    .filter((p) => p.did !== destDid && p.openState === 'open')
    .map((point) => ({ point, total: totals.get(point.did) ?? null }))
    .sort((a, b) => {
      if (a.total === null && b.total === null) return a.point.shopName.localeCompare(b.point.shopName);
      if (a.total === null) return 1;
      if (b.total === null) return -1;
      return a.total - b.total;
    });
}

/** The two ways to buy the journey, cheapest first — same rule as the Send app. */
export interface PriceCard {
  key: 'locked' | 'flexible';
  title: string;
  sub: string;
  total: number;
}

export function priceCards(q: QuoteView): PriceCard[] {
  return [
    { key: 'locked', title: 'Cheapest', sub: 'Waits for the lowest-price bus', total: q.locked.total },
    { key: 'flexible', title: 'Fastest', sub: 'Any bus can take it — unused ceiling comes back', total: q.flexible.total },
  ];
}

/* --------------------------------------------------------------- speaking -- */

export function ordersSummary(balance: number, open: number, unpaid: number): string {
  return (
    `Balance ${money(balance)}. ${open} order${open === 1 ? '' : 's'} on the move.` +
    (unpaid ? ` ${unpaid} unpaid — top up to release ${unpaid === 1 ? 'it' : 'them'}.` : '')
  );
}
