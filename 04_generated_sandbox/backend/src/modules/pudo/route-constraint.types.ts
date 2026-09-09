import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { GeoPoint } from './pudo.types';

/**
 * What a driver can report from the cab, in one tap.
 *
 * Short on purpose. A long list is a form, and a form is not something anybody fills in at a junction
 * with a truck behind them. Everything here is a thing you can see from a windscreen and name without
 * looking anything up.
 */
export const CONSTRAINT_KINDS = [
  'LOW_BRIDGE',
  'HEIGHT_BARRIER',
  'WEIGHT_LIMIT',
  'NO_HAZMAT',
  'WASHOUT',
  'WEIGHBRIDGE',
  'FERRY',
  'CHECKPOINT',
] as const;
export type ConstraintKind = (typeof CONSTRAINT_KINDS)[number];

/**
 * What each kind DOES to a load that meets it — and the distinction the board lives on.
 *
 * A BLOCKER stops a vehicle: a bridge it does not fit under, a limit it may not exceed, a corridor its
 * cargo may not enter. An ADVISORY costs time and nothing else — a ferry, a weighbridge, a checkpoint
 * are all things a haulier wants to know about and none of them are a reason to refuse a load.
 *
 * Typing them apart is what keeps the board usable. A screen that shows "there is a weighbridge" with
 * the same weight as "this bridge will not take you" teaches an operator to skim past both.
 */
/**
 * A DISCRIMINATED union, so the compiler carries the rule instead of a comment asking nicely.
 *
 * Something that blocks is legal or physical and can be measured; something advisory is neither and has
 * nothing to measure. Written this way, code that tries to turn a ferry into a board blocker does not
 * compile — which is the guarantee worth having, because the failure it prevents is a screen showing
 * "there is a weighbridge" with the same weight as "this bridge will not take you".
 */
export type ConstraintEffect =
  | { blocks: true; measure: 'height_m' | 'weight_kg' | 'none'; kind: 'legal' | 'physical' }
  | { blocks: false; measure: 'none'; kind: 'advisory' };

export const CONSTRAINT_EFFECT: Record<ConstraintKind, ConstraintEffect> = {
  // PHYSICAL, not legal: it does not fit, and there is very often another way round that costs kilometres.
  LOW_BRIDGE: { blocks: true, measure: 'height_m', kind: 'physical' },
  HEIGHT_BARRIER: { blocks: true, measure: 'height_m', kind: 'physical' },
  // LEGAL: a posted limit is not a thing a driver may decide to exceed because the load nearly fits.
  WEIGHT_LIMIT: { blocks: true, measure: 'weight_kg', kind: 'legal' },
  NO_HAZMAT: { blocks: true, measure: 'none', kind: 'legal' },
  WASHOUT: { blocks: true, measure: 'none', kind: 'physical' },
  // Cost a haulier time, never the load.
  WEIGHBRIDGE: { blocks: false, measure: 'none', kind: 'advisory' },
  FERRY: { blocks: false, measure: 'none', kind: 'advisory' },
  CHECKPOINT: { blocks: false, measure: 'none', kind: 'advisory' },
};

/**
 * How much a report is currently believed.
 *
 * THE SAFETY ASYMMETRY, as a state machine. 'active' from a single report, because wrongly believing in
 * a low bridge costs a detour. 'disputed' when somebody says it is gone — which does NOT stop it warning,
 * because wrongly believing a low bridge is gone kills someone. Only 'cleared' silences it, and only an
 * operator can put it there.
 */
export const CONSTRAINT_STATUSES = ['active', 'disputed', 'cleared'] as const;
export type ConstraintStatus = (typeof CONSTRAINT_STATUSES)[number];

export interface RouteConstraint {
  constraintId: string;
  kind: ConstraintKind;
  at: GeoPoint;
  /** Metres for a height, kilograms for a limit. Absent where the kind has nothing to measure. */
  value?: number;
  /** What the driver typed, if anything — a road name, a landmark. Never required. */
  note?: string;
  reportedBy: string;
  reportedAt: string;
  /** Driver DIDs who passed it later and agreed. One vote each, and never the reporter's own. */
  confirmedBy: string[];
  /** Driver DIDs who say it is not there. Recorded, and deliberately NOT enough to clear it. */
  refutedBy: string[];
  status: ConstraintStatus;
  /** When it FIRST entered dispute since it was last believed. Cleared again if the crowd talks it back
   *  to 'active' — the operator's queue measures how long a hazard has been waiting on THEM, and a
   *  constraint that returned to active was never waiting. */
  disputedAt?: string;
  clearedBy?: string;
  clearedAt?: string;
  clearReason?: string;
}

/**
 * One constraint as anybody may read it — no reporter identities, which are nobody else's business.
 *
 * The ONLY shape that leaves this module. A driver identifiable as the one who slowed a corridor down is
 * a driver who stops reporting, so the DID lists never cross the wire — not even back to the person who
 * just refuted it. A CLASS, not an interface, so it emits into the contract: an anonymous response is an
 * untyped blob to the generated client, and a screen handed `unknown` renders nothing safely.
 */
export class ConstraintView {
  constraintId: string;
  @ApiProperty({ enum: CONSTRAINT_KINDS })
  kind: ConstraintKind;
  at: GeoPoint;
  @ApiPropertyOptional()
  value?: number;
  @ApiPropertyOptional()
  note?: string;
  @ApiProperty({ enum: CONSTRAINT_STATUSES })
  status: ConstraintStatus;
  reportedAt: string;
  /**
   * When somebody first said it was gone. Absent unless the status is 'disputed'.
   *
   * The operator's queue is sorted on this and not on the report date: a bridge reported two years ago and
   * disputed this morning has been waiting for an operator since this morning. Sorting the queue by the
   * report date would bury today's dispute under every old hazard on the map.
   */
  @ApiPropertyOptional()
  disputedAt?: string;
  /** How many OTHER drivers have since agreed it is there. Never who they are. */
  confirmations: number;
  /** How many say it is gone. Recorded and shown, and deliberately not enough to clear it. */
  refutations: number;
}

/** What is around here, or on the corridor ahead. Named so the rows emit — see ConstraintView. */
export class ConstraintsResponse {
  @ApiProperty({ type: [ConstraintView] })
  items: ConstraintView[];
  total: number;
}

/**
 * The corridor read, which says in the response what it is.
 *
 * `basis` is not decoration. An empty `items` means "nothing has been REPORTED on this line", and a
 * client that renders that as a clear road has told a haulier something nobody knows. The field makes
 * that impossible to read the other way.
 */
export class RouteConstraintsResponse extends ConstraintsResponse {
  @ApiProperty({ enum: ['reported-by-drivers-never-surveyed'] })
  basis: 'reported-by-drivers-never-surveyed';
}
