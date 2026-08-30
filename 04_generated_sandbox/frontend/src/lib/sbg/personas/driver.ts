import type { SbgClient } from '../client';
import { createMediaApi } from './media';

/** The driver jobs + earnings register query (all optional). */
export interface DriverJobsQuery {
  q?: string;
  status?: 'available' | 'claimed' | 'in_transit' | 'delivered';
  paid?: 'paid' | 'unpaid';
  from?: string;
  to?: string;
  sort?: 'newest' | 'oldest' | 'earn_desc' | 'earn_asc';
  limit?: string;
  offset?: string;
}

/** The road a driver declares for a shift: both ends named AND pinned (the places have no addresses). */
export interface DeclaredLegBody {
  fromLabel: string;
  from: { lat: number; lng: number };
  toLabel: string;
  to: { lat: number; lng: number };
}

/**
 * Driver persona facade — the ONLY operations the driver app can name. Because it exports just this
 * slice, the driver PWA literally cannot type an operator or fleet-manager call: a compile-time mirror
 * of the runtime scope check. Every method returns a Result (data | typed error), never throws.
 *
 * Mirrors the 13 calls the legacy driver.js made, now typed against the generated contract.
 */
export function createDriverApi(sbg: SbgClient) {
  return {
    // S33 — real image upload/fetch, for the securement photo at freight pickup (the driver app had no
    // media capability before this; the securement gate is the first operation that needs it).
    ...createMediaApi(sbg),

    /** The driver's own record (status, badge, registry). */
    me: (did: string) => sbg.request((c) => c.GET('/v1/sbg/fleet/drivers/{did}', { params: { path: { did } } })),

    /** The current shift session (coupled vehicle, corridor) — null-ish when off shift. */
    session: (did: string) => sbg.request((c) => c.GET('/v1/sbg/fleet/drivers/{did}/session', { params: { path: { did } } })),

    /** The driver's JOBS + EARNINGS register (R5): a searched/filtered/paged page of the freight hauls they
     *  claimed → { items, total }. Owner-scoped. */
    jobs: (did: string, query?: DriverJobsQuery) =>
      sbg.request((c) => c.GET('/v1/sbg/fleet/drivers/{did}/jobs', { params: { path: { did }, query: query ?? {} } })),
    jobsSummary: (did: string, query?: DriverJobsQuery) =>
      sbg.request((c) => c.GET('/v1/sbg/fleet/drivers/{did}/jobs/summary', { params: { path: { did }, query: query ?? {} } })),
    jobsExport: (did: string, query?: DriverJobsQuery) =>
      sbg.request((c) => c.GET('/v1/sbg/fleet/drivers/{did}/jobs/export', { params: { path: { did }, query: query ?? {} }, parseAs: 'text' })),

    /** What the driver has claimed (totes / freight in hand). */
    claims: (did: string) => sbg.request((c) => c.GET('/v1/sbg/fleet/drivers/{did}/claims', { params: { path: { did } } })),

    /** Nearby open-data transport rates (the driver sets their own per-km price against the market). */
    vehicleRates: () => sbg.request((c) => c.GET('/v1/sbg/pricing/near', { params: { query: { type: 'vehicle' } } })),

    /** Heartbeat + last-seen (drives the live fleet map). */
    ping: (did: string) => sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/ping', { params: { path: { did } } })),

    /** MDP hubs and PUDO agents — endpoints the driver can route toward. */
    mdps: () => sbg.request((c) => c.GET('/v1/sbg/mdps', {})),
    agents: () => sbg.request((c) => c.GET('/v1/sbg/agents', {})),

    /** Set this vehicle's public per-km rate. */
    setVehiclePrice: (vehicleId: string, price: number) =>
      sbg.request((c) => c.PATCH('/v1/sbg/vehicles/{id}/pricing', { params: { path: { id: vehicleId } }, body: { price } })),

    /** Start a shift: scan the vehicle QR, or name one already driven before — optionally saying where it goes. */
    startSession: (did: string, vehicle: { vehicleQr?: string; vehicleId?: string }, leg?: DeclaredLegBody) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/start-session', { params: { path: { did } }, body: { ...vehicle, leg } })),

    /** The vehicles this driver has driven before — the "which one today?" list, before they reach the yard. */
    driverVehicles: (did: string) => sbg.request((c) => c.GET('/v1/sbg/fleet/drivers/{did}/vehicles', { params: { path: { did } } })),

    /** Say (or re-say) the road this shift is running — what "a load near you" is matched against. */
    declareLeg: (did: string, leg: DeclaredLegBody) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/leg', { params: { path: { did } }, body: leg })),

    /** The roads this driver has run before — offered instead of naming two places every morning. */
    driverLegs: (did: string) => sbg.request((c) => c.GET('/v1/sbg/fleet/drivers/{did}/legs', { params: { path: { did } } })),

    /** Resolve a typed place to a point — for a road end that is a market or a junction, not a PUDO. */
    geocode: (q: string) => sbg.request((c) => c.GET('/v1/sbg/geocode', { params: { query: { q } } })),

    /** End the shift (decouple). */
    endSession: (did: string) => sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/end-session', { params: { path: { did } } })),

    /** Declare a route A→B and get offered nearby totes/freight sized to the vehicle's remaining capacity. */
    suggestWork: (did: string, body: { from: { lat: number; lng: number }; to: { lat: number; lng: number }; departAt?: string; minEarn?: number }) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/suggest-work', { params: { path: { did } }, body })),

    /** Find work AROUND me — the bike/bajaj half of the marketplace, matched by distance, not by detour. */
    suggestNearby: (did: string, body: { at: { lat: number; lng: number }; radiusKm: number; minEarn?: number }) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/suggest-nearby', { params: { path: { did } }, body })),

    /** Hold new offers. Omit `minutes` for "until I resume". Never touches loads already claimed. */
    snoozeWork: (did: string, minutes?: number) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/snooze', { params: { path: { did } }, body: { minutes } })),

    /** Take work again, now. */
    resumeWork: (did: string) => sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/resume', { params: { path: { did } } })),

    /** Declare the patch this rider works: "loads within this many km of me". */
    declareArea: (did: string, radiusKm: number) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/area', { params: { path: { did } }, body: { radiusKm } })),

    /** GPS heartbeat: where the vehicle is now. Feeds the live map, the market's supply side, and the
     *  "a load on the road you are on" nudge — none of which can be true without it. */
    locate: (did: string, at: { lat: number; lng: number }) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/locate', { params: { path: { did } }, body: at })),

    /** Accept an offer. */
    /** The offers still awaiting an answer — what a notification tap opens, without re-declaring a route. */
    activeOffers: (did: string) => sbg.request((c) => c.GET('/v1/sbg/fleet/drivers/{did}/offers', { params: { path: { did } } })),

    claimOffer: (offerId: string) => sbg.request((c) => c.POST('/v1/sbg/dispatch/offers/{id}/claim', { params: { path: { id: offerId } } })),

    /** Decline an offer. */
    ignoreOffer: (offerId: string) => sbg.request((c) => c.POST('/v1/sbg/dispatch/offers/{id}/ignore', { params: { path: { id: offerId } } })),

    /**
     * FB1 — the open board: the whole market from where the operator is standing.
     *
     * `radiusKm` is the OPERATOR's own reach, and omitting it means the entire market — there is deliberately
     * no platform clamp on this call, unlike the 15 km one that governs being interrupted. Every load comes
     * back, including the ones this vehicle cannot take, each carrying its own typed reasons.
     */
    freightBoard: (at: { lat: number; lng: number }, radiusKm?: number) =>
      sbg.request((c) => c.GET('/v1/sbg/dispatch/board', { params: { query: { lat: at.lat, lng: at.lng, ...(radiusKm != null ? { radiusKm } : {}) } } })),

    /** FB0c — name a price for a load posted for negotiation. Reserves nothing: the shipper's acceptance is
     *  what claims it, so the load stays open to everyone until then. */
    proposeForFreight: (freightId: string, body: { from: { lat: number; lng: number }; price: number; note?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/dispatch/freight/{id}/proposals', { params: { path: { id: freightId } }, body })),

    /** FB0c — pull back a price already named. */
    withdrawProposal: (proposalId: string) =>
      sbg.request((c) => c.POST('/v1/sbg/dispatch/proposals/{id}/withdraw', { params: { path: { id: proposalId } }, body: {} })),

    /** Scan a released bag onto the vehicle. */
    loadBag: (code: string, driverBadgeId: string) =>
      sbg.request((c) => c.POST('/v1/sbg/totes/{code}/load', { params: { path: { code } }, body: { driverBadgeId } })),

    /** S32b/S33 — pick up a claimed dedicated-freight job (claimed → in_transit). Sends the driver's own DID
     *  (only the claimer may advance a job) plus the S33 load-safety gate: the confirmed checklist keys + the
     *  securement photo mediaId. */
    pickupFreight: (freightId: string, driverDid: string, check?: { confirmed?: string[]; securementPhotoId?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/dispatch/freight/{id}/pickup', { params: { path: { id: freightId } }, body: { driverDid, ...check } })),

    /** S32b/S33 — deliver an in-transit dedicated-freight job (in_transit → delivered; capacity released),
     *  with the confirmed unload-checklist keys. */
    deliverFreight: (freightId: string, driverDid: string, check?: { confirmed?: string[] }) =>
      sbg.request((c) => c.POST('/v1/sbg/dispatch/freight/{id}/deliver', { params: { path: { id: freightId } }, body: { driverDid, ...check } })),

    /** S33b — log a temperature reading for a cold-chain freight in transit (a breach flags it for the tower). */
    recordTemp: (freightId: string, driverDid: string, celsius: number) =>
      sbg.request((c) => c.POST('/v1/sbg/dispatch/freight/{id}/temperature', { params: { path: { id: freightId } }, body: { driverDid, celsius } })),
  };
}

export type DriverApi = ReturnType<typeof createDriverApi>;
