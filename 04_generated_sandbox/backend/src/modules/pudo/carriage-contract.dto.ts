import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** P1 — the fleet records a contract it carries under. */
export class CreateContractDto {
  /** Who the fleet carries for — the sender on every order's consignment note until their business links it. */
  @IsString() @MaxLength(120) shipperName!: string;
  /** Their own contract number. Never a price: the terms are between the two of them. */
  @IsOptional() @IsString() @MaxLength(60) reference?: string;
  @IsOptional() @Matches(DAY, { message: 'A start date is a calendar day (YYYY-MM-DD)' }) startsOn?: string;
  @IsOptional() @Matches(DAY, { message: 'An end date is a calendar day (YYYY-MM-DD)' }) endsOn?: string;
}

/** The shipper's business links a contract with the code its fleet sent. */
export class LinkContractDto {
  @IsString() @MaxLength(40) code!: string;
}

export class EndContractDto {
  @IsOptional() @IsString() @MaxLength(280) reason?: string;
}

/** A fleet's orders, by the day they must arrive. Both ends inclusive; absent means unbounded. */
export class FleetOrdersQueryDto {
  @IsOptional() @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) from?: string;
  @IsOptional() @Matches(DAY, { message: 'A day is YYYY-MM-DD' }) to?: string;
}
