import type { SbgClient } from '../client';
import { createMediaApi } from './media';

/**
 * Agent persona facade — the ONLY operations the PUDO shop app can name. A compile-time
 * mirror of the runtime scope check: the agent PWA literally cannot type a fleet or hub
 * call. Every method returns a Result (data | typed error), never throws.
 *
 * Mirrors the calls the legacy agent.js made, now typed against the generated contract.
 * The shop's three jobs (accept / hand to the bus / release to the customer) plus the
 * click-and-collect counter flows, the bag last-mile, the wallet gate and open-data pricing.
 */
export function createAgentApi(sbg: SbgClient) {
  return {
    // S26: real image upload/fetch (drop-off proof, delivered proof, dispute evidence).
    ...createMediaApi(sbg),

    /** The shop's own record (status, open state, price, zone, balance, rating). */
    me: (did: string) => sbg.request((c) => c.GET('/v1/sbg/agents/{did}', { params: { path: { did } } })),

    /** The 'no money, no scan' gate — { ok, code, balance, shortfall } as readable state. */
    canTransact: (did: string) => sbg.request((c) => c.GET('/v1/sbg/agents/{did}/can-transact', { params: { path: { did } } })),

    /** Prepay the wallet that funds every accept scan. */
    topUp: (did: string, amount: number) =>
      sbg.request((c) => c.POST('/v1/sbg/agents/{did}/top-up', { params: { path: { did } }, body: { amount } })),

    /** Shop open / temporarily closed (Risk #30) — distinct from the lifecycle status. */
    setAvailability: (did: string, open: boolean) =>
      sbg.request((c) => c.POST('/v1/sbg/agents/{did}/availability', { params: { path: { did } }, body: { open } })),

    /** Publish this shop's per-parcel handling fee (open data — competition pressure). */
    setPrice: (did: string, price: number) =>
      sbg.request((c) => c.PATCH('/v1/sbg/agents/{did}/pricing', { params: { path: { did } }, body: { price } })),

    /** Nearby shops' handling fees — the benchmark this shop prices against. */
    ratesNear: (at?: { lat: number; lng: number }) =>
      sbg.request((c) =>
        c.GET('/v1/sbg/pricing/near', { params: { query: { type: 'pudo', ...(at ? { lat: String(at.lat), lng: String(at.lng) } : {}) } } }),
      ),

    /** Active corridors — the destinations this shop can accept parcels toward. */
    corridors: () => sbg.request((c) => c.GET('/v1/sbg/corridors', {})),

    /** Heartbeat + last-seen. */
    ping: (did: string) => sbg.request((c) => c.POST('/v1/sbg/agents/{did}/ping', { params: { path: { did } } })),

    /** Parcels sitting at this shop, waiting for the bus. */
    parcelsAtShop: (did: string) =>
      sbg.request((c) => c.GET('/v1/sbg/parcels', { params: { query: { status: 'At_PUDO', agent: did } } })),

    /** One parcel by sticker id (drives the release flow's state machine). */
    parcel: (id: string) => sbg.request((c) => c.GET('/v1/sbg/parcels/{id}', { params: { path: { id } } })),

    /** Take in a walk-up drop-off: sticker + size + destination + phones + proof photo. */
    accept: (body: {
      agentDid: string;
      parcelId: string;
      size: 'S' | 'M' | 'L' | 'HEAVY';
      destZone: string;
      senderMobile: string;
      receiverMobile: string;
      dropoffPhotoRef: string;
      // S30 — the commodity's primary cargo nature (default GEN server-side). Union mirrors CARGO_NATURES.
      natureCode?: 'GEN' | 'FOD' | 'FOP' | 'HAZ-CHEM' | 'HAZ-DUST' | 'HAZ-BIO' | 'HAZ-FLAM' | 'FRG' | 'ODR' | 'HUM';
    }) => sbg.request((c) => c.POST('/v1/sbg/parcels/accept', { body })),

    /**
     * Hand selected parcels to the scanned driver badge (the bus moment). The server runs the S25
     * completeness gate: a short load is refused (INCOMPLETE_MANIFEST, with the missed ids in params)
     * unless `acknowledgeShortShip` is passed to knowingly leave those parcels behind (with a reason).
     */
    handover: (
      agentDid: string,
      driverBadgeId: string,
      parcelIds: string[],
      opts?: { acknowledgeShortShip?: boolean; shortShipReason?: string },
    ) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/parcels/handover', {
          body: {
            agentDid,
            driverBadgeId,
            parcelIds,
            ...(opts?.acknowledgeShortShip ? { acknowledgeShortShip: true, shortShipReason: opts.shortShipReason } : {}),
          },
        }),
      ),

    /** Mark a bus parcel arrived at this destination shop → issues the customer OTP. */
    arrive: (parcelId: string, destAgentDid: string) =>
      sbg.request((c) => c.POST('/v1/sbg/parcels/{id}/arrive', { params: { path: { id: parcelId } }, body: { destAgentDid } })),

    /** Verify the customer's 4-digit code and hand the parcel over (photo optional, kept as proof). */
    pickup: (parcelId: string, agentDid: string, otp: string, deliveredPhotoRef?: string) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/parcels/{id}/pickup', {
          params: { path: { id: parcelId } },
          body: { agentDid, otp, ...(deliveredPhotoRef ? { deliveredPhotoRef } : {}) },
        }),
      ),

    /** Record the customer's rating of a delivered parcel. */
    rate: (parcelId: string, stars: number, raterMobile: string) =>
      sbg.request((c) => c.POST('/v1/sbg/parcels/{id}/rate', { params: { path: { id: parcelId } }, body: { stars, raterMobile } })),

    /** Resolve a buyer's collection code → the parcel + its shelf slot. */
    collect: (agentDid: string, collectionCode: string) =>
      sbg.request((c) => c.POST('/v1/sbg/parcels/collect', { body: { agentDid, collectionCode } })),

    /** Buyer checked the contents — close the order. */
    collectConfirm: (parcelId: string, agentDid: string, collectionCode: string) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/parcels/{id}/collect-confirm', { params: { path: { id: parcelId } }, body: { agentDid, collectionCode } }),
      ),

    /** Buyer refused the parcel — file the dispute with a reason + proof photo. */
    dispute: (parcelId: string, agentDid: string, reason: string, photoProofRef: string) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/parcels/{id}/dispute', { params: { path: { id: parcelId } }, body: { agentDid, reason, photoProofRef } }),
      ),

    /** A bus dropped a bag here — one scan shelves every parcel inside for pickup. */
    receiveBag: (did: string, code: string) =>
      sbg.request((c) => c.POST('/v1/sbg/agents/{did}/receive-bag', { params: { path: { did } }, body: { code } })),

    /** Reverse logistics: undo a drop-off within the 5-minute window with a torn-label photo → refund. */
    voidParcel: (parcelId: string, agentDid: string, voidedPhotoRef: string) =>
      sbg.request((c) => c.POST('/v1/sbg/parcels/{id}/void', { params: { path: { id: parcelId } }, body: { agentDid, voidedPhotoRef } })),
  };
}

export type AgentApi = ReturnType<typeof createAgentApi>;
