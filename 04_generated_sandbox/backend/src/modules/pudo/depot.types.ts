import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * HOW TO REACH A COMPANY — written by them, published by them, never verified by us.
 *
 * One card per company rather than a field set copied into each directory: a telephone number kept twice
 * drifts, and the copy on the screen drifts silently. It rides on the public profile page, in the yard
 * finder and beside an agent in the clearance directory.
 */
export class ContactCardView {
  /** Who to ask for. A role or a name, whichever the company prefers. */
  @ApiPropertyOptional() contactName?: string;
  @ApiPropertyOptional() phone?: string;
  /** The gate and the office are usually different telephones. */
  @ApiPropertyOptional() phoneAlt?: string;
  @ApiPropertyOptional() email?: string;
  @ApiPropertyOptional() website?: string;
  /** Where the gate is, in the words a driver needs — not the registered address, which is a legal fact. */
  @ApiPropertyOptional() address?: string;
  /** When somebody is there. The second question a haulier asks, after where. */
  @ApiPropertyOptional() hours?: string;
  /** The days visitors are received — `mon` … `sun` — and from when until when (`HH:MM`). Theirs to set. */
  @ApiPropertyOptional({ type: [String] }) visitDays?: string[];
  @ApiPropertyOptional() visitFrom?: string;
  @ApiPropertyOptional() visitTo?: string;
  @ApiProperty() saidAt: string;
  @ApiProperty() saidBy: string;
  /** Said out loud on every screen that shows it: this is their claim and nobody checked it. */
  @ApiProperty() basis: string;
}

/**
 * Y4 — A YARD THAT WANTS TO BE FINDABLE, and what it says is standing in it.
 *
 * What is deliberately absent from every class here is a slot, a row, a tier and a stacking plan. Yard
 * management is mainly smart planning, and that planning needs the yard's geometry, the rules that bind a
 * slot to a box (a powered row for a reefer, segregation distances for dangerous goods, tier weights and
 * ground bearing) and the departure order. The first two are a model of somebody else's physical site
 * that we have never seen; the third we already hold, because the leg home is on the board.
 *
 * So: we record the position the yard WRITES, we never assign one, and we tell them what is arriving.
 */

/** One box the yard says is standing there. A claim — attributed, dated, and never checked. */
export class DepotBoxSaidView {
  @ApiProperty() containerNo: string;
  /**
   * THE YARD'S OWN WORDS for where it is: "C-12, third row". A label so a haulier can be told where to
   * drive, not a coordinate in a model we pretend to hold.
   */
  @ApiPropertyOptional() position?: string;
  @ApiPropertyOptional() note?: string;
  @ApiProperty() at: string;
  @ApiProperty() by: string;
}

/** One leg that names this yard: arrived (so we derived a box here) or still on its way. */
export class DepotLegView {
  @ApiProperty() containerNo: string;
  @ApiProperty() legCode: string;
  @ApiProperty({ enum: ['posted', 'moving', 'arrived'] }) state: string;
  @ApiPropertyOptional() at?: string;
  /** Nothing in it. A yard plans differently for an empty than for a box that has to be stripped. */
  @ApiProperty() empty: boolean;
}

export class DepotRegisterView {
  @ApiProperty() entityId: string;
  @ApiProperty() placeLabel: string;
  @ApiProperty() country: string;
  @ApiPropertyOptional() note?: string;
  @ApiProperty() closed: boolean;
  /** What the yard SAYS is standing there. */
  @ApiProperty({ type: [DepotBoxSaidView] }) said: DepotBoxSaidView[];
  /** What we DERIVED — legs that ended here. Incomplete by construction: it knows only our own legs. */
  @ApiProperty({ type: [DepotLegView] }) derived: DepotLegView[];
  /** What is ON ITS WAY here. The one thing a gate man with a notebook cannot know. */
  @ApiProperty({ type: [DepotLegView] }) inbound: DepotLegView[];
  /** How many appear in both lists. A fact about two sources, never a merge of them. */
  @ApiProperty() inBoth: number;
  /** How to reach the yard, written by the yard. Their own entry, on their own screen. */
  @ApiPropertyOptional({ type: ContactCardView }) contact?: ContactCardView;
  @ApiProperty() basis: string;
}

/** One yard in the finder. Counts travel; the numbers do not — see the service. */
export class DepotRow {
  @ApiProperty() entityId: string;
  @ApiProperty() placeLabel: string;
  @ApiProperty() country: string;
  @ApiPropertyOptional() note?: string;
  @ApiPropertyOptional() location?: Record<string, number>;
  @ApiProperty() saidAt: string;
  @ApiProperty() saidBy: string;
  @ApiProperty() saidCount: number;
  @ApiProperty() derivedCount: number;
  @ApiProperty() inboundCount: number;
  /** HOW TO REACH THEM — the whole point of a finder, and the thing this one first shipped without. */
  @ApiPropertyOptional({ type: ContactCardView }) contact?: ContactCardView;
  @ApiProperty() basis: string;
}

export class DepotListResponse {
  @ApiProperty({ type: [DepotRow] }) items: DepotRow[];
  /** ALPHABETICAL, and said out loud — an ordering is a judgement, and this list makes none. */
  @ApiProperty() basis: string;
}
