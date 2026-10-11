import { randomBytes } from 'crypto';
import { GlosError } from '../http/glos-error';

/**
 * WHAT MAY BE CHOSEN AS A PASSWORD.
 *
 * Counting wrong tries per account (`PasswordTries`) stops somebody working through a list against ONE account. It
 * does not stop the other way round: one or two of the most-used passwords tried against EVERY account, never
 * enough on any of them to lock it. The answer to that is not a counter, it is that the most-used passwords are
 * not here to be found — so they are refused at the only moment that can be done: when one is chosen.
 *
 * This is a refusal of the worst, not a measure of strength. It names what people actually choose: a well-known
 * word with a number on the end, their own name or address, a run along the keyboard, nothing but digits.
 */

/** The floor for a password anybody chooses. (Staff and company administrators ask for more, at their own doors.) */
export const PASSWORD_MIN = 8;

/** Whole passwords, as they are — the ones the pattern rules below do not already catch. */
const WELL_KNOWN = new Set([
  'p@ssw0rd', 'p@ssword', 'passw0rd', 'pa$$w0rd', 'pa55word', 'password!', 'letmein!', 'trustno1', 'iloveyou', 'iloveyou!', 'iloveu2', 'ilovegod', 'ilovejesus',
  'qwerty123', 'qwerty12', '1q2w3e4r', '1q2w3e4r5t', 'q1w2e3r4', 'q1w2e3r4t5', '1qaz2wsx', '1qazxsw2', 'zaq12wsx', 'qazwsxedc', 'abc12345', 'abcd1234', 'a1b2c3d4', 'aa123456', 'abc123456',
  'changeme', 'changeit', 'welcome1', 'whatever', 'sunshine', 'princess', 'football', 'baseball', 'superman', 'starwars', 'jesuschrist', 'godisgood', 'godisgreat', 'blessed1',
  'nopassword', 'mypassword', 'yourpassword', 'thepassword', 'newpassword', 'password1!', 'adminadmin', 'rootroot', 'testtest', 'useruser', 'demodemo',
]);

/** Words a password is built from by putting a number or a sign on the end: "Welcome2026!", "arsenal123". */
const WORDS = new Set([
  'password', 'passwort', 'passcode', 'pass', 'welcome', 'karibu', 'letmein', 'login', 'signin', 'admin', 'administrator', 'root', 'user', 'guest', 'test', 'testing', 'demo', 'default', 'temp', 'temporary', 'changeme', 'secret', 'access', 'master', 'system', 'server', 'computer', 'internet',
  'hello', 'iloveyou', 'love', 'lovely', 'monkey', 'dragon', 'sunshine', 'princess', 'freedom', 'money', 'pesa', 'summer', 'winter', 'spring', 'autumn',
  'january', 'february', 'march', 'april', 'june', 'july', 'august', 'september', 'october', 'november', 'december', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'jesus', 'jesuschrist', 'christ', 'blessed', 'blessing', 'shalom', 'hallelujah', 'bismillah', 'mungu', 'baraka', 'amani', 'upendo', 'imani', 'neema', 'rafiki', 'hakuna', 'hakunamatata', 'jambo', 'habari', 'asante',
  'kenya', 'nairobi', 'mombasa', 'kisumu', 'nakuru', 'eldoret', 'tanzania', 'daressalaam', 'uganda', 'kampala', 'rwanda', 'kigali', 'ethiopia', 'addis', 'addisababa', 'malawi', 'africa', 'harambee',
  'safaricom', 'mpesa', 'airtel', 'telkom', 'equity', 'samsung', 'tecno', 'infinix', 'nokia', 'android', 'iphone', 'google', 'facebook', 'whatsapp', 'instagram', 'tiktok', 'youtube',
  'seebuyget', 'sbg', 'shop', 'duka', 'store', 'kiosk', 'hub', 'driver', 'dereva', 'fleet', 'parcel', 'business', 'biashara', 'office',
  'football', 'soccer', 'arsenal', 'chelsea', 'liverpool', 'manchester', 'manutd', 'manunited', 'mancity', 'barcelona', 'realmadrid', 'gormahia', 'leopards',
  'qwerty', 'qwertyuiop', 'asdfgh', 'asdfghjkl', 'zxcvbn', 'zxcvbnm', 'azerty',
]);

