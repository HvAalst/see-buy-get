import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import { LiveAnimals, LiveAnimalsDto } from './live-animals.types';

/**
 * AN IMPORT BY AIR: FROM "LANDED" TO "A TRUCK MAY COLLECT" (research 2026-10-29, 05_engineering/research/air_ops_2026-10-29.md
 * §3 and the synthesis B–D). Cargo off an aircraft sits in the handler's shed until customs has released it, every agency
 * the goods need has released it, and the handler has given its delivery order. Notice of arrival alone is never enough —
 * that is where the air differs from the rail. Each step is recorded by the importer or its agent, with its reference and
 * who said it; we judge none of them and promise none.
 */

/** An agency that may have to release air cargo before it leaves the airport, by country, and the goods it looks at. */
export interface AirAgency {
  key: string;
  name: string;
  /** What it looks at, in words: the importer or its agent decides whether these goods need it. */
  looksAt: string;
  /** Suggested for these cargo natures (the consignment's natureCode); never required by us. */
  suggestFor: string[];
  /** The veterinary authority: it releases live animals, which do not leave the airport without its word (2026-10-30). */
  vet?: true;
  /** It works Monday to Friday only at the airport (office hours on InfoTradeKenya, read 2026-10-29). */
  weekdaysOnly?: true;
}

/** Source: the release procedures read 2026-10-29 (InfoTradeKenya, ugandatrades.go.ug, rwandatrade.rw, the CTI chain for Tanzania, Ethiopia's EFDA). */
export const AIR_AGENCIES_SOURCE = 'Release procedures read 2026-10-29: InfoTradeKenya, Uganda and Rwanda trade portals, the Confederation of Tanzania Industries (2023).';

export const AIR_AGENCIES: Record<string, AirAgency[]> = {
  KE: [
    { key: 'kephis', name: 'Kenya Plant Health Inspectorate Service (KEPHIS)', looksAt: 'Plants, flowers, seeds, fresh fruit and vegetables', suggestFor: ['FOP'] },
    { key: 'dvs', name: 'Directorate of Veterinary Services (DVS)', looksAt: 'Animal products and live animals', suggestFor: ['HAZ-BIO'], vet: true, weekdaysOnly: true },
    { key: 'port_health', name: 'Port Health', looksAt: 'Food and anything that may carry disease', suggestFor: ['FOP', 'FOD'] },
    { key: 'kebs', name: 'Kenya Bureau of Standards (KEBS)', looksAt: 'Goods that must meet a Kenyan standard', suggestFor: [], weekdaysOnly: true },
    { key: 'ppb', name: 'Pharmacy and Poisons Board (PPB)', looksAt: 'Medicines and health products', suggestFor: ['HUM'], weekdaysOnly: true },
  ],
  UG: [
    { key: 'maaif', name: 'Ministry of Agriculture, Animal Industry and Fisheries (MAAIF)', looksAt: 'Plants, animal products and live animals', suggestFor: ['FOP'], vet: true },
    { key: 'nda', name: 'National Drug Authority (NDA)', looksAt: 'Medicines', suggestFor: ['HUM'] },
    { key: 'unbs', name: 'Uganda National Bureau of Standards (UNBS)', looksAt: 'Goods that must meet a Ugandan standard', suggestFor: [] },
  ],
  RW: [
    { key: 'rica', name: 'Rwanda Inspectorate, Competition and Consumer Protection Authority (RICA)', looksAt: 'Plant and animal health, live animals', suggestFor: ['FOP'], vet: true },
    { key: 'rwanda_fda', name: 'Rwanda Food and Drugs Authority', looksAt: 'Food and medicines', suggestFor: ['FOD', 'HUM'] },
  ],
  TZ: [
    { key: 'tmda', name: 'Tanzania Medicines and Medical Devices Authority (TMDA)', looksAt: 'Medicines and medical devices', suggestFor: ['HUM'] },
    { key: 'tbs', name: 'Tanzania Bureau of Standards (TBS)', looksAt: 'Food and goods that must meet a standard', suggestFor: ['FOD'] },
    { key: 'tz_vet', name: 'Ministry of Livestock and Fisheries (veterinary services)', looksAt: 'Live animals and animal products', suggestFor: [], vet: true },
  ],
  ET: [
    { key: 'efda', name: 'Ethiopian Food and Drug Authority (EFDA)', looksAt: 'Food and medicines', suggestFor: ['FOD', 'HUM'] },
    // Proclamation 267/2002 asks an entrance permit and a health certificate for animals; the office's own name was not read.
    { key: 'et_vet', name: 'The veterinary authority', looksAt: 'Live animals and animal products', suggestFor: [], vet: true },
  ],
};

