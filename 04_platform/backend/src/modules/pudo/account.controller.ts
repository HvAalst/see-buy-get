import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { actingPerson } from '../../foundation/auth/acting';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { Roles, SignedIn } from '../../foundation/auth/scopes.decorator';
import { GlosError } from '../../foundation/http/glos-error';
import { PersonService } from './person.service';
import { HandleService } from '../../foundation/handle/handle.service';
import { AccountCloseDto, AccountProfileDto, AccountPinDto, AccountEmailDto, BlockOldNumberDto, ChangeNumberDto, ForgetOtherDevicesDto, PinDevicesDto, ShopDevicesDto, ShopForgetOthersDto } from './pudo.dto';
import { AccountService } from './account.service';
import { AccountMoveService } from './account-move.service';
import { IdDisputeService } from './id-dispute.service';
import { AccountRecoveryService } from './account-recovery.service';
import { AccountClosingService } from './account-closing.service';

/**
 * THE ACCOUNT — one surface, every app.
 *
 * A driver's avatar, their PIN, where they live and the handle their public page answers on were reachable
 * from exactly one place: the Send app's account screen, because that is the only app whose token is a
 * `consumer` one. Everywhere else the same facts existed on the server and had no door. So the driver app
 * grew a foot with a sign-out link, a help link and a read-aloud button loose at the bottom of two
 * different screens, and a courier who wanted to change their PIN had no way at all. (The user, 2026-09-24:
 * *"as a driver or anybody with a sbg app I want an avatar with arrow drop down menu … Now it's a bit
 * messy on the bottom of the My Van page."*)
 *
 * The fix is not another screen. It is noticing that every role in this network already signs in through
 * the same identity spine — a driver, a shopkeeper and a fleet's office all prove a phone and a PIN against
 * `PersonService` — so the token already knows who the person is, and has simply never said so. It says so
 * now (`personDid`), and these three routes serve whichever app is asking.
 *
 * WHAT IS AND IS NOT HERE. The account is the PERSON: the avatar, the address, the PIN. The handle is read
 * alongside it because the menu shows it, but it belongs to the ROLE — an owner-driver has a public page
 * and a fleet driver does not, and a menu that offered "@yourname" to somebody with no page would be
 * advertising a dead link.
 *
 * NO OPERATOR OVERRIDE anywhere on this controller. `actingPerson` refuses a token that is not a person,
 * and never accepts a subject id — an operator acting on behalf of a shop is administration, an operator
 * setting somebody's PIN is impersonation, and staff helping a person back into their account have the
 * rotation paths built for that, which leave a record.
 */
@Controller('sbg/account')
export class AccountController {
  constructor(
    private readonly persons: PersonService,
    private readonly handles: HandleService,
    private readonly recovery: AccountRecoveryService,
    private readonly moves: AccountMoveService,
    private readonly idDisputes: IdDisputeService,
    private readonly accounts: AccountService,
    private readonly closing: AccountClosingService,
  ) {}

  /**
   * Who is signed in, as the menu needs them: name, photo, address, when the PIN last changed, and the
   * handle of the role they are acting as, where that role has one.
   *
   * Note what it does NOT do: invent a handle. `handleOf` looks up the acting DID and answers nothing for
   * a fleet driver, who has no public page by design — the menu simply omits the row.
   */
  @SignedIn()
  @Get('me')
  me(@Actor() actor: IntrospectionResult) {
    const person = this.persons.requireByDid(actingPerson(actor));
    const handle = actor.did ? this.handles.list().find((h) => h.id === actor.did)?.handle : undefined;
    // Somebody has asked staff to move THIS account to another number. Its holder is shown it wherever they look
    // at their own account — they are the one person who knows whether it was them.
    const moveAsked = this.moves.openAgainst(person.personDid);
    // Somebody says the national ID on one of this person's registrations is theirs — or it has gone to them, and
    // the registration is held. Shown with THEIR reference: it is what they answer with.
    const idDispute = this.idDisputes.against(person.personDid);
    return {
      ...this.persons.view(person),
      ...(moveAsked ? { moveAsked } : {}),
      ...(idDispute ? { idDispute } : {}),
      /** The role this token is acting as — what the menu heads itself with. */
      actingAs: actor.role,
      actingDid: actor.did,
      ...(handle ? { handle } : {}),
    };
  }

