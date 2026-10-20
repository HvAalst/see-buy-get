import type { SbgClient } from '../client';
import { createFiscalApi } from './fiscal';
import { createMediaApi } from './media';

/**
 * A parcel actually measured — three sides in centimetres and a weight in kilos.
 *
 * ITEM 9: where the network HAS this, it prices transport on it rather than on the size tier the parcel
 * happens to land in. All four or none, which is why this is one object rather than four parameters that
 * can drift apart.
 */
export interface Measure {
  l: number;
  w: number;
  h: number;
  kg: number;
}

/** The measurement as query values, or nothing at all — the endpoint reads all four or falls back to the
 *  band, so a partial spread would be silently ignored rather than half-applied. */
const asQuery = (m?: Measure): Record<string, string> =>
  m && [m.l, m.w, m.h, m.kg].every((n) => Number.isFinite(n) && n > 0)
    ? { l: String(m.l), w: String(m.w), h: String(m.h), kg: String(m.kg) }
    : {};

/** The bookkeeping (ledger) register query params — all optional (no query = the whole book, newest-first). */
export interface LedgerQuery {
  q?: string;
  type?: 'TOP_UP' | 'BILLING' | 'REBATE';
  direction?: 'in' | 'out';
  from?: string;
  to?: string;
  sort?: 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';
  limit?: string;
  offset?: string;
}

/**
 * Vendor persona facade — the ONLY operations the merchant console can name: the store's
 * own record, the incoming-orders inbox, the MINT (an order becomes a parcel + phygital
 * label + collection code + tracking key), the prepaid balance and its settlement book,
 * and the callback outbox. Every method returns a Result, never throws.
 */
