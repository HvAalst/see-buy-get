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

    /** Start a shift by scanning the vehicle QR (couples driver ↔ vehicle). */
    startSession: (did: string, vehicleQr: string) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/start-session', { params: { path: { did } }, body: { vehicleQr } })),

    /** End the shift (decouple). */
    endSession: (did: string) => sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/end-session', { params: { path: { did } } })),

    /** Declare a route A→B and get offered nearby totes/freight sized to the vehicle's remaining capacity. */
    suggestWork: (did: string, body: { from: { lat: number; lng: number }; to: { lat: number; lng: number }; departAt?: string; minEarn?: number }) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/suggest-work', { params: { path: { did } }, body })),

    /** Accept an offer. */
    claimOffer: (offerId: string) => sbg.request((c) => c.POST('/v1/sbg/dispatch/offers/{id}/claim', { params: { path: { id: offerId } } })),

    /** Decline an offer. */
    ignoreOffer: (offerId: string) => sbg.request((c) => c.POST('/v1/sbg/dispatch/offers/{id}/ignore', { params: { path: { id: offerId } } })),

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
