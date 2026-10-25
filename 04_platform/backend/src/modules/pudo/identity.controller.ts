import { Body, Controller, Get, Optional, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AgreementService } from '../../foundation/documents/agreement.service';
import { countryOfPhone } from '../../foundation/countries/catalogue';
import { RateLimit, RateLimitGuard } from '../../foundation/http/rate-limit.guard';
import { isSandbox } from '../../foundation/runtime/sandbox';
import { EmailCodeService } from './email-code.service';
import { AccountRecoveryService } from './account-recovery.service';
import { Public } from '../../foundation/auth/public.decorator';
import { Roles, Scopes } from '../../foundation/auth/scopes.decorator';
import { Actor } from '../../foundation/auth/actor.decorator';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { GlosError } from '../../foundation/http/glos-error';
import { hashPhone, isPlausiblePhone } from '../../foundation/identity/phone';
import { PersonService } from './person.service';
import { FleetManagerService } from './fleet-manager.service';
import { ConfirmDeviceDto } from './pudo.dto';
import { OtpService } from './otp.service';
import { ParcelService, parcelCurrency } from './parcel.service';
import { DispatchService } from './dispatch.service';
import { CargoService } from './cargo.service';
import { RoutingService } from './routing.service';
import { classifySize, measuredFactor } from './pudo.config';
import { InviteService } from './invite.service';
import { toInviteView } from './invite.types';
import { BuyerDisputeDto, CollectionResponseDto, RateMerchantDto, ConsumerSendDto, CreateInviteDto, EnrollDto, EmailCodeDto, AccountCodeDto, UndoNumberDto, RecoverAccountDto, NominateCollectorDto, PinLoginDto, PodDto, ProfileDto, SetPinDto, ChangePinDto, SwitchRoleDto } from './pudo.dto';
import { UnclaimedService } from './unclaimed.service';
import { MerchantRatingService } from './merchant-rating.service';

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
    private readonly cargo: CargoService,
    private readonly routing: RoutingService,
    private readonly unclaimed: UnclaimedService,
    private readonly merchants: MerchantRatingService,
    private readonly emailCodes: EmailCodeService,
    private readonly recovery: AccountRecoveryService,
    private readonly fleets: FleetManagerService,
    // 2026-10-25 — every sign-up agrees to the terms of use, the data notice and the cookie statement that count now.
    @Optional() private readonly agreements?: AgreementService,
  ) {}

  /**
   * Enroll (or return) the consumer for an OTP-verified phone; optionally set the PIN in the same step.
   * Requires the phone to have been verified via `sbg/auth/phone/verify` first — the OTP is the identity
   * proof; enroll consumes it (one verification → one enrolment), so a stale verification can't be reused.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(120, 15 * 60)
  @Post('enroll')
  enroll(@Body() dto: EnrollDto) {
    const verified = this.otp.isVerified(dto.phone);
    // A PIN NOBODY MAY CHOOSE IS SAID FIRST, before an email is asked for. It was said last: somebody was sent on to
    // the email step, typed an address and its code, and was only then told that 12345 will not do — on a screen
    // with no PIN field on it, and no way back to one but to start again with a minute's wait for a new code.
    if (verified && dto.pin !== undefined) this.persons.assertPin(dto.pin);
    /*
     * EVERY SIGN-UP AGREES (the user, 2026-10-25: "every sign up needs an agreement of terms of use, use of data,
     * storage of data, cookie statement"). A phone new to SeeBuyGet is somebody signing up: refused without the versions
     * that count now, before anything is made or the phone's confirmation spent. Somebody already here — a fleet's
     * driver, a PIN being replaced — is asked in their app instead, when they have not agreed to what counts now.
     */
    const signingUp = verified && !this.persons.findByPhone(dto.phone);
    // The country is the number's: what a person with a Kenyan number agrees to includes Kenya's own documents.
    const country = countryOfPhone(dto.phone, dto.agreement?.country);
    const agreed = this.agreements && (signingUp || dto.agreement) ? this.agreements.require(dto.agreement, country) : undefined;
    /*
     * A PIN IS CHOSEN WITH A RECOVERY EMAIL BEHIND IT — the user, 2026-10-01: "we need an email for account
     * recovery and safety." The PIN is what makes this an account somebody can be locked out of, or have taken
     * from them, so that is the moment the second channel has to exist: confirmed by a code, because an address
     * nobody proved they read is a way into somebody else's inbox. Checked BEFORE anything is created or the
     * phone's verification is spent, so a refusal costs the person nothing. Not asked again once one is on record.
     */
    const known = verified && dto.pin !== undefined ? this.persons.findByPhone(dto.phone) : undefined;
    const needsEmail = verified && dto.pin !== undefined && !known?.emailVerifiedAt;
    if (needsEmail) {
      if (!dto.email?.trim()) throw new GlosError('FIELD_REQUIRED', 'Give an email address: it is how you get back in if your number is ever lost, and where we warn you', { field: 'email' });
      this.persons.assertEmailFree(dto.email, known?.personDid);
      if (!this.emailCodes.isVerified(dto.email)) {
        if (!dto.emailCode?.trim()) throw new GlosError('EMAIL_NOT_VERIFIED', 'Type the code we sent to that email address', { field: 'emailCode' });
        this.emailCodes.verify(dto.email, dto.emailCode);
      }
    }
    /*
     * A PIN REPLACED ON A DEVICE IT NEVER WORKED ON NEEDS THE EMAIL CODE TOO — the user, 2026-10-11: "a pin reset on a
     * new device should ask for the email code."
     *
     * Now that a PIN cannot be tried from anywhere, the easiest way into an account was this door: a code to the
     * phone, and a new PIN. A code to a phone is read by whoever has the SIM today, or the handset for a minute. So
     * on a phone or browser the PIN already worked on, the code to the number is enough, as it was; on any other,
     * the person also types the recovery email on the account and the code we send to it. The address has to be
     * THE ACCOUNT'S: a code to an inbox proves the inbox, not whose it is. Checked before anything changes and
     * before the phone's confirmation is spent, so a refusal costs the person nothing.
     */
    const resetElsewhere = verified && dto.pin !== undefined && Boolean(known?.pinHash) && Boolean(known?.emailVerifiedAt) && !this.persons.knowsDevice(known?.personDid, dto.device);
    if (resetElsewhere) {
      if (!dto.email?.trim()) {
        throw new GlosError('FIELD_REQUIRED', 'This phone or browser is new to your account. To replace your PIN here, also type the recovery email on your account: we send it a code', { field: 'email', why: 'pin-reset' });
      }
      if (!this.emailCodes.isVerified(dto.email)) {
        if (!dto.emailCode?.trim()) throw new GlosError('EMAIL_NOT_VERIFIED', 'Type the code we sent to that email address', { field: 'emailCode', why: 'pin-reset' });
        this.emailCodes.verify(dto.email, dto.emailCode);
      }
      if (this.persons.findByEmail(dto.email)?.personDid !== known?.personDid) {
        throw new GlosError('FORBIDDEN', 'That is not the recovery email on this account. Use the address you gave when you chose your PIN — or “Trouble signing in?”', { field: 'email', why: 'pin-reset' });
      }
    }
    const { person, isNew, token, device } = this.persons.enroll(dto.phone, verified, dto.pin, dto.device);
    if (agreed) this.agreements?.recordIfNew([`person:${person.personDid}`], agreed, 'identity/enroll', country);
    if (needsEmail) {
      this.persons.setEmail(person.personDid, dto.email as string);
      this.emailCodes.consume(dto.email as string);
    }
    if (resetElsewhere) this.emailCodes.consume(dto.email as string);
    this.otp.consume(dto.phone);
    // S24: a first-time join through an invite link credits the inviter (best-effort — never blocks sign-up).
    if (isNew && dto.inviteToken) this.invites.accept(dto.inviteToken, person.personDid);
    // `device`: the key this device keeps. The code was typed here, so the PIN works here from now on.
    return { ...this.persons.view(person), isNew, token, device };
  }

  /**
   * A code to an email address, to CONFIRM it as a recovery address. Echoed in the answer only in a sandbox — anywhere
   * else, handing it to whoever asked would let anyone confirm anyone's inbox.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('email/request')
  emailRequest(@Body() dto: EmailCodeDto) {
    const { code, review } = this.recovery.sendConfirmCode(dto.email);
    // The review code is shown: everybody knows it, and nothing was mailed (foundation/runtime/review-code.ts).
    if (review) return { sent: false, review, code };
    return isSandbox() ? { sent: true, code } : { sent: true };
  }

  /**
   * A code to the address ON an account — to get back in, or to undo a number change. Answers the same whether or
   * not any account uses that address: this door tells a stranger nothing about who is registered.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 15 * 60)
  @Post('account-code')
  accountCode(@Body() dto: AccountCodeDto) {
    const { code } = this.recovery.sendAccountCode(dto.email, dto.why);
    return isSandbox() && code ? { sent: true, code } : { sent: true };
  }

  /**
   * UNDO A NUMBER CHANGE — within 24 hours, with the OLD number and the PIN as it was, or with a code to the
   * account's email. The account goes back to the old number, every phone is signed out and the PIN is locked:
   * whoever moved it knew the PIN.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 15 * 60)
  @Post('phone/undo')
  undoNumber(@Body() dto: UndoNumberDto) {
    if (dto.email?.trim()) this.recovery.undoWithEmail(dto.email, dto.code ?? '');
    else if (dto.phone?.trim() && dto.pin?.trim()) this.recovery.undoWithOldNumber(dto.phone, dto.pin);
    else throw new GlosError('FIELD_REQUIRED', 'Give the old number and its PIN, or the account’s email and the code we sent it');
    return { undone: true };
  }

  /**
   * GET BACK IN WHEN THE NUMBER IS GONE AND THE PIN FORGOTTEN: the inbox, the national ID where the account has one,
   * a new number confirmed by code, a new PIN. It can be undone for 24 hours like any number change.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(10, 15 * 60)
  @Post('recover')
  recover(@Body() dto: RecoverAccountDto) {
    const person = this.recovery.recoverByEmail(dto);
    // The code to the new number was typed on this device: it is the one device the new PIN works on.
    return { recovered: true, undoUntil: person.phoneChange?.undoUntil, device: this.persons.trustDevice(dto.newPhone) };
  }

  /**
   * THIS DEVICE, CONFIRMED BY THE CODE — for somebody who has an account and a PIN and is on a device their PIN has
   * never been used on. `auth/phone/request` sent the code and `auth/phone/verify` checked it; this hands the device
   * its key and spends the confirmation. Nothing about the account changes: the PIN is the one they had.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('device')
  confirmDevice(@Body() dto: ConfirmDeviceDto) {
    if (!this.otp.isVerified(dto.phone)) throw new GlosError('PHONE_NOT_VERIFIED', 'Verify your phone number first');
    const device = this.persons.trustDevice(dto.phone);
    this.otp.consume(dto.phone);
    return { device };
  }

  /**
   * Reopen the app: phone + PIN, no code — ON A DEVICE THE CODE WAS ONCE TYPED ON (`device`). Anywhere else the
   * answer is DEVICE_NOT_KNOWN and the PIN is not looked at. Locks after repeated wrong PINs — then the code again.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(60, 15 * 60) // each PIN locks after five; this stops one caller spreading guesses across many phones
  @Post('login')
  login(@Body() dto: PinLoginDto) {
    const { person, token } = this.persons.loginWithPin(dto.phone, dto.pin, dto.device);
    return { ...this.persons.view(person), token };
  }

  /** Set or change the signed-in person's PIN. */
  @Roles('consumer')
  @Post('pin')
  setPin(@Body() dto: SetPinDto, @Actor() actor: IntrospectionResult) {
    // The same rule as the door: no PIN without a confirmed recovery email behind it.
    if (!this.persons.requireByDid(actor.did!).emailVerifiedAt) throw new GlosError('FIELD_REQUIRED', 'Add your email address first: it is how you get back in if your number is ever lost', { field: 'email' });
    this.persons.setPin(actor.did!, dto.pin);
    return { ok: true };
  }

  /**
   * Change your PIN — proven with the CURRENT PIN, not with a session (a phone left unlocked is not proof of who
   * holds it). A wrong current PIN counts toward the lockout. Other sessions end; this one gets a fresh sign-in.
   */
  @Public()
  @UseGuards(RateLimitGuard)
  @RateLimit(20, 15 * 60)
  @Post('pin/change')
  changePin(@Body() dto: ChangePinDto) {
    const { person, token } = this.persons.changePin(dto.phone, dto.pin, dto.newPin, dto.device);
    return { ...this.persons.view(person), token };
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
    /*
     * A FLEET OPENS ONLY ONCE IT IS ACTIVE, BY EVERY DOOR. The Fleet app's own sign-in refuses a fleet that is not
     * (`requireSignInByDid`); this switch did not, so a fleet staff had only registered — and, once fleets could sign
     * themselves up (2026-10-23), any fleet at all, a minute after signing up — was handed a manager's token before
     * anybody had looked at its papers.
     */
    if (dto.role === 'fleet_manager') {
      const link = person.roles.find((r) => r.role === 'fleet_manager' && r.status === 'active');
      if (link && !this.fleets.isActive(link.entityDid)) {
        throw new GlosError('AUTH_NOT_ACTIVE', 'Your fleet is not active yet: SeeBuyGet checks its papers and records its bond first');
      }
    }
    return this.persons.mintForRole(person, dto.role);
  }

  /**
   * The receiver/sender home: every parcel this person is a party to (sent + received). Theirs is what belongs to
   * their ACCOUNT, and — retroactively (O4) — what is addressed to the number they sign in with and belongs to no
   * account yet; never what belonged to whoever had that number before. PII-free authenticated twins; the counterpart
   * stays hashed. S32d
   * also returns `freights` — any order of theirs that was too big for the parcel network and diverted to
   * dedicated freight, so a diverted order never vanishes from the buyer's home.
   */
  @Roles('consumer')
  @Get('parcels')
  myParcels(@Actor() actor: IntrospectionResult) {
    const person = this.persons.requireByDid(actor.did!);
    return { ...this.parcels.partyTo(person), freights: this.dispatch.freightsFor(person) };
  }

  /**
   * PG1 — parcel genesis from the sender's own phone: the IDENTICAL mint the vendor console gets (derived
   * size + cargo gate, locked price, shipment DID + twin + planned journey + printable label at creation).
   * Cash at the counter: the price locks NOW and the shop collects it at drop-off — so the label (the
   * sender's drop-off credential) issues immediately. The sender's identity comes from the TOKEN, never
   * the body. A P4+ load is REFUSED here (not diverted like a vendor's): the freight lane bills a shipper
   * at claim through the vendor prepaid rail, and a person has no billing rail yet — a silent divert would
   * be un-priced, un-consented free freight (the driver still gets paid). Refusing keeps the money
   * invariant; the Send UI explains and points at a PUDO shop.
   */
  @Scopes('shipment:create')
  @Roles('consumer')
  @Post('parcels')
  createParcel(@Body() dto: ConsumerSendDto, @Actor() actor: IntrospectionResult) {
    const person = this.persons.requireByDid(actor.did!);
    if (!isPlausiblePhone(dto.receiverMobile)) throw new GlosError('PHONE_INVALID', 'Enter a valid receiver phone number — it is how they get their parcel');
    if (dto.originPudoDid === dto.destPudoDid) throw new GlosError('INVALID_INPUT', 'Pick two different shops');
    const dims: [number, number, number] = [dto.dimensionsCm.l, dto.dimensionsCm.w, dto.dimensionsCm.h];
    const cargoClass = this.cargo.classify({ kg: dto.weightKg, dimsCm: dims });
    if (this.cargo.dedicatedRequired(cargoClass)) {
      throw new GlosError('CARGO_REQUIRES_DEDICATED', `Cargo class ${cargoClass} is too large for the parcel network — ask at a PUDO shop about dedicated freight (personal freight booking is coming)`);
    }
    const size = classifySize({ ...dto.dimensionsCm, kg: dto.weightKg });
    // ITEM 9 — a person sending from the app types real centimetres, so the transport is priced on what
    // the box measures rather than on the tier it lands in.
    // Priced from the vehicles that can carry this parcel — near the sender where they asked — as the quote was.
    const quote = this.routing.quoteShipment(dto.originPudoDid, dto.destPudoDid, size, measuredFactor({ ...dto.dimensionsCm, kg: dto.weightKg }), { kg: dto.weightKg, fragile: dto.fragile, ...(dto.near ? { near: dto.near } : {}) });
    // Fail closed on price drift: a consumer send is billed the LOCKED leg (createConsumerSend), so the
    // sender's consented total must match the fresh locked quote. If the market moved between the quote
    // and this mint, refuse with the new total so the app can re-confirm — never silently bill a
    // different amount than the one shown at "Make my label".
    // Against the GROSS, because that is the money the sender hands over at the counter. Consent is to a
    // figure a person can be asked for, and tax is part of what they are asked for — gating on the net
    // would agree a price and collect a different one, which is the exact failure this gate exists to stop.
    if (dto.expectedTotal != null && Math.abs(dto.expectedTotal - quote.locked.gross) > 0.001) {
      throw new GlosError('PRICE_CHANGED', `The price is now ${quote.locked.gross.toFixed(2)} — please review it before sending`, { newTotal: quote.locked.gross });
    }
    const { parcel, label } = this.parcels.createConsumerSend({
      senderPersonDid: person.personDid,
      senderPhoneHash: person.phoneHash,
      receiverMobile: dto.receiverMobile,
      originAgentDid: dto.originPudoDid,
      destAgentDid: dto.destPudoDid,
      dimensionsCm: dto.dimensionsCm,
      weightKg: dto.weightKg,
      fragile: dto.fragile,
      natureCode: dto.natureCode,
      quote,
    });
    // Field-picked response (S25): the sender's authenticated twin view + their drop-off credential + the
    // locked price + the planned journey — never the raw Parcel (it carries the counterparty's number).
    let journey: { hops: string[]; mdpRouted: boolean; pickupReadyAt: string } | undefined;
    try {
      const j = this.routing.planJourney({ originAgentDid: parcel.originAgentDid, destAgentDid: parcel.destAgentDid!, weightKg: parcel.weightKg });
      journey = { hops: j.hops.map((h) => h.label), mdpRouted: j.mdpRouted, pickupReadyAt: j.pickupReadyAt };
    } catch {
      journey = undefined; // best-effort, like the public track surface — the mint itself already succeeded
    }
    return {
      parcel: this.parcels.consumerParcel(parcel.parcelId, person),
      label,
      // `total` is the GROSS — the cash this sender hands over at the counter. `tax` names the part of it
      // that is not ours, because a person is entitled to see the tax they paid and, in most places, a
      // receipt is required to say so. The platform's own three layers stay out of it: a buyer sees a price — in its
      // money, said beside it (a sum is never said bare).
      price: { routeMode: parcel.routeMode, currency: parcelCurrency(parcel), total: parcel.shipmentCost, transport: parcel.transportCost, nodeFees: parcel.nodeFees, platformFee: parcel.platformFee, km: parcel.routeKm, ceiling: parcel.ceilingCost, tax: parcel.shipmentTax, taxLabel: parcel.taxLabel },
      journey,
    };
  }

  /** One parcel the caller is a party to — the authenticated twin + status timeline (404 to a non-party). */
  @Roles('consumer')
  @Get('parcels/:id')
  parcel(@Param('id') id: string, @Actor() actor: IntrospectionResult) {
    const person = this.persons.requireByDid(actor.did!);
    return this.parcels.consumerParcel(id, person);
  }

  /** The receiver attaches their own delivered-state photo (proof of what they received) — S23. */
  @Roles('consumer')
  @Post('parcels/:id/pod')
  addPod(@Param('id') id: string, @Body() dto: PodDto, @Actor() actor: IntrospectionResult) {
    const person = this.persons.requireByDid(actor.did!);
    return this.parcels.attachPod(id, person, person.personDid, dto.photoRef);
  }

  /**
   * The receiver answers the final notice — the four things a person can do about a closed window.
   *
   * On their OWN parcel only, and 404 otherwise: this is the one screen in the network where somebody
   * can give up a claim to goods, so it must not be possible to do it to somebody else's.
   *
   * Returns their twin rather than a bare acknowledgement, because three of the four choices change what
   * the app should be showing them and a screen that has to guess will guess wrong.
   */
  @Roles('consumer')
  @Post('parcels/:id/collection-response')
  collectionResponse(@Param('id') id: string, @Body() dto: CollectionResponseDto, @Actor() actor: IntrospectionResult) {
    const person = this.persons.requireByDid(actor.did!);
    this.parcels.requireReceiver(id, person);
    if (dto.choice === 'relinquish') this.refuseWhileUndoable(person.personDid, 'give a parcel up');
    const { outcome } = this.unclaimed.respond(id, dto.choice, dto.note);
    return { outcome, parcel: this.parcels.consumerParcel(id, person) };
  }

  /**
   * The receiver names somebody to collect for them.
   *
   * The code comes BACK to the receiver, which is the point: they are the one who has to pass it on, and
   * a code the network delivered straight to the neighbour would be the network deciding who a person
   * trusts. Their own code keeps working alongside it, and the shop still learns neither.
   */
  @Roles('consumer')
  @Post('parcels/:id/nominate-collector')
  nominateCollector(@Param('id') id: string, @Body() dto: NominateCollectorDto, @Actor() actor: IntrospectionResult) {
    const person = this.persons.requireByDid(actor.did!);
    this.parcels.requireReceiver(id, person);
    this.refuseWhileUndoable(person.personDid, 'name somebody to collect for you');
    return this.unclaimed.nominate(id, dto.name, dto.phone ? hashPhone(dto.phone) : undefined);
  }

  /**
   * The receiver rates the STORE they bought from — stars and tags, on a parcel we actually carried.
   *
   * That last part is the whole point: a public review site cannot tell a real customer from a paid one,
   * and we can, because we moved the parcel. Verified beats volume. One verdict per shipment, so nobody
   * can stack a merchant either way, and only after delivery — an opinion about a parcel that has not
   * arrived is an opinion about waiting, which the measured half already reports better.
   */
  @Roles('consumer')
  @Post('parcels/:id/rate-store')
  rateStore(@Param('id') id: string, @Body() dto: RateMerchantDto, @Actor() actor: IntrospectionResult) {
    const person = this.persons.requireByDid(actor.did!);
    return this.merchants.rate({ parcelId: id, phoneHash: person.phoneHash, personDid: person.personDid, stars: dto.stars, tags: dto.tags });
  }

  /**
   * WHAT CANNOT BE TAKEN BACK WAITS FOR THE DAY IN WHICH A NUMBER CHANGE CAN BE UNDONE. Giving a parcel up, and naming
   * somebody else to collect it, are the two things on this surface that an undo could not put right — and for that
   * day the account may be in the hands of whoever moved it. Refused outright, with the hour it ends, rather than
   * held: the same way a second number change is refused in that day.
   */
  private refuseWhileUndoable(personDid: string, what: string): void {
    const until = this.persons.undoOpenUntil(personDid);
    if (until) throw new GlosError('INVALID_STATE', `Your account’s phone number was changed less than a day ago, and that can still be undone. You can ${what} once it no longer can.`, { until });
  }

  /** The receiver files a delivery dispute (reason + photo) → routed to the vendor / sender + control tower. */
  @Roles('consumer')
  @Post('parcels/:id/dispute')
  disputeParcel(@Param('id') id: string, @Body() dto: BuyerDisputeDto, @Actor() actor: IntrospectionResult) {
    const person = this.persons.requireByDid(actor.did!);
    return this.parcels.buyerDispute(id, person, person.personDid, dto.reason, dto.photoRef);
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
