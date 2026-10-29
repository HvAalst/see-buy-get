/**
 * STORES, AS NETWORK STAFF FIND AND OPEN THEM.
 *
 * A store rings because its labels stopped printing, or its system was never told a parcel arrived. Until
 * this screen the console had no list of stores at all: staff could confirm a store's payment under Money
 * in, and could not look the store up. Everything here is what the server chose to send for the purpose —
 * no signing secret, no buyer, no whole phone number — so there is nothing on this screen to hide.
 *
 * Pure, so the finding and the "what is wrong with this store" reading are tested without a browser.
 */

export interface StoreRow {
  vendorId: string;
  name: string;
  country: string;
  /** The company of ours that settles it. Absent where we only match in its country. */
  companyName?: string;
  /** NULL where it has no till with us — a different fact from an empty one. */
  balance: number | null;
  currency?: string;
  hasAccount: boolean;
  hasCallback: boolean;
  hasDock: boolean;
  address?: string;
  createdAt: string;
  /** A business's parcel account (2026-10-29): it sends from the Business app, and nobody signs in to it as a store. */
  forBusiness?: boolean;
}

export type CallbackState = 'pending' | 'delivered' | 'failed';

export interface StoreDesk extends StoreRow {
  signIn: { hasAccount: boolean; secretRotatedAt?: string };
  contact: { phoneEnding?: string };
  money: {
    open: Array<{ reference: string; amount: number; currency: string; openedAt: string }>;
    recent: Array<{ type: 'TOP_UP' | 'TOP_UP_FEE' | 'BILLING' | 'REBATE' | 'CLAIM'; sign: '+' | '-'; amount: number; currency: string; parcelId?: string; at: string }>;
  };
  shipments: { total: number; unpaid: number; active: number; recent: Array<{ parcelId: string; externalOrderId?: string; status: string; paid: boolean; destZone: string; at: string }> };
  callbacks: {
    url?: string;
    carriesCode: boolean;
    pending: number;
    failed: number;
    delivered: number;
    lastDeliveredAt?: string;
    recent: Array<{ event: string; at: string; state: CallbackState; attempts: number; nextTryAt?: string; deliveredAt?: string; lastError?: string }>;
  };
  keys: Array<{ keyId: string; kind: 'publishable' | 'secret'; mode: 'test' | 'live'; label?: string; hint: string; createdAt: string; lastUsedAt?: string; revokedAt?: string }>;
  dock: { label: string; zone: string; bays: number; enabledAt: string } | null;
  returnsWaiting: number;
  reputation: { shipments: number; average: number; count: number; isNew: boolean };
}

/** How many stores a page of the list holds. */
export const STORES_PAGE = 20;

/** By name, the way somebody on the phone gives it. The list it was handed is left as it was. */
export function storesInOrder<T extends Pick<StoreRow, 'name' | 'vendorId'>>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }) || a.vendorId.localeCompare(b.vendorId));
}

/**
 * FIND A STORE by what a caller can say: its name, its store number, the street it is on, its country, or
 * the company of ours it pays. Every word typed has to be found somewhere, in any order, so "threads ke"
 * finds Nairobi Threads in Kenya and "threads ug" finds nothing. Nothing typed is everything.
 */
export function findStores<T extends StoreRow>(rows: T[], query: string): T[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return rows;
  return rows.filter((r) => {
    const hay = [r.name, r.vendorId, r.address, r.country, r.companyName].filter(Boolean).join(' ').toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}

/** One page of what was found, and how many pages there are. A page past the end reads as the last one. */
export function storePage<T>(rows: T[], page: number, size: number = STORES_PAGE): { shown: T[]; page: number; pages: number } {
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const at = Math.min(Math.max(0, page), pages - 1);
  return { shown: rows.slice(at * size, at * size + size), page: at, pages };
}

/** The float as a row can say it: none held here, empty, or the figure. Which of the three matters more than the number. */
export type FloatState = 'none' | 'empty' | 'held';

export function floatState(row: Pick<StoreRow, 'balance'>): FloatState {
  if (row.balance === null) return 'none';
  return row.balance > 0 ? 'held' : 'empty';
}

/**
 * WHAT IS LIKELY WRONG, read off the store before anybody asks — in the order a caller would complain of
 * it. Each is a fact with a remedy on this screen or the store's own, never a judgement:
 *   - `unpaid`      labels are waiting on its float (the commonest call: "my labels will not print");
 *   - `awaited`     a payment it started has not arrived yet (staff confirm it under Money in);
 *   - `failing`     its systems are not answering what we send them;
 *   - `returns`     parcels offered back to it that it has not answered.
 *
 * TWO THINGS ARE DELIBERATELY NOT HERE. An empty float on its own: a store that ships nothing owes nobody
 * a float. And a store with no address for its systems to be told at: most small stores have no systems,
 * work from the Store app alone, and a warning on every one of them would be a fact dressed as a demand
 * — the first look at this screen flagged the demo store for exactly that. The panel still says it.
 */
export type StoreTrouble = 'unpaid' | 'awaited' | 'failing' | 'returns';

export function storeTroubles(desk: Pick<StoreDesk, 'shipments' | 'money' | 'callbacks' | 'returnsWaiting'>): StoreTrouble[] {
  const out: StoreTrouble[] = [];
  if (desk.shipments.unpaid > 0) out.push('unpaid');
  if (desk.money.open.length > 0) out.push('awaited');
  if (desk.callbacks.failed > 0) out.push('failing');
  if (desk.returnsWaiting > 0) out.push('returns');
  return out;
}

/** A callback that arrived is quiet, one still owed is a wait, one given up on is the thing to look at. */
export function callbackTone(state: CallbackState): 'ok' | 'quiet' | 'warn' {
  return state === 'delivered' ? 'ok' : state === 'pending' ? 'quiet' : 'warn';
}

/** A key that was revoked is history; one never used may be the one the store thinks it is using. */
export function keyState(key: { lastUsedAt?: string; revokedAt?: string }): 'revoked' | 'unused' | 'used' {
  if (key.revokedAt) return 'revoked';
  return key.lastUsedAt ? 'used' : 'unused';
}
