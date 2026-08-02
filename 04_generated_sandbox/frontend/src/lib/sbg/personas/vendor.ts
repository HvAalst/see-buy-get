import type { SbgClient } from '../client';

/**
 * Vendor persona facade — the ONLY operations the merchant console can name: the store's
 * own record, the incoming-orders inbox, the MINT (an order becomes a parcel + phygital
 * label + collection code + tracking key), the prepaid balance and its settlement book,
 * and the callback outbox. Every method returns a Result, never throws.
 */
export function createVendorApi(sbg: SbgClient) {
  return {
    /** The store's public record (never re-exposes the secret). */
    me: (vendorId: string) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}', { params: { path: { id: vendorId } } })),

    /** Update pin / address / callback URL / split policy. */
    update: (
      vendorId: string,
      patch: {
        callbackUrl?: string;
        location?: { lat: number; lng: number };
        address?: string;
        shippingPolicy?: { mode?: 'full' | 'capped'; freeOverSubtotal?: number; buyerContributionCap?: number; maxTransportSpend?: number };
      },
    ) => sbg.request((c) => c.PATCH('/v1/sbg/vendors/{id}', { params: { path: { id: vendorId } }, body: patch })),

    /** The store's orders (its inbound parcels), newest first server-side. */
    orders: (vendorId: string) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/orders', { params: { path: { id: vendorId } } })),

    /** Full detail for one order (validates it belongs to this store). */
    order: (vendorId: string, parcelId: string) =>
      sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/orders/{parcelId}', { params: { path: { id: vendorId, parcelId } } })),

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
    }) => sbg.request((c) => c.POST('/v1/sbg/inbound/orders', { body })),

    /** Derive the size tier from dimensions + weight — the live preview for the mint form. */
    classify: (l: number, w: number, h: number, kg: number) =>
      sbg.request((c) => c.POST('/v1/sbg/size/classify', { body: { l, w, h, kg } })),

    /** Settle an unpaid order after a top-up — releases its label. */
    settle: (parcelId: string) => sbg.request((c) => c.POST('/v1/sbg/parcels/{id}/settle', { params: { path: { id: parcelId } } })),

    /** Prepay the daughter company ('no prepay, no label'). */
    topUp: (vendorId: string, amount: number) =>
      sbg.request((c) => c.POST('/v1/sbg/vendors/{id}/top-up', { params: { path: { id: vendorId } }, body: { amount } })),

    /** The prepaid settlement book, newest first. */
    settlement: (vendorId: string) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/settlement', { params: { path: { id: vendorId } } })),

    /** The HMAC-signed status-callback outbox. */
    callbacks: (vendorId: string) => sbg.request((c) => c.GET('/v1/sbg/vendors/{id}/callbacks', { params: { path: { id: vendorId } } })),

    /** Quote one origin→destination journey (for the confirm step's price cards). */
    quote: (originDid: string, destDid: string, size: string) =>
      sbg.request((c) => c.GET('/v1/sbg/quote', { params: { query: { origin: originDid, dest: destDid, size } } })),

    /** Quote many drop-off candidates against the buyer's destination — the origin picker's
     *  prices. (Empty origin/dests: the S5a contract quirk marks the unused pair required.) */
    quoteOrigins: (destDid: string, originDids: string[], size: string) =>
      sbg.request((c) =>
        c.GET('/v1/sbg/quote/options', { params: { query: { origin: '', dest: destDid, origins: originDids.join(','), dests: '', size } } }),
      ),
  };
}

export type VendorApi = ReturnType<typeof createVendorApi>;
