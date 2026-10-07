import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BUSINESS_ACTIVITIES, VERIFICATION_STATES, type BusinessActivity, type VerificationState } from '../../foundation/entity/entity.types';

/**
 * B1 — A CUSTOMER'S BUSINESS AND THE PEOPLE IN IT.
 *
 * The user, 2026-10-04: a separate business app for shippers and expeditors, the expeditor acting as the shipper's
 * agent, and "we don't handle their payments at all". So a business here is an address book, papers, people and the
 * work they hand us. Never an account with money in it.
 *
 * WHAT EACH PERSON MAY DO is a role inside the business, kept here and checked live on every request:
 *  - `owner`   everything, including who else is in it and what the business says about itself
 *  - `booker`  the work: imports, loads, papers, places
 *  - `finance` the same reach as a booker today. Named apart because their payment network will connect here
 *              (B5) and the person who answers for money is not always the person who books.
 *  - `viewer`  reads, changes nothing
 */
export const BUSINESS_MEMBER_ROLES = ['owner', 'booker', 'finance', 'viewer'] as const;
export type BusinessMemberRole = (typeof BUSINESS_MEMBER_ROLES)[number];

/**
 * One person's place in one business, as stored.
 *
 * KEYED TO A PHONE, NOT TO AN ACCOUNT, until they accept. An owner adds somebody by the number they know them by;
 * nothing is learned about whether that number has an account (see lesson: a shared code names, never admits), and
 * nothing opens until the person signs in with their OWN phone and PIN and says yes. A number addresses; only the
 * person's own sign-in answers.
 */
export interface BusinessMember {
  memberId: string;
  entityId: string;
  phoneHash: string;
  /** The last three digits, so an owner can tell two invitations apart. Never the number. */
  phoneEnds: string;
  /** Set when they accept. */
  personDid?: string;
  /** How they appear and what every act of theirs is recorded under. Given by whoever added them. */
  name: string;
  role: BusinessMemberRole;
  invitedBy: string;
  invitedAt: string;
  joinedAt?: string;
  declinedAt?: string;
  /** Removed members are KEPT: "who booked this in March" has to stay answerable after they leave. */
  removedAt?: string;
  removedBy?: string;
}

/**
 * Which of a business's people posted a load. Kept by the business, NEVER ON THE LOAD: a load is read by every carrier
 * on the board, and which person in an office posted it is that office's own affair.
 */
export interface LoadPoster {
  freightId: string;
  entityId: string;
  personDid: string;
  at: string;
}

/** Somebody in a business who is sent a load's receipt, and as what: the one who posted it, or an owner in their place. */
export interface ReceiptPerson {
  address: string;
  name: string;
  personDid: string;
  as: 'poster' | 'owner';
  business: string;
}

export class BusinessMemberView {
  @ApiProperty() memberId: string;
  @ApiProperty() name: string;
  @ApiProperty({ enum: BUSINESS_MEMBER_ROLES }) role: BusinessMemberRole;
  /** `invited` until they sign in and accept. */
  @ApiProperty({ enum: ['invited', 'joined'] }) state: 'invited' | 'joined';
  @ApiProperty() phoneEnds: string;
  @ApiProperty() invitedBy: string;
  @ApiProperty() invitedAt: string;
  @ApiPropertyOptional() joinedAt?: string;
  /** True on the reader's own row. */
  @ApiProperty() you: boolean;
}

/** Where the check by SeeBuyGet stands, as the business reads it. Staff names stay on the staff side. */
export class BusinessCheckView {
  @ApiProperty({ enum: VERIFICATION_STATES }) state: VerificationState;
  @ApiPropertyOptional() askedAt?: string;
  @ApiPropertyOptional() verifiedAt?: string;
  @ApiPropertyOptional() refusedAt?: string;
  /** Why it was refused, in staff's words. Shown so the business can put it right. */
  @ApiPropertyOptional() reason?: string;
  /**
   * WHAT IS STILL MISSING BEFORE IT CAN BE ASKED FOR, in keys a screen turns into sentences. Derived on every read.
   * `certificate_of_incorporation` · `representative_id`.
   */
  @ApiProperty({ type: [String] }) missing: string[];
}

export class BusinessView {
  @ApiProperty() entityId: string;
  @ApiProperty() name: string;
  @ApiProperty() country: string;
  @ApiProperty({ enum: BUSINESS_ACTIVITIES, isArray: true }) activities: BusinessActivity[];
  @ApiProperty() registrationNo: string;
  @ApiPropertyOptional() taxNo?: string;
  @ApiProperty({ type: BusinessCheckView }) check: BusinessCheckView;
  /** Its public address — only once checked. */
  @ApiPropertyOptional() handle?: string;
  @ApiProperty() createdAt: string;
  /** The reader's own place in it. */
  @ApiProperty({ type: BusinessMemberView }) you: BusinessMemberView;
}

/** One line of "your businesses": the ones you are in, and the ones you are invited to. */
export class BusinessMembershipView {
  @ApiProperty() memberId: string;
  @ApiProperty() entityId: string;
  @ApiProperty() name: string;
  @ApiProperty() country: string;
  @ApiProperty({ enum: BUSINESS_MEMBER_ROLES }) role: BusinessMemberRole;
  @ApiProperty({ enum: ['invited', 'joined'] }) state: 'invited' | 'joined';
  @ApiProperty() invitedBy: string;
  @ApiProperty({ enum: VERIFICATION_STATES }) checked: VerificationState;
}

export class BusinessMembershipList {
  @ApiProperty({ type: [BusinessMembershipView] }) items: BusinessMembershipView[];
}

/** Declared above its user: the swagger plugin evaluates a class reference when the referring class is defined. */
export class BusinessToken {
  @ApiProperty() access_token: string;
  @ApiProperty() token_type: 'Bearer';
  @ApiProperty() expires_in: number;
}

/** A session for one business: the token, and the business as its member reads it. */
export class BusinessSession {
  @ApiProperty({ type: BusinessToken }) token: BusinessToken;
  @ApiProperty({ type: BusinessView }) business: BusinessView;
}

/** A business as STAFF read it: everything the check needs, names included. */
export class BusinessStaffRow {
  @ApiProperty() entityId: string;
  @ApiProperty() name: string;
  @ApiProperty() country: string;
  @ApiProperty({ enum: BUSINESS_ACTIVITIES, isArray: true }) activities: BusinessActivity[];
  @ApiProperty() registrationNo: string;
  @ApiPropertyOptional() taxNo?: string;
  @ApiProperty() createdAt: string;
  @ApiProperty() createdBy: string;
  @ApiProperty({ enum: VERIFICATION_STATES }) state: VerificationState;
  @ApiPropertyOptional() askedAt?: string;
  @ApiPropertyOptional() askedBy?: string;
  @ApiPropertyOptional() firstBy?: string;
  @ApiPropertyOptional() firstAt?: string;
  @ApiPropertyOptional() verifiedBy?: string;
  @ApiPropertyOptional() verifiedAt?: string;
  @ApiPropertyOptional() refusedBy?: string;
  @ApiPropertyOptional() refusedAt?: string;
  @ApiPropertyOptional() reason?: string;
  @ApiProperty() members: number;
  @ApiProperty({ type: [String] }) missing: string[];
  @ApiPropertyOptional() handle?: string;
}

export class BusinessStaffList {
  @ApiProperty({ type: [BusinessStaffRow] }) items: BusinessStaffRow[];
}
