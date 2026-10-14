import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/*
 * TWO PEOPLE SAY ONE NATIONAL ID IS THEIRS.
 *
 * A driver and a shop each register with a national ID number, and the network keeps one of each. So somebody whose
 * number another registration already holds cannot register at all — and until now nothing could put that right.
 * The likeliest cause is a mistyped digit; the other is somebody using a number that is not theirs. The user decided
 * how it is settled (2026-10-08):
 *
 *   "the sbg staff needs to see a selfie with the holder showing it's ID back and front. Or someone can take the pic
 *    of it to get a stable quality. Like keep your ID visible under your chin and take a selfie."
 *   "staff decide from the photos, if that is still disputed they can make an appointment in person. our system will
 *    generate a ticket with instructions and what they need to bring for the appointment date."
 *
 * So:
 *
 *  - WHOEVER IS REFUSED opens a dispute, with their number confirmed by a code, and is handed a reference. They
 *    write it on paper and send three photographs: themselves holding the card with the paper beside it, the card's
 *    front, the card's back. The reference in the picture is what makes it a picture taken for THIS — a copy of
 *    somebody's card, or an old photograph of them holding it, does not have it.
 *  - THE ONE WHO HOLDS THE NUMBER is told, and has a week to do the same — or to say the number on their record was
 *    mistyped and put their own there, which ends it at once with nobody losing anything.
 *  - TWO MEMBERS OF STAFF DECIDE from the photographs: one says who it is and why, a second, different one approves.
 *    They type the number they read on each card and are told only whether it is the disputed one.
 *  - WHOEVER LOSES IT keeps their account. A registration that loses its ID is HELD, not removed: it finishes what
 *    it carries and starts nothing new until an ID of its own is on record.
 *  - STILL DISPUTED? Whoever did not get it makes an appointment, and is given a ticket: where, when, what to bring.
 *    Two members of staff decide again on what they saw in person, and that is final.
 *
 * WHAT IS NEVER KEPT: an ID number outside the vault (a keyed print finds it; the answer "matches / differs" is all
 * staff see), a whole phone number, and the photographs for longer than thirty days after the decision.
 */

/** Which register the ID is disputed in. A driver's ID does not stop the same person opening a shop. */
export const ID_REGISTERS = ['driver', 'shop'] as const;
export type IdRegister = (typeof ID_REGISTERS)[number];

/** The two people. `claimant` — refused at registration, says the ID is theirs · `holder` — registered with it. */
export const DISPUTE_SIDES = ['claimant', 'holder'] as const;
export type DisputeSide = (typeof DISPUTE_SIDES)[number];

/** The three photographs each of them sends. */
export const DISPUTE_PHOTOS = ['face', 'front', 'back'] as const;
export type DisputePhoto = (typeof DISPUTE_PHOTOS)[number];

/**
 * `opened` — the claimant has a reference; their photographs are awaited · `answering` — they are in; the holder has
 * been told and has until `answerBy` · `ready` — the holder answered, or their time is up: staff decide · `checked`
 * — one member of staff has said who it is; a second approves · `decided` — done, from the photographs; whoever did
 * not get it may still make an appointment until `contestBy` · `appointment` — one is made · `rechecked` — one
 * member of staff has said what they saw in person; a second approves · `final` — decided in person ·
 * `conceded` — the holder said their number was mistyped and put their own on record · `withdrawn` — the claimant
 * took it back · `lapsed` — the claimant never sent photographs.
 */
export const DISPUTE_STATES = ['opened', 'answering', 'ready', 'checked', 'decided', 'appointment', 'rechecked', 'final', 'conceded', 'withdrawn', 'lapsed'] as const;
export type DisputeState = (typeof DISPUTE_STATES)[number];

/** How long the claimant has to send their photographs, and the holder to answer. */
export const DISPUTE_ANSWER_DAYS = 7;
/** How long after a decision whoever did not get the ID may make an appointment. */
export const DISPUTE_CONTEST_DAYS = 14;
/** How far ahead an appointment may be made, and how often its day may be changed. */
export const APPOINTMENT_WITHIN_DAYS = 21;
export const APPOINTMENT_CHANGES = 2;
/**
 * WHEN THE REMINDER GOES: this many hours before the day of the appointment begins — 06:00 UTC the day before,
 * which is the morning across Africa and Europe. No time zone is kept for a country, so it is one moment for all.
 */
export const APPOINTMENT_REMINDER_HOURS = 18;
/** How many disputes one phone number may open in a day. Each can come to a notice to somebody. */
export const DISPUTE_OPENS_PER_DAY = 3;

