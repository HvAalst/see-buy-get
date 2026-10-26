import type { ComponentChildren } from 'preact';
import { presentationFor, type SbgError } from '../../lib/sbg';
import { Button } from './Button';
import { Icon, type IconName } from './Icon';

/**
 * The read-aloud key → plain-language sentence table.
 *
 * `presentationFor(code)` gives an icon, a tone and a `say` key. The key is what an audio
 * clip is filed under; until the clips ship, this table is the text the clip will say. Going
 * through the key (and not through `error.detail`) is the point: the server's detail is
 * developer English — "Offer has lapsed (auto-ignored)", "Driver is not currently coupled to
 * a vehicle" — and dumping it on a driver is the failure mode this contract exists to stop.
 */
const SAY: Record<string, string> = {
  'error.generic': 'Something went wrong. Try again.',
  'error.offline': 'No signal right now. This needs a connection — try again when you have one.',
  'error.offline_needed': 'You are offline. This needs a connection — try again when you have signal.',
  'error.slow_network': 'The network is very slow. Try again in a moment.',
  'error.update_app': 'This app needs updating before you can carry on.',
  'error.too_late': 'Too late — that one has gone.',
  'error.not_now': 'That cannot be done right now.',
  // Two causes share this code — too long on the shift, or not yet rested before the next one — and the
  // server's detail says which. The sentence must be true of both, so it names the rule and not the remedy:
  // telling a driver who is standing at the depot to "deliver what is aboard" is advice about a van they left.
  'error.hours_exceeded': 'Your driving hours do not allow this right now.',
  'error.too_heavy': 'Too heavy for the space you have left.',
  'error.no_room': 'That run does not have room for this.',
  'error.carrier_not_trading': 'This carrier is not taking new work right now.',
  'error.reason_required': 'Say why first — the other side is shown your reason.',
  'error.already_registered': 'These details are already registered — sign in with that account rather than making another.',
  // F5 — the goods and the truck, or the goods and each other. The server's DETAIL names the vehicle or
  // the load already aboard, which is the only actionable part, so callers pass showDetail.
  'error.vehicle_capability': 'That truck cannot carry these goods.',
  'error.cargo_incompatible': 'These goods must not travel with something already on that truck.',
  'error.checklist': 'There are checks left to tick before this.',
  'error.receiver': 'Record who received the goods first.',
  'error.pod_photo': 'Attach a photo of the goods as delivered.',
  'error.no_fragile': 'This vehicle cannot carry fragile loads.',
  'error.not_found': 'We could not find that. Check the code.',
  'error.wrong_code': 'That code is not right. Try again.',
  'error.wrong_destination': 'That parcel is going somewhere else. It belongs in another bag.',
  'error.code_locked': 'That code is locked. Ask for a new one.',
  // A SIGN-IN THAT WAS REFUSED. One code answers every door — a phone and PIN, an email and password, a store's
  // ID and secret, an authenticator code — so the sentence names none of them: it used to say "That PIN is not
  // right" to somebody who had typed a password. The server's detail says which, where a screen shows it.
  'error.wrong_sign_in': 'That is not right. Check what you typed and try again.',
  // Consumer phone + PIN sign-in (S20/S21).
  'error.pin_digits': 'Your PIN must be 5 digits.',
  'error.device_new': 'Your PIN does not work on this phone or browser yet. We send a code to your number to confirm it; after that your PIN works here.',
  'error.pin_locked': 'Too many wrong PINs. Tap "Forgot your PIN?" to sign in with a code.',
  'error.pin_wrong': 'That is not your PIN. Five wrong tries lock it.',
  'error.password_wrong': 'That is not the password. Try again.',
  'error.driver_pass': 'Scan the badge on the driver’s phone: their badge number on its own hands over nothing.',
  'error.vehicle_check': 'Check the vehicle first: your fleet asks for a daily check before a shift.',
  // Five wrong passwords at one account. The server's own sentence says how long is left, and is what is shown
  // (`SERVER_SAYS`); this is the line for when it sent none.
  'error.password_locked': 'Too many wrong passwords. This sign-in is locked for now: wait, or reset the password.',
  'error.password_short': 'That password is too short. Use at least 8 characters.',
  'error.password_guessable': 'That password is too easy to guess. Avoid a common word with a number on the end, your own name or email address, only digits, and runs like 12345678.',
  'error.secret_wrong': 'That is not the current secret. Try again.',
  'error.pin_guessable': 'That PIN is too easy to guess. Avoid mostly one digit, a run like 12345 or 13579, and a pattern like 12312.',
  'error.role_not_held': 'You cannot open that here.',
  'error.phone_invalid': 'That phone number is not right. Check it.',
  // The server's own words for these two, so that a screen which also shows the detail does not say it twice.
  'error.phone_not_served': 'We cannot send a code to a number in that country yet.',
  'error.sms_not_sent': 'We could not send the code just now. Try again in a little while.',
  'error.country_not_open': 'SeeBuyGet is not open in this country yet. This starts the day it opens.',
  'error.agreement': 'Read and agree to the terms first.',
  'error.verify_phone': 'Verify your phone first — we will send you a code.',
  'error.verify_email': 'Confirm your email first — type the code we sent to it.',
  'error.bag_full': 'That bag is full.',
  'error.already_in_bag': 'That parcel is already in a bag. Check the other bag if it is not in this one.',
  'error.staging_full': 'There is no room for another bag. Give one to a driver, or make room for more in your shelf setup.',
  'error.shelf_full': 'There is not enough room on the shelf.',
  'error.manifest_incomplete': 'Some parcels for this bus are still waiting. Load them, or leave them behind.',
  'error.parcel_lost': 'This parcel was declared lost. Keep it safe and tell SeeBuyGet you have it.',
  // S26 media upload + retention.
  'error.photo_too_large': 'That photo is too big. Try taking it again.',
  'error.photo_type': 'That file is not a photo. Use the camera.',
  'error.photo_expired': 'That photo was kept for its time and has been removed.',
  'error.photo_locked': 'This photo is kept as proof and cannot be removed yet.',
  'error.sign_in': 'Please sign in again.',
  'error.not_allowed': 'You are not allowed to do that.',
  'error.slow_down': 'Too many taps. Wait a moment and try again.',
  'error.check_fields': 'Something is missing. Check what you typed.',
  'error.locked': 'This account is locked. Ask the office.',
  'error.top_up': 'There is not enough money in the wallet.',
  'error.unpaid': 'This shipment has not been paid for.',
  'error.wrong_place': 'This is the wrong place for that parcel.',
  'error.photo_needed': 'A photo is needed first.',
};

