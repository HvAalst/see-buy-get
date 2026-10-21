import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { GeoPoint, HubPapers } from './pudo.types';

/** A hub's papers, each the id of a photograph the hub itself took and uploaded. */
export class HubPapersDto {
  /** A copy of the ID of the person who answers for the hub. */
  @IsString() idCopyRef!: string;
  /** The hub's trading licence. */
  @IsString() licenceRef!: string;
  /** The premises: the front, and where bags are kept. */
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(4) @IsString({ each: true }) photoRefs!: string[];
}

/** A member of staff's decision on a hub's papers. */
export class HubPapersDecisionDto {
  @IsBoolean() approve!: boolean;
  /** Required when refusing: the hub is shown it, and a refusal it cannot act on leaves it where a silent one would. */
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
}

/** A hub whose papers wait for a member of staff: what it said about itself, and the papers to look at. */
export class HubPapersRow {
  mdpId: string;
  did: string;
  name: string;
  country: string;
  zones: string[];
  location: GeoPoint;
  address?: string;
  contactPhone?: string;
  createdAt: string;
  papers: HubPapers;
}
