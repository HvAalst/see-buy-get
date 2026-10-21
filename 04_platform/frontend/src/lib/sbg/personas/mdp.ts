import type { SbgClient } from '../client';
import { createMediaApi } from './media';

/**
 * MDP persona facade — the ONLY operations the sort-hub app can name. The floor loop from
 * Compendium Ch 17: drop a bag (empty it), sort each parcel (the system answers WHICH bag),
 * load a full bag onward (one scan moves everything inside), register fresh totes — plus
 * the hub's open-data sort fee. Every method returns a Result, never throws.
 */
export function createMdpApi(sbg: SbgClient) {
  return {
    // Round 35 — a photograph of a parcel found cut or opened (the tamper protocol), and nothing else at a hub yet.
    ...createMediaApi(sbg),

    /** Round 35 — a parcel standing at this hub found cut or opened: held here, SeeBuyGet operations told. */
    reportTamper: (mdpId: string, parcelId: string, body: { photoRefs: string[]; note?: string; observedAt?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/mdps/{id}/parcels/{parcelId}/tamper', { params: { path: { id: mdpId, parcelId } }, body })),

    /** All hubs — the app resolves its own by the signed-in DID. */
    mdps: () => sbg.request((c) => c.GET('/v1/sbg/mdps', {})),

    /** Totes currently at this hub. (Empty `status` = no status filter, per the backend.) */
    totesAt: (mdpId: string) => sbg.request((c) => c.GET('/v1/sbg/totes', { params: { query: { location: mdpId, status: '' } } })),

    /** Every parcel in At_MDP (the app keeps only its own hub's; empty `agent` = no filter). */
    parcelsAtMdp: () => sbg.request((c) => c.GET('/v1/sbg/parcels', { params: { query: { status: 'At_MDP', agent: '' } } })),

    /** A bus dropped a bag: empty it — its parcels join the sort queue, the tote frees up. */
    dropBag: (mdpId: string, code: string, receipt?: { sealNumber?: string; photoRef: string; asClosed: boolean }) =>
      sbg.request((c) => c.POST('/v1/sbg/mdps/{id}/drop-bag', { params: { path: { id: mdpId } }, body: { code, ...(receipt ? { receipt } : {}) } })),

    /** Round 36 — a bag as the hub may read it before receiving it: how it was closed, never its seal's number. */
    bag: (code: string) => sbg.request((c) => c.GET('/v1/sbg/totes/{code}', { params: { path: { code } } })),

    /** Round 36 — a bag closed for the road where it stands: its coded seal's number and a photograph, or a photograph. */
    closeBag: (code: string, body: { seal?: string; photoRef: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/totes/{code}/close', { params: { path: { code } }, body: { ...body, observedAt: new Date().toISOString() } })),

    /** Round 36 — a bag not as it was closed (the tamper protocol): held, operations told. */
    reportBagTamper: (code: string, body: { finding: 'seal_not_as_written' | 'seal_broken' | 'wrap_cut'; numberRead?: string; photoRefs: string[]; note?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/totes/{code}/tamper', { params: { path: { code } }, body: { ...body, observedAt: new Date().toISOString() } })),

    /** Sort one parcel: the system answers the next destination + the bag to place it in. */
    sort: (mdpId: string, parcelId: string) =>
      sbg.request((c) => c.POST('/v1/sbg/mdps/{id}/sort', { params: { path: { id: mdpId } }, body: { parcelId } })),

    /** Scan a full bag onto the bus — every parcel inside goes On_Bus in one move. */
    loadBag: (code: string, driverBadgeId: string) =>
      sbg.request((c) => c.POST('/v1/sbg/totes/{code}/load', { params: { path: { code } }, body: { driverBadgeId, observedAt: new Date().toISOString() } })),

    /** The hub's papers, from its own sign-in (the ISO 28000 check: "hubs are vetted"): each the id of a photograph it took. */
    sendPapers: (mdpId: string, body: { idCopyRef: string; licenceRef: string; photoRefs: string[] }) =>
      sbg.request((c) => c.POST('/v1/sbg/mdps/{id}/papers', { params: { path: { id: mdpId } }, body })),

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
