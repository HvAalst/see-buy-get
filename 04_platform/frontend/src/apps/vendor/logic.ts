/**
 * Pure vendor domain logic — no DOM, no fetch, no Preact. Deterministic and unit-tested.
 * The mint wizard's gating, the order-status wording and the drop-off pricing rows decide
 * what a merchant is told their shipment costs and where it stands.
 */

import { toCsv } from '../../shared/csv';
import type { MessageKey, Translate } from '../../shared/i18n';
import { cash } from '../../shared/money';
import type { IconName } from '../../shared/ui/Icon';
import type { Measure } from '../../lib/sbg/personas/vendor';
import type { CheckoutRow, NetworkPoint, OrderRow, OriginOption, ParcelStatus, QuoteLegPrice, QuoteView, SettlementRow, ShippingPolicy } from './types';

/* ------------------------------------------------------------------ money -- */

/** Two decimals, in the money the server named for the figure; bare where it named none — what a box holds. */
export function money(v: number | null | undefined, currency?: string): string {
  return cash(v, currency);
}

/* ------------------------------------------------------------------- dock -- */

/**
 * What still blocks enabling the store's own dock, in the order the form asks it.
 *
 * The pin is required rather than defaulted to the storefront, because the two are genuinely different
 * places — a driver sent to the shop window of a warehouse whose gate is on the next street has made a
 * wasted trip, and the whole point of a dock is saving one.
 */
export function dockBlockers(
  f: { label: string; zone: string; point: { lat: number; lng: number } | null; bays: string },
  t: Translate,
): string | null {
  if (!f.label.trim()) return t('vendor.logic.dockLabel');
  if (!f.zone.trim()) return t('vendor.logic.dockZone');
  if (!f.point) return t('vendor.logic.dockPin');
  const bays = Number(f.bays);
  // Not `!bays`: a typed 0 is a real answer and a wrong one, and it must not fall through as "unset".
  if (!Number.isFinite(bays) || bays < 1) return t('vendor.logic.dockBays');
  return null;
}

/**
 * How full the dock floor is reading right now.
 *
 * Warn only when it is genuinely FULL, never merely busy: a store with two bays is at 50% the moment it
 * opens one bag, and colouring that as a problem would teach them to ignore the colour.
 */
export function stagingTone(s: { capacity: number; used: number; free: number }): 'ok' | 'warn' {
  return s.free <= 0 ? 'warn' : 'ok';
}

/* ----------------------------------------------------------------- policy -- */

/** The split policy in plain words — what the BUYER pays at checkout. */
export function policyLine(p: ShippingPolicy, t: Translate, currency?: string): string {
  if (p.mode === 'full') return t('vendor.logic.policyFull');
  return t('vendor.logic.policyCapped', { cap: money(p.buyerContributionCap, currency), free: money(p.freeOverSubtotal, currency) });
}

/** The insurer on the policy, in a sentence — or that there is none, and what that means. */
export function insurerLine(p: Pick<ShippingPolicy, 'insurer'>, t: Translate): string {
  return p.insurer ? t('vendor.logic.insurer', { name: p.insurer.name, email: p.insurer.email }) : t('vendor.logic.noInsurer');
}

/** One damage claim report in the store's list: who reported it, and whether it went to the insurer. */
export function reportRowLine(row: { origin: 'buyer' | 'counter'; madeAt: string; insurer?: { insurer: string } }, t: Translate): string {
  const by = t(row.origin === 'counter' ? 'vendor.reports.byShop' : 'vendor.reports.byReceiver');
  const when = new Date(row.madeAt).toLocaleDateString();
  return row.insurer ? t('vendor.reports.lineSent', { by, when, insurer: row.insurer.insurer }) : t('vendor.reports.lineKept', { by, when });
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
    case 'Unclaimed':
      // The store's word for it, not the network's: what a merchant needs to know is that their customer
      // has not come, which is a thing they may have to act on rather than a state machine label.
      return { word: t('vendor.status.unclaimed'), icon: 'clock', tone: 'warn' };
    case 'Ready_For_Pickup':
      return { word: t('vendor.status.ready'), icon: 'box', tone: 'ok' };
    case 'Delivered':
      return { word: t('vendor.status.delivered'), icon: 'check', tone: 'ok' };
    case 'Disputed':
      return { word: t('vendor.status.disputed'), icon: 'warning', tone: 'danger' };
    case 'Voided':
      return { word: t('vendor.status.voided'), icon: 'block', tone: 'danger' };
    case 'Returned':
      return { word: t('vendor.status.returned'), icon: 'repeat', tone: 'info' };
    case 'Lost':
      return { word: t('vendor.status.lost'), icon: 'warning', tone: 'danger' };
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
  /** FP8 — box 13 for an order that ships as freight: what the driver needs at the door, and when. Ignored for a parcel. */
  instructions: string;
  deliveryWindow: string;
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
  instructions: '',
  deliveryWindow: '',
};