export function createVendorApi(sbg: SbgClient) {
  return {
    // Its tax invoices (KRA eTIMS, Kenya only).
    ...createFiscalApi(sbg),
    // Round 30 — its photos for real: the contents of each order (the "before" a claim is judged against), its GS1 licence.
    ...createMediaApi(sbg),
    /** The store's public record (never re-exposes the secret). */
    me: (vendorId: string) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}', { params: { path: { id: vendorId } } })),

    /** Update pin / address / callback URL / split policy. */
    update: (
      vendorId: string,
      patch: {
        callbackUrl?: string;
        callbackCarriesCode?: boolean;
        location?: { lat: number; lng: number };
        address?: string;
        shippingPolicy?: { mode?: 'full' | 'capped'; freeOverSubtotal?: number; buyerContributionCap?: number; maxTransportSpend?: number; insurer?: { name: string; email: string } | null };
      },
    ) => sbg.request((c) => c.PATCH('/v1/sbg/vendors/{id}', { params: { path: { id: vendorId } }, body: patch })),

    /** The store's shipment register (R0): a server-side searched/filtered/sorted/paged page of orders,
     *  returned as { items, total }. All query fields are optional (no query = newest-first, page 1). */
    orders: (
      vendorId: string,
      query?: {
        q?: string;
        status?: string;
        pudo?: string;
        from?: string;
        to?: string;
        paid?: 'paid' | 'unpaid';
        sort?: 'newest' | 'oldest' | 'cost_desc' | 'cost_asc';
        limit?: string;
        offset?: string;
      },
    ) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/orders', { params: { path: { id: vendorId }, query: query ?? {} } })),

    /** Store-wide shipment counts (total / unpaid / active) for the console header nudge + spoken summary —
     *  computed over the WHOLE store, never the current register page. Owner-scoped. */
    orderStats: (vendorId: string) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/orders/stats', { params: { path: { id: vendorId } } })),
    /** The damage claim reports on this store's orders, newest first, each with where it was emailed. */
    damageReports: (vendorId: string) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/damage-reports', { params: { path: { id: vendorId } } })),

    /** Export the WHOLE matching set (every page, current filters) as a CSV string — the vendor's OWN
     *  shipment export. Owner-scoped; parsed as text (the endpoint returns text/csv, not JSON). */
    exportOrders: (
      vendorId: string,
      query?: { q?: string; status?: string; pudo?: string; from?: string; to?: string; paid?: 'paid' | 'unpaid'; sort?: 'newest' | 'oldest' | 'cost_desc' | 'cost_asc' },
    ) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/orders/export', { params: { path: { id: vendorId }, query: query ?? {} }, parseAs: 'text' })),

    /** The store's BOOKKEEPING register (R3): a server-side searched/filtered/sorted/paged page of ledger
     *  entries (top-ups / shipment billings / rebates) → { items, total }. Owner-scoped. */
    ledger: (
      vendorId: string,
      query?: LedgerQuery,
    ) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/ledger', { params: { path: { id: vendorId }, query: query ?? {} } })),

    /** Running totals (in / out / net / count) for the current filter + the always-current balance. Owner-scoped. */
    ledgerSummary: (
      vendorId: string,
      query?: LedgerQuery,
    ) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/ledger/summary', { params: { path: { id: vendorId }, query: query ?? {} } })),

    /** Export the WHOLE matching set (every page, current filters) as a CSV string — the vendor's OWN
     *  bookkeeping export. Owner-scoped; parsed as text (the endpoint returns text/csv). */
    ledgerExport: (
      vendorId: string,
      query?: LedgerQuery,
    ) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/ledger/export', { params: { path: { id: vendorId }, query: query ?? {} }, parseAs: 'text' })),

    /** Full detail for one order (validates it belongs to this store). */
    order: (vendorId: string, parcelId: string) =>
      sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/orders/{parcelId}', { params: { path: { id: vendorId, parcelId } } })),

    /* --- round 29: the store's GS1 company prefix, held to a business's rules, and the disputes it is in --- */

    /** Give the prefix and the extension digit: each parcel paid from now on gets an SSCC under it. */
    setGs1: (vendorId: string, companyPrefix: string, extensionDigit: number) =>
      sbg.request((c) => c.PUT('/v1/sbg/vendors/{id}/gs1', { params: { path: { id: vendorId } }, body: { companyPrefix, extensionDigit } })),
    /** Stop giving SSCCs: parcels already labelled keep theirs. */
    clearGs1: (vendorId: string) => sbg.request((c) => c.DELETE('/v1/sbg/vendors/{id}/gs1', { params: { path: { id: vendorId } } })),
    gs1Disputes: (vendorId: string) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/gs1/disputes', { params: { path: { id: vendorId } } })),
    /** "This prefix is ours", refused a prefix another uses: with the store's GS1 licence. */
    openGs1Dispute: (vendorId: string, body: { companyPrefix: string; extensionDigit: number; licenceRef: string; note?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/vendors/{id}/gs1/disputes', { params: { path: { id: vendorId } }, body })),
    sendGs1Licence: (vendorId: string, disputeId: string, licenceRef: string) =>
      sbg.request((c) => c.POST('/v1/sbg/vendors/{id}/gs1/disputes/{disputeId}/licence', { params: { path: { id: vendorId, disputeId } }, body: { licenceRef } })),
    withdrawGs1Dispute: (vendorId: string, disputeId: string) =>
      sbg.request((c) => c.POST('/v1/sbg/vendors/{id}/gs1/disputes/{disputeId}/withdraw', { params: { path: { id: vendorId, disputeId } } })),

    /** Round 27 — an order's label, to print again once it is paid; and the same for a thermal label printer (ZPL). */
    orderLabel: (vendorId: string, parcelId: string) =>
      sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/orders/{parcelId}/label', { params: { path: { id: vendorId, parcelId } } })),
    orderLabelZpl: (vendorId: string, parcelId: string) =>
      sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/orders/{parcelId}/label.zpl', { params: { path: { id: vendorId, parcelId } }, parseAs: 'text' })),

    /** DT — the parcel's planned journey (origin PUDO → MDP(s) → dest PUDO), for the twin view after minting. */
    parcelRoute: (parcelId: string) =>
      sbg.request((c) => c.GET('/v1/sbg/parcels/{id}/route', { params: { path: { id: parcelId } } })),

    /** Buyer checkout selections waiting to be shipped — the incoming-orders inbox. */
    checkouts: (vendorId: string) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/checkouts', { params: { path: { id: vendorId } } })),

    /** MINT: an order ships → inbound parcel + phygital label + collection code + tracking key. */
    mint: (body: {
      vendorId: string;
      originPudoDid: string;
      destPudoDid: string;
      checkoutId?: string;
      externalOrderId?: string;
      buyerMobile?: string;
      buyerEmail?: string;
      size?: 'S' | 'M' | 'L' | 'HEAVY';
      dimensionsCm?: { l: number; w: number; h: number };
      weightKg?: number;
      contentPhotoRef: string;
      subtotal?: number;
      routeMode?: 'flexible' | 'locked';
      fragile?: boolean;
      items?: Array<{ name: string; qty: number }>;
      /** FP8 — box 13 when the order ships as freight. */
      instructions?: string;
      deliveryWindow?: string;
      /** Round 13 — the commercial invoice, for a shipment that crosses a border. */
      invoice?: Record<string, unknown>;
    }) => sbg.request((c) => c.POST('/v1/sbg/inbound/orders', { body: body as never })),

    /** Round 13 — a crossing parcel's commercial invoice, three copies a page each: printed with the label. */
    papersPage: (vendorId: string, parcelId: string) =>
      sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/parcels/{parcelId}/invoice.html', { params: { path: { id: vendorId, parcelId } }, parseAs: 'text' })) as Promise<{ data?: string; error?: unknown }>,

    /** Derive the size tier from dimensions + weight — the live preview for the mint form. */
    classify: (l: number, w: number, h: number, kg: number) =>
      sbg.request((c) => c.POST('/v1/sbg/size/classify', { body: { l, w, h, kg } })),

    /** Settle an unpaid order after a top-up — releases its label. */
    settle: (parcelId: string) => sbg.request((c) => c.POST('/v1/sbg/parcels/{id}/settle', { params: { path: { id: parcelId } } })),

    /**
     * ASK to prepay the daughter company ('no prepay, no label').
     *
     * It hands back a reference and how to pay; the balance moves when the payment provider confirms the
     * payment. Before 2026-09-22 this credited the balance with whatever number was typed here.
     */
    topUp: (vendorId: string, amount: number, phone?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/vendors/{id}/top-up', { params: { path: { id: vendorId } }, body: { amount, ...(phone ? { phone } : {}) } })),

    /** What this store is waiting to have confirmed, and what was confirmed lately. */
    funding: (vendorId: string) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/funding', { params: { path: { id: vendorId } } })),

    /** The prepaid settlement book, newest first. */
    settlement: (vendorId: string) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/settlement', { params: { path: { id: vendorId } } })),

    /* --- merchant API keys: who the public shipping API sees when this store calls it --- */

    /** This store's keys. Never carries a secret — not even to its owner; see the issue call. */
    apiKeys: (vendorId: string) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/api-keys', { params: { path: { id: vendorId } } })),

    /** Mint a key. The response carries the full value ONCE and it is never retrievable again. */
    issueApiKey: (vendorId: string, body: { kind: 'publishable' | 'secret'; mode?: 'test' | 'live'; label?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/vendors/{id}/api-keys', { params: { path: { id: vendorId } }, body })),

    /** Stop a key working. Kept rather than deleted, so "what was that key doing" stays answerable. */
    revokeApiKey: (vendorId: string, keyId: string) =>
      sbg.request((c) => c.DELETE('/v1/sbg/vendors/{id}/api-keys/{keyId}', { params: { path: { id: vendorId, keyId } } })),

    /** The HMAC-signed status-callback outbox. */
    callbacks: (vendorId: string) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/callbacks', { params: { path: { id: vendorId } } })),
    /** A test to the store’s own system, answered once the first try is made. */
    testCallback: (vendorId: string) => sbg.request((c) => c.POST('/v1/sbg/vendors/{id}/callbacks/test', { params: { path: { id: vendorId } } })),
    /** One sent again: the same message, to the address and with the secret the store has now. */
    resendCallback: (vendorId: string, callbackId: string) => sbg.request((c) => c.POST('/v1/sbg/vendors/{id}/callbacks/{callbackId}/resend', { params: { path: { id: vendorId, callbackId } } })),

    /* --- the store's own dock: a driver collects HERE, and the goods are handled once ---------------
       Outbound only, and deliberately not a PUDO: no shelf, no release, never a destination, and no
       intake fee, because nobody takes in a box its own owner packed. The dock is a place on the route,
       never a stop in the fee stack. */

    /** Turn the store's own address into a place the network collects from. `bays` is how many sealed
     *  bags can stand waiting on the floor — the dock refuses to open more than it has room for. */
    setCollectionPoint: (
      vendorId: string,
      body: { label: string; zone: string; country?: string; location: { lat: number; lng: number }; bays?: number },
    ) => sbg.request((c) => c.POST('/v1/sbg/vendors/{id}/collection-point', { params: { path: { id: vendorId } }, body })),

    /** Stop collecting here. Bags already claimed stay with the drivers who claimed them. */
    clearCollectionPoint: (vendorId: string) =>
      sbg.request((c) => c.DELETE('/v1/sbg/vendors/{id}/collection-point', { params: { path: { id: vendorId } } })),

    /** What this dock should be bagging: paid parcels grouped by destination, the bags already open,
     *  and how much floor is left. */
    dockPlan: (vendorId: string) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/dock', { params: { path: { id: vendorId } } })),

    /** Open a bag for one destination. Refused once the floor is full — a real constraint, not advice. */
    openDockBag: (vendorId: string, destZone: string) =>
      sbg.request((c) => c.POST('/v1/sbg/vendors/{id}/dock/bags', { params: { path: { id: vendorId } }, body: { destZone } })),

    /** Put one parcel in the bag. */
    fillDockBag: (vendorId: string, code: string, parcelId: string) =>
      sbg.request((c) => c.POST('/v1/sbg/vendors/{id}/dock/bags/{code}/fill', { params: { path: { id: vendorId, code } }, body: { parcelId } })),

    /** Close it. The store's seal is what PUBLISHES the bag — it is the moment drivers near the dock are
     *  told there is something to collect, so it is never done on the store's behalf. */
    sealDockBag: (vendorId: string, code: string, body: { acknowledgeShortShip?: boolean; shortShipReason?: string; closure?: { seal?: string; photoRef: string } } = {}) =>
      sbg.request((c) => c.POST('/v1/sbg/vendors/{id}/dock/bags/{code}/seal', { params: { path: { id: vendorId, code } }, body })),

    /**
     * Returns waiting on this store's decision — parcels nobody came for.
     *
     * Not a store choosing whether to abandon something: the buyer paid for the goods, so they are the
     * buyer's. This is a store choosing whether to pay for their journey home.
     */
    returns: (vendorId: string) =>
      sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/returns', { params: { path: { id: vendorId } } })),

    /** Yes — mint the journey home, bill this store, and hand the shop its shelf slot back. */
    acceptReturn: (vendorId: string, offerId: string) =>
      sbg.request((c) => c.POST('/v1/sbg/vendors/{id}/returns/{offerId}/accept', { params: { path: { id: vendorId, offerId } } })),

    /** No — and the parcel stays where it is, because it is still somebody else's property. */
    declineReturn: (vendorId: string, offerId: string, reason?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/vendors/{id}/returns/{offerId}/decline', { params: { path: { id: vendorId, offerId } }, body: { reason } })),

    /** Quote one origin→destination journey (for the confirm step's price cards).
     *
     *  The MEASUREMENT rides along whenever the form has one, because the mint prices on it: a preview
     *  quoted from the size band would show a store one number and bill it another, and the store would
     *  be right to call that a bait. */
    quote: (originDid: string, destDid: string, size: string, measure?: Measure) =>
      sbg.request((c) => c.GET('/v1/sbg/quote', { params: { query: { origin: originDid, dest: destDid, size, ...asQuery(measure) } } })),

    /** Quote many drop-off candidates against the buyer's destination — the origin picker's
     *  prices. (Empty origin/dests: the S5a contract quirk marks the unused pair required.) */
    quoteOrigins: (destDid: string, originDids: string[], size: string, measure?: Measure) =>
      sbg.request((c) =>
        c.GET('/v1/sbg/quote/options', { params: { query: { origin: '', dest: destDid, origins: originDids.join(','), dests: '', size, ...asQuery(measure) } } }),
      ),
  };
}

export type VendorApi = ReturnType<typeof createVendorApi>;
