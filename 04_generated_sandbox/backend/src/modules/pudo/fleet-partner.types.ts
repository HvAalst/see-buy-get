import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * P4 — A FLEET'S PARTNERS: the other fleets it hands its overflow to first.
 *
 * The user, 2026-10-05: when tomorrow needs more trucks than the fleet has, what is left over goes to "partner fleets,
 * then board". A partner is a fleet this one has an arrangement with — made off the platform, like every price here —
 * and the record of it says only that the one may OFFER orders to the other. It commits nobody: a partner takes an
 * offered order or leaves it.
 *
 * It is made the way a contract is linked: the fleet that will be offering issues a one-time code, and the partner's
 * office enters it. A code addresses one arrangement; entering it is the partner's own act of agreeing to be offered
 * work. Either side ends it, which stops new offers and touches nothing already taken.
 */
export const PARTNERSHIP_STATUSES = ['invited', 'active', 'ended'] as const;
export type PartnershipStatus = (typeof PARTNERSHIP_STATUSES)[number];

export class PartnershipEnd {
  at: string;
  /** Which side ended it: the fleet that offers, or the partner. */
  @ApiProperty({ enum: ['from', 'to'] }) side: 'from' | 'to';
  by: string;
}

export class FleetPartnership {
  partnershipId: string;
  /** The fleet that offers its overflow. */
  fromFleetDid: string;
  fromFleetName: string;
  /** What the offering fleet calls the partner, until the partner's office links it — then the partner's own name. */
  partnerName: string;
  /** The partner, once its office entered the code. */
  @ApiPropertyOptional() toFleetDid?: string;
  @ApiProperty({ enum: PARTNERSHIP_STATUSES }) status: PartnershipStatus;
  createdAt: string;
  createdBy: string;
  @ApiPropertyOptional() linkedAt?: string;
  @ApiPropertyOptional() linkedBy?: string;
  @ApiPropertyOptional({ type: PartnershipEnd }) ended?: PartnershipEnd;
  /**
   * Whether the partner may PASS ON an order it took from this fleet to a fleet of its own. Off unless the offering
   * fleet turns it on (the user, 2026-10-06: "only if I allowed that partner"): its customer's goods go no further
   * than the fleet it chose, unless it said they may.
   */
  @ApiPropertyOptional() mayPassOn?: boolean;
  /** Internal — the hash of the code and when it stops working. Never sent out. */
  invite?: { codeHash: string; expiresAt: string };
}

/** A partnership as either fleet reads it: everything but the hash of a code. */
export class FleetPartnershipView {
  partnershipId: string;
  fromFleetDid: string;
  fromFleetName: string;
  partnerName: string;
  @ApiPropertyOptional() toFleetDid?: string;
  @ApiProperty({ enum: PARTNERSHIP_STATUSES }) status: PartnershipStatus;
  createdAt: string;
  createdBy: string;
  @ApiPropertyOptional() linkedAt?: string;
  @ApiPropertyOptional() linkedBy?: string;
  @ApiPropertyOptional({ type: PartnershipEnd }) ended?: PartnershipEnd;
  /** Whether the partner may pass this fleet's orders on to a fleet of its own. The offering fleet's switch. */
  @ApiPropertyOptional() mayPassOn?: boolean;
  @ApiPropertyOptional() inviteExpiresAt?: string;
}

export class PartnerInviteIssued {
  @ApiProperty({ type: FleetPartnershipView }) partnership: FleetPartnershipView;
  /** The code — shown this once. */
  code: string;
  expiresAt: string;
}

/** Both directions, kept apart: the fleets this one may offer to, and the fleets that may offer to it. */
export class FleetPartnerLists {
  @ApiProperty({ type: [FleetPartnershipView] }) offeringTo: FleetPartnershipView[];
  @ApiProperty({ type: [FleetPartnershipView] }) offeredBy: FleetPartnershipView[];
}

/** A fleet named on an order: by its identity and the name it trades under. */
export class HandOnFleet {
  fleetDid: string;
  fleetName: string;
}

/**
 * WHAT BECAME OF AN ORDER ITS FLEET COULD NOT CARRY ITSELF.
 *
 * `offered` put to the fleet's partners, and none has taken it yet · `partner` a partner took it, and carries it ·
 * `board` released to the open board, where any checked carrier can take it.
 *
 * The contract carrier stays the fleet the shipper ordered from: this records who it handed the carrying to. The
 * shipper's papers name whoever actually carried.
 */
export const HAND_ON_STATES = ['offered', 'partner', 'board'] as const;
export type HandOnState = (typeof HAND_ON_STATES)[number];

/** A partner that took an order, offering it on to fleets of its own. */
export class OnwardOffer {
  at: string;
  by: string;
  /** The fleets still deciding. */
  @ApiProperty({ type: [HandOnFleet] }) offeredTo: HandOnFleet[];
}

export class OrderHandOn {
  @ApiProperty({ enum: HAND_ON_STATES }) state: HandOnState;
  at: string;
  by: string;
  /** The partners still deciding. A partner that declines is taken off; nobody left means the offer has run out. */
  @ApiPropertyOptional({ type: [HandOnFleet] }) offeredTo?: HandOnFleet[];
  /** The partner that took it. */
  @ApiPropertyOptional({ type: HandOnFleet }) partner?: HandOnFleet;
  @ApiPropertyOptional() takenAt?: string;
  @ApiPropertyOptional() takenBy?: string;
  /**
   * PASSED ON. The partner that took it from the fleet it was ordered from, and passed it on to the one carrying it
   * now (`partner`). One step and no further: a fleet that an order was passed on to carries it or gives it back.
   */
  @ApiPropertyOptional({ type: HandOnFleet }) via?: HandOnFleet;
  /** While the partner that took it is offering it on, and nobody has taken it yet. It is in nobody's plan meanwhile. */
  @ApiPropertyOptional({ type: OnwardOffer }) onward?: OnwardOffer;
}
