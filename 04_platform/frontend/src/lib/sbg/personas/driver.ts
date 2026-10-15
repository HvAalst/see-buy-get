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

    /** The fleets that have offered this driver a place — and what would have to be finished before saying yes. */
    fleetOffers: (did: string) => sbg.request((c) => c.GET('/v1/sbg/drivers/{did}/fleet-offers', { params: { path: { did } } })),

    /** Yes: drive for that fleet now. Every earlier session ends; a fresh token comes back for this phone. */
    acceptFleetOffer: (did: string, offerId: string) =>
      sbg.request((c) => c.POST('/v1/sbg/drivers/{did}/fleet-offers/{offerId}/accept', { params: { path: { did, offerId } } })),

    /** No. The fleet is told; nothing else changes. */
    declineFleetOffer: (did: string, offerId: string) =>
      sbg.request((c) => c.POST('/v1/sbg/drivers/{did}/fleet-offers/{offerId}/decline', { params: { path: { did, offerId } } })),

    /** Leave the fleet — the driver's own act, from their own sign-in. Refused by name while a shift runs or
     *  anything is in their hands. Every earlier session ends; a fresh token comes back for this phone. */
    leaveFleet: (did: string) => sbg.request((c) => c.POST('/v1/sbg/drivers/{did}/leave-fleet', { params: { path: { did } } })),

    /**
     * What riding for themselves would take, read before anything is asked: whether the app offers it (and the
     * sentence that says why not), what they are cleared to ride, and where a courier can register with which company.
     */
    rideAloneTerms: (did: string) => sbg.request((c) => c.GET('/v1/sbg/drivers/{did}/ride-alone', { params: { path: { did } } })),

    /** A driver who is in no fleet becomes a courier, at once: where they live, and the vehicle of their own. */
    rideAlone: (did: string, body: { country: string; vehicleClass: string; plate: string; truckSubtype?: string; idCopyRef?: string; licenceCopyRef?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/drivers/{did}/ride-alone', { params: { path: { did } }, body })),

    /**
     * FP4 — a driver sends the renewed licence: the photo (an uploaded `kyc_licence` media id) and the date
     * they read off it. It goes to their fleet's office, or — a courier without a fleet — to network staff,
     * and switches nothing on until whoever that is has read the card.
     */
    sendLicenceRenewal: (did: string, body: { copyRef: string; expiresAt: string; number?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/licence-renewal', { params: { path: { did } }, body: body as never })),

    /**
     * HEAVY REGISTRY: SEND THE DOCUMENTS THAT GET YOU CLEARED — an ID copy and the licence itself.
     *
     * The route has always accepted a driver's own token; only a fleet ever had a screen for it. So an
     * independent courier who registered for anything above a motorcycle sat at DRAFT being told that
     * "the fleet office must activate you", with no fleet office and no way to send anything.
     */
    submitKyc: (did: string, body: { idCopyRef: string; licenceCopyRef: string; photoRef?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/submit-kyc', { params: { path: { did } }, body: body as never })),

    /** The current shift session (coupled vehicle, corridor) — null-ish when off shift. */
    session: (did: string) => sbg.request((c) => c.GET('/v1/sbg/fleet/drivers/{did}/session', { params: { path: { did } } })),

    /** "Tell me when I can start": a driver resting after a working day asks to be told the moment the rest is over. */
    tellWhenRested: (did: string) => sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/rest/tell-me', { params: { path: { did } } })),

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
    /** FP2 — the consignment note of a load this driver carries. */
    freightNote: (freightId: string) => sbg.request((c) => c.GET('/v1/sbg/dispatch/freight/{id}/consignment-note.html', { params: { path: { id: freightId } }, parseAs: 'text' })),

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

    /**
     * Start a shift: scan the vehicle QR, or name one already driven before — optionally saying where it goes.
     * With the driver's PIN: a phone left signed in is not proof of who is holding it.
     */
    startSession: (did: string, vehicle: { vehicleQr?: string; vehicleId?: string }, pin: string, leg?: DeclaredLegBody) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/start-session', { params: { path: { did } }, body: { ...vehicle, pin, leg } })),

    /** The coming days this driver's fleet has said who drives, and whether they do. */
    driverRoster: (did: string) => sbg.request((c) => c.GET('/v1/sbg/fleet/drivers/{did}/roster', { params: { path: { did } } })),

    /** The vehicles this driver has driven before — the "which one today?" list, before they reach the yard. */
    driverVehicles: (did: string) => sbg.request((c) => c.GET('/v1/sbg/fleet/drivers/{did}/vehicles', { params: { path: { did } } })),

    /** Say (or re-say) the road this shift is running — what "a load near you" is matched against. */
    declareLeg: (did: string, leg: DeclaredLegBody) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/leg', { params: { path: { did } }, body: leg })),

    /** The roads this driver has run before — offered instead of naming two places every morning. */
    driverLegs: (did: string) => sbg.request((c) => c.GET('/v1/sbg/fleet/drivers/{did}/legs', { params: { path: { did } } })),

    /* ---- F3: the scheduled runs this driver is rostered on, and the waiting clock at each gate ---- */

    /** The departures the fleet has put this driver on, soonest first, with who is aboard each. */
    driverDepartures: (did: string) => sbg.request((c) => c.GET('/v1/sbg/fleet/drivers/{did}/departures' as never, { params: { path: { did } } } as never)),

    /**
     * AT THE GATE, and FREE TO GO. The two taps a demurrage charge rests on.
     *
     * No time is sent. The server takes its own clock when the tap lands, because a typed time is a claim
     * in a dispute the driver has a stake in and a tap is a record — and that difference is what lets the
     * shipper accept the number afterwards.
     */
    departureArrived: (departureId: string, bookingId: string, where: 'loading' | 'delivery') =>
      sbg.request((c) =>
        c.POST('/v1/sbg/departures/{departureId}/bookings/{bookingId}/arrived' as never, { params: { path: { departureId, bookingId } }, body: { where } } as never),
      ),
    departureFreeToGo: (departureId: string, bookingId: string, where: 'loading' | 'delivery') =>
      sbg.request((c) =>
        c.POST('/v1/sbg/departures/{departureId}/bookings/{bookingId}/free-to-go' as never, { params: { path: { departureId, bookingId } }, body: { where } } as never),
      ),

    /**
     * HANDED OVER, and who took it.
     *
     * Clocking out of the delivery gate proves the truck got there and says nothing about whether the load
     * came off it — which is the gap this closes. The name is optional because often nobody gives one.
     */
    handOver: (
      departureId: string,
      bookingId: string,
      proof: { receiverName: string; photoRef: string; remarks?: string; confirmed: string[] },
    ) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/departures/{departureId}/bookings/{bookingId}/delivered' as never, {
          params: { path: { departureId, bookingId } },
          body: proof,
        } as never),
      ),

    /** Secured and ready to pull away: the load-safety checklist, and the photograph of it strapped down. */
    secureBooking: (departureId: string, bookingId: string, body: { confirmed: string[]; securementPhotoRef?: string }) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/departures/{departureId}/bookings/{bookingId}/secured' as never, { params: { path: { departureId, bookingId } }, body } as never),
      ),

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
    /**
     * "Do not interrupt me for less than this", all in, for bags and freight alike.
     *
     * A STANDING setting, unlike the minimum typed into a work search: a fee floor is the driver's cost
     * base, not a mood, and it is the only one the lock-screen nudge can read — that path is triggered by
     * a GPS fix and has no request to carry a filter. Omit the amount (or send 0) to clear it.
     */
    setMinEarn: (did: string, amount?: number) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/min-earn', { params: { path: { did } }, body: { amount } })),

    snoozeWork: (did: string, minutes?: number) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/snooze', { params: { path: { did } }, body: { minutes } })),

    /** Take work again, now. */
    resumeWork: (did: string) => sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/resume', { params: { path: { did } } })),

    /** Switch off (or back on) the road the network works out from a load the driver takes. Off also clears
     *  that road and is honoured for the rest of the shift — a switch, not an argument with the next claim. */
    setDerivedLeg: (did: string, on: boolean) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/derived-leg', { params: { path: { did } }, body: { on } })),

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

    /**
     * The crowd-sourced road map: what drivers have reported on the roads around here.
     *
     * An empty list means nothing has been REPORTED, and never that the road is clear — no one surveys
     * these corridors, so a screen showing this has to carry that caveat itself.
     */
    roadNear: (at: { lat: number; lng: number }, radiusKm?: number) =>
      sbg.request((c) =>
        c.GET('/v1/sbg/route-constraints', { params: { query: { lat: at.lat, lng: at.lng, ...(radiusKm != null ? { radiusKm } : {}) } } }),
      ),

    /** What sits on the corridor between two places. Same caveat, and the response repeats it in `basis`. */
    roadAlongRoute: (from: { lat: number; lng: number }, to: { lat: number; lng: number }) =>
      sbg.request((c) =>
        c.GET('/v1/sbg/route-constraints/route', {
          params: { query: { fromLat: from.lat, fromLng: from.lng, toLat: to.lat, toLng: to.lng } },
        }),
      ),

    /**
     * One tap from the cab: there is something on this road.
     *
     * No `by` — who reported it comes from the token. `value` is metres for a height and kilograms for a
     * limit, and the kinds that have something to measure are refused without it.
     */
    reportRoad: (body: { kind: string; at: { lat: number; lng: number }; value?: number; note?: string; photoRef?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/route-constraints', { body: body as never })),

    /**
     * CL5 — MAY A PHOTOGRAPH BE KEPT IN THIS COUNTRY, AND WHAT MUST BE AGREED TO FIRST?
     *
     * Asked BEFORE the camera is offered. The notice comes back with the answer so the screen never keeps
     * its own copy of a consent text — that is how two versions of one start existing, and only one of
     * them was ever agreed to.
     */
    observationNotice: (country: string) => sbg.request((c) => c.GET('/v1/sbg/field-observations/notice', { params: { query: { country } } as never })),

    /** CL5 — what you were asked for at a counter. First-hand or refused, at the server and on the form. */
    recordObservation: (body: {
      country: string;
      place: string;
      subject: string;
      note?: string;
      happenedOn: string;
      firstHand: boolean;
      evidenceMediaId?: string;
      consentAgreed?: boolean;
      consentNoticeVersion?: string;
    }) => sbg.request((c) => c.POST('/v1/sbg/field-observations', { body: body as never })),

    /** The atlas — public, and the only honest way to ask "which country" of somebody at a border. */
    countryCatalogue: () => sbg.request((c) => c.GET('/v1/sbg/country-catalogue', {})),

    /** CL5 — what has been observed in a country, newest first by the date it happened. */
    fieldObservations: (country: string) => sbg.request((c) => c.GET('/v1/sbg/field-observations', { params: { query: { country } } as never })),

    /** A later passer-by agrees it is still there. */
    confirmRoad: (constraintId: string, body: { note?: string; photoRef?: string } = {}) =>
      sbg.request((c) => c.POST('/v1/sbg/route-constraints/{id}/confirm', { params: { path: { id: constraintId } }, body: body as never })),

    /**
     * A driver says it is gone — and it KEEPS WARNING.
     *
     * Deliberately not a delete. This disputes the constraint and puts it in front of an operator; it goes
     * on appearing and go on blocking meanwhile. A screen must not present it as removing anything.
     */
    refuteRoad: (constraintId: string, body: { note?: string; photoRef?: string } = {}) =>
      sbg.request((c) => c.POST('/v1/sbg/route-constraints/{id}/refute', { params: { path: { id: constraintId } }, body: body as never })),

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
    pickupFreight: (freightId: string, driverDid: string, check?: { confirmed?: string[]; securementPhotoId?: string; reservations?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/dispatch/freight/{id}/pickup', { params: { path: { id: freightId } }, body: { driverDid, ...check } })),

    /** S32b/S33 — deliver an in-transit dedicated-freight job (in_transit → delivered; capacity released),
     *  with the confirmed unload-checklist keys. */
    deliverFreight: (freightId: string, driverDid: string, check?: { confirmed?: string[]; receiverName?: string; podPhotoId?: string; remarks?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/dispatch/freight/{id}/deliver', { params: { path: { id: freightId } }, body: { driverDid, ...check } })),

    /** FP3b — the driver stood at the door and could not hand over. The load stays on the van; the sender is told. */
    failDelivery: (freightId: string, driverDid: string, body: { outcome: 'absent' | 'refused' | 'unreachable'; note?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/dispatch/freight/{id}/delivery-failed', { params: { path: { id: freightId } }, body: { driverDid, ...body } })),

    /** FP8 — the driver hands a claimed load back before pickup: back on the market, the sender told why. */
    handBack: (freightId: string, reason: string) =>
      sbg.request((c) => c.POST('/v1/sbg/dispatch/freight/{id}/hand-back', { params: { path: { id: freightId } }, body: { reason } })),

    /** S33b — log a temperature reading for a cold-chain freight in transit (a breach flags it for the tower). */
    recordTemp: (freightId: string, driverDid: string, celsius: number) =>
      sbg.request((c) => c.POST('/v1/sbg/dispatch/freight/{id}/temperature', { params: { path: { id: freightId } }, body: { driverDid, celsius } })),
  };
}

export type DriverApi = ReturnType<typeof createDriverApi>;
