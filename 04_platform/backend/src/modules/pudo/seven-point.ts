import { GlosError } from '../../foundation/http/glos-error';
import { crossesBorder } from './commercial-invoice.service';
import type { TruckSubtype } from './fleet.config';

/**
 * Round 40 — THE 7-POINT INSPECTION (the user: "Cross-border closed loads"). Before a container or a closed body is loaded
 * for a load that crosses a border, the driver looks it over at seven points for a false wall, floor or roof, a hidden
 * space, or signs of tampering — each point ticked, each with its own photograph — and the load is not taken over until
 * all seven are done. A domestic load, and an open body, are taken over as before.
 *
 * Something found is not ticked: it is reported under the tamper protocol (finding `inspection_failed`), which holds the
 * load and tells operations before anybody takes it over.
 */

/** The seven points, in the order a driver walks them: the C-TPAT container and trailer inspection. */
export const INSPECTION_POINTS = ['front_wall', 'left_side', 'right_side', 'floor', 'roof', 'doors', 'undercarriage'] as const;
export type InspectionPoint = (typeof INSPECTION_POINTS)[number];

/** Each point in a few words — for a refusal that says which are left. The driver's own words live in the app. */
export const POINT_WORDS: Record<InspectionPoint, string> = {
  front_wall: 'the front wall',
  left_side: 'the left side',
  right_side: 'the right side',
  floor: 'the floor',
  roof: 'the roof',
  doors: 'the doors, inside and out',
  undercarriage: 'the outside and the undercarriage',
};

/**
 * BODIES WITH WALLS, A ROOF AND DOORS THAT CLOSE: where something can be built in or hidden. A tractor with a semi-trailer,
 * and a drawbar, are counted closed: the trailer behind them is not described, and a body nobody described is not known
 * to be open. Tanks, open decks and tippers are not inspected this way.
 */
export const CLOSED_BODIES: readonly TruckSubtype[] = ['box', 'tail_lift', 'refrigerated', 'insulated', 'curtain_side', 'walking_floor', 'semi_trailer', 'drawbar'];
/** Bodies that carry a container. A load that names its container number is a container leg whatever carries it. */
export const CONTAINER_BODIES: readonly TruckSubtype[] = ['skeletal', 'container_selfloader'];

export type InspectionKind = 'container' | 'closed';

/** What carries the load: the vehicle on the driver's shift at pickup, or the one frozen at the claim. */
export interface CarryingBody {
  vehicleClass?: string;
  truckSubtype?: string;
}

/** Whether this load is inspected at seven points before it is taken over, and what is inspected. Nothing for any other load. */
export function inspectionAsked(f: { pickupCountry?: string; destCountry?: string; containerNo?: string }, body: CarryingBody | undefined): InspectionKind | undefined {
  if (!crossesBorder(f)) return undefined;
  const sub = body?.truckSubtype as TruckSubtype | undefined;
  if (f.containerNo || (sub && CONTAINER_BODIES.includes(sub))) return 'container';
  if (body?.vehicleClass === 'van' || (sub && CLOSED_BODIES.includes(sub))) return 'closed';
  return undefined;
}

export interface InspectionInput {
  point: string;
  photoRef: string;
}

/**
 * THE SEVEN, DONE: each point once, each with its own photograph, none of them the securement photo. Refused by name before
 * anything is written, saying which points are left. Returned in walking order.
 */
export function requireInspection(kind: InspectionKind, given: InspectionInput[] | undefined, otherPhotos: Array<string | undefined> = []): Array<{ point: InspectionPoint; photoRef: string }> {
  const list = given ?? [];
  const unknown = list.find((g) => !(INSPECTION_POINTS as readonly string[]).includes(g.point));
  if (unknown) throw new GlosError('VALIDATION_FAILED', `There is no inspection point called "${String(unknown.point).slice(0, 40)}"`, { field: 'inspection' });
  const what = kind === 'container' ? 'The container' : 'The body';
  const missing = INSPECTION_POINTS.filter((p) => !list.some((g) => g.point === p && g.photoRef?.trim()));
  if (missing.length) {
    throw new GlosError(
      'INSPECTION_INCOMPLETE',
      `${what} is looked over at seven points, each photographed, before a load that crosses a border is taken over. Not done yet: ${missing.map((p) => POINT_WORDS[p]).join(', ')}.`,
      { field: 'inspection', missing },
    );
  }
  const chosen = INSPECTION_POINTS.map((p) => ({ point: p, photoRef: list.find((g) => g.point === p && g.photoRef?.trim())!.photoRef.trim() }));
  const refs = chosen.map((c) => c.photoRef);
  if (new Set(refs).size !== refs.length || refs.some((r) => otherPhotos.includes(r))) {
    throw new GlosError('INSPECTION_INCOMPLETE', 'Each point is photographed on its own: one photograph shows one point, and none is the photo of the secured load.', { field: 'inspection' });
  }
  return chosen;
}
