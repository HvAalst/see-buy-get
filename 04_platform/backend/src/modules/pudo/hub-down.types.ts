import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsISO8601, IsOptional, IsString, MaxLength } from 'class-validator';

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

/**
 * 2026-11-11 — the owner: "Reopening time should be a mandatory field when closing a hub but we need to confirm before it
 * opens whether it actually will be open through a daily bell"; not confirmed by then, "stays closed, staff told". The hub's
 * word counts when it is given in the last day before the time it said.
 */
export const HUB_DOWN_CONFIRM_WINDOW_H = 24;

/** Whether the hub has said, in the last day before it, that it opens at the time it gave. */
export function confirmedInTime(down: { until?: string; confirmedAt?: string } | undefined): boolean {
  if (!down?.until || !down.confirmedAt) return false;
  return Date.parse(down.confirmedAt) >= Date.parse(down.until) - HUB_DOWN_CONFIRM_WINDOW_H * 3_600_000;
}

/** Whether the hub may be asked to confirm now: from a day before the time it gave, and after it. */
export function confirmOpen(down: { until?: string } | undefined, now: number = Date.now()): boolean {
  return Boolean(down?.until && now >= Date.parse(down.until) - HUB_DOWN_CONFIRM_WINDOW_H * 3_600_000);
}

/** Past the time it gave, and it never confirmed: it stays down, and staff are told (the console's flags). */
export function unconfirmedPast(down: { until?: string; confirmedAt?: string } | undefined, now: number = Date.now()): boolean {
  return Boolean(down?.until && Date.parse(down.until) <= now && !confirmedInTime(down));
}

/** Down now: said so, and not past a time it confirmed it opens at. Past an unconfirmed time it stays down. */
export function hubIsDown(down: { until?: string; confirmedAt?: string } | undefined, now: number = Date.now()): boolean {
  return Boolean(down && !(down.until && Date.parse(down.until) <= now && confirmedInTime(down)));
}

export const HUB_DOWN_WORDS: Readonly<Record<HubDownReason, string>> = {
  power: 'no power',
  flood: 'flooding, or the road to it cut',
  security: 'unsafe to open',
  no_staff: 'nobody to work it',
  authority: 'closed by an authority',
  other: 'closed',
};

/** 2026-11-11 — drivers may come for the bags standing in a hub that is down: the hub, or staff, said its door opens for them. */
export class HubDownCollect {
  @ApiProperty() since!: string;
  @ApiProperty() by!: string;
  @ApiProperty({ enum: ['hub', 'staff'] }) byRole!: 'hub' | 'staff';
}

export class HubDown {
  @ApiProperty() since!: string;
  /** When it opens again — always said (the owner, 2026-11-11). It opens then only if the hub confirmed it in the day before. */
  @ApiPropertyOptional() until?: string;
  /** When the hub last said it opens at `until` — counted only in the day before it (confirmedInTime). */
  @ApiPropertyOptional() confirmedAt?: string;
  /** When the daily bell last asked. */
  @ApiPropertyOptional() askedAt?: string;
  /** When it was told it stays closed for not confirming, for this `until`. */
  @ApiPropertyOptional() unconfirmedToldAt?: string;
  @ApiPropertyOptional({ type: HubDownCollect }) collectable?: HubDownCollect;
  @ApiProperty({ enum: HUB_DOWN_REASONS }) reason!: HubDownReason;
  @ApiPropertyOptional() note?: string;
  /** Who said so, by name. */
  @ApiProperty() by!: string;
  @ApiProperty({ enum: ['hub', 'staff'] }) byRole!: 'hub' | 'staff';
}

export class HubDownDto {
  @IsIn([...HUB_DOWN_REASONS]) reason!: HubDownReason;
  @IsOptional() @IsString() @MaxLength(200) note?: string;
  /** When it opens again: mandatory (the owner, 2026-11-11) — a best guess where it is not known, asked again every day. */
  @IsISO8601() until!: string;
  /** Who is saying it, for a console on the shared key; a named sign-in's own name wins. */
  @IsOptional() @IsString() @MaxLength(120) by?: string;
}

/** The hub's word on its reopening: a new time, or (none given) that it opens at the time it gave — or now, that time past. */
export class HubReopeningDto {
  @IsOptional() @IsISO8601() until?: string;
  @IsOptional() @IsString() @MaxLength(120) by?: string;
}

/** Drivers may come for the bags standing in it, or no longer. */
export class HubCollectDto {
  @IsBoolean() collectable!: boolean;
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
  /** How it was paid, by the driver's country's run pay (the owner, 2026-11-11): a bag's fee, or the extra km at their rate. */
  @ApiPropertyOptional({ enum: ['bag', 'km'] }) paidAs?: 'bag' | 'km';
  /** By km: how many km the bag's road grew by. */
  @ApiPropertyOptional() extraKm?: number;
}
