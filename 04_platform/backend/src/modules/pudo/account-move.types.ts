import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/*
 * TWO MEMBERS OF STAFF MOVE AN ACCOUNT — for the person nothing else can help.
 *
 * The account is the phone number. Somebody who still knows their PIN moves it themselves; somebody whose number is
 * gone and whose PIN is forgotten gets back in through their recovery email. What is left is the person with NO
 * number, NO PIN and NO inbox they can read — and for them the user decided (2026-10-01): "2 seebuyget staff can
 * move an account."
 *
 * It is the most dangerous thing staff can do to a person, because it is also exactly what somebody who wants
 * another person's account would ask for. So it is built as a request with a history, never as a button:
 *
 *  - THE PERSON ASKS, signed out, and proves the NEW number is theirs with a code. They are handed a reference. The
 *    answer is the same whether or not the old number has an account: asking tells a stranger nothing.
 *  - THE ACCOUNT'S HOLDER IS TOLD at once, everywhere they read — and can stop it by being who they are: signed in,
 *    from Settings; or simply by signing in with their PIN, which is the one thing the asker said they could not do.
 *  - ONE MEMBER OF STAFF CHECKS who is asking and writes down what they checked. A SECOND, different one approves.
 *  - THE MOVE IS THE ORDINARY ONE: it can be undone for 24 hours with the old number and PIN, or the inbox.
 *  - WHOEVER HOLDS THE REFERENCE can read what became of it — which is how somebody with no working phone number,
 *    PIN or inbox is told the outcome at all.
 */

/**
 * `asked` — waiting for a member of staff to check who is asking · `checked` — one has, and a second must approve ·
 * `moved` — done · `refused` — by staff, with a reason written for the person · `stopped` — from the account itself:
 * its holder said no, or its PIN was used after this was asked · `lapsed` — nobody decided it in time.
 */
export const MOVE_STATES = ['asked', 'checked', 'moved', 'refused', 'stopped', 'lapsed'] as const;
export type MoveState = (typeof MOVE_STATES)[number];

/** How long a request waits before it lapses. Long enough for somebody to bring an ID to an office. */
export const MOVE_LAPSES_AFTER_DAYS = 14;
/** How many times a day one account may be asked about. Each asking is a notice to its holder. */
export const MOVE_ASKS_PER_DAY = 3;

/** Whether the national ID the asker typed is the one the account registered with. The number itself is never kept. */
export const MOVE_ID_ANSWERS = ['matches', 'differs', 'none_on_record'] as const;
export type MoveIdAnswer = (typeof MOVE_ID_ANSWERS)[number];

export class AskMoveDto {
  /** The number the account is on — the one they can no longer use. */
  @IsString() @MaxLength(24) oldPhone!: string;
  /** The number it should move to. Already confirmed by a code (auth/phone/request + verify). */
  @IsString() @MaxLength(24) newPhone!: string;
  /** The national ID number they registered with, where they did: a driver's, a shopkeeper's. */
  @IsOptional() @IsString() @MaxLength(40) nationalId?: string;
  /** What happened, in their own words. For the member of staff who reads it. */
  @IsOptional() @IsString() @MaxLength(280) note?: string;
}

export class MoveStatusDto {
  @IsString() @MinLength(6) @MaxLength(20) reference!: string;
}

export class CheckMoveDto {
  /** What was checked, and how: the ID seen, the questions answered. Kept on the request. */
  @IsString() @MaxLength(500) what!: string;
  /** Sandbox only: the name of the member of staff, where the shared key is in use. */
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}

export class ApproveMoveDto {
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}

export class RefuseMoveDto {
  /** Written for the person who asked: they read it with their reference. */
  @IsString() @MaxLength(500) reason!: string;
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}

/** How to reach the company that answers for a country — its own entry, as it wrote it. */
export class MoveSupport {
  company: string;
  @ApiPropertyOptional() contactName?: string;
  @ApiPropertyOptional() phone?: string;
  @ApiPropertyOptional() phoneAlt?: string;
  @ApiPropertyOptional() email?: string;
  @ApiPropertyOptional() hours?: string;
}

/** What somebody who asked is handed: the reference to read to staff, and who to speak to. */
export class MoveAsked {
  reference: string;
  lapsesAt: string;
  @ApiPropertyOptional({ type: MoveSupport }) support?: MoveSupport;
}

/** What became of a request, as whoever holds its reference is told. Nothing here says whose account it was. */
export class MoveStatus {
  @ApiProperty({ enum: MOVE_STATES }) state: MoveState;
  askedAt: string;
  /** While it waits: when it lapses if nobody decides it. */
  @ApiPropertyOptional() lapsesAt?: string;
  @ApiPropertyOptional() decidedAt?: string;
  /** Refused: why, in staff's words for the person. */
  @ApiPropertyOptional() reason?: string;
  @ApiPropertyOptional({ type: MoveSupport }) support?: MoveSupport;
}

/** What a signed-in person is shown about a request against their own account. */
export class MoveAgainstMe {
  askedAt: string;
  /** The last digits of the number it would move to. */
  toEnds: string;
}

export class MoveRoleLine {
  /** `driver` or `shop`. */
  role: string;
  name: string;
  /** A driver's fleet, where they drive for one. */
  @ApiPropertyOptional() with?: string;
}

/** What the system knows of the account a request names — what staff have to check the asker against. */
export class MoveAccount {
  since: string;
  hasPin: boolean;
  /** The recovery email, masked. The asker says they cannot read it. */
  @ApiPropertyOptional() email?: string;
  @ApiProperty({ type: [MoveRoleLine] }) roles: MoveRoleLine[];
  /** A driver or shop record on it was registered with a national ID. */
  nationalIdOnRecord: boolean;
  /** The PIN was used — or chosen again by a code to the number — AFTER this was asked. The asker said they could do neither. */
  @ApiPropertyOptional() pinUsedSince?: string;
  /** The number was changed less than a day ago, and that can still be undone. */
  @ApiPropertyOptional() numberChangedAt?: string;
}

/** A request, as staff are shown it. Never a whole phone number: the last digits tell two requests apart. */
export class MoveRow {
  moveId: string;
  reference: string;
  @ApiProperty({ enum: MOVE_STATES }) state: MoveState;
  askedAt: string;
  lapsesAt: string;
  oldEnds: string;
  newEnds: string;
  /** The old number names an account. False: there is nothing to move, and the request can only be refused. */
  namesAccount: boolean;
  @ApiPropertyOptional({ enum: MOVE_ID_ANSWERS }) nationalId?: MoveIdAnswer;
  @ApiPropertyOptional() note?: string;
  @ApiPropertyOptional() checkedBy?: string;
  @ApiPropertyOptional() checkedAt?: string;
  @ApiPropertyOptional() checkedWhat?: string;
  @ApiPropertyOptional() decidedBy?: string;
  @ApiPropertyOptional() decidedAt?: string;
  @ApiPropertyOptional() reason?: string;
  /** Stopped from the account itself: its `holder` said no, signed in — or its `pin` was used after this was asked. */
  @ApiPropertyOptional({ enum: ['holder', 'pin'] }) stoppedBy?: 'holder' | 'pin';
  /** The member of staff reading this is the one who checked it, so cannot be the one to approve it. */
  @ApiPropertyOptional() checkedByYou?: boolean;
  @ApiPropertyOptional({ type: MoveAccount }) account?: MoveAccount;
}

export class MoveList {
  @ApiProperty({ type: [MoveRow] }) items: MoveRow[];
  /** How many wait on a member of staff. */
  waiting: number;
}

export class MoveStopped {
  stopped: number;
}
