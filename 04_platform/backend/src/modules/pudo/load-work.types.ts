import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 2026-11-13 — UNUSUAL LOADS (the owner: "We should not go into specifics as house or student moves as service … rather think
 * of something broader to embrace unusual loads"; plan U1–U4 as revised on the page). What it takes to MOVE a load, beside what
 * the goods are: for each end, who is there to help and what equipment, the floor, a lift, how far it is carried; for the load,
 * how many people it takes to lift and carry, or a machine; and how it must be handled. The rules are in load-work.ts.
 */

/** People at an end who will help load or unload: nobody, one, or two or more. */
export const SITE_HANDS = ['none', 'one', 'two'] as const;
export type SiteHands = (typeof SITE_HANDS)[number];

/** Equipment at an end: a forklift, a pallet jack, a loading dock, a crane. */
export const END_EQUIPMENT = ['FLT', 'PLT', 'DOCK', 'CRN'] as const;
export type EndEquipment = (typeof END_EQUIPMENT)[number];

/** What the load takes to lift and carry: one person, two, three or more — or a machine (it is on a pallet, or too heavy to lift). */
export const LOAD_NEEDS = ['one', 'two', 'three', 'machine'] as const;
export type LoadNeeds = (typeof LOAD_NEEDS)[number];

/** How it must be handled, beside fragile and one piece (which loads already say). */
export const HANDLING_MARKS = ['upright', 'noStack', 'long', 'blankets', 'securing'] as const;
export type HandlingMark = (typeof HANDLING_MARKS)[number];

/** One end of a load — where it is picked up, or delivered — as the poster says it. */
export class LoadEnd {
  @ApiProperty({ enum: SITE_HANDS }) hands: SiteHands;
  @ApiPropertyOptional({ enum: END_EQUIPMENT, isArray: true }) equipment?: EndEquipment[];
  /** "Sender loads" / "Receiver unloads": they do it themselves, so the driver brings nothing here. */
  @ApiPropertyOptional() theyDoIt?: boolean;
  /** The floor it is on: 0 is the ground. */
  @ApiPropertyOptional() floor?: number;
  /** A lift that takes it. */
  @ApiPropertyOptional() lift?: boolean;
  /** How far it is carried from where the vehicle stops, in metres. */
  @ApiPropertyOptional() carryM?: number;
  /** Waiting expected at this end, in minutes. */
  @ApiPropertyOptional() waitMin?: number;
}

/** What it takes to move a load: the load, its two ends, and how it must be handled. */
export class LoadWork {
  @ApiProperty({ enum: LOAD_NEEDS }) needs: LoadNeeds;
  @ApiProperty({ type: LoadEnd }) pickup: LoadEnd;
  @ApiProperty({ type: LoadEnd }) delivery: LoadEnd;
  @ApiPropertyOptional({ enum: HANDLING_MARKS, isArray: true }) marks?: HandlingMark[];
}

/** What a driver must bring to one end: helpers beside themselves, a tail-lift, a pallet jack. All zero: nothing. */
export class EndGap {
  @ApiProperty() helpers: number;
  @ApiProperty() tailLift: boolean;
  @ApiProperty() palletJack: boolean;
}

/** A named piece of extra work — what a driver prices when they name one price for the whole job (U4). */
export const EXTRA_KINDS = ['helper', 'tailLift', 'palletJack', 'floors', 'carry', 'wait'] as const;
export type ExtraKind = (typeof EXTRA_KINDS)[number];

export class LoadExtra {
  @ApiProperty({ enum: ['pickup', 'delivery'] }) end: 'pickup' | 'delivery';
  @ApiProperty({ enum: EXTRA_KINDS }) kind: ExtraKind;
  /** How many: helpers, floors, metres, minutes. */
  @ApiPropertyOptional() n?: number;
}

/** Both ends' gaps. */
export class GapPair {
  @ApiProperty({ type: EndGap }) pickup: EndGap;
  @ApiProperty({ type: EndGap }) delivery: EndGap;
}

/**
 * The work on a load as every screen reads it: what each end offers, what the driver brings there, the extra work named for
 * one negotiated price, and the handling marks (with LONG added from the measurements).
 */
export class LoadWorkView {
  @ApiPropertyOptional({ enum: LOAD_NEEDS }) needs?: LoadNeeds;
  @ApiPropertyOptional({ type: LoadEnd }) pickup?: LoadEnd;
  @ApiPropertyOptional({ type: LoadEnd }) delivery?: LoadEnd;
  @ApiPropertyOptional({ type: GapPair }) gaps?: GapPair;
  @ApiProperty({ type: [LoadExtra] }) extras: LoadExtra[];
  @ApiProperty({ enum: HANDLING_MARKS, isArray: true }) marks: HandlingMark[];
}

/** What a driver can bring to a job: the people who work with them, and their vehicle's tail-lift and pallet jack. */
export interface DriverBrings {
  helpers: number;
  tailLift: boolean;
  palletJack: boolean;
}
