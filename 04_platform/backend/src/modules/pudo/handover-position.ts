import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsNumber, IsOptional, Max, Min } from 'class-validator';
import { haversineKm } from './geo';

/**
 * 2026-11-10 — WHERE THE PHONE WAS AT A HANDOVER (the owner asked whether the app ties the GPS position and the time to
 * the photo taken at a handover; it tied the time only — "build it that way"): at a load's pickup and delivery, at a
 * door where a delivery could not be made, and when a driver takes a bag on its seal, the phone's position and how sure
 * the phone was of it are kept with the act and its photo, in the same record and the same anchor in the chain, with how
 * far that was from the place on the note.
 *
 * Never refused for it: GPS is often poor, switched off or refused, above all where this network starts — so a missing
 * reading is written down as missing, and a distant one is said with its distance. Noted, not judged.
 *
 * Read from the phone at the moment of the act, never out of the picture: a photo is sent stripped of its hidden data
 * (the EXIF, a GPS position in it too), for privacy and size.
 */
export const MAX_ACCURACY_M = 100_000;

/** What the phone said, as the app sends it beside the act. */
export class HandoverPositionDto {
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-90) @Max(90) lat?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-180) @Max(180) lng?: number;
  /** How sure the phone was: the radius it gave, in metres. */
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(MAX_ACCURACY_M) accuracyM?: number;
  /** When the phone took that reading, by its own clock. */
  @ApiPropertyOptional() @IsOptional() @IsDateString() fixAt?: string;
  /** The phone gave no position: location off, refused, or no reading in time. */
  @ApiPropertyOptional({ enum: [true] }) @IsOptional() @IsIn([true]) none?: true;
}

/** As it is kept with the act. */
export class HandoverPosition {
  @ApiPropertyOptional() lat?: number;
  @ApiPropertyOptional() lng?: number;
  @ApiPropertyOptional() accuracyM?: number;
  @ApiPropertyOptional() fixAt?: string;
  /** How far from the place the act belongs at (the pickup, the delivery, the hub or shop), where both are known. */
  @ApiPropertyOptional() metresFromPlace?: number;
  /** The phone gave none. */
  @ApiPropertyOptional() none?: boolean;
}

/** A reading taken this long before the act is said with its age. */
const STALE_MS = 2 * 60_000;
/** A reading dated later than the act by more than this is not believed: its time is dropped, the place kept. */
const AHEAD_MS = 5 * 60_000;

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** What is kept: the reading as the phone gave it, and how far it was from the place — or that there was none. */
export function positionAtAct(given: HandoverPositionDto | undefined, place: { lat: number; lng: number } | undefined, actAt: string): HandoverPosition {
  if (!given || given.none || !Number.isFinite(given.lat) || !Number.isFinite(given.lng)) return { none: true };
  const lat = round(given.lat!, 6);
  const lng = round(given.lng!, 6);
  const accuracyM = given.accuracyM !== undefined && Number.isFinite(given.accuracyM) ? Math.round(given.accuracyM) : undefined;
  const fixMs = given.fixAt ? Date.parse(given.fixAt) : NaN;
  const actMs = Date.parse(actAt);
  const fixAt = Number.isFinite(fixMs) && !(Number.isFinite(actMs) && fixMs > actMs + AHEAD_MS) ? new Date(fixMs).toISOString() : undefined;
  const metresFromPlace = place && Number.isFinite(place.lat) && Number.isFinite(place.lng) ? Math.round(haversineKm(place, { lat, lng }) * 1000) : undefined;
  return { lat, lng, ...(accuracyM !== undefined ? { accuracyM } : {}), ...(fixAt ? { fixAt } : {}), ...(metresFromPlace !== undefined ? { metresFromPlace } : {}) };
}

/** A distance as people read it: to 10 m under a kilometre, then in km. */
export function distanceWords(m: number): string {
  if (m < 10) return 'under 10 m';
  if (m < 1000) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km`;
}

/**
 * As the consignment note says it (in English, as the note is written): how far from `place`, and how sure — or that the
 * phone gave none. Nothing for an act kept before positions were (undefined).
 */
export function positionWords(p: HandoverPosition | undefined, actAt?: string, place = 'this place'): string | undefined {
  if (!p) return undefined;
  if (p.none || p.lat === undefined || p.lng === undefined) return 'The driver’s phone gave no position';
  const where = p.metresFromPlace !== undefined ? `${distanceWords(p.metresFromPlace)} from ${place}` : `at ${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`;
  // How sure, as the phone said it: exact under 100 m, where a rounded figure would claim more or less than it did.
  const sure = p.accuracyM !== undefined ? ` (accurate to ${p.accuracyM < 100 ? `${p.accuracyM} m` : distanceWords(p.accuracyM)})` : '';
  const before = p.fixAt && actAt ? Date.parse(actAt) - Date.parse(p.fixAt) : NaN;
  const age = Number.isFinite(before) && before > STALE_MS ? `, read ${Math.round(before / 60_000)} min before` : '';
  return `The driver’s phone was ${where}${sure}${age}`;
}

/** For the chain: short, and the same every time it is worked out. */
export function positionAnchor(p: HandoverPosition | undefined): unknown {
  if (!p) return undefined;
  return p.none ? 'none' : [p.lat, p.lng, p.accuracyM ?? null, p.fixAt ?? null];
}

/**
 * Only a driver's own app stands at the place: it always says something — a reading, or that it had none. Staff acting
 * for a driver send nothing, and their act says nothing of a phone.
 */
export function phoneAtHandover(actor: { role?: string } | undefined, given: HandoverPositionDto | undefined): { position?: HandoverPositionDto } {
  return actor?.role === 'driver' ? { position: given ?? { none: true } } : {};
}
