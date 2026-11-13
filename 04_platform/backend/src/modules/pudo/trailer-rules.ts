/**
 * 2026-11-13 — WHAT MAY BE TOWED, AND BY WHOM (the owner: "we should also consider a trailer for VANs especially (student house)
 * movers use vans and trailers in cities"; plan D1–D5, "build as recommended"; research of 13 November, legal.html L49).
 *
 * A trailer behind a car or a van: what it carries is its maximum weight less its own (never assumed). Unbraked, it weighs at
 * most 750 kg loaded. It is within what the van may tow, braked or unbraked, as its registration says. And the driver's licence
 * covers the pair, by the country's rule:
 *  - the Netherlands: up to 750 kg on B; heavier on B while van and trailer together stay at or under 3,500 kg; on B with code 96
 *    up to 4,250 kg together; on BE a trailer up to 3,500 kg;
 *  - Uganda: up to 750 kg on B; heavier on BE;
 *  - everywhere else — Kenya above 750 kg, Rwanda, Tanzania, Ethiopia among them — up to 750 kg on the ordinary licence, nothing
 *    heavier until the lawyer answers (L49).
 * A trailer with a plate of its own shows its registration card: the Netherlands above 750 kg, Kenya always (the yellow Z plate).
 */
export const TOWING_KINDS = ['B96', 'BE', 'E'] as const;
export type TowingKind = (typeof TOWING_KINDS)[number];

/** The vehicles that tow a trailer here: a car or a van (a truck's trailer is its own body — drawbar, semi-trailer). */
export const TOWING_CLASSES: ReadonlySet<string> = new Set(['car', 'van']);
/** A trailer without brakes weighs at most this loaded. */
export const UNBRAKED_MAX_KG = 750;
/** The heaviest trailer a car or van tows here, on any licence. */
export const TRAILER_MAX_KG = 3500;

export interface TrailerSpec {
  plate: string;
  /** Its maximum weight, loaded (on its plate). */
  maxKg: number;
  /** Its own weight, empty. */
  emptyKg: number;
  braked: boolean;
  closed: boolean;
  /** Its load space, where measured. */
  volumeM3?: number;
  /** Ramps of its own: loads that need a ramp go on it. */
  ramp: boolean;
}

/** What it carries: its maximum less its own weight. */
export function payloadOf(t: Pick<TrailerSpec, 'maxKg' | 'emptyKg'>): number {
  return Math.max(0, Math.round((t.maxKg - t.emptyKg) * 10) / 10);
}

/** Whether the trailer carries a plate of its own, and so shows its registration card. */
export function ownPlateRequired(country: string | undefined, maxKg: number): boolean {
  if (country === 'KE') return true;
  if (country === 'NL') return maxKg > UNBRAKED_MAX_KG;
  return false;
}

/** What a van may tow, from its registration: braked and unbraked; its own maximum weight, where the country's rule asks for it. */
export interface TowLimits {
  brakedKg: number;
  unbrakedKg: number;
  grossKg?: number;
}

/**
 * Why this pairing may not be driven, in words for the driver — or nothing where it may. Each refusal says what would allow it.
 */
export function towingRefusal(input: { country: string | undefined; countryName: string; kinds: readonly string[]; vehicle: { vehicleClass: string; plate: string; towLimits?: TowLimits }; trailer: TrailerSpec }): string | undefined {
  const { country, countryName, kinds, vehicle, trailer } = input;
  if (!TOWING_CLASSES.has(vehicle.vehicleClass)) return `A trailer is towed by a car or a van, not a ${vehicle.vehicleClass}`;
  if (!vehicle.towLimits) return `Say what ${vehicle.plate} may tow first, braked and unbraked, from its registration`;
  if (!trailer.braked && trailer.maxKg > UNBRAKED_MAX_KG) return `A trailer without brakes weighs at most ${UNBRAKED_MAX_KG} kg loaded: this one is ${trailer.maxKg} kg`;
  const may = trailer.braked ? vehicle.towLimits.brakedKg : vehicle.towLimits.unbrakedKg;
  if (trailer.maxKg > may) return `${vehicle.plate} may tow ${may} kg ${trailer.braked ? 'braked' : 'unbraked'}: this trailer is ${trailer.maxKg} kg`;
  if (trailer.maxKg <= UNBRAKED_MAX_KG) return undefined;
  if (country === 'NL') {
    const gross = vehicle.towLimits.grossKg;
    if (gross != null && gross + trailer.maxKg <= 3500) return undefined;
    if (gross != null && gross + trailer.maxKg <= 4250 && kinds.includes('B96')) return undefined;
    if (kinds.includes('BE') && trailer.maxKg <= TRAILER_MAX_KG) return undefined;
    if (gross == null) return `Say ${vehicle.plate}'s own maximum weight, from its registration: whether your licence covers this trailer depends on the two together`;
    return `Van and trailer together are ${gross + trailer.maxKg} kg: in the Netherlands that needs BE${gross + trailer.maxKg <= 4250 ? ', or B with code 96' : ''} on your licence`;
  }
  if (country === 'UG') return kinds.includes('BE') ? undefined : 'A trailer over 750 kg in Uganda needs BE on your licence';
  return `In ${countryName} a car or van tows a trailer up to 750 kg on the ordinary licence; a heavier one waits until the law is confirmed`;
}
