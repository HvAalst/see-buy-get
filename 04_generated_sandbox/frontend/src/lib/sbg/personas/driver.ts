import type { SbgClient } from '../client';

/**
 * Driver persona facade — the ONLY operations the driver app can name. Because it exports just this
 * slice, the driver PWA literally cannot type an operator or fleet-manager call: a compile-time mirror
 * of the runtime scope check. Every method returns a Result (data | typed error), never throws.
 *
 * Mirrors the 13 calls the legacy driver.js made, now typed against the generated contract.
 */
export function createDriverApi(sbg: SbgClient) {
  return {
    /** The driver's own record (status, badge, registry). */
    me: (did: string) => sbg.request((c) => c.GET('/v1/sbg/fleet/drivers/{did}', { params: { path: { did } } })),

    /** The current shift session (coupled vehicle, corridor) — null-ish when off shift. */
    session: (did: string) => sbg.request((c) => c.GET('/v1/sbg/fleet/drivers/{did}/session', { params: { path: { did } } })),

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

    /** S32b — pick up a claimed dedicated-freight job (claimed → in_transit). Sends the driver's own DID so
     *  the server can confirm THIS driver claimed it (only the claimer may advance a job). */
    pickupFreight: (freightId: string, driverDid: string) =>
      sbg.request((c) => c.POST('/v1/sbg/dispatch/freight/{id}/pickup', { params: { path: { id: freightId } }, body: { driverDid } })),

    /** S32b — deliver an in-transit dedicated-freight job (in_transit → delivered; capacity released). */
    deliverFreight: (freightId: string, driverDid: string) =>
      sbg.request((c) => c.POST('/v1/sbg/dispatch/freight/{id}/deliver', { params: { path: { id: freightId } }, body: { driverDid } })),
  };
}

export type DriverApi = ReturnType<typeof createDriverApi>;
