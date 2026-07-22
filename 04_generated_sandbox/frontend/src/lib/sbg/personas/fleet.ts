import type { SbgClient } from '../client';

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
      documents?: { registrationPhotoRef?: string; factoryId?: string };
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

    /** Heavy registry: submit ID + licence copies → KYC_PENDING (the DECISION is GLOS ops'). */
    submitDriverKyc: (did: string, idCopyRef: string, licenceCopyRef: string) =>
      sbg.request((c) =>
        c.POST('/v1/sbg/fleet/drivers/{did}/submit-kyc', { params: { path: { did } }, body: { idCopyRef, licenceCopyRef } }),
      ),

    /** Active driver↔vehicle couplings. */
    assignments: () => sbg.request((c) => c.GET('/v1/sbg/fleet/assignments', { params: { query: { status: 'active' } } })),

    /** Corridors (for the optional coupling assignment). */
    corridors: () => sbg.request((c) => c.GET('/v1/sbg/corridors', {})),

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
