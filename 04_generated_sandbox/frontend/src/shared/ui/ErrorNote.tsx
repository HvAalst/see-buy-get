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
  'error.offline': 'No signal right now. Your phone will retry.',
  'error.slow_network': 'The network is very slow. Try again in a moment.',
  'error.update_app': 'This app needs updating before you can carry on.',
  'error.too_late': 'Too late — that one has gone.',
  'error.not_now': 'That cannot be done right now.',
  'error.too_heavy': 'Too heavy for the space you have left.',
  'error.no_fragile': 'This vehicle cannot carry fragile loads.',
  'error.not_found': 'We could not find that. Check the code.',
  'error.wrong_code': 'That code is not right. Try again.',
  'error.wrong_destination': 'That parcel is going somewhere else. It belongs in another bag.',
  'error.code_locked': 'That code is locked. Ask for a new one.',
  // Consumer phone + PIN sign-in (S20/S21).
  'error.wrong_pin': 'That PIN is not right. Try again.',
  'error.pin_digits': 'Your PIN must be 4 digits.',
  'error.pin_locked': 'Too many wrong PINs. Tap "Forgot your PIN?" to sign in with a code.',
  'error.role_not_held': 'You cannot open that here.',
  'error.phone_invalid': 'That phone number is not right. Check it.',
  'error.verify_phone': 'Verify your phone first — we will send you a code.',
  'error.bag_full': 'That bag is full.',
  'error.already_in_bag': 'That parcel is already in a bag. Check the other bag if it is not in this one.',
  'error.shelf_full': 'There is no shelf space left.',
  'error.manifest_incomplete': 'Some parcels for this bus are still waiting. Load them, or leave them behind.',
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
  CANNOT_COUPLE: 'You cannot take this vehicle. Check your licence with the office.',
  BAG_RESERVED: 'That bag is being held for another driver.',
  CONFLICT: 'Someone got there first.',
  INTERNAL: 'The system had a problem. Try again shortly.',
};

export function errorSentence(error: SbgError): string {
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
        {showDetail && error.detail ? <p class="note__d">{error.detail}</p> : null}
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

export interface NoteProps {
  tone?: 'info' | 'warn' | 'danger' | 'ok';
  /** A name from the monoline set. Typed so an emoji cannot be passed here at all. */
  icon?: IconName;
  title: string;
  detail?: string;
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
