import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * B4 — WHO AN EXPEDITOR SENDS FOR. The user, 2026-10-04: the expeditor is the shipper's AGENT, so the client stays the
 * shipper on the consignment note and the expeditor is named as the one who booked it for them.
 *
 * A client is an entry in the expeditor's own address book — a name, a country, an address and somebody to ring. It is
 * not an account, and nothing here checks it: the expeditor answers for who their clients are, the way a fleet answers
 * for its own customers on a run.
 */
export class BusinessClient {
  @ApiProperty() clientId: string;
  /** The expeditor whose book this is. */
  @ApiProperty() entityId: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() country?: string;
  @ApiPropertyOptional() address?: string;
  @ApiPropertyOptional() contactName?: string;
  @ApiPropertyOptional() contactPhone?: string;
  @ApiPropertyOptional() contactEmail?: string;
  @ApiProperty() createdBy: string;
  @ApiProperty() createdAt: string;
  /** Kept, not deleted: a load sent for them in March still names them. */
  @ApiPropertyOptional() archivedAt?: string;
  @ApiPropertyOptional() archivedBy?: string;
}

/**
 * Who a load or a booking was sent FOR, stamped when it was made. A copy, not a link: the consignment note is a legal
 * record, and renaming a client next year must not rewrite who the sender was on last year's note.
 */
export class ClientRef {
  @ApiProperty() clientId: string;
  @ApiProperty() name: string;
  @ApiPropertyOptional() country?: string;
  @ApiPropertyOptional() address?: string;
}

export function clientRefOf(c: BusinessClient): ClientRef {
  return { clientId: c.clientId, name: c.name, ...(c.country ? { country: c.country } : {}), ...(c.address ? { address: c.address } : {}) };
}
