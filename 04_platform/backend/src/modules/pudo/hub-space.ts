/**
 * 2026-11-02 — A HUB DECLARES ITS SPACE (the owner: "shouldn't a hub also declare its space?"). A shop says how big its shelf
 * is and how many bags its floor stands; a sort hub says the same for a bigger floor, in two numbers:
 *
 *  - BAG PLACES — how many bags can stand on its floor at once: bags waiting to be sorted, and bags being filled or waiting
 *    for a driver;
 *  - DAILY SORTING — how many parcels it sorts in a day.
 *
 * And what happens when it is full (the owner, choosing): new bags go to another approved hub that serves the same zones; if
 * there is none, they wait at the shop or hub they are at, and whoever is waiting is told. A driver is never turned away at
 * the door with bags in hand. The rule itself is MdpService's (spaceOf, placeBag, letWaitingGo); this file holds the bounds
 * and the record it keeps.
 */

/** The fewest and the most bag places a hub can say. One bag is a floor; ten thousand is a warehouse no hub here is. */
export const BAG_PLACES_MIN = 1;
export const BAG_PLACES_MAX = 10_000;

/** The fewest and the most parcels a hub can say it sorts in a day. */
export const SORT_PER_DAY_MIN = 1;
export const SORT_PER_DAY_MAX = 1_000_000;

/** What the sign-up form starts at — the owner's own example (2026-11-02): "18 of 40 bag places free · 600 parcels a day". */
export const BAG_PLACES_DEFAULT = 40;
export const SORT_PER_DAY_DEFAULT = 600;

/** One bag received at a hub: emptied in the records at once, standing on the floor until its parcels are sorted. */
export interface HubDrop {
  code: string;
  parcelIds: string[];
  at: string;
}

/** What a hub's floor holds that its bags no longer say (MdpService.floors). */
export interface HubFloorBook {
  mdpId: string;
  drops: HubDrop[];
  /** Parcels sorted on a day of the hub's own clock. A new day starts at none. */
  sorted?: { day: string; count: number };
  /** The day the hub was told its sorting was full — told once a day. */
  dayFullToldOn?: string;
  /**
   * 2026-11-12 — DAY BY DAY, the last 30 days of its own clock (the hub density map, "Hubs on the Road" step 3): parcels sorted,
   * and whether it ran full — its day's sorting reached, or a bag held for room on its floor.
   */
  days?: Record<string, HubDay>;
  /** 2026-11-12 — hours its last parcels stood on its floor before their bag left (arrival times count the median). */
  dwells?: number[];
}

export interface HubDay {
  sorted: number;
  full?: boolean;
}

/** How many days a hub's day-by-day record keeps. */
export const HUB_DAYS_KEPT = 30;

/** A day's record changed, the oldest days beyond HUB_DAYS_KEPT let go. */
export function withDay(days: Record<string, HubDay> | undefined, day: string, change: (d: HubDay) => HubDay): Record<string, HubDay> {
  const next = { ...(days ?? {}), [day]: change(days?.[day] ?? { sorted: 0 }) };
  const keep = Object.keys(next).sort().slice(-HUB_DAYS_KEPT);
  return Object.fromEntries(keep.map((k) => [k, next[k]]));
}

/**
 * What is wrong with two numbers a hub says, or null: whole numbers, inside the bounds — said in words the owner can act on,
 * before anything is written.
 */
export function spaceProblem(bagPlaces: unknown, sortPerDay: unknown): { field: 'bagPlaces' | 'sortPerDay'; words: string } | null {
  if (typeof bagPlaces !== 'number' || !Number.isInteger(bagPlaces) || bagPlaces < BAG_PLACES_MIN || bagPlaces > BAG_PLACES_MAX) {
    return { field: 'bagPlaces', words: `Say how many bags can stand on your floor at once: a whole number from ${BAG_PLACES_MIN} to ${BAG_PLACES_MAX.toLocaleString('en-GB')}` };
  }
  if (typeof sortPerDay !== 'number' || !Number.isInteger(sortPerDay) || sortPerDay < SORT_PER_DAY_MIN || sortPerDay > SORT_PER_DAY_MAX) {
    return { field: 'sortPerDay', words: `Say how many parcels you sort in a day: a whole number from ${SORT_PER_DAY_MIN} to ${SORT_PER_DAY_MAX.toLocaleString('en-GB')}` };
  }
  return null;
}
