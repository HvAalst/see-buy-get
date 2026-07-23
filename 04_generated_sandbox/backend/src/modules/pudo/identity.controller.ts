import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { Public } from '../../foundation/auth/public.decorator';
import { Roles } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { PersonService } from './person.service';
import { OtpService } from './otp.service';
import { ParcelService } from './parcel.service';
import { toView } from './person.types';
import { BuyerDisputeDto, EnrollDto, PinLoginDto, PodDto, SetPinDto, SwitchRoleDto } from './pudo.dto';

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
    return { ...toView(person), isNew, token };
  }

  /** Reopen the app: phone + 4-digit PIN, no OTP (locks after repeated wrong PINs — then OTP again). */
  @Public()
  @Post('login')
  login(@Body() dto: PinLoginDto) {
    const { person, token } = this.persons.loginWithPin(dto.phone, dto.pin);
    return { ...toView(person), token };
  }

  /** Set or change the signed-in person's PIN. */
  @Roles('consumer')
  @Post('pin')
  setPin(@Body() dto: SetPinDto, @Actor() actor: IntrospectionResult) {
    this.persons.setPin(actor.did!, dto.pin);
    return { ok: true };
  }

  /** The signed-in person + every role they hold (the role switcher reads this). */
  @Roles('consumer')
  @Get('me')
  me(@Actor() actor: IntrospectionResult) {
    return toView(this.persons.requireByDid(actor.did!));
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
   * verified phone — retroactively (O4). PII-free authenticated twins; the counterpart stays hashed.
   */
  @Roles('consumer')
  @Get('parcels')
  myParcels(@Actor() actor: IntrospectionResult) {
    const person = this.persons.requireByDid(actor.did!);
    return this.parcels.forPhoneHash(person.phoneHash);
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
}
