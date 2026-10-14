import type { Funding } from '../../foundation/funding/funding.types';
import { normalizePhone } from '../../foundation/identity/phone';
import type { MerchantScorecard } from './merchant-rating.service';
import type { VendorOrderStats } from './parcel.service';
import type { ApiKeyView, Parcel, Vendor } from './pudo.types';
import { settlementCurrencyOf, type VendorCallback, type VendorSettlement } from './vendor.service';

/**
 * A STORE, AS NETWORK STAFF SEE IT.
 *
 * A store rings because its labels stopped printing, or its system was never told a parcel arrived, and
 * the person who answers has to FIND that store and see what state it is in. Until this the console had
 * no list of stores at all. The route behind it existed, and answered with every store's whole record —
 * the owner's phone number among it — to a screen nobody had built.
 *
 * WHAT IS LEFT OUT, AND WHY IT IS BUILT HERE AND NOT FILTERED ON A SCREEN. Each of these is something the
 * store's own routes rightly carry for the store, and that somebody answering a phone has no use for:
 *   - the signing secret, a key's value or its hash, a callback's signature;
 *   - a callback's BODY, which carries the buyer's collection code;
 *   - a buyer's phone number, their email, their collection code, the tracking key;
 *   - the owner's whole phone number (its last digits say "that is the number we have"), and the address
 *     the store signs in with.
 * So the view is assembled field by field from what may be shown. A field added to Vendor, Parcel or
 * VendorCallback tomorrow does not reach staff by being added: somebody has to name it here.
 */

/** How many of each kind of recent thing a support desk is shown. The rest is the store's own screen. */
export const DESK_RECENT = 5;

/** The record a view is built from: never the one that still holds the signing secret. */
export type StoreRecord = Omit<Vendor, 'secret'>;

export interface StoreRow {
  vendorId: string;
  name: string;
  country: string;
  /** The company of ours that settles it, by name. Absent where we only match in its country. */
  companyName?: string;
  /** Its float, and the money that figure is in. NULL where it has no till with us: not the same as empty. */
  balance: number | null;
  currency?: string;
  /** Signs in with an email and password of its own — or, when false, still by its signing secret. */
  hasAccount: boolean;
  /** Whether an address is set for its systems to be told about its parcels. */
  hasCallback: boolean;
  /** Whether it has a dock of its own that drivers collect from. */
  hasDock: boolean;
  address?: string;
  createdAt: string;
}

export interface StoreDesk extends StoreRow {
  signIn: { hasAccount: boolean; secretRotatedAt?: string };
  /** The last digits of the number on file, when there is one. Never the number. */
  contact: { phoneEnding?: string };
  money: {
    /** Payments it has started and that have not arrived. Staff confirm these under Money in. */
    open: Array<{ reference: string; amount: number; currency: string; openedAt: string }>;
    recent: Array<{ type: VendorSettlement['type']; sign: '+' | '-'; amount: number; currency: string; parcelId?: string; at: string }>;
  };
  shipments: VendorOrderStats & {
    /** Enough to recognise a parcel and look it up under Support. Nothing about the buyer. */
    recent: Array<{ parcelId: string; externalOrderId?: string; status: Parcel['status']; paid: boolean; destZone: string; at: string }>;
  };
  callbacks: {
    url?: string;
    carriesCode: boolean;
    /** Of the newest hundred kept. */
    pending: number;
    failed: number;
    delivered: number;
    lastDeliveredAt?: string;
    recent: Array<{ event: string; at: string; state: VendorCallback['state']; attempts: number; nextTryAt?: string; deliveredAt?: string; lastError?: string }>;
  };
  keys: Array<{ keyId: string; kind: ApiKeyView['kind']; mode: ApiKeyView['mode']; label?: string; hint: string; createdAt: string; lastUsedAt?: string; revokedAt?: string }>;
  dock: { label: string; zone: string; bays: number; enabledAt: string } | null;
  /** Parcels offered back to it that it has not yet answered. */
  returnsWaiting: number;
  reputation: { shipments: number; average: number; count: number; isNew: boolean };
}

/** What the caller has already looked up about a store: which company settles it, and whether it has an account. */
export interface StoreStanding {
  companyName?: string;
  currency?: string;
  balance: number | null;
  hasAccount: boolean;
}

