import type { SbgClient } from '../client';

/**
 * What a receiver may say about a store — the catalogue, mirrored from the backend.
 *
 * Tags rather than free text, and POSITIVES ARE HALF OF IT: a scorecard made only of complaints is a
 * pillory, and "well packed" is real information a shopper wants. Ordered good-first so a screen that
 * renders them in order does not open with an accusation.
 */
export const MERCHANT_TAGS = ['WELL_PACKED', 'AS_DESCRIBED', 'SHIPPED_FAST', 'POOR_PACKAGING', 'WRONG_ITEM', 'MISSING_ITEM'] as const;
export type MerchantTag = (typeof MERCHANT_TAGS)[number];
export const POSITIVE_TAGS: ReadonlySet<string> = new Set(['WELL_PACKED', 'AS_DESCRIBED', 'SHIPPED_FAST']);
import { createMediaApi } from './media';
import { createFiscalApi } from './fiscal';

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
    // S26: real image upload/fetch (the receiver's own PoD + dispute evidence).
    ...createMediaApi(sbg),
    // The tax invoice for a parcel they sent themselves (KRA eTIMS, Kenya only).
    ...createFiscalApi(sbg),

    /** The signed-in person + every role they hold (drives the role switcher). */
    me: () => sbg.request((c) => c.GET('/v1/sbg/identity/me')),

    /** Set or change the 4-digit PIN. */
    setPin: (pin: string) => sbg.request((c) => c.POST('/v1/sbg/identity/pin', { body: { pin } })),

    /** Set the person's own display name and/or avatar mediaId (S29). Returns the updated self-view. */
    setProfile: (body: { displayName?: string; avatarMediaId?: string }) =>
      sbg.request((c) => c.PATCH('/v1/sbg/identity/profile', { body })),

    /** "Act as" a held role → a NEW actor token for that role (do not seed it into THIS session). */
    switchRole: (role: PersonRole) => sbg.request((c) => c.POST('/v1/sbg/identity/switch', { body: { role } })),

    /** The receiver/sender home: every parcel this person is a party to, sent + received (by phoneHash). */
    myParcels: () => sbg.request((c) => c.GET('/v1/sbg/identity/parcels')),

    /** PG3 — mint a peer send in-app (the identical genesis the vendor console gets): receiver + the two
     *  shops + REAL dims/weight (the size tier is derived server-side). Cash at the counter: the response
     *  carries the locked price + the label the sender shows at drop-off. */
    createParcel: (body: { receiverMobile: string; originPudoDid: string; destPudoDid: string; dimensionsCm: { l: number; w: number; h: number }; weightKg: number; fragile?: boolean; expectedTotal?: number }) =>
      sbg.request((c) => c.POST('/v1/sbg/identity/parcels', { body })),

    /** One parcel the person is a party to — the authenticated twin + status timeline (404 to a non-party). */
    parcel: (id: string) => sbg.request((c) => c.GET('/v1/sbg/identity/parcels/{id}', { params: { path: { id } } })),

    /** Attach the receiver's own delivered-state photo (proof of what they received). */
    pod: (id: string, photoRef: string) => sbg.request((c) => c.POST('/v1/sbg/identity/parcels/{id}/pod', { params: { path: { id } }, body: { photoRef } })),

    /** File a delivery dispute from the app (reason + delivered-state photo) → routed by origin. */
    dispute: (id: string, reason: string, photoRef: string) =>
      sbg.request((c) => c.POST('/v1/sbg/identity/parcels/{id}/dispute', { params: { path: { id } }, body: { reason, photoRef } })),

    /**
     * Answer the final notice — the four things a person can do about a closed collection window.
     *
     * Not a survey. Each choice does something, which is why it is a fixed list: "I am coming" buys more
     * time, "someone else will" opens a nomination, "I do not want it" gives up the claim, and "I never
     * ordered this" raises it with whoever sent it — which is emphatically NOT giving it up.
     */
    respondToNotice: (id: string, choice: 'coming' | 'proxy' | 'relinquish' | 'not-mine', note?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/identity/parcels/{id}/collection-response', { params: { path: { id } }, body: { choice, note } })),

    /** Name somebody to collect instead. The code comes back HERE, because passing it on is the point. */
    nominateCollector: (id: string, name: string, phone?: string) =>
      sbg.request((c) => c.POST('/v1/sbg/identity/parcels/{id}/nominate-collector', { params: { path: { id } }, body: { name, phone } })),

    /**
     * Rate the STORE this parcel came from — stars plus tags, never prose.
     *
     * Only the receiver, only once, only after delivery. That is what a public review site structurally
     * cannot do and we can, because we carried the thing being reviewed.
     */
    rateStore: (id: string, stars: number, tags: MerchantTag[]) =>
      sbg.request((c) => c.POST('/v1/sbg/identity/parcels/{id}/rate-store', { params: { path: { id } }, body: { stars, tags } })),

    /** Create (or return) the person's reusable invite link — the app turns the token into a share link (S24). */
    createInvite: (channels?: string[]) => sbg.request((c) => c.POST('/v1/sbg/identity/invites', { body: { channels } })),

    /** The person's sent invites + how many joined (the growth credit). */
    myInvites: () => sbg.request((c) => c.GET('/v1/sbg/identity/invites')),
  };
}

export type ConsumerApi = ReturnType<typeof createConsumerApi>;
