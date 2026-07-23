import type { SbgClient } from '../client';

/** The person-facing roles a consumer may hold and switch into (mirrors backend PersonRole). */
export type PersonRole = 'consumer' | 'driver' | 'agent' | 'mdp' | 'fleet_manager' | 'vendor';

/**
 * Consumer persona facade (S20/S21) — the AUTHENTICATED half of the Send/Buy/Get consumer surface.
 * Every method carries the person's bearer (the seeded consumer session) and returns a Result, never
 * throws. These are the routes gated @Roles('consumer'); the pre-auth enroll/login/OTP calls are made
 * with publicRequest before any token exists (see the Send app's api.ts), not here.
 *
 * Responses are `{type:object}` in the contract, so the caller crosses the boundary with narrow<T>().
 */
export function createConsumerApi(sbg: SbgClient) {
  return {
    /** The signed-in person + every role they hold (drives the role switcher). */
    me: () => sbg.request((c) => c.GET('/v1/sbg/identity/me')),

    /** Set or change the 4-digit PIN. */
    setPin: (pin: string) => sbg.request((c) => c.POST('/v1/sbg/identity/pin', { body: { pin } })),

    /** "Act as" a held role → a NEW actor token for that role (do not seed it into THIS session). */
    switchRole: (role: PersonRole) => sbg.request((c) => c.POST('/v1/sbg/identity/switch', { body: { role } })),

    /** The receiver/sender home: every parcel this person is a party to, sent + received (by phoneHash). */
    myParcels: () => sbg.request((c) => c.GET('/v1/sbg/identity/parcels')),

    /** One parcel the person is a party to — the authenticated twin + status timeline (404 to a non-party). */
    parcel: (id: string) => sbg.request((c) => c.GET('/v1/sbg/identity/parcels/{id}', { params: { path: { id } } })),

    /** Attach the receiver's own delivered-state photo (proof of what they received). */
    pod: (id: string, photoRef: string) => sbg.request((c) => c.POST('/v1/sbg/identity/parcels/{id}/pod', { params: { path: { id } }, body: { photoRef } })),

    /** File a delivery dispute from the app (reason + delivered-state photo) → routed by origin. */
    dispute: (id: string, reason: string, photoRef: string) =>
      sbg.request((c) => c.POST('/v1/sbg/identity/parcels/{id}/dispute', { params: { path: { id } }, body: { reason, photoRef } })),
  };
}

export type ConsumerApi = ReturnType<typeof createConsumerApi>;
