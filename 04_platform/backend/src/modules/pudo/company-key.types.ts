import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import type { ApiKeyMode } from './pudo.types';

/**
 * A COMPANY'S KEYS FOR ITS OWN SYSTEMS (the user, round 12: an API for businesses and fleets; "Same as the system" — a
 * business's owners make and take away its keys, any manager of a fleet under their name; a test key and a live key as
 * stores have). A key is the company's system acting for the company: it posts, sends in and takes at its price, and
 * nothing a person must decide.
 */

export type CompanyKind = 'business' | 'fleet';

/** A company's key as it is kept: its hash, never itself. */
export interface CompanyKey {
  keyId: string;
  owner: { kind: CompanyKind; id: string };
  mode: ApiKeyMode;
  label?: string;
  /** SHA-256 of the key: a key is 24 random bytes, not a password, so a fast hash is the right one (ApiKeyService). */
  hash: string;
  /** Its last four characters: enough to tell two keys apart in a list. */
  hint: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt?: string;
  revokedAt?: string;
  revokedBy?: string;
}

/** A key as its company reads it: never the key itself, not even to them. */
export class CompanyKeyView {
  keyId: string;
  @ApiProperty({ enum: ['test', 'live'] }) mode: ApiKeyMode;
  @ApiPropertyOptional() label?: string;
  hint: string;
  createdAt: string;
  createdBy: string;
  @ApiPropertyOptional() lastUsedAt?: string;
  @ApiPropertyOptional() revokedAt?: string;
  @ApiPropertyOptional() revokedBy?: string;
}

export class CompanyKeyList {
  @ApiProperty({ type: [CompanyKeyView] }) items: CompanyKeyView[];
}

/** A new key, and the key itself — in this answer only. */
export class CompanyKeyIssued {
  @ApiProperty({ type: CompanyKeyView }) key: CompanyKeyView;
  /** Copy it now: it is not shown again. */
  secret: string;
}

export class IssueCompanyKeyDto {
  @ApiProperty({ enum: ['test', 'live'] })
  @IsIn(['test', 'live'])
  mode!: ApiKeyMode;
  /** What the company calls the system that holds it: "ERP", "the warehouse system". */
  @IsOptional() @IsString() @MaxLength(60) label?: string;
}

/** Who is calling, worked out from the key: which company, test or live, and which of its keys. */
export interface CompanyCaller {
  kind: CompanyKind;
  /** A business's entity id, or a fleet's DID. */
  id: string;
  mode: ApiKeyMode;
  keyId: string;
  /** How the act is recorded: the key's label and its last four characters. */
  name: string;
}