  /**
   * MUTE MY ACCOUNT (the user, 2026-10-22: "an account can be muted by the user"). It rests: nothing new reaches it —
   * no notification or email beyond codes and its own safety, no new parcel at a shop of theirs, no load offered to
   * them as a driver, no new work for their fleet, no new order for their store — and what it already holds goes on.
   * They can still sign in and read everything. Keyed to the token, like everything here. Answers the account as
   * Settings shows it.
   */
  @SignedIn()
  @Post('mute')
  mute(@Actor() actor: IntrospectionResult) {
    return this.persons.view(this.persons.mute(actingPerson(actor)));
  }

  /** …and wake it: everything is offered to it again from now on. Nothing missed while it rested is replayed. */
  @SignedIn()
  @Post('unmute')
  unmute(@Actor() actor: IntrospectionResult) {
    return this.persons.view(this.persons.unmute(actingPerson(actor)));
  }

  /**
   * CAN MY ACCOUNT BE CLOSED, AND WHAT IS STILL OPEN (the user, 2026-10-22). Only once its owner was told — after four
   * years without a sign-in; then what keeps it from closing, thing by thing, for Settings to say before the PIN.
   */
  @SignedIn()
  @Get('closing')
  closingStanding(@Actor() actor: IntrospectionResult) {
    return this.closing.standing(actingPerson(actor));
  }

  /**
   * CLOSE MY ACCOUNT — with the PIN, once told it can be, with nothing open. Personal details go; what other people's
   * records point at stays, as "closed account". Every session ends, this one included.
   */
  @SignedIn()
  @Post('close')
  close(@Body() dto: AccountCloseDto, @Actor() actor: IntrospectionResult) {
    return this.closing.close(actingPerson(actor), dto.pin);
  }

  /** Set the person's own name, photo or address. Each field independent; an empty address clears it. */
  @SignedIn()
  @Patch('profile')
  setProfile(@Body() dto: AccountProfileDto, @Actor() actor: IntrospectionResult) {
    const person = this.persons.setProfile(actingPerson(actor), dto);
    return this.persons.view(person);
  }

  /**
   * Change the PIN, proven with the current one.
   *
   * KEYED TO THE TOKEN, never to a phone number in the body — the whole account is, and this is the field
   * where it matters most. A route that took a phone would change the PIN of whatever account that number
   * named, so one hostile body would be enough, and checking afterwards is no check at all because the
   * credential has already moved.
   *
   * The wrong-PIN counter is the door's, so a guess here costs the same as a guess at sign-in: an open
   * session is not proof of who is holding the phone.
   *
   * Every other session that PIN opened is ended — including, necessarily, the one that made this call,
   * because the token carries the person as its revocation key. So the app that calls this signs the
   * person back in rather than carrying on; the response deliberately hands back no token, since the
   * consumer one the spine mints is not the role token the caller came in with.
   */
  @SignedIn()
  @Post('pin/change')
  changePin(@Body() dto: AccountPinDto, @Actor() actor: IntrospectionResult) {
    const { person } = this.persons.changePinForPerson(actingPerson(actor), dto.currentPin, dto.newPin);
    return { changed: true, pinChangedAt: person.pinChangedAt, signedOutEverywhere: true };
  }

  /**
   * THE PHONES AND BROWSERS MY PIN WORKS ON — how many, when each was confirmed by a code and last used, and which
   * one this is. A POST although it only reads: the browser's device keys come in the body, never in an address,
   * which is written to logs. Keyed to the token, like everything here.
   */
  @SignedIn()
  @Post('pin-devices')
  pinDevices(@Body() dto: PinDevicesDto, @Actor() actor: IntrospectionResult) {
    return this.persons.devicesOf(actingPerson(actor), dto.devices);
  }

  /**
   * FORGET EVERY OTHER PHONE AND BROWSER — the PIN again. Each of them needs the code to the number before the PIN
   * works there again, and every session is ended, this one included: the app signs the person back in here.
   */
  @SignedIn()
  @Post('pin-devices/forget-others')
  forgetOtherDevices(@Body() dto: ForgetOtherDevicesDto, @Actor() actor: IntrospectionResult) {
    return { ...this.persons.forgetOtherDevices(actingPerson(actor), dto.pin, dto.devices), signedOutEverywhere: true };
  }

  /**
   * THE SHOP'S OWN PHONES AND BROWSERS — the ones its email and password work on (the user, 2026-10-18: "who is at the
   * counter"). Read and forgotten by the shop itself, signed in as the shop; staff pass every role check and are refused
   * by name. A POST for the same reason as the PIN's: the key travels in the body.
   */
  @Roles('agent', 'mdp', 'genesis')
  @Post('shop-devices')
  shopDevices(@Body() dto: ShopDevicesDto, @Actor() actor: IntrospectionResult) {
    return this.accounts.devicesOf(shopOf(actor), dto.device);
  }

