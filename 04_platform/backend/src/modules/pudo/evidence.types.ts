import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class EvidenceLedger {
  @ApiProperty({ description: 'Fingerprints kept: one per scan, signature and document anchored.' }) anchors: number;
  @ApiProperty({ description: 'Every anchor follows the one before it, and its id matches what it holds.' }) whole: boolean;
  @ApiPropertyOptional() brokenAt?: number;
  @ApiPropertyOptional() reason?: string;
  @ApiPropertyOptional() first?: string;
  @ApiPropertyOptional() last?: string;
}

export class EvidenceStore {
  @ApiProperty({ enum: ['postgres', 'files'] }) engine: 'postgres' | 'files';
  @ApiProperty({ description: 'False where nothing is kept (a test, GLOS_PERSIST=off): no writer to claim.' }) claimed: boolean;
  @ApiPropertyOptional({ description: 'The server process that holds the store, and since when.' }) pid?: number;
  @ApiPropertyOptional() since?: string;
}

export class EvidenceView {
  @ApiPropertyOptional() ledger?: EvidenceLedger;
  store: EvidenceStore;
}
