import type { SbgClient } from '../client';
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
      documents?: { registrationPhotoRef?: string; factoryId?: string };
      vehiclePhotoRefs?: string[]; // S26 — mediaIds of the vehicle-body photos
      trailerPhotoRefs?: string[]; // S26 — mediaIds of a coupled trailer's photos
      equipment?: string[]; // S32 — declared load/unload equipment (tail-lift, pallet jack, …)
      // Cast: the generated body narrows vehicleClass/truckSubtype to closed unions the
      // form feeds as validated strings; the backend re-validates (S5a contract quirk).
    }) => sbg.request((c) => c.POST('/v1/sbg/vehicles', { body: body as never })),

    /** Set a vehicle's public per-km rate (open data). */
    setVehiclePrice: (vehicleId: string, price: number) =>
      sbg.request((c) => c.PATCH('/v1/sbg/vehicles/{id}/pricing', { params: { path: { id: vehicleId } }, body: { price } })),

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

    /** End a session (decouple). */
    uncouple: (did: string) => sbg.request((c) => c.POST('/v1/sbg/fleet/drivers/{did}/uncouple', { params: { path: { did } } })),
  };
}

export type FleetApi = ReturnType<typeof createFleetApi>;