/** What staff read on a card came to. The number itself is not kept. */
export const CARD_ANSWERS = ['matches', 'differs'] as const;
export type CardAnswer = (typeof CARD_ANSWERS)[number];

/** What a decision did to the registration that lost the ID. */
export const HOLDER_EFFECTS = ['held', 'corrected', 'none'] as const;
export type HolderEffect = (typeof HOLDER_EFFECTS)[number];

/** What to bring to an appointment. Worded by the app; the order is the order they are asked for. */
export const BRING = ['id_card', 'phone', 'reference', 'second_document'] as const;
export type Bring = (typeof BRING)[number];

export class OpenDisputeDto {
  @IsIn(ID_REGISTERS) register!: IdRegister;
  /** The number on their own ID card — the one registration refused. */
  @IsString() @MinLength(3) @MaxLength(40) nationalId!: string;
  /** Their phone number, already confirmed by a code (auth/phone/request + verify). */
  @IsString() @MaxLength(24) phone!: string;
}

export class DisputeReferenceDto {
  @IsString() @MinLength(6) @MaxLength(20) reference!: string;
}

export class DisputePhotoDto {
  @IsString() @MinLength(6) @MaxLength(20) reference!: string;
  @IsIn(DISPUTE_PHOTOS) which!: DisputePhoto;
  /** A downscaled image as a data URL, the way every photograph reaches this network. */
  @IsString() dataUrl!: string;
  @IsOptional() @IsString() thumbDataUrl?: string;
}

export class AppointmentDto {
  @IsString() @MinLength(6) @MaxLength(20) reference!: string;
  /** The day they will come, `YYYY-MM-DD`. */
  @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string;
  /** The hour, `HH:MM` — where the country's company counts its visitors by the hour. */
  @IsOptional() @Matches(/^\d{2}:\d{2}$/) at?: string;
}

export class OwnIdDto {
  /** The number on their own ID card. */
  @IsString() @MinLength(3) @MaxLength(40) nationalId!: string;
}

export class ReadCardDto {
  @IsIn(DISPUTE_SIDES) side!: DisputeSide;
  /** The number as read off the card — in the photograph, or in the hand. Only whether it is the disputed one is kept. */
  @IsString() @MinLength(3) @MaxLength(40) number!: string;
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}

export class RetakeDto {
  @IsIn(DISPUTE_SIDES) side!: DisputeSide;
  /** Why the photographs will not do — written for the person who has to take them again. */
  @IsString() @MaxLength(300) reason!: string;
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}

export class CheckDisputeDto {
  /** Whose ID it is. */
  @IsIn(DISPUTE_SIDES) to!: DisputeSide;
  /** What was checked, and how. Kept: the second member of staff approves on the strength of it. */
  @IsString() @MaxLength(500) what!: string;
  /** Written for the one who does not get it: they read it. */
  @IsString() @MaxLength(500) reason!: string;
  /** After an appointment: who came. */
  @IsOptional() @IsBoolean() claimantCame?: boolean;
  @IsOptional() @IsBoolean() holderCame?: boolean;
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}

export class ApproveDisputeDto {
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}

export class SendBackDisputeDto {
  /** Why the second member of staff does not approve it as it stands. */
  @IsString() @MaxLength(300) why!: string;
  @IsOptional() @IsString() @MaxLength(80) by?: string;
}

/** A day the country's company is closed, as it said itself. */
export class DisputeClosedDate {
  date: string;
  @ApiPropertyOptional() note?: string;
  /** With both, the date is not closed but SHORTER: visitors from `from` until `to` that day only. */
  @ApiPropertyOptional() from?: string;
  @ApiPropertyOptional() to?: string;
}

/** An hour of a day, and how many places are still free in it. */
export class DisputeHour {
  /** When it starts, `HH:MM`. */
  at: string;
  /** When it ends: an hour later, or at closing time for the last part of an hour. */
  @ApiPropertyOptional() until?: string;
  free: number;
}

/** A day an appointment can be made for — with its hours, where the company counts visitors by the hour. */
export class DisputeDay {
  date: string;
  @ApiPropertyOptional({ type: [DisputeHour] }) hours?: DisputeHour[];
}