/** All four measurements present and positive — the classify call's gate. */
export function dimsComplete(f: Pick<MintForm, 'l' | 'w' | 'h' | 'kg'>): boolean {
  return [f.l, f.w, f.h, f.kg].every((v) => Number(v) > 0);
}

/**
 * The typed measurements as numbers, or undefined while the form is still incomplete.
 *
 * ITEM 9 — this is what makes the quote price the parcel the store actually measured instead of the tier
 * it fell into, and it is the SAME gate as the classify call so the price and the tier can never be
 * derived from different halves of a half-filled form.
 */
export function measureOf(f: Pick<MintForm, 'l' | 'w' | 'h' | 'kg'>): Measure | undefined {
  return dimsComplete(f) ? { l: Number(f.l), w: Number(f.w), h: Number(f.h), kg: Number(f.kg) } : undefined;
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
  /** The money the total is in: the quote’s. */
  currency?: string;
}

/**
 * The drop-off picker: every OPEN shop, priced against the buyer's destination where a
 * route exists, CHEAPEST FIRST; unroutable shops sink to the bottom rather than vanish —
 * a merchant standing next to one deserves to see why it offers no price.
 */
export function originRows(points: NetworkPoint[] | null, destDid: string, options: OriginOption[] | null): OriginRow[] {
  const quotes = new Map((options ?? []).map((o) => [o.did, o.quote]));
  return (points ?? [])
    .filter((p) => p.did !== destDid && p.openState === 'open' && p.takesNew !== false)
    .map((point) => {
      const quote = quotes.get(point.did);
      return { point, total: quote?.locked.total ?? null, ...(quote?.currency ? { currency: quote.currency } : {}) };
    })
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

/**
 * WHAT THE STORE WILL BE BILLED, which is not what the network earns.
 *
 * `total` is the price before tax — the figure the margin question is asked of. The balance is charged
 * `gross`, tax and all, so a console showing `total` quotes one number and bills another the moment any
 * sister sets a tax rate. It reads as correct today only because every rate is still zero.
 *
 * Falls back to `total` for a quote taken before the tax seam existed, where the two were the same
 * number to the cent.
 */
export function chargeOf(leg: QuoteLegPrice): number {
  return leg.gross ?? leg.total;
}

/**
 * The breakdown a MERCHANT gets: the one platform fee line, and the tax, when there is any.
 *
 * Never the three layers the fee is made of — that split is for running the business and is not
 * customer-facing on either side. And nothing that reads zero: a line saying "Tax 0.00" on every order in
 * a country that charges none is noise a store learns to skip past, which is how the line that matters
 * gets skipped too.
 */
export function feeLines(leg: QuoteLegPrice, t: Translate): Array<{ label: string; amount: number }> {
  const out: Array<{ label: string; amount: number }> = [];
  if (leg.fee) out.push({ label: t('vendor.price.platformFee'), amount: leg.fee });
  if (leg.tax) out.push({ label: t('vendor.price.tax'), amount: leg.tax });
  return out;
}

export function priceCards(q: QuoteView, t: Translate): PriceCard[] {
  return [
    { key: 'locked', title: t('vendor.price.cheapest'), sub: t('vendor.price.cheapestSub'), total: chargeOf(q.locked) },
    { key: 'flexible', title: t('vendor.price.fastest'), sub: t('vendor.price.fastestSub'), total: chargeOf(q.flexible) },
  ];
}

/* --------------------------------------------------------------- speaking -- */

export function ordersSummary(balance: number, open: number, unpaid: number, t: Translate, currency?: string): string {
  const base = t(open === 1 ? 'vendor.logic.ordersSummaryOne' : 'vendor.logic.ordersSummaryMany', { balance: money(balance, currency), open });
  const tail = unpaid ? ' ' + t(unpaid === 1 ? 'vendor.logic.ordersUnpaidOne' : 'vendor.logic.ordersUnpaidMany', { count: unpaid }) : '';
  return base + tail;
}

/* -------------------------------------------------------------------- export -- */

/** The vendor export columns — SAME set + order as the server's whole-set export (vendorOrdersToCsv), so a
 *  client "export selected" and a server "export all" are byte-identical. The collection code (the handover
 *  secret) is deliberately NOT a column. */
export const ORDER_CSV_HEADERS = ['Order', 'Shipment DID', 'Buyer', 'Products', 'Status', 'Paid', 'Destination', 'Shipping cost', 'Buyer charge', 'Currency', 'Created'];

/** Render the given (already-selected) shipment rows to CSV for a client-side download. */
export function orderRowsToCsv(rows: OrderRow[]): string {
  return toCsv(
    ORDER_CSV_HEADERS,
    // Currency comes from the ROW, not from a constant: the server stamps each parcel with the money it
    // was sold in, and the two exports have to agree column for column or "export all" and "export
    // selected" are different files.
    rows.map((o) => [o.externalOrderId ?? o.parcelId, o.did ?? '', o.buyer ?? '', o.products ?? '', o.status, o.paidStatus ?? '', o.destZone, o.shipmentCost ?? '', o.buyerCharge ?? '', o.currency ?? '', o.createdAt ?? '']),
  );
}

/* --------------------------------------------------------------- bookkeeping -- */

/** The merchant's word for a ledger entry type — the shipment billing reads as "Shipment". For ON-SCREEN
 *  display (translated); the CSV export deliberately keeps English (see ledgerRowsToCsv). */
export function ledgerTypeWord(type: SettlementRow['type'], t: Translate): string {
  // A chain, not a fallback: a new row type arriving here used to render as 'Rebate', which is a wrong
  // word rather than a missing one — the worst way for a register to be out of date.
  if (type === 'TOP_UP') return t('vendor.ledger.typeTopUp');
  if (type === 'TOP_UP_FEE') return t('vendor.ledger.typeTopUpFee');
  if (type === 'BILLING') return t('vendor.ledger.typeShipment');
  if (type === 'REBATE') return t('vendor.ledger.typeRebate');
  return type;
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

/**
 * THE LIVE LINE in the top bar — the orders this store still has to deal with.
 *
 * It replaced the store's own name, which is fixed for the session. Unpaid comes first because it is
 * the one that blocks: an unpaid order has no label and is not moving, and no amount of shipping
 * activity fixes it.
 */
export function vendorWorkLine(stats: { unpaid?: number; active?: number } | null, t: Translate): string | undefined {
  if (!stats) return undefined;
  const bits = [
    stats.unpaid ? t('vendor.bar.unpaid', { count: stats.unpaid }) : null,
    stats.active ? t('vendor.bar.inFlight', { count: stats.active }) : null,
  ].filter(Boolean);
  return bits.length ? bits.join(' · ') : t('vendor.bar.clear');
}

/* ----------------------------------------------------------- the store's account -- */

/**
 * What stops an email and a password being a store's account — said before the server has to. Eight characters is
 * the server's own floor for a password somebody chooses for an account that already exists.
 */
export function accountBlocker(email: string, password: string): MessageKey | null {
  if (!/^\S+@\S+\.\S+$/.test(email.trim())) return 'vendor.account.needEmail';
  if (password.length < 8) return 'vendor.account.needPassword';
  return null;
}

/**
 * IS THIS STORE STILL SIGNING IN WITH ITS SECRET? Only when the server has SAID it has no account: not known yet is
 * not "no", and a store must not be told to set up an account it already has.
 */
export function needsAccount(vendor: { hasAccount?: boolean } | null | undefined): boolean {
  return vendor?.hasAccount === false;
}
