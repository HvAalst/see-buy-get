import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ADVISER_FAILURES, AdviserFailure } from './plan-adviser.types';

/*
 * WHAT THIS SERVER IS CONNECTED TO, as staff are shown it.
 *
 * A fleet's planning panel leans on two things outside this server: a routing server for road distances and the
 * adviser. Both are set in the server's environment, and both fall back quietly — a plan is made on estimates, the
 * adviser says it is not set up — which is right for the office using them and leaves staff unable to see a routing
 * server that is set and silent. So each says three things: whether it is set up, what became of the last time it was
 * asked since this server started, and (the routing server) what it answers when asked now.
 *
 * Nothing here is a secret and nothing here can become one: an address is shown as its host only, because an address
 * can carry a key, and a credential is shown as set or not set.
 */

/** What became of the last time a plan asked the routing server. */
export class RouterAsk {
  at: string;
  ok: boolean;
  /** How many places the plan had. */
  places: number;
  /** Why the plan was made on estimates instead, in the words the plan itself carried. */
  @ApiPropertyOptional() why?: string;
}

export class RouterConnection {
  configured: boolean;
  /** The host of the address that is set. Never the address itself. */
  @ApiPropertyOptional() host?: string;
  /** Something is set, and it is not a web address: no plan can use it. */
  @ApiPropertyOptional() invalid?: boolean;
  profile: string;
  /** The most places one request carries; a day with more is planned on estimates. */
  maxPoints: number;
  @ApiPropertyOptional({ type: RouterAsk }) last?: RouterAsk;
}

/** What became of the last time an office asked the adviser. */
export class AdviserAsk {
  at: string;
  ok: boolean;
  @ApiPropertyOptional({ enum: ADVISER_FAILURES }) failed?: AdviserFailure;
}

export class AdviserConnection {
  configured: boolean;
  model: string;
  @ApiPropertyOptional({ type: AdviserAsk }) last?: AdviserAsk;
}

export class ConnectionsView {
  @ApiProperty({ type: RouterConnection }) router: RouterConnection;
  @ApiProperty({ type: AdviserConnection }) adviser: AdviserConnection;
  /** When this server started. "Last asked" is since then: it is kept in memory, and a restart forgets it. */
  since: string;
}

/**
 * The routing server, asked now about two places near a fleet's depot. `ok` is that it answered with distances; the
 * figure is there to be read, because a server holding another country's map answers too — with a distance that is
 * plainly not the one between these two places.
 */
export class RouterCheck {
  at: string;
  ok: boolean;
  @ApiPropertyOptional() why?: string;
  /** By road between the two places, as the server has it. */
  @ApiPropertyOptional() km?: number;
  /** It answered, and knows no road between them. */
  @ApiPropertyOptional() noRoad?: boolean;
  /** How far apart the two places are in a straight line. */
  @ApiPropertyOptional() apartKm?: number;
  /** Whose depot the two places are near. */
  @ApiPropertyOptional() near?: string;
  /** How long it took to answer. */
  @ApiPropertyOptional() ms?: number;
}