/** The agencies a country lists, or none we have read. */
export function airAgenciesOf(country: string | undefined): AirAgency[] {
  return AIR_AGENCIES[(country ?? '').toUpperCase()] ?? [];
}

/** The country's veterinary authority, where we list one: live animals are not released without it. */
export function vetAgencyOf(country: string | undefined): AirAgency | undefined {
  return airAgenciesOf(country).find((a) => a.vet);
}

/**
 * WHERE CUSTOMS ITSELF WORKS MONDAY TO FRIDAY at the airport — its verification, which every release waits on. Only what
 * we read: Kenya (InfoTradeKenya office hours, read 2026-10-29). Elsewhere nothing is said, never guessed.
 */
export const CUSTOMS_WEEKDAYS_ONLY: Record<string, string> = { KE: 'customs verification (KRA)' };

const WEEKDAY_WORD = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_WORD = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** A landing that may wait for Monday: the day, the offices that keep weekday hours, and what to do about it. */
export class AirArrivalWarning {
  @ApiProperty({ enum: ['saturday', 'sunday', 'friday_late', 'holiday'] }) kind: 'saturday' | 'sunday' | 'friday_late' | 'holiday';
  @ApiProperty() landsOn: string;
  @ApiProperty({ type: [String] }) offices: string[];
  @ApiProperty() text: string;
}

/**
 * THE WEEKEND TRAP (research 2026-10-29: "a Friday-evening arrival of medicines or animals waits until Monday unless
 * officers attend on Form C.1"). Cargo landing on a Saturday, a Sunday, a day the country's own calendar marks closed, or
 * a Friday afternoon, where an office its release waits on keeps weekday hours. Never that it WILL wait: that it may,
 * and that the agent may ask for officers out of hours (EAC Customs Management Regulations 2010, regs 4–6).
 */
export function airArrivalWarning(input: { country: string; landsOn?: string; landsAt?: string; agencies: Array<{ key: string; name: string }>; closed?: { note?: string; company: string } }): AirArrivalWarning | undefined {
  if (!input.landsOn || !/^\d{4}-\d{2}-\d{2}$/.test(input.landsOn)) return undefined;
  const country = input.country.toUpperCase();
  const listed = airAgenciesOf(country);
  const offices = [
    ...(CUSTOMS_WEEKDAYS_ONLY[country] ? [CUSTOMS_WEEKDAYS_ONLY[country]] : []),
    ...input.agencies.filter((a) => listed.find((l) => l.key === a.key)?.weekdaysOnly).map((a) => a.name),
  ];
  if (!offices.length) return undefined;
  const day = new Date(`${input.landsOn}T00:00:00.000Z`).getUTCDay();
  const kind = input.closed ? 'holiday' : day === 6 ? 'saturday' : day === 0 ? 'sunday' : day === 5 && (input.landsAt ?? '') >= '12:00' ? 'friday_late' : undefined;
  if (!kind) return undefined;
  const d = new Date(`${input.landsOn}T00:00:00.000Z`);
  const when = `${WEEKDAY_WORD[day]} ${d.getUTCDate()} ${MONTH_WORD[d.getUTCMonth()]}`;
  const why =
    kind === 'holiday'
      ? `It lands on ${when}, which ${input.closed!.company}’s calendar marks closed${input.closed!.note ? ` (${input.closed!.note})` : ''}.`
      : kind === 'friday_late'
        ? `It lands on ${when} in the afternoon.`
        : `It lands on ${when}.`;
  const join = offices.length > 1 ? `${offices.slice(0, -1).join(', ')} and ${offices[offices.length - 1]}` : offices[0];
  return {
    kind,
    landsOn: input.landsOn,
    offices,
    text: `${why} ${join.charAt(0).toUpperCase()}${join.slice(1)} ${offices.length > 1 ? 'work' : 'works'} Monday to Friday at the airport, so the release may wait for the next working day. Your agent may ask for officers to attend out of hours on Form C.1, at least 24 hours before — on a Sunday or a public holiday at a minimum charge of three hours (EAC Customs Management Regulations 2010, regs 4–6).`,
  };
}

/** A step of the release, as recorded: its reference, when it happened, who said so. */
export class AirReleaseStep {
  @ApiPropertyOptional() reference?: string;
  @ApiProperty() at: string;
  @ApiProperty() by: string;
  @ApiProperty() recordedAt: string;
}

/** One agency the goods need, and its release once given. */
export class AirAgencyRelease {
  @ApiProperty() key: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional({ type: AirReleaseStep }) released?: AirReleaseStep;
}