/** Where to go, and who to ask for — the country's company, as it wrote its own entry. */
export class DisputePlace {
  company: string;
  @ApiPropertyOptional() contactName?: string;
  @ApiPropertyOptional() phone?: string;
  @ApiPropertyOptional() phoneAlt?: string;
  @ApiPropertyOptional() email?: string;
  @ApiPropertyOptional() address?: string;
  @ApiPropertyOptional() hours?: string;
  /** The days it receives visitors (`mon` … `sun`), set by the company itself. Absent: it has set none. */
  @ApiPropertyOptional({ type: [String] }) visitDays?: string[];
  /** From when until when on those days, `HH:MM`. */
  @ApiPropertyOptional() visitFrom?: string;
  @ApiPropertyOptional() visitTo?: string;
  /** A day of the week with hours of its own (`{ sat: { from, to } }`), where the company gave one. */
  @ApiPropertyOptional({ type: Object }) visitHoursByDay?: Partial<Record<string, { from: string; to: string }>>;
  /** How many visitors it sees in an hour, where it has said. With it, an appointment is for an hour. */
  @ApiPropertyOptional() visitorsPerHour?: number;
  /** The dates it is closed: public holidays, one-off closures. */
  @ApiPropertyOptional({ type: [DisputeClosedDate] }) closedDates?: DisputeClosedDate[];
}

/** THE TICKET for an appointment: where, when, and what to bring. One for each of the two people. */
export class DisputeTicket {
  /** Their own reference: what they say at the desk. */
  reference: string;
  /** The day, `YYYY-MM-DD`. */
  date: string;
  /** The hour — from `at` until `until`, `HH:MM` — where the company counts its visitors by the hour. */
  @ApiPropertyOptional() at?: string;
  @ApiPropertyOptional() until?: string;
  /** This person made the appointment. False: the other did, and this one may come too. */
  yours: boolean;
  @ApiProperty({ enum: BRING, isArray: true }) bring: Bring[];
  /** How many more times the day can be changed, by whoever made it. */
  changesLeft: number;
  /** They will be reminded the day before, in the app and by email — or cannot be: they have no account to reach. */
  willRemind: boolean;
  /** The reminder went, and when. */
  @ApiPropertyOptional() remindedAt?: string;
  /** The company has since changed its days, hours or closures, and this day or hour no longer fits them. */
  @ApiPropertyOptional() offDay?: boolean;
  @ApiPropertyOptional({ type: DisputePlace }) place?: DisputePlace;
}

/** What somebody who opened a dispute is handed. */
export class DisputeOpened {
  reference: string;
  /** Their photographs are due by then. */
  photosBy: string;
  @ApiPropertyOptional({ type: DisputePlace }) support?: DisputePlace;
}

/** Where a dispute stands, as ONE of the two people is told — by their own reference. Nothing here names the other. */
export class DisputeStatus {
  reference: string;
  @ApiProperty({ enum: DISPUTE_SIDES }) side: DisputeSide;
  @ApiProperty({ enum: ID_REGISTERS }) register: IdRegister;
  @ApiProperty({ enum: DISPUTE_STATES }) state: DisputeState;
  openedAt: string;
  /** Which of their three photographs are in. */
  @ApiProperty({ enum: DISPUTE_PHOTOS, isArray: true }) photos: DisputePhoto[];
  /** Their photographs have been sent to staff. */
  sent: boolean;
  /** They may send, or send again, now — and until when. */
  @ApiPropertyOptional() photosDueBy?: string;
  /** Staff asked for the photographs again, and why. */
  @ApiPropertyOptional() retakeWhy?: string;
  /** Decided: the ID is theirs. Absent until there is a decision. */
  @ApiPropertyOptional() yours?: boolean;
  /** Why, in staff's words — written for the one who did not get it. */
  @ApiPropertyOptional() reason?: string;
  /** The holder, after losing it: their registration is held until an ID of their own is on record. */
  @ApiPropertyOptional() held?: boolean;
  /** They did not get it, and may still make an appointment — until when. */
  @ApiPropertyOptional() contestBy?: string;
  @ApiPropertyOptional({ type: DisputeTicket }) ticket?: DisputeTicket;
  /**
   * THE DAYS THERE ARE TO CHOOSE FROM, while this person may make or move an appointment: the company's visiting
   * days in the next three weeks, without the dates it is closed — and, where it counts visitors by the hour, the
   * hours of each with the places still free. Absent where it has set no visiting days: then any day may be asked.
   */
  @ApiPropertyOptional({ type: [DisputeDay] }) choices?: DisputeDay[];
  @ApiPropertyOptional({ type: DisputePlace }) support?: DisputePlace;
}

/** A dispute over the ID on a signed-in person's own registration — what their Settings shows. */
export class DisputeAgainstMe {
  /** THEIR reference: what they write on the paper, and what the status is read with. */
  reference: string;
  @ApiProperty({ enum: ID_REGISTERS }) register: IdRegister;
  @ApiProperty({ enum: DISPUTE_STATES }) state: DisputeState;
  /** While they can still answer: until when. */
  @ApiPropertyOptional() answerBy?: string;
  /** Their registration is held: the ID went to the other person. */
  @ApiPropertyOptional() held?: boolean;
}

