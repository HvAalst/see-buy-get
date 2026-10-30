import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { GlosError } from '../../foundation/http/glos-error';

/**
 * LIVE ANIMALS BY AIR (the user, 2026-10-30: "build 1 and 2", after the recommendation; research 2026-10-29,
 * 05_engineering/research/air_special_cargo_2026-10-29.md §3 and its synthesis C). Our part is the road: from the farm to
 * the cargo terminal, or from the shed at the airport to the place the veterinary officer named. What the law of each
 * country asks of the carrier is still with our lawyer (legal.html L30), so until it answers we keep to the strict reading:
 * the papers complete before loading, the animals' keeper's word that none is unfit, a vehicle made for them, the driver's
 * own checks at pickup, the original papers riding with the animals, and on an import a destination nobody can change.
 * We sign nothing for anybody: the shipper's certification, the vet's certificate and the permits are theirs.
 */

/** Livestock walk on a livestock body; crated animals — chicks, poultry, pets — ride closed, upright, with air. */
export const ANIMAL_KINDS = ['livestock', 'crated'] as const;
export type AnimalKind = (typeof ANIMAL_KINDS)[number];

/** Day-old chicks live on their yolk for about 72 hours after hatching — the breeder's figure, not a law (Aviagen, 15 Oct 2024). */
export const CHICK_WINDOW_H = 72;

export class LiveAnimalsDestination {
  @ApiProperty() label: string;
  @ApiProperty() location: { lat: number; lng: number };
  /** Where it was named: the permit, or the officer. */
  @ApiProperty() namedOn: string;
}

/** The animals as their keeper declared them, with the papers by number — the originals travel with the animals. */
export class LiveAnimals {
  @ApiProperty({ enum: ANIMAL_KINDS }) kind: AnimalKind;
  @ApiProperty() species: string;
  @ApiProperty() count: number;
  /** Day-old chicks: when they hatched. */
  @ApiPropertyOptional() hatchedAt?: string;
  /** The import permit (the destination country's; on an export, the consignee's). */
  @ApiProperty() permit: string;
  @ApiProperty() healthCertificate: string;
  /** Present where the species is listed under CITES: the permit's number. */
  @ApiPropertyOptional() cites?: string;
  @ApiPropertyOptional() movementPermit?: string;
  /** Who looks after them on the way; absent, the driver is their handler. */
  @ApiPropertyOptional() attendant?: { name: string; phone?: string };
  /** Export: who signed the shipper's certification for live animals — the shipper, never SeeBuyGet. */
  @ApiPropertyOptional() shipperCertifiedBy?: string;
  /** The keeper's word that none is unfit to travel, and whose. */
  @ApiProperty() fitToTravel: { by: string; at: string };
  /** Import: the place the veterinary officer named — the road leg goes there and nowhere else. */
  @ApiPropertyOptional({ type: LiveAnimalsDestination }) destination?: LiveAnimalsDestination;
}

export class LiveAnimalsDto {
  @IsIn(ANIMAL_KINDS as unknown as string[]) kind!: AnimalKind;
  @IsString() @MaxLength(80) species!: string;
  @IsInt() @Min(1) @Max(100_000) count!: number;
  @IsOptional() @IsString() hatchedAt?: string;
  @IsString() @MaxLength(60) permit!: string;
  @IsString() @MaxLength(60) healthCertificate!: string;
  @IsOptional() @IsBoolean() citesListed?: boolean;
  @IsOptional() @IsString() @MaxLength(60) citesPermit?: string;
  @IsOptional() @IsString() @MaxLength(60) movementPermit?: string;
  @IsOptional() @IsString() @MaxLength(80) attendantName?: string;
  @IsOptional() @IsString() @MaxLength(24) attendantPhone?: string;
  @IsOptional() @IsString() @MaxLength(120) shipperCertifiedBy?: string;
  /** None is sick or injured, in the last tenth of pregnancy, given birth in the last 48 hours, or newborn with an unhealed navel. */
  @IsBoolean() fitToTravel!: boolean;
  /** Import: one of the importer's places — the place the veterinary officer named. Resolved by the route. */
  @IsOptional() @IsString() quarantineSiteId?: string;
  /** Import: where the place was named — the permit, or the officer. */
  @IsOptional() @IsString() @MaxLength(120) namedOn?: string;
}

