import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * P1 — A STANDING CONTRACT OF CARRIAGE between a shipper and ONE fleet.
 *
 * The user, 2026-10-05: "Fleet owners often times work with a contract for a longer period. They must deliver." A
 * webshop selling bricks has its orders carried by a fleet it has an agreement with — not offered to whoever is on
 * the open board. The contract is what routes those orders to that fleet's queue, and nothing else: its price, its
 * terms and its payment are between the two of them (the rule since 2026-10-04 — we never handle their money), so
 * the record keeps a reference to THEIR paper, never a rate of ours.
 *
 * The FLEET records it, because the fleet is the party that must deliver and plans for it. The shipper may or may
 * not be on SeeBuyGet: a fleet whose customer is not here uploads that customer's orders itself. When the shipper
 * IS here, the fleet hands its business a one-time code and the business links the contract — from then on the
 * business posts its orders straight into the fleet's queue.
 */
export const CONTRACT_STATUSES = ['active', 'ended'] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export class ContractShipper {
  /** As the fleet named them — and, once linked, as the business is registered. Box 1 on every order's note. */
  name: string;
  /** The shipper's business on SeeBuyGet, once it linked the contract with the fleet's code. Absent: not here. */
  @ApiPropertyOptional() entityId?: string;
  @ApiPropertyOptional() linkedAt?: string;
  /** Which person in the business linked it. */
  @ApiPropertyOptional() linkedBy?: string;
}

export class ContractEnd {
  at: string;
  /** Which side ended it, and the person who did. */
  @ApiProperty({ enum: ['fleet', 'shipper'] }) side: 'fleet' | 'shipper';
  by: string;
  @ApiPropertyOptional() reason?: string;
}

/** The pending link, kept as a hash. The code itself is shown once, to the fleet that asked for it. */
export interface ContractInvite {
  codeHash: string;
  expiresAt: string;
  issuedAt: string;
}

export class CarriageContract {
  contractId: string;
  fleetDid: string;
  fleetName: string;
  @ApiProperty({ type: ContractShipper }) shipper: ContractShipper;
  /** Their own contract number — what both sides call it. Never a price. */
  @ApiPropertyOptional() reference?: string;
  /** From and until when orders may be placed under it (calendar days, inclusive). Absent: open-ended. */
  @ApiPropertyOptional() startsOn?: string;
  @ApiPropertyOptional() endsOn?: string;
  @ApiProperty({ enum: CONTRACT_STATUSES }) status: ContractStatus;
  createdAt: string;
  createdBy: string;
  @ApiPropertyOptional({ type: ContractEnd }) ended?: ContractEnd;
  /** Internal — the code a business links with. Never sent out. */
  invite?: ContractInvite;
}

/** A contract as either party reads it: everything except the hash of a code. */
export class CarriageContractView {
  contractId: string;
  fleetDid: string;
  fleetName: string;
  @ApiProperty({ type: ContractShipper }) shipper: ContractShipper;
  @ApiPropertyOptional() reference?: string;
  @ApiPropertyOptional() startsOn?: string;
  @ApiPropertyOptional() endsOn?: string;
  @ApiProperty({ enum: CONTRACT_STATUSES }) status: ContractStatus;
  createdAt: string;
  createdBy: string;
  @ApiPropertyOptional({ type: ContractEnd }) ended?: ContractEnd;
  /** Whether a link code is outstanding, and until when — never the code. */
  @ApiPropertyOptional() inviteExpiresAt?: string;
}

/** The answer to issuing a code: the contract, and the code — the only time it is ever shown. */
export class ContractInviteIssued {
  @ApiProperty({ type: CarriageContractView }) contract: CarriageContractView;
  code: string;
  expiresAt: string;
}

export class CarriageContractList {
  @ApiProperty({ type: [CarriageContractView] }) items: CarriageContractView[];
}

/** What a contract order carries: a COPY, so renaming either side later never rewrites an order's papers. */
export class ContractRef {
  contractId: string;
  fleetDid: string;
  fleetName: string;
  shipperName: string;
  @ApiPropertyOptional() reference?: string;
}