/** What still keeps air cargo in the shed, in words — empty once it may be collected. */
export function airReleaseGaps(r: { customs?: AirReleaseStep; agencies: AirAgencyRelease[]; deliveryOrder?: AirReleaseStep }): string[] {
  const out: string[] = [];
  if (!r.customs) out.push('the customs release');
  for (const a of r.agencies) if (!a.released) out.push(`the release by ${a.name}`);
  if (!r.deliveryOrder) out.push('the handler’s delivery order');
  return out;
}

/** The road leg's gate while the cargo is not yet released at the airport. */
export class FreightReleaseGate {
  @ApiProperty() importId: string;
  @ApiProperty() importCode: string;
  /** Where it waits: the handler's shed. */
  @ApiProperty() place: string;
  /** What is still missing, in words; empty once released. */
  @ApiProperty({ type: [String] }) missing: string[];
  /** The importer sent the truck anyway, with its reason: its decision, and its truck's waiting. */
  @ApiPropertyOptional() collectAnyway?: { by: string; at: string; reason: string };
}

/** Undefined = a driver may take it; else the take's words. */
export function releaseRefusal(f: { waitsForRelease?: FreightReleaseGate } | undefined): string | undefined {
  const g = f?.waitsForRelease;
  if (!g || !g.missing.length || g.collectAnyway) return undefined;
  return `Not released yet at ${g.place}: still waiting for ${g.missing.join(', ')}. This load opens as soon as it is released on ${g.importCode}.`;
}

/** The handler's free storage, from its notice of arrival until our truck takes the cargo out. Derived on read. */
export class AirStorageClock {
  @ApiProperty({ enum: ['not_started', 'running', 'due_soon', 'over', 'stopped', 'no_free_hours'] }) state: 'not_started' | 'running' | 'due_soon' | 'over' | 'stopped' | 'no_free_hours';
  @ApiPropertyOptional() startedAt?: string;
  @ApiPropertyOptional() freeHours?: number;
  @ApiPropertyOptional() freeUntil?: string;
  @ApiPropertyOptional() hoursLeft?: number;
  @ApiPropertyOptional() leftAt?: string;
}

/** Due soon in the last six hours of the free time. */
export const AIR_STORAGE_SOON_H = 6;

/**
 * THE HANDLER'S FREE STORAGE — hours from its notice of arrival, as the importer copied them off the handler's notice or
 * tariff. Pure: the same facts and moment give the same answer. Charges are the handler's to bill: we count hours, never money.
 */
export function airStorageClock(input: { notifiedAt?: string; freeHours?: number; leftAt?: string }, now: number): AirStorageClock {
  const H = 3_600_000;
  if (!input.notifiedAt) return { state: 'not_started', ...(input.freeHours != null ? { freeHours: input.freeHours } : {}) };
  if (input.freeHours == null) return { state: 'no_free_hours', startedAt: input.notifiedAt, ...(input.leftAt ? { leftAt: input.leftAt } : {}) };
  const start = Date.parse(input.notifiedAt);
  const until = start + input.freeHours * H;
  const base = { startedAt: input.notifiedAt, freeHours: input.freeHours, freeUntil: new Date(until).toISOString() };
  if (input.leftAt) return { state: 'stopped', ...base, leftAt: input.leftAt };
  const left = Math.round(((until - now) / H) * 10) / 10;
  if (now >= until) return { state: 'over', ...base, hoursLeft: left };
  return { state: left <= AIR_STORAGE_SOON_H ? 'due_soon' : 'running', ...base, hoursLeft: left };
}

/* ------------------------------------------------------------------ the import by air, as kept -- */

export class ImportAirFlight {
  @ApiProperty() flight: string;
  @ApiProperty() date: string;
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiPropertyOptional() arrivesLocal?: string;
}

/**
 * AN IMPORT BY AIR (2026-10-29): the waybill it came under, its flights, the handler's shed it waits in, the cargo as
 * booked, and the release — each step recorded by the importer or its agent, never derived and never promised.
 */
