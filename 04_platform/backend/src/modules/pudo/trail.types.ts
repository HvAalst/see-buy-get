import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * THE TRAIL (the ISO 28000 check: "anchor custody, loads, seals and the documents' fingerprints"; built without asking).
 *
 * Every parcel scan was anchored in the network's chain (fabric-ledger.adapter.ts); a load's taking over and delivery, the
 * copies of its consignment note frozen at each moment, the exceptions of the tamper protocol and a bag's closing, take and
 * receipt were fingerprinted, and kept, and anchored nowhere — so a record changed afterwards could be told from the
 * original by nobody. Now each is anchored as it is kept, and staff can ask for a unit's trail: every step worked out
 * again from the record as it stands and checked against what the chain holds — intact, altered, or made before the trail
 * was anchored. Only hashes go into the chain: no names, no numbers, no amounts.
 */

export const TRAIL_STATES = ['intact', 'altered', 'not_anchored'] as const;
export type TrailState = (typeof TRAIL_STATES)[number];

export const TRAIL_STEPS = ['picked_up', 'delivered', 'note', 'exception', 'seal_written', 'seal_read', 'seal_broken', 'seal_replaced', 'bag_closed', 'bag_taken', 'bag_received', 'scan', 'damage_report', 'damage_note'] as const;
export type TrailStepKind = (typeof TRAIL_STEPS)[number];

export class TrailStep {
  @ApiProperty({ enum: TRAIL_STEPS }) kind!: TrailStepKind;
  at!: string;
  @ApiProperty({ enum: TRAIL_STATES }) state!: TrailState;
  /** What it was, in a word: the note copy's moment, the exception's finding. */
  @ApiPropertyOptional() detail?: string;
  @ApiPropertyOptional() txId?: string;
}

/** The chain as a whole: every anchor walked. */
export class TrailChain {
  anchors!: number;
  whole!: boolean;
  @ApiPropertyOptional() brokenAt?: number;
  @ApiPropertyOptional() reason?: string;
}

export class TrailView {
  ref!: string;
  @ApiProperty({ enum: ['load', 'bag', 'parcel'] }) kind!: 'load' | 'bag' | 'parcel';
  @ApiProperty({ type: [TrailStep] }) steps!: TrailStep[];
  @ApiPropertyOptional({ type: TrailChain }) chain?: TrailChain;
}