/** The unfit, said once, in the words the keeper agrees to (WOAH Terrestrial Code 7.3.7; EU Reg. 1/2005 Annex I Ch. I). */
export const UNFIT_WORDS = 'none is sick or injured, in the last tenth of its pregnancy, has given birth in the last 48 hours, or is a newborn with an unhealed navel';

/**
 * THE DECLARATION, checked before anything is written. The papers are numbers we hold; the originals ride with the
 * animals. Nothing goes without the keeper's word that none is unfit — "Animals should not be loaded until the
 * documentation required to that point is complete" (WOAH 7.3.6).
 */
export function liveAnimalsOf(
  dto: LiveAnimalsDto,
  side: 'import' | 'export',
  by: string,
  now: number,
  destination?: { label: string; location: { lat: number; lng: number } },
): LiveAnimals {
  const species = dto.species?.trim();
  if (!species) throw new GlosError('FIELD_REQUIRED', 'Say what the animals are — “dairy heifers”, “day-old chicks”', { field: 'animals.species' });
  if (!(dto.count >= 1)) throw new GlosError('FIELD_REQUIRED', 'Say how many animals there are', { field: 'animals.count' });
  const permit = dto.permit?.trim();
  if (!permit) throw new GlosError('FIELD_REQUIRED', side === 'import' ? 'Give the import permit’s number: animals do not leave the airport until it is produced' : 'Give the consignee’s import permit number: the airline asks for it before it accepts the animals', { field: 'animals.permit' });
  const healthCertificate = dto.healthCertificate?.trim();
  if (!healthCertificate) throw new GlosError('FIELD_REQUIRED', 'Give the veterinary health certificate’s number: its original rides with the animals', { field: 'animals.healthCertificate' });
  if (dto.citesListed && !dto.citesPermit?.trim()) throw new GlosError('FIELD_REQUIRED', 'A species listed under CITES travels with its permit: give its number', { field: 'animals.citesPermit' });
  if (dto.fitToTravel !== true) throw new GlosError('FIELD_REQUIRED', `Say that ${UNFIT_WORDS}: an unfit animal is not loaded`, { field: 'animals.fitToTravel' });
  if (side === 'export' && !dto.shipperCertifiedBy?.trim()) throw new GlosError('FIELD_REQUIRED', 'Say who signed the shipper’s certification for live animals: the airline asks for it with each shipment, and only the shipper signs it', { field: 'animals.shipperCertifiedBy' });
  let hatchedAt: string | undefined;
  if (dto.hatchedAt?.trim()) {
    const at = Date.parse(dto.hatchedAt);
    if (Number.isNaN(at) || at > now + 5 * 60_000) throw new GlosError('VALIDATION_FAILED', 'Say when they hatched — a moment that has come', { field: 'animals.hatchedAt' });
    hatchedAt = new Date(at).toISOString();
  }
  const attendant = dto.attendantName?.trim() ? { name: dto.attendantName.trim().slice(0, 80), ...(dto.attendantPhone?.trim() ? { phone: dto.attendantPhone.trim().slice(0, 24) } : {}) } : undefined;
  return {
    kind: dto.kind === 'crated' ? 'crated' : 'livestock',
    species: species.slice(0, 80),
    count: Math.round(dto.count),
    ...(hatchedAt ? { hatchedAt } : {}),
    permit: permit.slice(0, 60),
    healthCertificate: healthCertificate.slice(0, 60),
    ...(dto.citesListed && dto.citesPermit?.trim() ? { cites: dto.citesPermit.trim().slice(0, 60) } : {}),
    ...(dto.movementPermit?.trim() ? { movementPermit: dto.movementPermit.trim().slice(0, 60) } : {}),
    ...(attendant ? { attendant } : {}),
    ...(side === 'export' && dto.shipperCertifiedBy?.trim() ? { shipperCertifiedBy: dto.shipperCertifiedBy.trim().slice(0, 120) } : {}),
    fitToTravel: { by, at: new Date(now).toISOString() },
    ...(destination ? { destination: { label: destination.label.slice(0, 120), location: destination.location, namedOn: (dto.namedOn?.trim() || `import permit ${permit}`).slice(0, 120) } } : {}),
  };
}