export class ImportAir {
  @ApiProperty() awb: string;
  @ApiProperty({ enum: ['master', 'house', 'direct'] }) waybillKind: 'master' | 'house' | 'direct';
  @ApiPropertyOptional() houseNumber?: string;
  @ApiProperty() airline: string;
  @ApiProperty({ type: [ImportAirFlight] }) flights: ImportAirFlight[];
  @ApiProperty() arrivalAirport: string;
  /** The handler's shed it waits in and is collected from. */
  @ApiProperty() handler: string;
  @ApiProperty() pieces: number;
  @ApiProperty() weightKg: number;
  @ApiPropertyOptional() temp?: { minC: number; maxC: number };
  /** The handler's notice that it has arrived: its free storage starts here. Never enough on its own to collect. */
  @ApiPropertyOptional({ type: AirReleaseStep }) notified?: AirReleaseStep;
  @ApiPropertyOptional({ type: AirReleaseStep }) customs?: AirReleaseStep;
  @ApiProperty({ type: [AirAgencyRelease] }) agencies: AirAgencyRelease[];
  @ApiPropertyOptional({ type: AirReleaseStep }) deliveryOrder?: AirReleaseStep;
  /** The importer's word to send the truck before it is released — with why; its truck's waiting is its own. */
  @ApiPropertyOptional() collectAnyway?: { by: string; at: string; reason: string };
  /** The handler's free storage, in hours, as on its notice or tariff — and where that figure came from. */
  @ApiPropertyOptional() freeHours?: number;
  @ApiPropertyOptional() freeHoursSource?: string;
  @ApiPropertyOptional({ type: [String] }) warned?: string[];
  /** Live animals (2026-10-30): the declaration, and the place the veterinary officer named — the only place they go. */
  @ApiPropertyOptional({ type: LiveAnimals }) animals?: LiveAnimals;
  @ApiProperty() recordedAt: string;
  @ApiProperty() recordedBy: string;
}

export class ImportAirView extends ImportAir {
  /** What still keeps it in the shed, in words. */
  @ApiProperty({ type: [String] }) gaps: string[];
  @ApiProperty({ type: AirStorageClock }) clock: AirStorageClock;
  /** The road leg's gate in the take's own words, while it is closed. */
  @ApiPropertyOptional() roadWaits?: string;
  /** A landing that may wait for Monday (2026-10-30). */
  @ApiPropertyOptional({ type: AirArrivalWarning }) arrival?: AirArrivalWarning;
  /** What to watch for, in words: the landing day, the chicks' hours. */
  @ApiProperty({ type: [String] }) warnings: string[];
  /** The waybill read against the law of its route, and the agencies the destination lists. */
  @ApiProperty() check: { number: string; problem?: string; airline?: string; regime: string; rules?: string; limits: string[]; claims: string[]; caveats: string[]; mismatches: string[] };
}

/* ----------------------------------------------------------------------------- requests -- */

export class ImportAirFlightDto {
  @Matches(/^\s*[A-Z0-9]{2}\s?\d{1,4}[A-Z]?\s*$/i, { message: 'A flight is the airline’s two-character code and its number, like KQ 101' }) flight!: string;
  /** The day it lands — the release's offices count from it (2026-10-30). */
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'The day it lands, as YYYY-MM-DD' }) date!: string;
  @Matches(/^\s*[A-Za-z]{3}\s*$/, { message: 'An airport by its three-letter code, like AMS' }) from!: string;
  @Matches(/^\s*[A-Za-z]{3}\s*$/, { message: 'An airport by its three-letter code, like NBO' }) to!: string;
  @IsOptional() @Matches(/^\d{2}:\d{2}$/, { message: 'Its arrival as HH:MM, local time' }) arrivesLocal?: string;
}

/** The waybill, the flights, the shed, the cargo and the agencies the goods need. */
export class ImportAirDto {
  @IsString() @MaxLength(16) awb!: string;
  @IsIn(['master', 'house', 'direct']) waybillKind!: 'master' | 'house' | 'direct';
  @IsOptional() @IsString() @MaxLength(40) houseNumber?: string;
  @IsOptional() @IsString() @MaxLength(80) airline?: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => ImportAirFlightDto) flights!: ImportAirFlightDto[];
  @IsString() @MaxLength(80) handler!: string;
  @IsNumber() @Min(1) @Max(10_000) pieces!: number;
  @IsNumber() @Min(0.1) @Max(200_000) weightKg!: number;
  @IsOptional() @IsNumber() @Min(-30) @Max(30) minC?: number;
  @IsOptional() @IsNumber() @Min(-30) @Max(30) maxC?: number;
  /** The agencies of the destination's list these goods need, by key. */
  @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) agencies!: string[];
  @IsOptional() @IsNumber() @Min(0) @Max(720) freeHours?: number;
  @IsOptional() @IsString() @MaxLength(160) freeHoursSource?: string;
  /** Live animals (2026-10-30): the declaration, and on an import the place the veterinary officer named. */
  @IsOptional() @ValidateNested() @Type(() => LiveAnimalsDto) animals?: LiveAnimalsDto;
}

/** One step of the release: the notice of arrival, customs, an agency (by its key) or the delivery order. */
export class ImportAirStepDto {
  @IsString() @MaxLength(40) step!: string;
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
  @IsOptional() @IsString() at?: string;
}

export class ImportAirAnywayDto {
  @IsString() @MaxLength(300) reason!: string;
  /** The importer accepts that a truck sent before the release may wait, and that its waiting is the importer's. */
  @IsBoolean() waitingIsMine!: boolean;
}
