import { scryptSync } from 'crypto';
import { GlosError } from '../http/glos-error';

/**
 * WRONG PASSWORDS, COUNTED AGAINST THE ACCOUNT — whoever types them, from wherever.
 *
 * A limit per caller (`RateLimitGuard`) counts addresses, and somebody guessing from ten thousand addresses is ten
 * thousand callers who each made one polite try. What they cannot spread out is the ACCOUNT they are guessing at.
 * So the tries are counted there: five wrong in a quarter of an hour and the sign-in is locked, the right password
 * included — a lock that still let the right one through would only tell the guesser when to stop.
 *
 * It is counted against the ADDRESS THAT WAS TYPED, whether or not anybody holds it. A lock that only real accounts
 * could reach would answer the question every sign-in here refuses to answer: is there an account by this name.
 *
 * A LOCK ENDS BY ITSELF, and each one in a row is longer: a person who mistyped waits a quarter of an hour; somebody
 * working through a list gets five tries a day. The way back that does not wait is the one only the holder has —
 * a reset by a code sent to the address (`forget`).
 *
 * Kept in memory, like the one-time codes: honest for one server. Behind two, a guesser gets two counts; the fix is
 * a shared counter, not a cleverer local one. A restart forgets the locks, which costs a guesser's five tries.
 */

/** Wrong tries before the sign-in locks. The same number as a PIN. */
export const MAX_PASSWORD_TRIES = 5;
/** Wrong tries count together while they are this close to each other. */
export const PASSWORD_TRY_WINDOW_MS = 15 * 60 * 1000;
/** How long the first lock lasts, the second in a row, and so on. The last rung repeats. */
export const PASSWORD_LOCK_LADDER_MS = [15 * 60 * 1000, 60 * 60 * 1000, 6 * 60 * 60 * 1000, 24 * 60 * 60 * 1000];
/** This long after a lock ended with no new one, the ladder starts again from its first rung. */
export const PASSWORD_LADDER_MEMORY_MS = 24 * 60 * 60 * 1000;
/** A crude cap, so a flood of made-up addresses cannot pin memory. */
const MAX_KEYS = 50_000;

interface Tries {
  /** When each recent wrong try was made. */
  wrong: number[];
  lockedUntil?: number;
  /** Locks in a row: which rung of the ladder the next one stands on. */
  locks: number;
}

/** How long, in the words a person is told: "15 minutes", "1 hour", "6 hours". */
export function lockWords(ms: number): string {
  const minutes = Math.max(1, Math.ceil(ms / 60_000));
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  const hours = Math.ceil(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'}`;
}

/** What a door says: when a try is wrong, and what its lock is a lock on. The defaults are a password's. */
export interface TriesWords {
  wrong: string;
  /** "Too many wrong …" */
  what: string;
  /** How to get in without waiting, if there is a way: ", or reset the password". */
  wayBack: string;
}
const PASSWORD_WORDS: TriesWords = { wrong: 'Wrong email or password', what: 'passwords', wayBack: ', or reset the password' };
/** A password whose holder cannot reset it themselves (network staff, a company's administrators): they wait, or a colleague makes them a new sign-in. */
export const PASSWORD_NO_SELF_RESET: TriesWords = { ...PASSWORD_WORDS, wayBack: '' };

export class PasswordTries {
  private readonly state = new Map<string, Tries>();

  constructor(private readonly words: TriesWords = PASSWORD_WORDS) {}

  private static key(typed: string | undefined): string {
    return (typed ?? '').trim().toLowerCase().slice(0, 254);
  }

  private locked(until: number, now: number): GlosError {
    const left = until - now;
    return new GlosError('PASSWORD_LOCKED', `Too many wrong ${this.words.what}. This sign-in is locked: try again in ${lockWords(left)}${this.words.wayBack}.`, { retryAfterSec: Math.ceil(left / 1000) });
  }

  /** Until when this address is locked — undefined when it is not. */
  lockedUntil(typed: string | undefined, now: number = Date.now()): number | undefined {
    const until = this.state.get(PasswordTries.key(typed))?.lockedUntil;
    return until !== undefined && until > now ? until : undefined;
  }

  /** BEFORE the password is looked at: a locked sign-in answers nobody, right password or wrong. */
  check(typed: string | undefined, now: number = Date.now()): void {
    const until = this.lockedUntil(typed, now);
    if (until !== undefined) throw this.locked(until, now);
  }

  /**
   * A wrong password. Counted, and answered: `error` is what to throw — the usual refusal, or, on the try that
   * fills the count, the lock it started (`locked`, so that the holder can be told, once).
   */
  wrong(typed: string | undefined, now: number = Date.now()): { error: GlosError; locked?: { until: number } } {
    const key = PasswordTries.key(typed);
    const entry = this.state.get(key) ?? { wrong: [], locks: 0 };
    // A lock that ended long ago is forgotten: the next one starts from the first rung again.
    if (entry.lockedUntil !== undefined && now - entry.lockedUntil > PASSWORD_LADDER_MEMORY_MS) entry.locks = 0;
    entry.wrong = entry.wrong.filter((at) => now - at < PASSWORD_TRY_WINDOW_MS);
    entry.wrong.push(now);
    if (entry.wrong.length < MAX_PASSWORD_TRIES) {
      this.keep(key, entry, now);
      return { error: new GlosError('AUTH_FAILED', this.words.wrong) };
    }
    const until = now + PASSWORD_LOCK_LADDER_MS[Math.min(entry.locks, PASSWORD_LOCK_LADDER_MS.length - 1)];
    entry.locks += 1;
    entry.lockedUntil = until;
    entry.wrong = [];
    this.keep(key, entry, now);
    return { error: this.locked(until, now), locked: { until } };
  }

  /**
   * The right password — or a reset by a code sent to the address, which is the holder's own way back and opens a
   * locked sign-in at once. The wrong tries are forgotten; so is the lock, and the ladder.
   */
  forget(typed: string | undefined): void {
    this.state.delete(PasswordTries.key(typed));
  }

  private keep(key: string, entry: Tries, now: number): void {
    this.state.set(key, entry);
    if (this.state.size <= MAX_KEYS) return;
    for (const [k, e] of this.state) {
      const live = e.wrong.some((at) => now - at < PASSWORD_TRY_WINDOW_MS) || (e.lockedUntil !== undefined && now - e.lockedUntil <= PASSWORD_LADDER_MEMORY_MS);
      if (!live) this.state.delete(k);
    }
  }
}

const NOBODY_SALT = 'nobody-holds-this-address';

/**
 * The work of checking a password, done for an address nobody holds. Without it "no such account" answers in a
 * fraction of the time "wrong password" does, and the difference is a list of who has an account.
 */
export function spendTime(password: string | undefined): void {
  scryptSync(String(password ?? ''), NOBODY_SALT, 64);
}
