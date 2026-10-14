import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ProfileMobilisation } from './profile.types';

/**
 * One hand-back, as only an operator sees it.
 *
 * THE REASON IS NOT PUBLISHED, and that is a decision rather than an omission. FP8 made handing a load
 * back possible and, to its credit, recorded why — and a great many of those reasons are the safety rules
 * working: a driver who hands a load back because their rest is due has done the right thing. Publishing
 * the reason on a page a shipper reads would punish the honest use of a rule this network wrote, and the
 * predictable response is drivers who stop handing back and drive tired instead.
 *
 * So the COUNT is public and the REASON is here, where somebody handling a complaint can read it. That is
 * not a second version of the record: the public page and this screen agree on every number.
 */
export class MoverHandBack {
  /** The load, by its code — an operator can look it up. */
  code: string;
  /** The driver's shop-floor label, never their legal name. Operators are trusted, not omniscient. */
  driver: string;
  reason: string;
  at: string;
}

/** What one driver of this fleet did. Operator-only, for the same reason the reasons are. */
export class MoverDriver {
  driver: string;
  claimed: number;
  handedBack: number;
  kept: number;
  delivered: number;
}

/**
 * One fleet's record, as the console shows it.
 *
 * `moves` is EXACTLY the object the public page carries — not a recomputation and not a superset. An
 * operator's view is the same record with context added, never a different record, because the moment the
 * two can disagree the public one stops being trustworthy and reciprocal visibility becomes a slogan.
 */
export class MoverRow {
  did: string;
  name: string;
  /** Their public page, so an operator can read exactly what a shipper reads. */
  @ApiPropertyOptional()
  handle?: string;
  @ApiPropertyOptional()
  jurisdiction?: string;
  /** How many drivers they field — the denominator behind everything below. */
  drivers: number;
  @ApiProperty({ type: ProfileMobilisation })
  moves: ProfileMobilisation;
  @ApiProperty({ type: [MoverHandBack] })
  handBacks: MoverHandBack[];
  @ApiProperty({ type: [MoverDriver] })
  perDriver: MoverDriver[];
}

/**
 * Everybody who moves loads, with the half a shipper does not see.
 *
 * ON §6'S STATE-CONTROLLED SPLIT, which this screen was supposed to carry: it does not exist here, and
 * saying so is better than inventing it. That split — inspection selection, physical exam, queue position
 * — is a CUSTOMS concept, and it belongs to a clearing agent's record. A fleet's delays are its own; there
 * is no state actor sitting between a fleet and a delivered load whose share we would have to separate
 * out. When the agent's own record exists (§CL4, item 1), the split ships with it and belongs there.
 */
export class MoversView {
  @ApiProperty({ type: [MoverRow] })
  items: MoverRow[];
  /** What the figures do and do not cover — the same sentence the public page carries, verbatim. */
  measured: string;
}
