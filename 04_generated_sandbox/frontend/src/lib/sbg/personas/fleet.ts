import type { SbgClient } from '../client';
import type { components } from '../schema';
import { createMediaApi } from './media';

/**
 * Fleet-manager persona facade — the ONLY operations the fleet app can name, which is
 * also the honest scope of a fleet_manager token: registration, docs, coupling and the
 * scoped dashboards. KYC DECISIONS and suspensions are operator-only routes and are
 * deliberately absent — the app shows "GLOS is checking" instead of a button that 403s.
 *
 * The token's `tenant` (set at mint) scopes /vehicles, /fleet/drivers and /fleet/dashboard
 * server-side; no method here passes a manager id for reads.
 */
export function createFleetApi(sbg: SbgClient) {
  return {
    // S26: real image upload/fetch (vehicle body + trailer + registration photos).
    ...createMediaApi(sbg),

    /** FP2 — the consignment note of a load one of the fleet's drivers carried. */
    freightNote: (freightId: string) => sbg.request((c) => c.GET('/v1/sbg/dispatch/freight/{id}/consignment-note.html', { params: { path: { id: freightId } }, parseAs: 'text' })),

    /** FP1 — the fleet's earnings register: every driver's hauls, paged; the totals by driver and month + the money; CSV. */
    earnings: (did: string, query: Record<string, string | undefined>) =>
      sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/earnings', { params: { path: { did }, query: query as never } })),
    earningsSummary: (did: string, query: Record<string, string | undefined>) =>
      sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/earnings/summary', { params: { path: { did }, query: query as never } })),
    earningsExport: (did: string, query: Record<string, string | undefined>) =>
      sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/earnings/export', { params: { path: { did }, query: query as never }, parseAs: 'text' })),

    /** Counts, working hours, live positions and active cargo — scoped by the token.
     *  (`manager` is required by the contract but operator-only at runtime; empty = my tenant.) */
    dashboard: () => sbg.request((c) => c.GET('/v1/sbg/fleet/dashboard', { params: { query: { manager: '' } } })),

    /** This fleet's vehicles. (Empty filters = no filter, per the backend.) */
    vehicles: () => sbg.request((c) => c.GET('/v1/sbg/vehicles', { params: { query: { status: '', class: '' } } })),

    /** The truck sub-type catalog (label + capacity + handling capabilities). */
    truckSubtypes: () => sbg.request((c) => c.GET('/v1/sbg/vehicles/truck-subtypes', {})),

    /** Register a vehicle (own ID; capacity computed; verified = full docs + factory ID). */
    registerVehicle: (body: {
      plate: string;
      vehicleClass: string;
      ownerName: string;
      ownerType: string;
      managerDid: string;
      truckSubtype?: string;
      capacityKg?: number;
      pricePerKm?: number;
      baseFee?: number; // S34 — freight flag-down fee (defaults per class)
      minMultiplier?: number; // S34 — the fleet's price-floor multiplier (default 0.8)
      maxMultiplier?: number; // S34 — the fleet's price-ceiling multiplier (default 1.5)
      documents?: { registrationPhotoRef?: string; factoryId?: string; insuranceRef?: string; insuranceExpiresAt?: string; inspectionRef?: string; inspectionExpiresAt?: string };
      vehiclePhotoRefs?: string[]; // S26 — mediaIds of the vehicle-body photos
      trailerPhotoRefs?: string[]; // S26 — mediaIds of a coupled trailer's photos
      equipment?: string[]; // S32 — declared load/unload equipment (tail-lift, pallet jack, …)
      // Cast: the generated body narrows vehicleClass/truckSubtype to closed unions the
      // form feeds as validated strings; the backend re-validates (S5a contract quirk).
    }) => sbg.request((c) => c.POST('/v1/sbg/vehicles', { body: body as never })),

    /** Set a vehicle's public per-km rate (open data). */
    setVehiclePrice: (vehicleId: string, price: number) =>
      sbg.request((c) => c.PATCH('/v1/sbg/vehicles/{id}/pricing', { params: { path: { id: vehicleId } }, body: { price } })),

    /** FP4 — record the vehicle's papers: insurance and inspection references and expiry dates (YYYY-MM-DD). Owner only. */
    setVehicleDocuments: (vehicleId: string, documents: { insuranceRef?: string; insuranceExpiresAt?: string; inspectionRef?: string; inspectionExpiresAt?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/vehicles/{id}/documents', { params: { path: { id: vehicleId } }, body: documents as never })),

    /** FP4 — record a driver's renewed licence: the new expiry date, and the number if it changed. */
    renewLicence: (did: string, body: { number?: string; expiresAt: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/licence', { params: { path: { did } }, body: body as never })),

    /** This fleet's drivers. */
    drivers: () => sbg.request((c) => c.GET('/v1/sbg/fleet/drivers', {})),

    /** Onboard a driver: bike/motorcycle = light registry (ACTIVE now); heavier = DRAFT + KYC. */
    onboardDriver: (body: {
      displayName: string;
      fullName: string;
      nationalId: string;
      mobile: string;
      licenceClasses: string[];
      managerDid: string;
      licenceNumber?: string;
      licenceExpiresAt?: string;
      criminalRecordClear?: boolean;
      // Cast: the generated body flattens licenceClasses (an array at runtime) to a bare
      // enum — an S5a generation quirk; the backend validates the real array.
    }) => sbg.request((c) => c.POST('/v1/sbg/drivers/onboard', { body: body as never })),

    /**
     * Heavy registry: submit the ID and licence PHOTOS → KYC_PENDING (the DECISION is GLOS ops').
     *
     * Real media ids. The two documents are what makes the typed national id, licence number and expiry
     * checkable at all; the optional portrait is the driver's badge picture, sent only when there is one.
     */
    submitDriverKyc: (did: string, idCopyRef: string, licenceCopyRef: string, photoRef?: string) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/fleet/drivers/{did}/submit-kyc', { params: { path: { did } }, body: { idCopyRef, licenceCopyRef, ...(photoRef ? { photoRef } : {}) } }),
      ),

    /** Active driver↔vehicle couplings. */
    assignments: () => sbg.request((c) => c.GET('/v1/sbg/fleet/assignments', { params: { query: { status: 'active' } } })),

    /**
     * The corridors the NETWORK publishes — a manager chooses among them and cannot add one.
     *
     * A corridor is the promise that a bus runs between two zones, and every shop in the origin zone
     * reads it when deciding what it may take in. That is why drawing one is an operator's job and this
     * is a read.
     */
    corridors: () => sbg.request((c) => c.GET('/v1/sbg/corridors', {})),

    /**
     * F1 — propose a line this fleet's own vehicles will run. It lands PROPOSED: nothing routes on it until
     * the network publishes it, and once published only this fleet's drivers may be put on it.
     */
    proposeLine: (body: { originZone: string; destZone: string; name?: string; vehicleType?: 'bus' | 'truck'; schedule?: string; note?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/lines', { body: body as never })),

    /* ------------------------------------------------- F3: selling the space on a run -------- */

    /**
     * Put a departure on one of this fleet's own published lines.
     *
     * This is the market running the other way: everything else here is a shipper posting a load and
     * carriers bidding, and the cheapest capacity in the network is a truck leaving anyway with air in
     * the back. The manager DID is in the path because these routes are addressed per fleet; the token's
     * tenant is still what authorises it.
     */
    declareDeparture: (
      did: string,
      body: {
        corridorId: string;
        /** Which truck. Required: the space in a particular hold is what is for sale. */
        vehicleId: string;
        leavesAt: string;
        /** How much of it. Absent means all of it — the vehicle registry already knows. */
        capacityKg?: number;
        capacityM3?: number;
        basis: string;
        amount: number;
        minCharge?: number;
        freeMin?: number;
        waitingPerHour?: number;
        km?: number;
        note?: string;
        /** How the shipper pays the fleet — a record, never a posting. Both or neither. */
        settleMethod?: string;
        settleWhen?: string;
        /** What this fleet’s own policy covers per load. Zero is a real answer; absent is a different one. */
        coverLimit?: number;
        coverPolicy?: string;
      },
    ) => sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/departures' as never, { params: { path: { did } }, body } as never)),

    /**
     * The company's OWN papers — its transport licence and its cover — with what its company enforces and
     * whether a lapse is costing it work. Readable by the fleet because the dates are about it.
     */
    ownPapers: (did: string) => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/papers', { params: { path: { did } } })),

    /**
     * Send a renewed licence or policy: an image this session uploaded, and the expiry read off it. The
     * date is the office's reading and switches nothing on — staff record the date they read off the image.
     */
    sendOwnPaper: (did: string, body: { kind: 'operator_licence' | 'carrier_insurance'; copyRef: string; expiresAt: string; reference?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/papers/send', { params: { path: { did } }, body })),

    /**
     * Give a shipper's space back, with the reason they are shown. The reason is REQUIRED of a carrier — the
     * server refuses without it — and `other` needs a note.
     */
    giveBackBooking: (departureId: string, bookingId: string, body: { reason: NonNullable<components['schemas']['CancelBookingDto']['reason']>; note?: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/departures/{departureId}/bookings/{bookingId}/cancel', { params: { path: { departureId, bookingId } }, body })),

    /** This fleet's own departures, soonest first, with who is aboard each and every wait recorded. */
    departures: (did: string) => sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/departures' as never, { params: { path: { did } } } as never)),

    /**
     * F4 — a load this fleet ALREADY HAD, put on its own run.
     *
     * Not a sale, and the customer has no account here: the fleet is telling us a load exists so the space
     * it fills stops being offered to somebody else. It is what makes the remaining figure on every offer
     * a fact rather than an advertisement.
     */
    addOwnLoad: (
      did: string,
      departureId: string,
      body: { customer: string; description: string; weightKg: number; volumeM3?: number; charge?: number },
    ) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/fleet/managers/{did}/departures/{departureId}/own-loads' as never, { params: { path: { did, departureId } }, body } as never),
      ),

    /** Who is driving it. Rostered after the space is sold, which is the ordinary way round. */
    assignDepartureDriver: (did: string, departureId: string, driverDid: string) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/fleet/managers/{did}/departures/{departureId}/driver' as never, { params: { path: { did, departureId } }, body: { driverDid } } as never),
      ),

    /**
     * Stop selling, mark it gone, or call it off — and the last of those carries a reason.
     *
     * Everybody with goods on the run is about to be told, and the reason is the only part of that message
     * they can act on. The server requires it once anybody is aboard.
     */
    setDepartureStatus: (did: string, departureId: string, status: 'open' | 'closed' | 'departed' | 'cancelled', reason?: string) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/fleet/managers/{did}/departures/{departureId}/status' as never, {
          params: { path: { did, departureId } },
          body: { status, ...(reason ? { reason } : {}) },
        } as never),
      ),

    /**
     * The fleet’s answer to a claim, in their own words.
     *
     * Recorded, never weighed. A refusal must carry a reason, because a refusal without one is not
     * something the other side can act on — and acting on it is the entire point of the record.
     */
    answerBookingClaim: (did: string, departureId: string, bookingId: string, answer: 'accepted' | 'refused', note?: string) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/fleet/managers/{did}/departures/{departureId}/bookings/{bookingId}/claim/answer' as never, {
          params: { path: { did, departureId, bookingId } },
          body: { answer, ...(note ? { note } : {}) },
        } as never),
      ),

    /** Handed over. The office recording what its driver did at the door. */
    markDelivered: (departureId: string, bookingId: string, receivedBy?: string) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/departures/{departureId}/bookings/{bookingId}/delivered' as never, {
          params: { path: { departureId, bookingId } },
          body: { ...(receivedBy ? { receivedBy } : {}) },
        } as never),
      ),

    /** Let a waiting charge go, with a reason. The record stays; only the amount goes to zero. */
    waiveWaiting: (did: string, departureId: string, bookingId: string, where: 'loading' | 'delivery', reason: string) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/fleet/managers/{did}/departures/{departureId}/bookings/{bookingId}/waive-waiting' as never, {
          params: { path: { did, departureId, bookingId } },
          body: { where, reason },
        } as never),
      ),

    /**
     * Put a shift ALREADY RUNNING onto a corridor, or move it to another one.
     *
     * The corridor is chosen when the shift starts and may be left empty, which is right for local and
     * marketplace work — and wrong the moment that driver pulls up at a shop counter, because the
     * handover refuses without one. This is the way back that did not exist: before it, the only repair
     * was to end the shift and start it again.
     */
    assignCorridor: (did: string, corridorId: string) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/fleet/drivers/{did}/assign-corridor', { params: { path: { did } }, body: { corridorId } as never }),
      ),

    /** Couple a driver to a vehicle on the driver's behalf (they normally scan the QR). */
    couple: (did: string, vehicleId: string, corridorId?: string) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/fleet/drivers/{did}/couple', {
          params: { path: { did } },
          body: { vehicleId, ...(corridorId ? { corridorId } : {}) },
        }),
      ),

    /* ---- CL3: scarcity, derived. The same public series both the console and a fleet office read. ---- */

    /**
     * The market series: what was asked for against what moved, day by day, plus how long loads are waiting,
     * what negotiated prices cleared at, and which lanes went quiet.
     *
     * Every figure is derived from timestamps the loads already carry, so it keeps working in a market where
     * nobody reports anything — which is the only kind of market this has to work in.
     */
    marketSeries: (query: { lat?: number; lng?: number; radiusKm?: number; since?: string; until?: string } = {}) =>
      sbg.request((c) =>
        c.GET('/v1/sbg/market/series', {
          params: {
            query: {
              ...(query.lat != null && query.lng != null ? { lat: query.lat, lng: query.lng } : {}),
              ...(query.radiusKm != null ? { radiusKm: query.radiusKm } : {}),
              ...(query.since ? { since: query.since } : {}),
              ...(query.until ? { until: query.until } : {}),
            },
          },
        } as never),
      ),

    /** FP5 — the market as one of the fleet's drivers on shift would see it, and who is on a shift. */
    dispatchView: (did: string, query: { driver?: string; radiusKm?: string }) =>
      sbg.request((c) => c.GET('/v1/sbg/fleet/managers/{did}/dispatch', { params: { path: { did }, query: query as never } })),
    /** FP5 — put a load on one of the fleet's drivers. The driver is told; the office's name goes on the load. */
    assign: (did: string, body: { freightId: string; driverDid: string }) =>
      sbg.request((c) => c.POST('/v1/sbg/fleet/managers/{did}/dispatch', { params: { path: { did } }, body: body as never })),

    /** End a session (decouple). */
    uncouple: (did: string) => sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/uncouple', { params: { path: { did } } })),
  };
}

export type FleetApi = ReturnType<typeof createFleetApi>;
