import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

/**
 * WHERE ROAD MEETS RAIL (the user, 2026-10-28: "I want to reduce mistakes and delays (south africa is struggling) for road
 * where road and rail comes together" — and, asked, "build the clock with the blocker as you said"). Design:
 * 05_engineering/rail_note.md.
 *
 * An EXPORT by rail: our truck takes the box to a rail terminal, and is timed to the train's cut-off there, the way a road
 * export is timed to the port gate. An IMPORT by rail: the box comes inland on a train, and our truck is not sent for it
 * until the railway has said it is there — the arrival notice — unless the importer says, with a reason, to collect anyway.
 * The free days the rail terminal gives are counted from the arrival until our truck takes the box out.
 */
/**
 * THE MODES OF A JOURNEY, IN ORDER (the user, 2026-10-29, on the navigation: "by direction, mode inside"). Road, rail,
 * sea and air are legs of one export or import, never sections of their own; a list can be filtered by them.
 */
export const LEG_MODES = ['road', 'rail', 'sea', 'air'] as const;
export type LegMode = (typeof LEG_MODES)[number];

/** The legs' modes in order, a repeat folded into one (a truck that hands to a truck is one road). */
export function journeyModes(modes: Array<LegMode | undefined>): LegMode[] {
  const out: LegMode[] = [];
  for (const m of modes) if (m && out[out.length - 1] !== m) out.push(m);
  return out;
}

export class RailTerminal {
  @ApiProperty() label: string;
  @ApiProperty() location: { lat: number; lng: number };
}

export class RailMoment {
  @ApiProperty() at: string;
  @ApiProperty() by: string;
  @ApiProperty() recordedAt: string;
  /** The railway's own reference for it, as given: its arrival notice number. */
  @ApiPropertyOptional() reference?: string;
}

/** The importer's word that a truck goes before the railway said the box is there — kept, with why. */
export class RailCollectAnyway {
  @ApiProperty() by: string;
  @ApiProperty() at: string;
  @ApiProperty() reason: string;
}

export class ExportByRail {
  @ApiProperty({ type: RailTerminal }) terminal: RailTerminal;
  /** By when the box must be at the rail terminal for its train, as the railway or the forwarder said. */
  @ApiProperty() cutoffAt: string;
  /** The train or the rail booking's reference. */
  @ApiPropertyOptional() reference?: string;
  /** When the train brought the box inside the port gate, as the exporter was told: the line's clock moves inside then. */
  @ApiPropertyOptional({ type: RailMoment }) atPort?: RailMoment;
  @ApiProperty() recordedAt: string;
  @ApiProperty() recordedBy: string;
}

export class ImportByRail {
  @ApiProperty({ type: RailTerminal }) terminal: RailTerminal;
  /** When the railway expects the box there, as it said. Never a promise of ours. */
  @ApiPropertyOptional() expectedAt?: string;
  /** The free days the rail terminal gives before it charges for storage, as the importer's agreement says. */
  @ApiPropertyOptional() freeDays?: number;
  /** When the train left the port with the box, as the importer or its agent was told: the line's clock starts then. */
  @ApiPropertyOptional({ type: RailMoment }) leftPort?: RailMoment;
  /** The railway's arrival notice: the box is at the terminal. Until then the road leg from it is not taken. */
  @ApiPropertyOptional({ type: RailMoment }) arrival?: RailMoment;
  @ApiPropertyOptional({ type: RailCollectAnyway }) collectAnyway?: RailCollectAnyway;
  @ApiProperty() recordedAt: string;
  @ApiProperty() recordedBy: string;
  /** Bell warnings already given, so each is given once. */
  @ApiPropertyOptional() warned?: string[];
}

/** The gate a road load carries while the box it is sent for is still on its way by rail. */
export class FreightRailGate {
  @ApiProperty() importId: string;
  @ApiProperty() importCode: string;
  @ApiProperty() terminal: string;
  @ApiPropertyOptional() arrivedAt?: string;
  @ApiPropertyOptional({ type: RailCollectAnyway }) collectAnyway?: RailCollectAnyway;
}

