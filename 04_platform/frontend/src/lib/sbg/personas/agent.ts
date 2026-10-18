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

    /** Send the shop's papers to be approved: each is the id of a picture this shop uploaded. */
    submitKyc: (did: string, body: { idCopyRef: string; tradingLicenceRef: string; shopPhotoRefs: string[] }) =>
      sbg.request((c) => c.POST('/v1/sbg/agents/{did}/submit-kyc', { params: { path: { did } }, body })),

    /** The 'no money, no scan' gate — { ok, code, balance, shortfall } as readable state. */
    canTransact: (did: string) => sbg.request((c) => c.GET('/v1/sbg/agents/{did}/can-transact', { params: { path: { did } } })),

    /**
     * ASK to top up the wallet that funds every accept scan.
     *
     * It does NOT add money. It hands back a reference and how to pay against it; the balance moves when
     * the payment provider confirms the payment. Before 2026-09-22 this route credited the float with
     * whatever number was typed here — see `foundation/funding` for why that changed.
     */
    topUp: (did: string, amount: number, phone?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/agents/{did}/top-up', { params: { path: { did } }, body: { amount, ...(phone ? { phone } : {}) } })),

    /** What this shop is waiting to have confirmed, and what was confirmed lately. */
    funding: (did: string) => sbg.request((c) => c.GET('/v1/sbg/agents/{did}/funding', { params: { path: { did } } })),

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

    /** Declare how many outbound BAGS the shop can stage on its floor at once (the shelf's counterpart). */
    setBagBays: (did: string, bays: number) =>
      sbg.request((c) => c.POST('/v1/sbg/agents/{did}/bag-bays', { params: { path: { did } }, body: { bays } })),

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
    /**
     * What is physically standing in this shop: the pile waiting to go on a bus, and the pile a customer
     * is coming to collect.
     *
     * It asked for At_PUDO alone until 2026-09-06, which meant the counter's "N to collect" was computed
     * over a list that could never contain one — the line was dead and the shopkeeper was never told
     * anybody's parcel had arrived. Both statuses, one round trip.
     */
    parcelsAtShop: (did: string) =>
      sbg.request((c) => c.GET('/v1/sbg/parcels', { params: { query: { status: 'At_PUDO,Ready_For_Pickup,Unclaimed', agent: did } } })),

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
      /** How long it took at the counter, by this app's clock — for the pilot's numbers. */
      takeInSeconds?: number;
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
      /** CL1 — the trade term the customer agreed with their buyer, and the place it names. Optional: most
       *  walk-ups have agreed none, and a load with no term leaves standing where it has always been. */
      incoterm?: 'EXW' | 'FCA' | 'CPT' | 'CIP' | 'DAP' | 'DPU' | 'DDP' | 'FAS' | 'FOB' | 'CFR' | 'CIF';
      namedPlace?: string;
      scheduledPickupAt?: string;
      allowEarlyClaim?: boolean;
      /** FB2b — 'negotiate' posts the load for drivers to name a price the counter then accepts, rather than
       *  the first fit truck taking it at the computed rate. The cash cap binds either way. */
      commitMode?: 'instant' | 'negotiate';
      /** FB2c — the two facts only the counter can supply: whether the load can be split (which decides an
       *  open deck versus a low-loader) and what the shop thinks it needs (advisory, never matched on). */
      indivisible?: boolean;
      bodyHint?: 'flatbed' | 'box' | 'curtain_side' | 'refrigerated' | 'tipper' | 'lowboy' | 'skeletal';
      /** FB5 — how the goods are PACKED, which is what decides the body and whether anything has to lift
       *  them. Absent falls back to the DEPLOYMENT's default (sacks here, loose in a European deployment),
       *  so the counter always sends it: a default is a guess about the region, this is a fact about the
       *  load. `bulk` is derived from it server-side and is never sent. */
      packaging?: 'loose' | 'bagged' | 'palletised' | 'drummed' | 'baled' | 'ibc' | 'piece';
      /** FB2d — bodies the CUSTOMER rules out. Unlike the hint above this one BINDS: a driver on an excluded
       *  body still sees the load on the board, marked with the shipper's refusal, and is refused the claim. */
      excludedBodies?: ('flatbed' | 'box' | 'curtain_side' | 'refrigerated' | 'tipper' | 'lowboy' | 'skeletal')[];
      // FP7 — box 13 at the counter.
      instructions?: string;
      contactName?: string;
      contactPhone?: string;
      deliveryWindow?: string;
    }) => sbg.request((c) => c.POST('/v1/sbg/parcels/book-freight', { body })),

    /** FB2b — the loads THIS shop posted, each with how many prices are waiting for an answer. Owner-scoped
     *  server-side; the shop is pinned to its own token. */
    postedFreight: () => sbg.request((c) => c.GET('/v1/sbg/dispatch/posted', {})),

    /** FB2b — the prices offered on one of my loads, newest first. */
    /** FP2 — the load's consignment note (CMR), as a printable page. */
    freightNote: (freightId: string) => sbg.request((c) => c.GET('/v1/sbg/dispatch/freight/{id}/consignment-note.html', { params: { path: { id: freightId } }, parseAs: 'text' })),
    /** FP3 — withdraw a posted load before the goods are taken over. The reason goes on the consignment note. */
    cancelFreight: (freightId: string, reason: string) => sbg.request((c) => c.POST('/v1/sbg/dispatch/freight/{id}/cancel', { params: { path: { id: freightId } }, body: { reason } })),
    /** FP7 — the sender's instructions (CMR box 13): rewritten before pickup, added to on the road. */
    setFreightInstructions: (freightId: string, body: { text?: string; contactName?: string; contactPhone?: string; deliveryWindow?: string }) =>
      sbg.request((c) => c.PATCH('/v1/sbg/dispatch/freight/{id}/instructions', { params: { path: { id: freightId } }, body: body as never })),
    /** FP6 — the shop rates the carrier on a delivered load: stars, and what went wrong if anything. */
    rateFreight: (freightId: string, body: { stars: number; issues?: string[] }) =>
      sbg.request((c) => c.POST('/v1/sbg/dispatch/freight/{id}/rate', { params: { path: { id: freightId } }, body: body as never })),
    /** FP3b — the shop's claim against a delivered load: damaged, short, or not received. */
    openFreightClaim: (freightId: string, body: { kind: 'damaged' | 'short' | 'not_received'; description: string; photoRef?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/dispatch/freight/{id}/claim', { params: { path: { id: freightId } }, body })),
    freightProposals: (freightId: string) =>
      sbg.request((c) => c.GET('/v1/sbg/dispatch/freight/{id}/proposals', { params: { path: { id: freightId } } })),

    /** FB2b — take a price. THIS is what claims the load; it is not a separate confirmation step. */
    acceptProposal: (proposalId: string) =>
      sbg.request((c) => c.POST('/v1/sbg/dispatch/proposals/{id}/accept', { params: { path: { id: proposalId } } })),

    /** FB2b — say no to one price. The load, and every other price on it, stay open. */
    declineProposal: (proposalId: string) =>
      sbg.request((c) => c.POST('/v1/sbg/dispatch/proposals/{id}/decline', { params: { path: { id: proposalId } } })),

    /** F3 — open a consolidation LOT for a durable dry commodity (owner-scoped; the acting shop is the owner
     *  and its site becomes the freight's pickup). A perishable commodity is refused server-side. */
    openConsignment: (body: {
      natureCode?: 'GEN' | 'FOD' | 'FOP' | 'HAZ-CHEM' | 'HAZ-DUST' | 'HAZ-BIO' | 'HAZ-FLAM' | 'FRG' | 'ODR' | 'HUM';
      /** Where the lot is actually collected (a co-op shed, a farm gate). Omitted → the owning shop's site. */
      pickupLabel?: string;
      pickupLocation?: { lat: number; lng: number };
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

    /** P3 — whose promise a walk-up taken in here is under, who answers for it, and the cover. Asked when
     *  the take-in screen opens, so it is said before the goods are accepted rather than after a refusal. */
    takeInTerms: (did: string) => sbg.request((c) => c.GET('/v1/sbg/agents/{did}/take-in-terms', { params: { path: { did } } })),

    /** PG4 — take a PRE-MINTED parcel in: a peer send (collect the locked price in cash + proof photo)
     *  or a store order (prepaid, no photo). One scan surface; the parcel's record decides. */
    intake: (id: string, dropoffPhotoRef?: string, takeInSeconds?: number) =>
      sbg.request((c) => c.POST('/v1/sbg/parcels/{id}/intake', { params: { path: { id } }, body: { ...(dropoffPhotoRef ? { dropoffPhotoRef } : {}), ...(takeInSeconds ? { takeInSeconds } : {}) } })),

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
    /** What to bag: waiting parcels grouped by NEXT HOP, plus the bags already open at this shop. */
    bagPlan: (did: string) => sbg.request((c) => c.GET('/v1/sbg/agents/{did}/bag-plan', { params: { path: { did } } })),

    /** Open a bag at this shop for one destination — the driver will scan it once instead of every parcel. */
    openBag: (did: string, destZone: string) =>
      sbg.request((c) => c.POST('/v1/sbg/agents/{did}/totes', { params: { path: { did } }, body: { destZone } })),

    /** Drop a waiting parcel into the open bag. The shop path, so a parcel going elsewhere is refused. */
    fillBag: (did: string, code: string, parcelId: string) =>
      sbg.request((c) => c.POST('/v1/sbg/agents/{did}/totes/{code}/fill', { params: { path: { did, code } }, body: { parcelId } })),

    /** Seal it. The server refuses if a parcel for that destination is still on the shelf, unless the
     *  shop knowingly leaves it — the same gate the parcel-by-parcel handover has. */
    sealBag: (did: string, code: string, opts?: { acknowledgeShortShip?: boolean; shortShipReason?: string }) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/agents/{did}/totes/{code}/seal', { params: { path: { did, code } }, body: { ...opts } }),
      ),

    receiveBag: (did: string, code: string) =>
      sbg.request((c) => c.POST('/v1/sbg/agents/{did}/receive-bag', { params: { path: { did } }, body: { code } })),

    /* --------------------------------- F3: taking space on a run that is already going -------- */

    /**
     * SPACE A SHIPPER CAN BUY — open departures that have not left, soonest first.
     *
     * The other direction of this market. Posting a load and waiting for a carrier to bid is the right
     * shape when the load is the scarce thing; when it is not, the cheapest capacity in the network is a
     * truck leaving anyway, and this is the list of them. A full departure is simply absent — it is not an
     * error and nobody needs telling, because a row whose only content is "you cannot have this" is noise.
     */
    departureOffers: (filter?: { from?: string; to?: string }) =>
      sbg.request((c) => c.GET('/v1/sbg/departures' as never, { params: { query: { ...(filter?.from ? { from: filter.from } : {}), ...(filter?.to ? { to: filter.to } : {}) } } } as never)),

    /**
     * What this load would cost on that run, and which axis of it the load fills — BEFORE booking.
     *
     * The same rule the top-up fee is held to: say the price before anybody commits. It refuses for every
     * reason `book` would, so a shipper learns "only 12 m³ of space is left" while they can still do
     * something about it rather than at the moment they press the button.
     */
    quoteDeparture: (departureId: string, load: { description: string; weightKg: number; volumeM3?: number }) =>
      sbg.request((c) => c.POST('/v1/sbg/departures/{departureId}/quote' as never, { params: { path: { departureId } }, body: load } as never)),

    /** Take the space. The shipper is the token's own DID, never one the body names. */
    bookDeparture: (departureId: string, load: { description: string; weightKg: number; volumeM3?: number; freightId?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/departures/{departureId}/book' as never, { params: { path: { departureId } }, body: load } as never)),

    /** Give the space back — the shipper who took it, or the fleet that sold it. */
    /**
     * WHAT I BOOKED — the read this side shipped without.
     *
     * A shop took space, saw a toast, and the booking left their world: no time, no company, no way to
     * give it back, and no way to learn the run had been called off.
     */
    myDepartureBookings: () => sbg.request((c) => c.GET('/v1/sbg/departures/mine' as never, {} as never)),

    /**
     * SOMETHING WENT WRONG — recorded and evidenced, never decided by us.
     *
     * We did not take this payment and we carry no cover on these goods, so an award of ours would be
     * an award of somebody else’s money. What this gives both parties is the record.
     */
    openBookingClaim: (departureId: string, bookingId: string, body: { kind: string; description: string; photoRef?: string; amount?: number }) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/departures/{departureId}/bookings/{bookingId}/claim' as never, { params: { path: { departureId, bookingId } }, body } as never),
      ),

    cancelDepartureBooking: (departureId: string, bookingId: string) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/departures/{departureId}/bookings/{bookingId}/cancel' as never, { params: { path: { departureId, bookingId } } } as never),
      ),

    /** Reverse logistics: undo a drop-off within the 5-minute window with a torn-label photo → refund. */
    voidParcel: (parcelId: string, agentDid: string, voidedPhotoRef: string) =>
      sbg.request((c) => c.POST('/v1/sbg/parcels/{id}/void', { params: { path: { id: parcelId } }, body: { agentDid, voidedPhotoRef } })),
  };
}

export type AgentApi = ReturnType<typeof createAgentApi>;
