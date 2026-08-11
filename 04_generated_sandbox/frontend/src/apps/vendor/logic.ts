/**
 * Pure vendor domain logic — no DOM, no fetch, no Preact. Deterministic and unit-tested.
 * The mint wizard's gating, the order-status wording and the drop-off pricing rows decide
 * what a merchant is told their shipment costs and where it stands.
 */

import { toCsv } from '../../shared/csv';
import type { Translate } from '../../shared/i18n';
import type { IconName } from '../../shared/ui/Icon';
import type { CheckoutRow, NetworkPoint, OrderRow, OriginOption, ParcelStatus, QuoteView, SettlementRow, ShippingPolicy } from './types';

/* ------------------------------------------------------------------ money -- */

export function money(v: number | null | undefined): string {
  return (Number(v) || 0).toFixed(2);
}

/* ----------------------------------------------------------------- policy -- */

/** The split policy in plain words — what the BUYER pays at checkout. */
export function policyLine(p: ShippingPolicy, t: Translate): string {
  if (p.mode === 'full') return t('vendor.logic.policyFull');
  return t('vendor.logic.policyCapped', { cap: money(p.buyerContributionCap), free: money(p.freeOverSubtotal) });
}

/* ----------------------------------------------------------------- status -- */

export interface StatusPresentation {
  word: string;
  icon: IconName;
  tone: 'ok' | 'info' | 'warn' | 'danger';
}

/** The order ladder as the MERCHANT reads it. */
export function orderStatus(status: ParcelStatus, t: Translate): StatusPresentation {
  switch (status) {
    case 'Created':
      return { word: t('vendor.status.created'), icon: 'edit', tone: 'warn' };
    case 'At_PUDO':
      return { word: t('vendor.status.atPudo'), icon: 'home', tone: 'info' };
    case 'On_Bus':
      return { word: t('vendor.status.onBus'), icon: 'truck', tone: 'info' };
    case 'At_MDP':
      return { word: t('vendor.status.atMdp'), icon: 'grid', tone: 'info' };
    case 'Ready_For_Pickup':
      return { word: t('vendor.status.ready'), icon: 'box', tone: 'ok' };
    case 'Delivered':
      return { word: t('vendor.status.delivered'), icon: 'check', tone: 'ok' };
    case 'Disputed':
      return { word: t('vendor.status.disputed'), icon: 'warning', tone: 'danger' };
    case 'Voided':
      return { word: t('vendor.status.voided'), icon: 'block', tone: 'danger' };
  }
}

export function paidWord(paidStatus: string, t: Translate): { word: string; tone: 'ok' | 'warn' } {
  return paidStatus === 'ParcelPaid' ? { word: t('vendor.paid.paid'), tone: 'ok' } : { word: t('vendor.paid.unpaid'), tone: 'warn' };
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
export function mintMissing(f: MintForm, t: Translate): string | null {
  if (!dimsComplete(f)) return t('vendor.mint.missDims');
  if (!f.photoRef) return t('vendor.mint.missPhoto');
  if (!f.destDid) return t('vendor.mint.missDest');
  if (!f.originDid) return t('vendor.mint.missOrigin');
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

export function handoffLine(c: CheckoutRow, t: Translate): string {
  let items: string;
  if (c.items?.length) {
    const count = c.items.reduce((n, i) => n + i.qty, 0);
    const one = c.items.length === 1 && c.items[0].qty === 1;
    items = t(one ? 'vendor.logic.handoffItemOne' : 'vendor.logic.handoffItemMany', { count });
  } else {
    items = t('vendor.logic.handoffOrder');
  }
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

export function priceCards(q: QuoteView, t: Translate): PriceCard[] {
  return [
    { key: 'locked', title: t('vendor.price.cheapest'), sub: t('vendor.price.cheapestSub'), total: q.locked.total },
    { key: 'flexible', title: t('vendor.price.fastest'), sub: t('vendor.price.fastestSub'), total: q.flexible.total },
  ];
}

/* --------------------------------------------------------------- speaking -- */

export function ordersSummary(balance: number, open: number, unpaid: number, t: Translate): string {
  const base = t(open === 1 ? 'vendor.logic.ordersSummaryOne' : 'vendor.logic.ordersSummaryMany', { balance: money(balance), open });
  const tail = unpaid ? ' ' + t(unpaid === 1 ? 'vendor.logic.ordersUnpaidOne' : 'vendor.logic.ordersUnpaidMany', { count: unpaid }) : '';
  return base + tail;
}

/* -------------------------------------------------------------------- export -- */

/** The vendor export columns — SAME set + order as the server's whole-set export (vendorOrdersToCsv), so a
 *  client "export selected" and a server "export all" are byte-identical. The collection code (the handover
 *  secret) is deliberately NOT a column. */
export const ORDER_CSV_HEADERS = ['Order', 'Shipment DID', 'Buyer', 'Products', 'Status', 'Paid', 'Destination', 'Shipping cost', 'Buyer charge', 'Created'];

/** Render the given (already-selected) shipment rows to CSV for a client-side download. */
export function orderRowsToCsv(rows: OrderRow[]): string {
  return toCsv(
    ORDER_CSV_HEADERS,
    rows.map((o) => [o.externalOrderId ?? o.parcelId, o.did ?? '', o.buyer ?? '', o.products ?? '', o.status, o.paidStatus ?? '', o.destZone, o.shipmentCost ?? '', o.buyerCharge ?? '', o.createdAt ?? '']),
  );
}

/* --------------------------------------------------------------- bookkeeping -- */

/** The merchant's word for a ledger entry type — the shipment billing reads as "Shipment". For ON-SCREEN
 *  display (translated); the CSV export deliberately keeps English (see ledgerRowsToCsv). */
export function ledgerTypeWord(type: SettlementRow['type'], t: Translate): string {
  return type === 'TOP_UP' ? t('vendor.ledger.typeTopUp') : type === 'BILLING' ? t('vendor.ledger.typeShipment') : t('vendor.ledger.typeRebate');
}

/** The bookkeeping export columns — SAME set + order as the server's ledger export (vendorLedgerToCsv), so a
 *  client "export selected" and a server "export all" are byte-identical. Amount is a SIGNED number. */
export const LEDGER_CSV_HEADERS = ['Date', 'Type', 'Direction', 'Amount', 'Parcel', 'Note'];

export function ledgerRowsToCsv(rows: SettlementRow[]): string {
  // The Type column mirrors the SERVER's English export byte-for-byte (NOT locale-translated) so a client
  // "export selected" equals a server "export all"; the on-screen word translates via ledgerTypeWord(t).
  const csvType = (type: SettlementRow['type']) => (type === 'TOP_UP' ? 'Top-up' : type === 'BILLING' ? 'Shipment' : 'Rebate');
  return toCsv(
    LEDGER_CSV_HEADERS,
    rows.map((s) => [s.at, csvType(s.type), s.sign === '+' ? 'in' : 'out', s.sign === '+' ? s.amount : -s.amount, s.parcelId ?? '', s.note ?? '']),
  );
}
