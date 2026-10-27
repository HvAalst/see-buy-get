import type { SbgClient } from '../client';
import type { components } from '../schema';
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

    /** 2026-10-27 — the new label of a parcel its store called off here: printed, and put over the old one. */
    hubLabel: (mdpId: string, parcelId: string) => sbg.request((c) => c.GET('/v1/sbg/mdps/{id}/parcels/{parcelId}/label', { params: { path: { id: mdpId, parcelId } } })),
    hubLabelZpl: (mdpId: string, parcelId: string) =>
      sbg.request((c) => c.GET('/v1/sbg/mdps/{id}/parcels/{parcelId}/label.zpl', { params: { path: { id: mdpId, parcelId } }, parseAs: 'text' })),

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

    /** Reading B — whether this hub takes stores' parcels in bulk, and when; and what is coming to it. */
    arrivals: (mdpId: string) => sbg.request((c) => c.GET('/v1/sbg/mdps/{id}/arrivals', { params: { path: { id: mdpId } } })),

    /** The hub's own word that it takes stores' parcels in bulk — its days and hours, its doors — or no longer does. Its owner's. */
    setBulk: (mdpId: string, body: { open: boolean; hours?: Record<string, { open: string; close: string } | null> | null; doors?: number | null; fees?: Record<string, number | null> | null }) =>
      sbg.request((c) => c.PUT('/v1/sbg/mdps/{id}/bulk', { params: { path: { id: mdpId } }, body: body as never })),

    /** At the hub's door: the units that came, counted, and a line of the hub's words. */
    receiveArrival: (mdpId: string, arrivalId: string, body: { units: number; note?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/mdps/{id}/arrivals/{arrivalId}/receive', { params: { path: { id: mdpId, arrivalId } }, body })),

    /** D11 — the store's empties counted out at the door, to whoever brought them. */
    emptiesBack: (mdpId: string, arrivalId: string, units: number) =>
      sbg.request((c) => c.POST('/v1/sbg/mdps/{id}/arrivals/{arrivalId}/empties', { params: { path: { id: mdpId, arrivalId } }, body: { units } })),

    /** One parcel scanned off the units, by its label: the hub answers for it from here. */
    scanArrival: (mdpId: string, arrivalId: string, code: string) =>
      sbg.request((c) => c.POST('/v1/sbg/mdps/{id}/arrivals/{arrivalId}/scan', { params: { path: { id: mdpId, arrivalId } }, body: { code } })),

    /** Scanning finished: what was booked and not scanned did not come — still the store's, which is told. */
    finishArrival: (mdpId: string, arrivalId: string) =>
      sbg.request((c) => c.POST('/v1/sbg/mdps/{id}/arrivals/{arrivalId}/finish', { params: { path: { id: mdpId, arrivalId } } })),

    /** Its day is over on the hub's clock and nothing came: the hub says so, and the store is told. */
    missedArrival: (mdpId: string, arrivalId: string) =>
      sbg.request((c) => c.POST('/v1/sbg/mdps/{id}/arrivals/{arrivalId}/missed', { params: { path: { id: mdpId, arrivalId } } })),

    /** The hub's opening hours and how to reach it: its own entry, and whether it is open now on its clock. */
    contact: (mdpId: string) => sbg.request((c) => c.GET('/v1/sbg/mdps/{id}/contact', { params: { path: { id: mdpId } } })),

    /** Its owner writes it — a merge: a field left out stays, an empty one goes, hours sent as null go. */
    setContact: (mdpId: string, body: { openingHours?: Record<string, { open: string; close: string } | null> | null; phone?: string; phoneAlt?: string; askFor?: string; gate?: string; email?: string; publish?: boolean }) =>
      sbg.request((c) => c.PUT('/v1/sbg/mdps/{id}/contact', { params: { path: { id: mdpId } }, body: body as never })),

    /** What the hub moves bags on between hubs (D11): its kinds, each with what it holds, worked out by the server. */
    carriers: (mdpId: string) => sbg.request((c) => c.GET('/v1/sbg/mdps/{id}/carriers', { params: { path: { id: mdpId } } })),

    /** Its owner writes the list, whole: a kind with its id is that kind changed, one without is new, one left out is off. */
    setCarriers: (mdpId: string, carriers: components['schemas']['HubCarrierInput'][]) =>
      sbg.request((c) => c.PUT('/v1/sbg/mdps/{id}/carriers', { params: { path: { id: mdpId } }, body: { carriers } })),

    /** D11 — its carriers on the move: its own, away; other hubs', come to it. */
    carrierMoves: (mdpId: string) => sbg.request((c) => c.GET('/v1/sbg/mdps/{id}/carrier-moves', { params: { path: { id: mdpId } } })),

    /** Carriers go with a driver (the pass scanned) to another hub, and how they come back. */
    sendCarriers: (mdpId: string, body: components['schemas']['SendCarriersDto']) => sbg.request((c) => c.POST('/v1/sbg/mdps/{id}/carrier-moves', { params: { path: { id: mdpId } }, body })),

    /** The other hub did what was said: counted out to the driver (how many), taken in as left, or kept aside. */
    carriersDone: (mdpId: string, moveId: string, count?: number) =>
      sbg.request((c) => c.POST('/v1/sbg/mdps/{id}/carrier-moves/{moveId}/done', { params: { path: { id: mdpId, moveId } }, body: count != null ? { count } : {} })),

    /** The owner posts the return job for its carriers kept aside at another hub: what they weigh together. */
    carrierReturnJob: (mdpId: string, moveId: string, weightKg: number) =>
      sbg.request((c) => c.POST('/v1/sbg/mdps/{id}/carrier-moves/{moveId}/return-job', { params: { path: { id: mdpId, moveId } }, body: { weightKg } })),

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