export function storeRowOf(vendor: Omit<Vendor, 'secret'>, standing: StoreStanding): StoreRow {
  return {
    vendorId: vendor.vendorId,
    name: vendor.name,
    country: vendor.country,
    ...(standing.companyName ? { companyName: standing.companyName } : {}),
    balance: standing.balance,
    // No till, no money to name: a currency beside "no float held here" would read as a balance of nothing.
    ...(standing.balance !== null && standing.currency ? { currency: standing.currency } : {}),
    hasAccount: standing.hasAccount,
    hasCallback: Boolean(vendor.callbackUrl),
    hasDock: Boolean(vendor.collection),
    ...(vendor.address ? { address: vendor.address } : {}),
    createdAt: vendor.createdAt,
  };
}

/** Newest first, by the field that says when. */
const newest = <T>(rows: T[], at: (row: T) => string): T[] => [...rows].sort((a, b) => (at(a) < at(b) ? 1 : at(a) > at(b) ? -1 : 0));

export function storeDeskOf(input: {
  vendor: Omit<Vendor, 'secret'>;
  standing: StoreStanding;
  funding: Funding[];
  ledger: VendorSettlement[];
  parcels: Parcel[];
  stats: VendorOrderStats;
  callbacks: VendorCallback[];
  keys: ApiKeyView[];
  returnsWaiting: number;
  scorecard: MerchantScorecard;
}): StoreDesk {
  const { vendor, standing } = input;
  const phone = vendor.contactMobile ? normalizePhone(vendor.contactMobile) : '';
  const count = (state: VendorCallback['state']) => input.callbacks.filter((c) => c.state === state).length;
  const lastDelivered = newest(input.callbacks.filter((c) => c.deliveredAt), (c) => c.deliveredAt!)[0]?.deliveredAt;
  return {
    ...storeRowOf(vendor, standing),
    signIn: { hasAccount: standing.hasAccount, ...(vendor.secretRotatedAt ? { secretRotatedAt: vendor.secretRotatedAt } : {}) },
    contact: phone.length >= 3 ? { phoneEnding: phone.slice(-3) } : {},
    money: {
      open: newest(input.funding.filter((f) => f.status === 'awaiting'), (f) => f.openedAt).map((f) => ({ reference: f.reference, amount: f.amount, currency: f.currency, openedAt: f.openedAt })),
      recent: newest(input.ledger, (s) => s.at)
        .slice(0, DESK_RECENT)
        .map((s) => ({ type: s.type, sign: s.sign, amount: s.amount, currency: settlementCurrencyOf(s), ...(s.parcelId ? { parcelId: s.parcelId } : {}), at: s.at })),
    },
    shipments: {
      total: input.stats.total,
      unpaid: input.stats.unpaid,
      active: input.stats.active,
      recent: newest(input.parcels, (p) => p.acceptedAt)
        .slice(0, DESK_RECENT)
        .map((p) => ({ parcelId: p.parcelId, ...(p.externalOrderId ? { externalOrderId: p.externalOrderId } : {}), status: p.status, paid: p.paidStatus === 'ParcelPaid', destZone: p.destZone, at: p.acceptedAt })),
    },
    callbacks: {
      ...(vendor.callbackUrl ? { url: vendor.callbackUrl } : {}),
      carriesCode: vendor.callbackCarriesCode !== false,
      pending: count('pending'),
      failed: count('failed'),
      delivered: count('delivered'),
      ...(lastDelivered ? { lastDeliveredAt: lastDelivered } : {}),
      recent: newest(input.callbacks, (c) => c.at)
        .slice(0, DESK_RECENT)
        .map((c) => ({
          event: c.event,
          at: c.at,
          state: c.state,
          attempts: c.attempts,
          // When it will be tried again matters only while it is still owed.
          ...(c.state === 'pending' ? { nextTryAt: c.nextTryAt } : {}),
          ...(c.deliveredAt ? { deliveredAt: c.deliveredAt } : {}),
          ...(c.lastError ? { lastError: c.lastError } : {}),
        })),
    },
    keys: input.keys.map((k) => ({
      keyId: k.keyId,
      kind: k.kind,
      mode: k.mode,
      ...(k.label ? { label: k.label } : {}),
      hint: k.hint,
      createdAt: k.createdAt,
      ...(k.lastUsedAt ? { lastUsedAt: k.lastUsedAt } : {}),
      ...(k.revokedAt ? { revokedAt: k.revokedAt } : {}),
    })),
    dock: vendor.collection ? { label: vendor.collection.label, zone: vendor.collection.zone, bays: vendor.collection.bays, enabledAt: vendor.collection.enabledAt } : null,
    returnsWaiting: input.returnsWaiting,
    reputation: { shipments: input.scorecard.shipments, average: input.scorecard.rating.average, count: input.scorecard.rating.count, isNew: input.scorecard.rating.isNew },
  };
}
