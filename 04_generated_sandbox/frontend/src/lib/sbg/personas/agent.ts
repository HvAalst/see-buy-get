import type { SbgClient } from '../client';
import { createMediaApi } from './media';

/** The agent parcel-history register query (all optional). */
export interface AgentParcelsQuery {
  q?: string;
  status?: string;
  role?: 'origin' | 'dest';
  from?: string;
  to?: string;
  sort?: 'newest' | 'oldest';
  limit?: string;
  offset?: string;
}

/** The agent earnings-ledger register query (all optional). */
export interface AgentLedgerQuery {
  q?: string;
  type?: 'TOP_UP' | 'FEE' | 'LABOR_PAYOUT' | 'REFUND';
  direction?: 'in' | 'out';
  from?: string;
  to?: string;
  sort?: 'newest' | 'oldest' | 'amount_desc' | 'amount_asc';
  limit?: string;
  offset?: string;
}

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

    /** The shop's pickup-shelf grid + live free-slot count (colour/number slots, occupancy). */
    getShelf: (did: string) => sbg.request((c) => c.GET('/v1/sbg/agents/{did}/shelf', { params: { path: { did } } })),

    /** Reconfigure the shelf grid (rows × colour columns + which slots pool small parcels) — returns the updated agent record. */
    setShelf: (did: string, rows: number, cols: number, consolidationSlots: string[] = []) =>
      sbg.request((c) => c.POST('/v1/sbg/agents/{did}/shelf', { params: { path: { did } }, body: { rows, cols, consolidationSlots } })),

    /** Move the shop's map pin (My-shop location editor). */
    setLocation: (did: string, lat: number, lng: number) =>
      sbg.request((c) => c.POST('/v1/sbg/agents/{did}/location', { params: { path: { did } }, body: { lat, lng } })),

    /** Set the weekly opening schedule (a per-day open/close, or null for a closed day). The contract types the
     *  body's value as an opaque object (the plugin can't express the day→hours|null union), so cast the field. */
    setHours: (did: string, openingHours: Record<string, { open: string; close: string } | null>) =>
      sbg.request((c) => c.POST('/v1/sbg/agents/{did}/hours', { params: { path: { did } }, body: { openingHours: openingHours as never } })),

    /** Point the shop-front photo at an uploaded media, or clear it with an empty string. */
    setShopfront: (did: string, mediaId: string) =>
      sbg.request((c) => c.POST('/v1/sbg/agents/{did}/shopfront', { params: { path: { did } }, body: { mediaId } })),

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

    /** The shop's PARCEL-HISTORY register (R4): parcels it handled (drop-off or collection), server-side
     *  searched / filtered / sorted / paged → { items, total }. Owner-scoped. */
    parcels: (did: string, query?: AgentParcelsQuery) =>
      sbg.request((c) => c.GET('/v1/sbg/agents/{did}/parcels', { params: { path: { did }, query: query ?? {} } })),
    parcelsExport: (did: string, query?: AgentParcelsQuery) =>
      sbg.request((c) => c.GET('/v1/sbg/agents/{did}/parcels/export', { params: { path: { did }, query: query ?? {} }, parseAs: 'text' })),

    /** The shop's EARNINGS register (R4): its own ledger (top-ups / handling pay / fees / refunds). Owner-scoped. */
    ledger: (did: string, query?: AgentLedgerQuery) =>
      sbg.request((c) => c.GET('/v1/sbg/agents/{did}/ledger', { params: { path: { did }, query: query ?? {} } })),
    ledgerSummary: (did: string, query?: AgentLedgerQuery) =>
      sbg.request((c) => c.GET('/v1/sbg/agents/{did}/ledger/summary', { params: { path: { did }, query: query ?? {} } })),
    ledgerExport: (did: string, query?: AgentLedgerQuery) =>
      sbg.request((c) => c.GET('/v1/sbg/agents/{did}/ledger/export', { params: { path: { did }, query: query ?? {} }, parseAs: 'text' })),

    /** One parcel by sticker id (drives the release flow's state machine). */
    parcel: (id: string) => sbg.request((c) => c.GET('/v1/sbg/parcels/{id}', { params: { path: { id } } })),

    /** REP2 — rate a driver this shop just handed to / received from (stars + specific issue flags). Gated
     *  server-side on the real interaction. */
    rateDriver: (driverDid: string, body: { stars: number; issues?: string[] }) =>
      // issues are the checked issue keys — valid DRIVER_ISSUES members; cast to satisfy the enum-array contract.
      sbg.request((c) => c.POST('/v1/sbg/drivers/{did}/rate', { params: { path: { did: driverDid } }, body: { stars: body.stars, issues: body.issues as never } })),

    /** REP2 — a provider's public reputation profile (a driver or an agent): PII-free name + aggregate rating. */
    reputation: (did: string) => sbg.request((c) => c.GET('/v1/sbg/reputation/{did}', { params: { path: { did } } })),

    /** Take in a walk-up drop-off: sticker + MEASURED dims (the tier is derived) + destination PUDO +
     *  phones + proof photo. `size` is kept only as a legacy fallback. */
    accept: (body: {
      agentDid: string;
      parcelId: string;
      size?: 'S' | 'M' | 'L' | 'HEAVY';
      dimensionsCm?: { l: number; w: number; h: number };
      weightKg?: number;
      destZone: string;
      destPudoDid?: string;
      senderMobile: string;
      receiverMobile: string;
      dropoffPhotoRef: string;
      fragile?: boolean;
      // S30 — the commodity's primary cargo nature (default GEN server-side). Union mirrors CARGO_NATURES.
      natureCode?: 'GEN' | 'FOD' | 'FOP' | 'HAZ-CHEM' | 'HAZ-DUST' | 'HAZ-BIO' | 'HAZ-FLAM' | 'FRG' | 'ODR' | 'HUM';
    }) => sbg.request((c) => c.POST('/v1/sbg/parcels/accept', { body })),

    /** F2 — book a too-big (dedicated, P4+) walk-up as FREIGHT instead of refusing it. The agent is the
     *  on-platform originator; the customer pays a CASH `budgetCap` (→ the freight's maxSpend ceiling) at the
     *  counter and settles off-platform, so no wallet is billed. Immediate (no date) or planned
     *  (`scheduledPickupAt` + `allowEarlyClaim`, reusing F1). Returns the FRT code + a tracking key to print. */
    bookFreight: (body: {
      agentDid: string;
      dimensionsCm: { l: number; w: number; h: number };
      weightKg: number;
      natureCode?: 'GEN' | 'FOD' | 'FOP' | 'HAZ-CHEM' | 'HAZ-DUST' | 'HAZ-BIO' | 'HAZ-FLAM' | 'FRG' | 'ODR' | 'HUM';
      fragile?: boolean;
      destPudoDid: string;
      customerMobile?: string;
      budgetCap: number;
      scheduledPickupAt?: string;
      allowEarlyClaim?: boolean;
    }) => sbg.request((c) => c.POST('/v1/sbg/parcels/book-freight', { body })),

    /** F3 — open a consolidation LOT for a durable dry commodity (owner-scoped; the acting shop is the owner
     *  and its site becomes the freight's pickup). A perishable commodity is refused server-side. */
    openConsignment: (body: {
      natureCode?: 'GEN' | 'FOD' | 'FOP' | 'HAZ-CHEM' | 'HAZ-DUST' | 'HAZ-BIO' | 'HAZ-FLAM' | 'FRG' | 'ODR' | 'HUM';
      destLabel: string;
      destLocation?: { lat: number; lng: number };
      targetKg: number;
      maxSpend?: number;
    }) => sbg.request((c) => c.POST('/v1/sbg/consignments', { body })),

    /** F3 — record a member deposit (kg) into a lot; the lot auto-posts as one bulk freight once it fills. */
    depositConsignment: (code: string, body: { memberRef: string; weightKg: number }) =>
      sbg.request((c) => c.POST('/v1/sbg/consignments/{code}/deposit', { params: { path: { code } }, body })),

    /** F3 — this shop's consolidation lots (owner-scoped). */
    consignments: (owner: string) => sbg.request((c) => c.GET('/v1/sbg/consignments', { params: { query: { owner } } })),

    /** The public shop directory — the destination PUDOs the counter can send toward (Map/Address picker). */
    networkPoints: () => sbg.request((c) => c.GET('/v1/sbg/network/points')),

    /** Resolve a typed area/place to a point (the "Address" intake mode → rank the nearest PUDO). */
    geocode: (q: string) => sbg.request((c) => c.GET('/v1/sbg/geocode', { params: { query: { q } } })),

    /** Derive the size tier + cargo class from measured dims (shown live at the counter before accept). */
    classify: (l: number, w: number, h: number, kg: number) => sbg.request((c) => c.POST('/v1/sbg/size/classify', { body: { l, w, h, kg } })),

    /** PG4 — what a scanned sticker IS before confirming: a pre-minted peer send (with the cash due), a
     *  store order, or an already-used sticker. 404 = a fresh sticker → the walk-up form. Server-pinned
     *  to the acting shop (WRONG_PUDO for a parcel booked elsewhere). */
    intakePreview: (id: string) => sbg.request((c) => c.GET('/v1/sbg/parcels/{id}/intake-preview', { params: { path: { id } } })),

    /** PG4 — take a PRE-MINTED parcel in: a peer send (collect the locked price in cash + proof photo)
     *  or a store order (prepaid, no photo). One scan surface; the parcel's record decides. */
    intake: (id: string, dropoffPhotoRef?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/parcels/{id}/intake', { params: { path: { id } }, body: dropoffPhotoRef ? { dropoffPhotoRef } : {} })),

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
    /** Open a bag at this shop for one destination — the driver will scan it once instead of every parcel. */
    openBag: (did: string, destZone: string) =>
      sbg.request((c) => c.POST('/v1/sbg/agents/{did}/totes', { params: { path: { did } }, body: { destZone } })),

    /** Drop a waiting parcel into the open bag. */
    fillBag: (code: string, parcelId: string) =>
      sbg.request((c) => c.POST('/v1/sbg/totes/{code}/fill', { params: { path: { code } }, body: { parcelId } })),

    /** Seal it. The server refuses if a parcel for that destination is still on the shelf, unless the
     *  shop knowingly leaves it — the same gate the parcel-by-parcel handover has. */
    sealBag: (did: string, code: string, opts?: { acknowledgeShortShip?: boolean; shortShipReason?: string }) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/agents/{did}/totes/{code}/seal', { params: { path: { did, code } }, body: { ...opts } }),
      ),

    receiveBag: (did: string, code: string) =>
      sbg.request((c) => c.POST('/v1/sbg/agents/{did}/receive-bag', { params: { path: { did } }, body: { code } })),

    /** Reverse logistics: undo a drop-off within the 5-minute window with a torn-label photo → refund. */
    voidParcel: (parcelId: string, agentDid: string, voidedPhotoRef: string) =>
      sbg.request((c) => c.POST('/v1/sbg/parcels/{id}/void', { params: { path: { id: parcelId } }, body: { agentDid, voidedPhotoRef } })),
  };
}

export type AgentApi = ReturnType<typeof createAgentApi>;