/** The papers whose originals ride with the animals, in words. */
export function originalsOf(a: Pick<LiveAnimals, 'permit' | 'healthCertificate' | 'cites' | 'movementPermit'>): string[] {
  return [`the veterinary health certificate ${a.healthCertificate}`, `the import permit ${a.permit}`, ...(a.cites ? [`the CITES permit ${a.cites}`] : []), ...(a.movementPermit ? [`the movement permit ${a.movementPermit}`] : [])];
}

/** What the driver is told: the animals, who looks after them, how they ride, and the papers that ride with them. */
export function animalWords(a: LiveAnimals): string {
  return [
    `Live animals: ${a.count} ${a.species}.`,
    a.attendant ? `${a.attendant.name}${a.attendant.phone ? ` (${a.attendant.phone})` : ''} looks after them on the way.` : 'You are their handler on the way.',
    a.kind === 'livestock' ? 'Load them by a ramp with sides, on a floor that does not slip.' : 'Keep the crates upright, their air holes clear.',
    'Keep air moving through the load, park in the shade, and never leave them standing in a closed vehicle.',
    `The originals ride with them: ${originalsOf(a).join(', ')}.`,
    a.destination ? `They go to ${a.destination.label} — the place the veterinary officer named — and nowhere else.` : '',
  ]
    .filter(Boolean)
    .join(' ');
}

/** The animals on a load, as the road needs them. */
export interface FreightLiveAnimals {
  kind: AnimalKind;
  species: string;
  count: number;
}

/**
 * A VEHICLE MADE FOR THEM — or the take's own words why not. Livestock on a livestock body (anti-slip floor, partitions,
 * a ramp with sides, air when it stands — WOAH 7.3.5); crated animals in a closed body that is not a motorbike, a bike
 * or a tuk-tuk: a car, a van, or a box, insulated or refrigerated truck.
 */
const CRATED_TRUCKS = ['box', 'insulated', 'refrigerated', 'livestock'];
export function animalVehicleRefusal(animals: FreightLiveAnimals | undefined, vehicle: { vehicleClass?: string; truckSubtype?: string } | null | undefined): string | undefined {
  if (!animals || !vehicle) return undefined;
  if (animals.kind === 'livestock') {
    return vehicle.truckSubtype === 'livestock' ? undefined : `${animals.count} ${animals.species} go on a livestock body — an anti-slip floor, partitions, a ramp with sides, and air when it stands.`;
  }
  const ok = vehicle.vehicleClass === 'car' || vehicle.vehicleClass === 'van' || (vehicle.vehicleClass === 'truck' && CRATED_TRUCKS.includes(vehicle.truckSubtype ?? ''));
  return ok ? undefined : `${animals.count} ${animals.species} ride in a closed body with air — a car, a van, or a box, insulated or refrigerated truck: never on a bike, a motorcycle, a tuk-tuk or an open truck.`;
}

/**
 * DAY-OLD CHICKS AND THEIR 72 HOURS: how old they are when the truck should reach its end, and a warning past the
 * window. Biology, not law — said as the breeder's figure.
 */
export function chickWindow(hatchedAt: string | undefined, arriveBy: number): { hoursOld: number; over: boolean } | undefined {
  if (!hatchedAt) return undefined;
  const hoursOld = Math.round(((arriveBy - Date.parse(hatchedAt)) / 3_600_000) * 10) / 10;
  return { hoursOld, over: hoursOld > CHICK_WINDOW_H };
}