  /** Every other phone forgotten, with the password: each needs the code to the shop's number again, its sign-in ended. */
  @Roles('agent', 'mdp', 'genesis')
  @Post('shop-devices/forget-others')
  forgetOtherShopDevices(@Body() dto: ShopForgetOthersDto, @Actor() actor: IntrospectionResult) {
    return { ...this.accounts.forgetOtherDevices(shopOf(actor), dto.password, dto.device), signedOutEverywhere: true };
  }

  /** This phone forgotten — a phone the shop lent, or sold. Signing in on it asks for the code again. */
  @Roles('agent', 'mdp', 'genesis')
  @Post('shop-devices/forget-this')
  forgetThisShopDevice(@Body() dto: ShopDevicesDto, @Actor() actor: IntrospectionResult) {
    if (!dto.device) throw new GlosError('FIELD_REQUIRED', 'Which phone: this one’s key', { field: 'device' });
    return this.accounts.forgetThisDevice(shopOf(actor), dto.device);
  }

  /**
   * FORGET THIS ONE, AND SIGN OUT — for a computer that is not theirs. From then on the PIN does not work on it
   * until a code to the number is typed there again.
   */
  @SignedIn()
  @Post('pin-devices/forget-this')
  forgetThisDevice(@Body() dto: PinDevicesDto, @Actor() actor: IntrospectionResult) {
    return this.persons.forgetThisDevice(actingPerson(actor), dto.devices);
  }

  /**
   * Set or replace the recovery email — the PIN again (an open session is not proof of who holds the phone), and
   * the code sent to the NEW address. The address it replaces is told, because whoever swaps the email is one
   * step from owning the account.
   */
  @SignedIn()
  @Post('email')
  setEmail(@Body() dto: AccountEmailDto, @Actor() actor: IntrospectionResult) {
    return this.persons.view(this.recovery.changeEmail(actingPerson(actor), dto.pin, dto.email, dto.code));
  }

  /**
   * MOVE THIS ACCOUNT TO ANOTHER PHONE NUMBER — by the person themselves, signed in. The PIN again, and a code
   * already confirmed on the new number (auth/phone/request + verify). No staff and no ID: the PIN already opens
   * the whole account. Keyed to the token, never to a number in the body.
   *
   * Every session ends, this one included; they sign in again with the new number and the same PIN. It can be
   * undone for 24 hours, and the old number is held for them until then.
   */
  @SignedIn()
  @Post('phone/change')
  changeNumber(@Body() dto: ChangeNumberDto, @Actor() actor: IntrospectionResult) {
    const person = this.recovery.changeNumber(actingPerson(actor), dto.pin, dto.newPhone);
    // No device goes with a number that moves — except the one this was done on: the code to the NEW number was
    // typed here, a moment ago. It is handed its key for the new number, so the person signs back in with their PIN.
    return { changed: true, undoUntil: person.phoneChange?.undoUntil, signedOutEverywhere: true, device: this.persons.trustDevice(dto.newPhone) };
  }

  /**
   * BLOCK MY OLD NUMBER — the user, 2026-10-08: "the user blocks their own old phone number in the account."
   *
   * For a week after a move, what is sent to the old number still reaches the account. When the people and the stores
   * that send to them have the new one, the holder lets the old number go here, rather than waiting for the week to
   * end. The PIN again; keyed to the token, never to a number in the body. Refused while the move can still be undone:
   * the old number is where the account would go back to. Answers with the account as it now stands.
   */
  @SignedIn()
  @Post('phone/old/block')
  blockOldNumber(@Body() dto: BlockOldNumberDto, @Actor() actor: IntrospectionResult) {
    return this.persons.view(this.recovery.blockOldNumber(actingPerson(actor), dto.pin));
  }
}

/** The shop a sign-in speaks for — the shop's own, never staff's, who pass every role check. A shop's own people never reach here: the guard lets them through counter doors only (at-the-counter.ts). */
/** Round 40 — a shop's, a hub's or a store's own phones and browsers: the account's own to see and forget, signed in as itself. */
function shopOf(actor: IntrospectionResult | undefined): string {
  if (!actor?.did || !['agent', 'mdp', 'genesis'].includes(actor.role ?? '')) throw new GlosError('FORBIDDEN', 'A shop’s, a hub’s or a store’s phones are its own to see and forget, signed in as itself. Staff change none.');
  return actor.did;
}
