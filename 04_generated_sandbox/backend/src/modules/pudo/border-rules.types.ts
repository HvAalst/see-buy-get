import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * CA6 — THE RULES OF CROSSING A BORDER (user, 2026-09-13).
 *
 * Trucks carry the trade between countries, and the road has rules the map does not show: where a border may be
 * crossed and when, the permits and the regional insurance a vehicle must carry, the size the crossing allows —
 * and CABOTAGE: a foreign truck is often not allowed to carry a load inside another country at all.
 *
 * A rule is held per DIRECTION (a Kenyan truck entering Tanzania is not a Tanzanian truck entering Kenya), and
 * the absence of a rule is not permission — the same rule as the crowd-sourced road constraints.
 */
export const CABOTAGE_RULES = ['allowed', 'forbidden'] as const;
export type CabotageRule = (typeof CABOTAGE_RULES)[number];

export class BorderCrossingPoint {
  @ApiProperty() name: string;
  /** Opening hours as the post states them ("06:00–22:00", "24 hours"). */
  @ApiPropertyOptional() hours?: string;
  @ApiPropertyOptional() note?: string;
}

export class BorderRule {
  /** The country the vehicle comes FROM (and is registered in, for cabotage). */
  @ApiProperty() from: string;
  /** The country it enters. */
  @ApiProperty() to: string;
  @ApiProperty({ type: [BorderCrossingPoint] }) crossings: BorderCrossingPoint[];
  /** Transit permits a vehicle needs to cross (named as the authority names them). */
  @ApiProperty({ type: [String] }) permits: string[];
  /** Regional insurance it must carry — e.g. the COMESA Yellow Card. */
  @ApiProperty({ type: [String] }) regionalInsurance: string[];
  @ApiPropertyOptional() maxWeightKg?: number;
  @ApiPropertyOptional() maxLengthM?: number;
  @ApiPropertyOptional() maxHeightM?: number;
  /** May a vehicle from `from` carry a load that starts and ends inside `to`? */
  @ApiProperty({ enum: CABOTAGE_RULES }) cabotage: CabotageRule;
  @ApiPropertyOptional() note?: string;
  @ApiProperty() setBy: string;
  @ApiProperty() setAt: string;
}

/** What a driver taking a cross-border load needs to know, before claiming it. */
export class BorderAdvice {
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  /** False where nobody has recorded the crossing: the driver is told that, rather than told nothing. */
  @ApiProperty() recorded: boolean;
  @ApiProperty({ type: [BorderCrossingPoint] }) crossings: BorderCrossingPoint[];
  @ApiProperty({ type: [String] }) permits: string[];
  @ApiProperty({ type: [String] }) regionalInsurance: string[];
  @ApiPropertyOptional() maxWeightKg?: number;
  @ApiPropertyOptional() maxLengthM?: number;
  @ApiPropertyOptional() maxHeightM?: number;
  @ApiPropertyOptional() note?: string;
}

export type BorderRefusalCode = 'CABOTAGE_NOT_PERMITTED' | 'OVER_BORDER_WEIGHT_LIMIT';

export interface BorderRefusal {
  code: BorderRefusalCode;
  message: string;
}
