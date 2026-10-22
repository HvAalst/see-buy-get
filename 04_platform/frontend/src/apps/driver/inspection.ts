import type { MessageKey } from '../../shared/i18n';
import type { Claimable } from './types';

/**
 * Round 40 — THE 7-POINT INSPECTION (the user: "Cross-border closed loads"). Before a container or a closed body is loaded for
 * a load that crosses a border, the driver looks it over at seven points — a false wall, floor or roof, a hidden space, signs
 * of tampering — ticks each and photographs each. The server says when a load asks for it (`claim.inspection`) and refuses
 * the pickup until all seven are sent; something found is not ticked but reported, and the load is held.
 */
export type InspectionPoint = 'front_wall' | 'left_side' | 'right_side' | 'floor' | 'roof' | 'doors' | 'undercarriage';

/** One point as the driver did it: looked and found nothing, and the photograph of it. */
export interface InspectionLook {
  ticked: boolean;
  photo: string;
}

/** What each point is called, and what to look for there. */
export const POINT_KEYS: Record<InspectionPoint, { label: MessageKey; look: MessageKey }> = {
  front_wall: { label: 'driver.inspection.point.front_wall', look: 'driver.inspection.look.front_wall' },
  left_side: { label: 'driver.inspection.point.left_side', look: 'driver.inspection.look.left_side' },
  right_side: { label: 'driver.inspection.point.right_side', look: 'driver.inspection.look.right_side' },
  floor: { label: 'driver.inspection.point.floor', look: 'driver.inspection.look.floor' },
  roof: { label: 'driver.inspection.point.roof', look: 'driver.inspection.look.roof' },
  doors: { label: 'driver.inspection.point.doors', look: 'driver.inspection.look.doors' },
  undercarriage: { label: 'driver.inspection.point.undercarriage', look: 'driver.inspection.look.undercarriage' },
};

/** The points this load asks for, in the server's order; a point this build does not know is left out rather than guessed. */
export function inspectionPoints(claim: Pick<Claimable, 'inspection'> | null | undefined): InspectionPoint[] {
  return (claim?.inspection?.points ?? []).filter((p): p is InspectionPoint => p in POINT_KEYS);
}

/** Done: no inspection asked, or every point ticked with its own photograph. */
export function inspectionReady(claim: Pick<Claimable, 'inspection'> | null | undefined, looks: Record<string, InspectionLook>): boolean {
  if (!claim?.inspection) return true;
  const points = claim.inspection.points;
  const photos = points.map((p) => looks[p]?.photo ?? '');
  return points.every((p) => looks[p]?.ticked && looks[p]?.photo) && new Set(photos).size === photos.length;
}

/** How many of the asked points are done — for the line under the section. */
export function inspectionDone(claim: Pick<Claimable, 'inspection'> | null | undefined, looks: Record<string, InspectionLook>): number {
  return (claim?.inspection?.points ?? []).filter((p) => looks[p]?.ticked && looks[p]?.photo).length;
}

/** What the pickup sends: each point with its photograph, in the server's order. Nothing when none is asked. */
export function inspectionBody(claim: Pick<Claimable, 'inspection'> | null | undefined, looks: Record<string, InspectionLook>): Array<{ point: string; photoRef: string }> | undefined {
  if (!claim?.inspection) return undefined;
  return claim.inspection.points.map((point) => ({ point, photoRef: looks[point]?.photo ?? '' }));
}
