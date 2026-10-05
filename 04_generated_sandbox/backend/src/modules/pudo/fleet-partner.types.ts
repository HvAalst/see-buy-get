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
}
