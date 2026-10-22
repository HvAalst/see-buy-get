import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MailConnection } from '../../foundation/mail/mail.types';
import { SmsConnection } from '../../foundation/sms/sms.types';
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
 * And two things everybody leans on: mail and push. Neither falls back — each is handed to a sender. Push's sender
 * KEEPS what it is handed; mail's does too unless the server was started with the provider's token and its sending
 * address. So the first question for those is not "is it answering" but "does anything leave", and it is read off the
 * sender that is wired in, never off a variable that happens to be set. For mail that does leave, the second is what
 * the last one met — and, where it failed, whose that is to put right.
 *
 * And one thing nobody gets in without: the text that carries a code to a phone. Off a sandbox it is the only way a
 * code reaches anybody, so "kept, not sent" there is nobody signing up, confirming a new phone or replacing a PIN.
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

/**
 * `own` — a matching pair that is this server's alone · `built_in` — the pair written in the source, which anybody
 * who can read it can sign with · `mismatched` — the public key is not the one the private key makes.
 */
export const PUSH_KEYS = ['own', 'built_in', 'mismatched'] as const;
export type PushKeys = (typeof PUSH_KEYS)[number];

/** What became of the last push this server handed to a device. */
export class PushLast {
  at: string;
  ok: boolean;
}

/**
 * WHERE A PUSH GOES — the message that lights a phone whose app is closed. The bell inside each app is not this: a
 * notification is written to the person's inbox first, whatever becomes of the push.
 */
export class PushConnection {
  /** A push leaves this server. `false`: it is kept here instead, and no phone is woken. */
  sends: boolean;
  @ApiProperty({ enum: PUSH_KEYS }) keys: PushKeys;
  /** Devices that have turned notifications on, and how many people they belong to. */
  devices: number;
  people: number;
  /** Pushes handed to a device since this server started, and how many of those failed. */
  handed: number;
  failed: number;
  @ApiPropertyOptional({ type: PushLast }) last?: PushLast;
}

/** The review code is on until the end of this day (UTC), as set in GLOS_REVIEW_CODE_UNTIL. */
export class ReviewCodeState {
  until!: string;
}

export class ConnectionsView {
  @ApiProperty({ type: RouterConnection }) router: RouterConnection;
  @ApiProperty({ type: AdviserConnection }) adviser: AdviserConnection;
  @ApiProperty({ type: MailConnection }) mail: MailConnection;
  @ApiProperty({ type: PushConnection }) push: PushConnection;
  @ApiProperty({ type: SmsConnection }) sms: SmsConnection;
  /**
   * This is a sandbox, where mail, push and texts are MEANT to be kept and not sent. Off a sandbox the same state is
   * people who are never told.
   */
  sandbox: boolean;
  /**
   * The review code (GLOS_REVIEW_CODE_UNTIL): while it is on, a NEW account's phone code — and a new recovery email's —
   * is 000000 where no text or mail can leave. The day it ends; null when it is off.
   */
  @ApiPropertyOptional({ type: ReviewCodeState, nullable: true }) reviewCode: ReviewCodeState | null;
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