/** Codes that deserve their own sentence, more specific than the shared say-key. */
const OVERRIDE: Record<string, string> = {
  NOT_COUPLED: 'You are not on shift. Scan a vehicle first.',
  ALREADY_COUPLED: 'You are already on a shift, or that van is taken.',
  CARRIER_NOT_TRADING: 'This carrier is not taking new work right now.', // the detail names the reason
  REASON_REQUIRED: 'Say why first — the other side is shown your reason.',
  CANNOT_COUPLE: 'That shift cannot start.', // FP4 — the detail names the paper, or the status
  BAG_RESERVED: 'That bag is being held for another driver.',
  CONFLICT: 'Someone got there first.',
  INTERNAL: 'The system had a problem. Try again shortly.',
};

/**
 * Refusals whose one useful fact only the server has — how long a lock has left to run. Its sentence was written
 * for the person reading it and IS the message; the shared line could only say "for now".
 */
const SERVER_SAYS = new Set<string>(['PASSWORD_LOCKED', 'PARCEL_LOST', 'COUNTRY_NOT_OPEN', 'AGREEMENT_REQUIRED']);

export function errorSentence(error: SbgError): string {
  if (SERVER_SAYS.has(error.code) && error.detail?.trim()) return error.detail.trim();
  return OVERRIDE[error.code] ?? SAY[presentationFor(error.code).say] ?? SAY['error.generic'];
}

export interface ErrorNoteProps {
  error: SbgError;
  /** Shown only when the error is retryable — otherwise retrying is theatre. */
  onRetry?: () => void;
  retryLabel?: string;
  /** Reveals the server's own wording. Off by default. */
  showDetail?: boolean;
}

export function ErrorNote({ error, onRetry, retryLabel = 'Try again', showDetail = false }: ErrorNoteProps) {
  const p = presentationFor(error.code);
  return (
    <div class={`note note--${p.tone}`} role="alert">
      {/* The presentation carries an icon NAME, never a glyph — the symbol is drawn from the
          monoline set so it inherits the note's colour and renders on every device. */}
      <Icon name={p.icon} size={22} class="note__ic" />
      <div class="note__body">
        <p class="note__t">{errorSentence(error)}</p>
        {/* Never the same sentence twice: where the server's words are the headline, they are not also the detail. */}
        {showDetail && error.detail && error.detail.trim() !== errorSentence(error) ? <p class="note__d">{error.detail}</p> : null}
        {onRetry && error.retryable ? (
          <div class="note__retry">
            <Button variant="link" full={false} onClick={onRetry}>
              {retryLabel}
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

/**
 * The sentence a refusal should be read as: the server's own, when the server wrote one for the person reading it.
 *
 * "No driver signs in with that number", "Mover 12 is carrying KX-1 — it has to be delivered or handed back": these
 * ARE the message. The shared line for their code would only sit above them saying less — "We could not find that.
 * Check the code." over a refusal that has nothing to do with a code. Only a 4xx carries such a sentence; anything
 * the client made up (no signal, a timeout) or the server broke on (5xx) keeps the shared wording.
 */
export function refusalSentence(error: SbgError): string {
  const written = error.status >= 400 && error.status < 500 && error.status !== 401 && error.status !== 426 ? error.detail?.trim() : '';
  return written || errorSentence(error);
}

/** A by-name refusal, shown where the person acted — one sentence, the server's. See `refusalSentence`. */
export function RefusalNote({ error }: { error: SbgError }) {
  const p = presentationFor(error.code);
  return (
    <div class={`note note--${p.tone}`} role="alert">
      <Icon name={p.icon} size={22} class="note__ic" />
      <div class="note__body">
        <p class="note__t">{refusalSentence(error)}</p>
      </div>
    </div>
  );
}

export interface NoteProps {
  tone?: 'info' | 'warn' | 'danger' | 'ok';
  /** A name from the monoline set. Typed so an emoji cannot be passed here at all. */
  icon?: IconName;
  title: string;
  /** Words, or words with the trade's short forms marked (<Abbreviated>). */
  detail?: ComponentChildren;
}

/** The same shape for a non-error message (shift started, rate matched, bag loaded). */
export function Note({ tone = 'info', icon, title, detail }: NoteProps) {
  return (
    <div class={`note note--${tone}`} role="status">
      {icon ? <Icon name={icon} size={22} class="note__ic" /> : null}
      <div class="note__body">
        <p class="note__t">{title}</p>
        {detail ? <p class="note__d">{detail}</p> : null}
      </div>
    </div>
  );
}