/** The rail terminal's free days, counted from the arrival until our truck takes the box out. Derived on read. */
export class RailTerminalClock {
  @ApiProperty({ enum: ['not_started', 'running', 'due_soon', 'over', 'stopped', 'no_free_days'] }) state: 'not_started' | 'running' | 'due_soon' | 'over' | 'stopped' | 'no_free_days';
  @ApiPropertyOptional() startedAt?: string;
  @ApiPropertyOptional() freeDays?: number;
  /** The end of the last free day. */
  @ApiPropertyOptional() freeUntil?: string;
  /** When our truck took the box out of the terminal: the clock stops. */
  @ApiPropertyOptional() leftAt?: string;
  /** Days past the free days, counted whole and begun. */
  @ApiPropertyOptional() daysOver?: number;
}

export class ImportByRailView extends ImportByRail {
  @ApiProperty({ type: RailTerminalClock }) clock: RailTerminalClock;
  /** Whether the road leg from the terminal may be taken now — and if not, why, in the board's own words. */
  @ApiPropertyOptional() roadWaits?: string;
  /** The road leg was taken before the rail leg was recorded: its driver may arrive before the box. */
  @ApiPropertyOptional() takenBefore?: boolean;
}

export class ExportByRailDto {
  /** The rail terminal, from the exporter's own places. */
  @IsString() @MaxLength(80) terminalSiteId!: string;
  @IsString() cutoffAt!: string;
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
}

export class ImportByRailDto {
  @IsString() @MaxLength(80) terminalSiteId!: string;
  @IsOptional() @IsString() expectedAt?: string;
  @IsOptional() @IsInt() @Min(0) @Max(60) freeDays?: number;
}

export class RailArrivalDto {
  /** When the railway said the box was at the terminal, as ISO-8601. */
  @IsString() at!: string;
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
}

export class RailCollectAnywayDto {
  @IsString() @MinLength(5) @MaxLength(300) reason!: string;
}

/**
 * WHY A ROAD LOAD WAITS FOR A TRAIN, in the words the board shows a driver and the take refuses with. Undefined: it may go —
 * no gate, the railway said the box is there, or the importer said to collect anyway.
 */
export function railRefusal(f: { waitsForRail?: FreightRailGate } | undefined): string | undefined {
  const g = f?.waitsForRail;
  if (!g || g.arrivedAt || g.collectAnyway) return undefined;
  return `The box is still on its way by rail to ${g.terminal}: the railway has not said it is there. This load opens as soon as its arrival is recorded on ${g.importCode}.`;
}

/**
 * THE RAIL TERMINAL'S CLOCK — the free days, from the arrival until the box left on our truck. Pure: the same facts and
 * the same moment give the same answer. Due soon on the last free day.
 */
export function railTerminalClock(input: { arrivedAt?: string; freeDays?: number; leftAt?: string }, now: number): RailTerminalClock {
  const DAY = 86_400_000;
  if (!input.arrivedAt) return { state: 'not_started', ...(input.freeDays != null ? { freeDays: input.freeDays } : {}) };
  if (input.freeDays == null) return { state: 'no_free_days', startedAt: input.arrivedAt, ...(input.leftAt ? { leftAt: input.leftAt } : {}) };
  const start = Date.parse(input.arrivedAt);
  const until = start + input.freeDays * DAY;
  const base = { startedAt: input.arrivedAt, freeDays: input.freeDays, freeUntil: new Date(until).toISOString() };
  const end = input.leftAt ? Date.parse(input.leftAt) : now;
  const daysOver = end > until ? Math.ceil((end - until) / DAY) : 0;
  if (input.leftAt) return { state: 'stopped', ...base, leftAt: input.leftAt, ...(daysOver ? { daysOver } : {}) };
  if (daysOver) return { state: 'over', ...base, daysOver };
  return { state: until - now <= DAY ? 'due_soon' : 'running', ...base };
}
