import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * 2026-11-11 — A HUB DOWN (the ISO 28000 check, gap 12; the owner: "build it now"). Nothing said a hub was closed, so bags
 * kept being addressed to it. Now the hub — or staff, when it cannot be reached — says it is down and why, and until when
 * if it knows: new bags go to another approved hub serving the zone, bags on the way are sent there, and the extra leg is
 * the network's cost. Its floor is not refused: a bag that reaches it anyway is still taken in by whoever is there.
 */
export const HUB_DOWN_REASONS = ['power', 'flood', 'security', 'no_staff', 'authority', 'other'] as const;
export type HubDownReason = (typeof HUB_DOWN_REASONS)[number];

/** The longest a hub is said to be down for at once; longer, it is said again — or it is not a hub for now. */
export const HUB_DOWN_MAX_DAYS = 30;

/** Down now: said so, and not past the time it was said to open again (then it is open by itself). */
export function hubIsDown(down: { until?: string } | undefined, now: number = Date.now()): boolean {
  return Boolean(down && !(down.until && Date.parse(down.until) <= now));
}

export const HUB_DOWN_WORDS: Readonly<Record<HubDownReason, string>> = {
  power: 'no power',
  flood: 'flooding, or the road to it cut',
  security: 'unsafe to open',
  no_staff: 'nobody to work it',
  authority: 'closed by an authority',
  other: 'closed',
};

export class HubDown {
  @ApiProperty() since!: string;
  /** When it opens again, where whoever said it knows: past it, it is open by itself. */
  @ApiPropertyOptional() until?: string;
  @ApiProperty({ enum: HUB_DOWN_REASONS }) reason!: HubDownReason;
  @ApiPropertyOptional() note?: string;
  /** Who said so, by name. */
  @ApiProperty() by!: string;
  @ApiProperty({ enum: ['hub', 'staff'] }) byRole!: 'hub' | 'staff';
}

export class HubDownDto {
  @IsIn([...HUB_DOWN_REASONS]) reason!: HubDownReason;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  @IsOptional() @IsISO8601() until?: string;
  /** Who is saying it, for a console on the shared key; a named sign-in's own name wins. */
  @IsOptional() @IsString() @MaxLength(120) by?: string;
}

/** Open again: only who says so, for a console on the shared key. */
export class HubDownUpDto {
  @IsOptional() @IsString() @MaxLength(120) by?: string;
}

/** A bag the network sent to another hub because the one it went to was down. */
export class ToteRedirect {
  @ApiProperty() at!: string;
  @ApiProperty() fromId!: string;
  @ApiProperty() fromName!: string;
  @ApiProperty() toId!: string;
  @ApiProperty() toName!: string;
  @ApiProperty({ enum: ['hub_down'] }) reason!: 'hub_down';
  /** On a vehicle already: the driver was paid the extra leg, as the network's cost. */
  @ApiPropertyOptional() paidExtra?: boolean;
}
