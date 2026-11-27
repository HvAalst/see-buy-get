/**
 * 2026-11-27 — WORDS THE SYSTEM WRITES THAT A NOTICE SAYS BACK (the owner: "fix as recommended"). Kept in one place, so the
 * service that writes one and the notice that says it in the reader's language read the same words: the notice knows it is
 * ours, not something a person typed, and says it as a phrase (notice-words/en/details.ts).
 */

/** Why a door load is withdrawn when its parcel is collected at the shop instead (business-door.service.ts). */
export const COLLECTED_AT_SHOP_REASON = 'its parcel was collected at the shop';

/** Who carries the goods when a courier's vehicle breaks down and no name is known (vehicle-breakdown.service.ts). */
export const THE_COURIER = 'The courier';