/** One of the two people, as staff are shown them. Never a whole phone number, never the ID number. */
export class DisputeParty {
  /** Their photographs have been sent, and when. */
  @ApiPropertyOptional() sentAt?: string;
  /** The photographs — media ids, only when one dispute is opened. */
  @ApiPropertyOptional() face?: string;
  @ApiPropertyOptional() front?: string;
  @ApiPropertyOptional() back?: string;
  /** What the number staff read on their card came to. */
  @ApiPropertyOptional({ enum: CARD_ANSWERS }) card?: CardAnswer;
  /** Who they are on the network: "Driver: Amos K., with Kilima Logistics", "Shop: Mama Sarah Shop". */
  @ApiPropertyOptional() who?: string;
  /** Since when they have had an account. */
  @ApiPropertyOptional() since?: string;
  /** The last digits of the claimant's phone. */
  @ApiPropertyOptional() phoneEnds?: string;
  /** What the holder sent when they registered, where they sent anything: an ID copy, a portrait. Media ids. */
  @ApiPropertyOptional({ type: [String] }) onRecord?: string[];
  /** Staff asked for the photographs again. */
  @ApiPropertyOptional() retakeWhy?: string;
  /** After an appointment: they came. */
  @ApiPropertyOptional() came?: boolean;
}

/** A dispute, as staff are shown it. */
export class DisputeRow {
  disputeId: string;
  /** The claimant's reference; the holder has their own. */
  reference: string;
  holderReference: string;
  @ApiProperty({ enum: ID_REGISTERS }) register: IdRegister;
  @ApiProperty({ enum: DISPUTE_STATES }) state: DisputeState;
  openedAt: string;
  @ApiPropertyOptional() photosBy?: string;
  @ApiPropertyOptional() answerBy?: string;
  @ApiProperty({ type: DisputeParty }) claimant: DisputeParty;
  @ApiProperty({ type: DisputeParty }) holder: DisputeParty;
  /** The proposal waiting for a second member of staff — from the photographs, or after an appointment. */
  @ApiPropertyOptional({ enum: DISPUTE_SIDES }) proposedTo?: DisputeSide;
  @ApiPropertyOptional() proposedBy?: string;
  @ApiPropertyOptional() proposedAt?: string;
  @ApiPropertyOptional() proposedWhat?: string;
  @ApiPropertyOptional() proposedReason?: string;
  /** The member of staff reading this made the proposal, so cannot be the one to approve it. */
  @ApiPropertyOptional() proposedByYou?: boolean;
  /** A second member of staff sent it back, and why. */
  @ApiPropertyOptional() sentBackWhy?: string;
  /** The decision from the photographs. */
  @ApiPropertyOptional({ enum: DISPUTE_SIDES }) decidedTo?: DisputeSide;
  @ApiPropertyOptional() decidedBy?: string;
  @ApiPropertyOptional() decidedAt?: string;
  @ApiPropertyOptional() reason?: string;
  @ApiPropertyOptional({ enum: HOLDER_EFFECTS }) holderEffect?: HolderEffect;
  @ApiPropertyOptional() contestBy?: string;
  /** An appointment: the day, and which of the two made it. */
  @ApiPropertyOptional() appointmentDate?: string;
  @ApiPropertyOptional({ enum: DISPUTE_SIDES }) appointmentBy?: DisputeSide;
  /** The hour of the appointment, where there is one. */
  @ApiPropertyOptional() appointmentAt?: string;
  /** The day-before reminder went to whoever of the two has an account, and when. */
  @ApiPropertyOptional() appointmentRemindedAt?: string;
  /** The appointment is on a day the country's company no longer receives visitors. */
  @ApiPropertyOptional() appointmentOffDay?: boolean;
  /**
   * Where the two people are sent, and when visitors are received there — the country's company's own entry, set
   * in its own admin. Absent: it has written nothing, and a ticket says to ask.
   */
  @ApiPropertyOptional({ type: DisputePlace }) place?: DisputePlace;
  /** The decision in person. */
  @ApiPropertyOptional({ enum: DISPUTE_SIDES }) finalTo?: DisputeSide;
  @ApiPropertyOptional() finalBy?: string;
  @ApiPropertyOptional() finalAt?: string;
  @ApiPropertyOptional() endedAt?: string;
}

export class DisputeList {
  @ApiProperty({ type: [DisputeRow] }) items: DisputeRow[];
  /** How many wait on a member of staff. */
  waiting: number;
}

export class OwnIdSaved {
  saved: boolean;
}
