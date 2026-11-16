import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SMS_FAILURES, SmsFailure } from './sms.types';

/**
 * 2026-11-16 — THE WAYS A CODE REACHES A PHONE, STEERED FROM THE STAFF CONSOLE (the owner: "Can we build it in a way that
 * it becomes visual and controlable from the staff console? If so, we implement."; the plan "Sign-in codes beyond
 * Twilio SMS", D1 and D4). Each SMS provider is a ROUTE. Per country, staff set the order routes are tried in and switch
 * a route off; a code goes by the first route that is set up and on, the next when one cannot take it, and — where a
 * route tells us what became of its texts — the next when one is not delivered within a minute. The way that last got
 * a code to a person goes first for them next time.
 *
 * Nothing here is a number, a code or a credential: a route is said as set up or not, and what it did as counts.
 */
export const CODE_ROUTES = ['africastalking', 'twilio'] as const;
export type CodeRouteId = (typeof CODE_ROUTES)[number];

/**
 * WHETHER A ROUTE CAN SEND FROM THIS SERVER. `ready` — set up, and this is not a sandbox · `not_set_up` — nothing of it
 * is set · `half_set_up` — some of it is set, not enough to send · `sandbox` — set up, and a sandbox never sends.
 */
export const ROUTE_STATES = ['ready', 'not_set_up', 'half_set_up', 'sandbox'] as const;
export type RouteState = (typeof ROUTE_STATES)[number];

/** How long a text a route reports on may stay undelivered before the code goes the next way (D4). */
export const AUTO_NEXT_SECONDS = 60;

/** What became of the last text a route was handed, since this server started. */
export class CodeRouteLast {
  at: string;
  ok: boolean;
  @ApiPropertyOptional({ enum: SMS_FAILURES }) failed?: SmsFailure;
}

export class CodeRouteStatus {
  @ApiProperty({ enum: CODE_ROUTES }) id: CodeRouteId;
  @ApiProperty({ enum: ROUTE_STATES }) state: RouteState;
  /** The route tells us when a text was delivered, or not: only then can a code move on by itself after a minute. */
  reportsDelivery: boolean;
  @ApiPropertyOptional({ type: CodeRouteLast }) last?: CodeRouteLast;
}

/** One route in one country, over the last seven days: codes it was given, delivered, not delivered, and typed in. */
export class CodeRouteCount {
  @ApiProperty({ enum: CODE_ROUTES }) route: CodeRouteId;
  asked: number;
  delivered: number;
  failed: number;
  entered: number;
}

export class CountryCodeRoutes {
  /** ISO 3166-1 alpha-2. */
  country: string;
  /** Codes go to its numbers at all: the country is switched on. */
  switchedOn: boolean;
  /** The order routes are tried in. */
  @ApiProperty({ enum: CODE_ROUTES, isArray: true }) order: CodeRouteId[];
  /** Routes staff switched off here. */
  @ApiProperty({ enum: CODE_ROUTES, isArray: true }) off: CodeRouteId[];
  /** Staff changed this country from the default order. */
  changed: boolean;
  /** The route a code goes by now: the first that is set up and on. Absent: none is. */
  @ApiPropertyOptional({ enum: CODE_ROUTES }) goesBy?: CodeRouteId;
  @ApiProperty({ type: [CodeRouteCount] }) counts: CodeRouteCount[];
}

export const CODE_ROUTE_CHANGES = ['order', 'on', 'off'] as const;
export type CodeRouteChangeKind = (typeof CODE_ROUTE_CHANGES)[number];

/** A change staff made, who made it, and when. */
export class CodeRouteChange {
  at: string;
  by: string;
  country: string;
  @ApiProperty({ enum: CODE_ROUTE_CHANGES }) what: CodeRouteChangeKind;
  @ApiPropertyOptional({ enum: CODE_ROUTES }) route?: CodeRouteId;
  @ApiPropertyOptional({ enum: CODE_ROUTES, isArray: true }) order?: CodeRouteId[];
}

export class CodeRoutesView {
  @ApiProperty({ type: [CodeRouteStatus] }) routes: CodeRouteStatus[];
  @ApiProperty({ type: [CountryCodeRoutes] }) countries: CountryCodeRoutes[];
  /** Newest first. */
  @ApiProperty({ type: [CodeRouteChange] }) changes: CodeRouteChange[];
  /** The counts are from this moment on: seven days ago. */
  since: string;
  autoNextSeconds: number;
}
