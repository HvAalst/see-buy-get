import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * A BUSINESS'S OWN SYSTEM, TOLD OF ITS LOADS (the user, round 10: "Businesses first"; "Only what it sees in its app";
 * "The company, once a day"). What its system hears, and what it reads back about each message.
 */

/** What its system hears about a load, as the event names it. Each carries the load exactly as the Loads screen shows it. */
export const BUSINESS_HOOK_EVENTS = ['load.taken', 'load.handed_back', 'load.picked_up', 'load.at_border', 'load.border_cleared', 'load.at_hub', 'load.seal_broken', 'load.cold_chain_broken', 'load.held', 'load.let_go', 'load.delivery_failed', 'load.delivered', 'load.cancelled', 'load.claim_opened', 'load.claim_decided'] as const;
export type BusinessHookEvent = (typeof BUSINESS_HOOK_EVENTS)[number];

export class BusinessHookMessageView {
  id: string;
  @ApiProperty({ description: 'One of the load events, or "test".' }) event: string;
  at: string;
  @ApiProperty({ enum: ['pending', 'delivered', 'failed'] }) state: 'pending' | 'delivered' | 'failed';
  attempts: number;
  nextTryAt: string;
  @ApiPropertyOptional() deliveredAt?: string;
  @ApiPropertyOptional({ description: 'Our words for what went wrong last. Never the system’s own answer.' }) lastError?: string;
  @ApiPropertyOptional() resent?: number;
  /** The exact body that was signed and sent: the business's own. */
  body: string;
}

export class BusinessSystemView {
  /** Where its system is told; absent while it has given none, and nothing is sent. */
  @ApiPropertyOptional() url?: string;
  @ApiPropertyOptional() setAt?: string;
  /** Whether it has a signing secret, and when it was last turned. The secret itself is shown once, when made. */
  hasSecret: boolean;
  @ApiPropertyOptional() secretTurnedAt?: string;
  /** Only in the answer that made it: copy it now, it is not shown again. */
  @ApiPropertyOptional() secret?: string;
  @ApiProperty({ type: [String], description: 'What its system hears about each load.' }) events: string[];
  @ApiProperty({ type: [BusinessHookMessageView] }) messages: BusinessHookMessageView[];
}

/** For network staff: counts only. They read it; they send nothing in a business's name. */
export class BusinessSystemCounts {
  hasAddress: boolean;
  delivered: number;
  waiting: number;
  givenUp: number;
  /** Round 12 — its keys that work, by mode. */
  keys?: { live: number; test: number };
}
