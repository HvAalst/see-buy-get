import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { Public } from '../../foundation/auth/public.decorator';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { PersonService } from './person.service';
import { OtpService } from './otp.service';
import { ParcelService } from './parcel.service';
import { DispatchService } from './dispatch.service';
import { InviteService } from './invite.service';
import { toInviteView } from './invite.types';
import { BuyerDisputeDto, CreateInviteDto, EnrollDto, PinLoginDto, PodDto, ProfileDto, SetPinDto, SwitchRoleDto } from './pudo.dto';

/**
 * Identity — the authenticated consumer surface (S20). "One person, one account, many roles."
 *
 * The phone-first flow: request an OTP (the existing `sbg/auth/phone/*`), then `enroll` to create or
 * return the person and mint a consumer token; set a 4-digit PIN once and `login` with it thereafter
 * (a new device re-verifies by OTP). `me` shows every role the person holds — sender/receiver, and any
 * driver/agent/hub/vendor account already linked by the same phone — and `switch` mints an actor token
 * for a held role, so a driver can send a parcel without ever creating a second account.
 *
 * enroll / login are @Public (pre-auth, like signup/login); me / switch require the consumer token.
 */
@Controller('sbg/identity')
export class IdentityController {
  constructor(
    private readonly persons: PersonService,
    private readonly otp: OtpService,
    private readonly parcels: ParcelService,
    private readonly invites: InviteService,
    private readonly dispatch: DispatchService,
  ) {}

  /**
   * Enroll (or return) the consumer for an OTP-verified phone; optionally set the PIN in the same step.
   * Requires the phone to have been verified via `sbg/auth/phone/verify` first — the OTP is the identity
   * proof; enroll consumes it (one verification → one enrolment), so a stale verification can't be reused.
   */
  @Public()
  @Post('enroll')
  enroll(@Body() dto: EnrollDto) {
    const verified = this.otp.isVerified(dto.phone);
    const { person, isNew, token } = this.persons.enroll(dto.phone, verified, dto.pin);
    this.otp.consume(dto.phone);
    // S24: a first-time join through an invite link credits the inviter (best-effort — never blocks sign-up).
    if (isNew && dto.inviteToken) this.invites.accept(dto.inviteToken, person.personDid);
    return { ...this.persons.view(person), isNew, token };
  }

  /** Reopen the app: phone + 4-digit PIN, no OTP (locks after repeated wrong PINs — then OTP again). */
  @Public()
  @Post('login')
  login(@Body() dto: PinLoginDto) {
    const { person, token } = this.persons.loginWithPin(dto.phone, dto.pin);
    return { ...this.persons.view(person), token };
  }

  /** Set or change the signed-in person's PIN. */
  @Roles('consumer')
  @Post('pin')
  setPin(@Body() dto: SetPinDto, @Actor() actor: IntrospectionResult) {
    this.persons.setPin(actor.did!, dto.pin);
    return { ok: true };
  }

  /** The signed-in person + every role they hold (the role switcher reads this) + their self profile. */
  @Roles('consumer')
  @Get('me')
  me(@Actor() actor: IntrospectionResult) {
    return this.persons.view(this.persons.requireByDid(actor.did!));
  }

  /** Set the signed-in person's own display name and/or avatar (S29). Returns the updated self-view. */
  @Roles('consumer')
  @Patch('profile')
  setProfile(@Body() dto: ProfileDto, @Actor() actor: IntrospectionResult) {
    const person = this.persons.setProfile(actor.did!, dto);
    return this.persons.view(person);
  }

  /** "Act as" a held role → an actor token carrying that role's scopes + tenant. */
  @Roles('consumer')
  @Post('switch')
  switch(@Body() dto: SwitchRoleDto, @Actor() actor: IntrospectionResult) {
    const person = this.persons.requireByDid(actor.did!);
    return this.persons.mintForRole(person, dto.role);
  }

  /**
   * The receiver/sender home: every parcel this person is a party to (sent + received), matched by their
   * verified phone — retroactively (O4). PII-free authenticated twins; the counterpart stays hashed. S32d
   * also returns `freights` — any order of theirs that was too big for the parcel network and diverted to
   * dedicated freight, so a diverted order never vanishes from the buyer's home.
   */
  @Roles('consumer')
  @Get('parcels')
  myParcels(@Actor() actor: IntrospectionResult) {
    const person = this.persons.requireByDid(actor.did!);
    return { ...this.parcels.forPhoneHash(person.phoneHash), freights: this.dispatch.freightsForPhoneHash(person.phoneHash) };
  }

  /** One parcel the caller is a party to — the authenticated twin + status timeline (404 to a non-party). */
  @Roles('consumer')
  @Get('parcels/:id')
  parcel(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    const person = this.persons.requireByDid(actor.did!);
    return this.parcels.consumerParcel(id, person.phoneHash);
  }

  /** The receiver attaches their own delivered-state photo (proof of what they received) — S23. */
  @Roles('consumer')
  @Post('parcels/:id/pod')
  addPod(@Param('id') id: string, @Body() dto: PodDto, @Actor() actor: IntrospectionResult) {
    const person = this.persons.requireByDid(actor.did!);
    return this.parcels.attachPod(id, person.phoneHash, person.personDid, dto.photoRef);
  }

  /** The receiver files a delivery dispute (reason + photo) → routed to the vendor / sender + control tower. */
  @Roles('consumer')
  @Post('parcels/:id/dispute')
  disputeParcel(@Param('id') id: string, @Body() dto: BuyerDisputeDto, @Actor() actor: IntrospectionResult) {
    const person = this.persons.requireByDid(actor.did!);
    return this.parcels.buyerDispute(id, person.phoneHash, person.personDid, dto.reason, dto.photoRef);
  }

  /** Create (or return) an invite for a contact → a token the app turns into a shareable /send/ link (S24). */
  @Roles('consumer')
  @Post('invites')
  createInvite(@Body() dto: CreateInviteDto, @Actor() actor: IntrospectionResult) {
    const person = this.persons.requireByDid(actor.did!);
    return toInviteView(this.invites.create(person.personDid, dto.channels));
  }

  /** The inviter's sent invites + how many turned into joins (the growth credit) — PII-free. */
  @Roles('consumer')
  @Get('invites')
  myInvites(@Actor() actor: IntrospectionResult) {
    const person = this.persons.requireByDid(actor.did!);
    return this.invites.forInviter(person.personDid);
  }

  /** The invite landing check — validates the token without exposing the inviter or the invitee. */
  @Public()
  @Get('invite/:token')
  invitePreview(@Param('token') token: string) {
    return this.invites.preview(token);
  }
}
