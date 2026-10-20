import type { SbgClient } from '../client';

/**
 * MDP persona facade — the ONLY operations the sort-hub app can name. The floor loop from
 * Compendium Ch 17: drop a bag (empty it), sort each parcel (the system answers WHICH bag),
 * load a full bag onward (one scan moves everything inside), register fresh totes — plus
 * the hub's open-data sort fee. Every method returns a Result, never throws.
 */
export function createMdpApi(sbg: SbgClient) {
  return {
    /** All hubs — the app resolves its own by the signed-in DID. */
    mdps: () => sbg.request((c) => c.GET('/v1/sbg/mdps', {})),

    /** Totes currently at this hub. (Empty `status` = no status filter, per the backend.) */
    totesAt: (mdpId: string) => sbg.request((c) => c.GET('/v1/sbg/totes', { params: { query: { location: mdpId, status: '' } } })),

    /** Every parcel in At_MDP (the app keeps only its own hub's; empty `agent` = no filter). */
    parcelsAtMdp: () => sbg.request((c) => c.GET('/v1/sbg/parcels', { params: { query: { status: 'At_MDP', agent: '' } } })),

    /** A bus dropped a bag: empty it — its parcels join the sort queue, the tote frees up. */
    dropBag: (mdpId: string, code: string) =>
      sbg.request((c) => c.POST('/v1/sbg/mdps/{id}/drop-bag', { params: { path: { id: mdpId } }, body: { code } })),

    /** Sort one parcel: the system answers the next destination + the bag to place it in. */
    sort: (mdpId: string, parcelId: string) =>
      sbg.request((c) => c.POST('/v1/sbg/mdps/{id}/sort', { params: { path: { id: mdpId } }, body: { parcelId } })),

    /** Scan a full bag onto the bus — every parcel inside goes On_Bus in one move. */
    loadBag: (code: string, driverBadgeId: string) =>
      sbg.request((c) => c.POST('/v1/sbg/totes/{code}/load', { params: { path: { code } }, body: { driverBadgeId, observedAt: new Date().toISOString() } })),

    /** Register a fresh laminated tote into this hub's pool. */
    newTote: (mdpId: string) => sbg.request((c) => c.POST('/v1/sbg/mdps/{id}/totes', { params: { path: { id: mdpId } } })),

    /** Publish this hub's per-parcel sort fee (open data). */
    setPrice: (mdpId: string, price: number) =>
      sbg.request((c) => c.PATCH('/v1/sbg/mdps/{id}/pricing', { params: { path: { id: mdpId } }, body: { price } })),

    /** Nearby hubs' sort fees — the benchmark this hub prices against. */
    ratesNear: (at?: { lat: number; lng: number }) =>
      sbg.request((c) =>
        c.GET('/v1/sbg/pricing/near', { params: { query: { type: 'mdp', ...(at ? { lat: String(at.lat), lng: String(at.lng) } : {}) } } }),
      ),
  };
}

export type MdpApi = ReturnType<typeof createMdpApi>;
