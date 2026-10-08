import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { Actor } from '../../foundation/auth/actor.decorator';
import { actingPerson } from '../../foundation/auth/acting';
import { IntrospectionResult } from '../../foundation/auth/auth.types';
import { PersonService } from './person.service';
import { HandleService } from '../../foundation/handle/handle.service';
import { AccountProfileDto, AccountPinDto, AccountEmailDto, ChangeNumberDto } from './pudo.dto';
import { AccountMoveService } from './account-move.service';
import { AccountRecoveryService } from './account-recovery.service';

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
  ) {}

  /**
   * Who is signed in, as the menu needs them: name, photo, address, when the PIN last changed, and the
   * handle of the role they are acting as, where that role has one.
   *
   * Note what it does NOT do: invent a handle. `handleOf` looks up the acting DID and answers nothing for
   * a fleet driver, who has no public page by design — the menu simply omits the row.
   */
  @Get('me')
  me(@Actor() actor: IntrospectionResult) {
    const person = this.persons.requireByDid(actingPerson(actor));
    const handle = actor.did ? this.handles.list().find((h) => h.id === actor.did)?.handle : undefined;
    // Somebody has asked staff to move THIS account to another number. Its holder is shown it wherever they look
    // at their own account — they are the one person who knows whether it was them.
    const moveAsked = this.moves.openAgainst(person.personDid);
    return {
      ...this.persons.view(person),
      ...(moveAsked ? { moveAsked } : {}),
      /** The role this token is acting as — what the menu heads itself with. */
      actingAs: actor.role,
      actingDid: actor.did,
      ...(handle ? { handle } : {}),
    };
  }

  /** Set the person's own name, photo or address. Each field independent; an empty address clears it. */
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
  @Post('pin/change')
  changePin(@Body() dto: AccountPinDto, @Actor() actor: IntrospectionResult) {
    const { person } = this.persons.changePinForPerson(actingPerson(actor), dto.currentPin, dto.newPin);
    return { changed: true, pinChangedAt: person.pinChangedAt, signedOutEverywhere: true };
  }

  /**
   * Set or replace the recovery email — the PIN again (an open session is not proof of who holds the phone), and
   * the code sent to the NEW address. The address it replaces is told, because whoever swaps the email is one
   * step from owning the account.
   */
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
  @Post('phone/change')
  changeNumber(@Body() dto: ChangeNumberDto, @Actor() actor: IntrospectionResult) {
    const person = this.recovery.changeNumber(actingPerson(actor), dto.pin, dto.newPhone);
    return { changed: true, undoUntil: person.phoneChange?.undoUntil, signedOutEverywhere: true };
  }
}
