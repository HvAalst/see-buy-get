import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

/**
 * THE DIRECTORY (the user, 2026-10-30: "a directory much similar to that of fiata.org but in our own style"; choices in
 * memory decided-2026-10-30-directory). Logistics firms on SeeBuyGet, by country and by what they do: verified
 * forwarders, clearing agents, container depots and hauliers. Listed once verified, unless they take themselves off.
 * Each entry says what the firm says of itself beside what we have seen on SeeBuyGet, and the papers staff checked —
 * named with their dates, never scored. Alphabetical, never ranked. No membership badge of anybody's.
 */
export const DIRECTORY_KINDS = ['forwarder', 'clearing_agent', 'haulier', 'depot'] as const;
export type DirectoryKind = (typeof DIRECTORY_KINDS)[number];

export class DirectoryCheck {
  /** Which paper: a company paper's kind, or `fleet_papers` — for a page to name it in its reader's language. */
  @ApiProperty() paper: string;
  /** What staff checked, in words. */
  @ApiProperty() what: string;
  @ApiProperty() at: string;
}

/** How to reach a firm — only what it chose to show. Shown as buttons, never printed as a list of numbers to copy. */
export class DirectoryContact {
  @ApiPropertyOptional() phone?: string;
  @ApiPropertyOptional() email?: string;
  @ApiPropertyOptional() website?: string;
  @ApiPropertyOptional() address?: string;
  @ApiPropertyOptional() hours?: string;
}

/** What we have seen of the firm's work on SeeBuyGet — counted, never judged. Absent counts are unmeasured, not zero. */
export class DirectorySeen {
  /** A clearing agent: the imports it was appointed on, and how many got on the road. */
  @ApiPropertyOptional() appointed?: number;
  @ApiPropertyOptional() cleared?: number;
  /** A haulier: the loads its drivers delivered on SeeBuyGet. */
  @ApiPropertyOptional() delivered?: number;
  /** A forwarder: the loads it posted that were delivered. */
  @ApiPropertyOptional() arranged?: number;
}

/** What a clearing agent says it clears, and where — its claim, not checked by us. */
export class DirectorySays {
  /** Its specialisms, by their ids (`vehicles`, `sea_container` …). */
  @ApiProperty({ type: [String] }) clears: string[];
  @ApiProperty({ type: [String] }) places: string[];
}

export class DirectoryEntry {
  /** Its public page: seebuyget.com/@handle. */
  @ApiProperty() handle: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: DIRECTORY_KINDS, isArray: true }) kinds: DirectoryKind[];
  @ApiProperty() country: string;
  /** On SeeBuyGet since. */
  @ApiProperty() since: string;
  /** Its own line about itself — its words, not checked by us. */
  @ApiPropertyOptional() words?: string;
  /** A clearing agent's own list of what it clears and where — its claim, not checked by us. */
  @ApiPropertyOptional({ type: DirectorySays }) says?: DirectorySays;
  @ApiProperty({ type: DirectorySeen }) seen: DirectorySeen;
  @ApiProperty({ type: [DirectoryCheck] }) checks: DirectoryCheck[];
  @ApiPropertyOptional({ type: DirectoryContact }) contact?: DirectoryContact;
}

export class DirectoryCountry {
  @ApiProperty() country: string;
  @ApiProperty() name: string;
  @ApiProperty() total: number;
  @ApiProperty() forwarder: number;
  @ApiProperty() clearing_agent: number;
  @ApiProperty() haulier: number;
  @ApiProperty() depot: number;
  /** Where to put its marker on the map: the middle of its firms' pins, else none. */
  @ApiPropertyOptional() at?: { lat: number; lng: number };
}

export class DirectoryIndex {
  @ApiProperty({ type: [DirectoryCountry] }) countries: DirectoryCountry[];
  @ApiProperty() basis: string;
}

export class DirectoryCountryView {
  @ApiProperty() country: string;
  @ApiProperty() name: string;
  @ApiProperty({ type: [DirectoryEntry] }) entries: DirectoryEntry[];
  @ApiProperty() basis: string;
}

/** A firm's own place in the directory, as it sees it: whether it is listed, its line, and why it may not be. */
export class DirectoryListingView {
  @ApiProperty() listed: boolean;
  /** It may be listed: verified, and doing something the directory lists. */
  @ApiProperty() eligible: boolean;
  @ApiProperty({ enum: DIRECTORY_KINDS, isArray: true }) kinds: DirectoryKind[];
  @ApiPropertyOptional() words?: string;
  @ApiPropertyOptional({ type: DirectoryContact }) contact?: DirectoryContact;
  /** Why it is not shown, in words, where it is not. */
  @ApiPropertyOptional() why?: string;
  @ApiPropertyOptional() handle?: string;
  /** The country whose page it is on: /directory/<country>/. */
  @ApiPropertyOptional() country?: string;
}

export class DirectoryListingDto {
  /** Shown, or taken off. Left out, it stays as it was — a firm saving only its line. */
  @IsOptional() @IsBoolean() listed?: boolean;
  /** Its own line: what it does and where, in its words. */
  @IsOptional() @IsString() @MaxLength(240) words?: string;
}

/** A fleet's own contact for the directory: only what it ticks to show (a company shows its own contact entry). */
export class FleetDirectoryDto extends DirectoryListingDto {
  @IsOptional() @IsString() @Matches(/^(\+?[\d\s()\-.]{6,24})?$/, { message: 'A phone number: digits, spaces and brackets — or nothing, to show none' }) phone?: string;
  @IsOptional() @IsString() @MaxLength(120) email?: string;
  @IsOptional() @IsString() @MaxLength(200) website?: string;
}