const ROWS = ['abcdefghijklmnopqrstuvwxyz', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm', '1234567890', '0123456789'];
const backwards = (s: string) => [...s].reverse().join('');

/** A run along the alphabet, the number row or a row of the keyboard, forwards or backwards: "abcdefgh", "87654321", "qwertyui". */
function isRun(s: string): boolean {
  if (s.length < 4) return false;
  return ROWS.some((row) => row.includes(s) || backwards(row).includes(s) || (row + row).includes(s));
}

/** The words somebody's own details give a guesser: the name before the @, and each word of a name. */
function own(about: Array<string | undefined>): Set<string> {
  const out = new Set<string>();
  for (const raw of about) {
    const text = (raw ?? '').toLowerCase();
    if (!text) continue;
    const whole = text.split('@')[0];
    const joined = whole.replace(/[^a-z0-9]/g, '');
    if (joined.length >= 4) out.add(joined);
    const lettersOnly = whole.replace(/[^a-z]/g, '');
    if (lettersOnly.length >= 4) out.add(lettersOnly);
    for (const word of whole.split(/[^a-z0-9]+/)) if (word.length >= 4) out.add(word);
  }
  return out;
}

/**
 * What is wrong with a password, if anything. `about` is what a guesser already knows about its owner — their
 * email address, the name of their shop — because a password made of that is the first one tried.
 */
export function passwordProblem(password: string | undefined, about: Array<string | undefined> = [], min: number = PASSWORD_MIN): 'short' | 'guessable' | null {
  const typed = password ?? '';
  if (typed.length < min) return 'short';
  const p = typed.toLowerCase();
  if (WELL_KNOWN.has(p)) return 'guessable';
  // Fewer than four different characters: "aaaaaaaa", "12121212", "abababab".
  if (new Set(p).size < 4) return 'guessable';
  // Nothing but digits and signs: a birthday, a phone number, a run. Ten digits is a space a machine walks through.
  if (!/[a-z]/.test(p)) return 'guessable';
  // A WORD WITH NUMBERS AND SIGNS AROUND IT: what is left when the digits and signs at either end are taken off.
  // (A run along the keyboard is caught here too, with or without a number on the end: "qwertyui", "asdfgh123".)
  const core = p.replace(/[^a-z]+$/, '').replace(/^[^a-z]+/, '');
  const plain = core.replace(/[^a-z0-9]/g, '');
  if (WORDS.has(core) || WORDS.has(plain) || isRun(plain)) return 'guessable';
  // The same word twice: "passwordpassword", "kenyakenya".
  if (plain.length % 2 === 0 && plain.slice(0, plain.length / 2) === plain.slice(plain.length / 2) && WORDS.has(plain.slice(0, plain.length / 2))) return 'guessable';
  const theirs = own(about);
  if (theirs.has(core) || theirs.has(plain)) return 'guessable';
  return null;
}

/** Refuse a password that is too short or too easy to guess, in the two codes every app has a sentence for. */
export function assertPassword(password: string | undefined, about: Array<string | undefined> = [], min: number = PASSWORD_MIN): void {
  const problem = passwordProblem(password, about, min);
  if (problem === 'short') throw new GlosError('PASSWORD_TOO_SHORT', `A password needs at least ${min} characters`);
  if (problem === 'guessable') {
    throw new GlosError('PASSWORD_GUESSABLE', 'That password is too easy to guess. Avoid a common word with a number on the end, your own name or email address, only digits, and runs like 12345678 or qwerty.');
  }
}

/* ------------------------------------------------------------------ a code that resets a password -- */

/** Crockford's alphabet: no I, L, O or U, so a code read off an email cannot be mistyped into another code. */
const CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A PASSWORD-RESET CODE: sixty random bits. It was thirty-two ("RST-" and eight hex characters), and the reset finds
 * the account BY the code — so a guess did not have to match one account's code, only anybody's, and every reset
 * that happened to be open made the next guess likelier. Sixty bits ends that whoever is guessing, from however
 * many addresses.
 */
export function newResetCode(): string {
  return 'RST-' + [...randomBytes(12)].map((b) => CODE_ALPHABET[b % 32]).join('');
}

/** A code as it was typed → as it was issued: capitals, no spaces, and the letters the alphabet leaves out read as the digits they look like. */
export function readResetCode(typed: string | undefined): string {
  const t = (typed ?? '').replace(/\s+/g, '').toUpperCase();
  if (!t.startsWith('RST-')) return t;
  return 'RST-' + t.slice(4).replace(/O/g, '0').replace(/[IL]/g, '1');
}
