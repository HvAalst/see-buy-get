import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ParcelStatus } from './pudo.types';

export class LostParcelAct {
  @ApiProperty({ enum: ['declared', 'found'] }) act: 'declared' | 'found';
  @ApiProperty({ description: 'The member of staff, by name.' }) by: string;
  at: string;
  /** Where they looked (declared), or where it turned up (found). */
  words: string;
}

export class LostParcelView {
  parcelId: string;
  status: ParcelStatus;
  @ApiPropertyOptional() declaredAt?: string;
  @ApiPropertyOptional() reason?: string;
  @ApiPropertyOptional() lastSeenAt?: string;
  @ApiPropertyOptional() foundAt?: string;
  @ApiPropertyOptional() foundNote?: string;
  @ApiPropertyOptional() from?: string;
  @ApiPropertyOptional() to?: string;
  @ApiProperty({ type: [LostParcelAct] }) acts: LostParcelAct[];
}
