import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 2026-11-15 — WHO DID WHAT ON "CONNECT YOUR SHOP SYSTEM" (the owner: "Is it a common thing to record which keys they made?
 * If so, build it"). Each entry names who — the owner, or a developer by their name — what, and when; never a key or a
 * secret, only a key's last characters and its label.
 */
export const STORE_ACTS = ['key_made', 'key_revoked', 'address_set', 'address_cleared', 'code_setting', 'test_sent', 'secret_made', 'developer_invited', 'developer_removed'] as const;
export type StoreAct = (typeof STORE_ACTS)[number];

export class StoreActivityEntry {
  at: string;
  /** The owner, or a developer's name. */
  @ApiPropertyOptional() developer?: string;
  @ApiProperty({ enum: STORE_ACTS }) act: StoreAct;
  /** A key: its kind (publishable/secret), world (test/live), last characters and label. */
  @ApiPropertyOptional() kind?: string;
  @ApiPropertyOptional() mode?: string;
  @ApiPropertyOptional() hint?: string;
  @ApiPropertyOptional() label?: string;
  /** Where order updates go now. */
  @ApiPropertyOptional() url?: string;
  /** Whether the collection code rides in the updates. */
  @ApiPropertyOptional() on?: boolean;
  /** A developer invited or taken out. */
  @ApiPropertyOptional() name?: string;
}

export class StoreActivityResponse {
  @ApiProperty({ type: [StoreActivityEntry] }) items: StoreActivityEntry[];
}
