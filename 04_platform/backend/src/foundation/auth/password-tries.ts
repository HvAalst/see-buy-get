import { scryptSync } from 'crypto';
import { GlosError } from '../http/glos-error';
import { PersistentMap } from '../store/persistent-map';

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
 * WHAT IS KEPT, AND WHERE. A LOCK is kept in the durable store (`keptLocks`): a restart must not hand a guesser a
 * clean slate, and a day-long lock that a deploy ends is not a day-long lock. It is written when a lock starts and
 * when one is lifted — rare events — and it lives behind the same store everything durable does, so the day that
 * store is shared between servers, so are the locks. The wrong tries BEFORE a lock are kept in memory only: writing
 * a file for every wrong password anybody types would turn guessing into a way to wear the disk out, and losing
 * them at a restart costs at most four tries.
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

/** A lock as it is kept: until when, and which one in a row it was. */
export interface KeptLock {
  until: number;
  locks: number;
}

/**
 * The durable store one door's locks are kept in: `data/password-locks-<door>.json`. Under test, and with persistence
 * off, it keeps them in memory. (`file` is for the test that proves the round trip through a real file.)
 */
export function keptLocks(door: string, file?: string): Map<string, KeptLock> {
  return new PersistentMap<string, KeptLock>(`password-locks-${door}`, file ? { file } : {});
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
export const PASSWORD_WORDS: TriesWords = { wrong: 'Wrong email or password', what: 'passwords', wayBack: ', or reset the password' };
/** A password whose holder cannot reset it themselves (network staff, a company's administrators): they wait, or a colleague makes them a new sign-in. */
export const PASSWORD_NO_SELF_RESET: TriesWords = { ...PASSWORD_WORDS, wayBack: '' };

export class PasswordTries {
  /** When each recent wrong try at an address was made. Memory only. */
  private readonly wrongTries = new Map<string, number[]>();

  /**
   * @param words what this door says
   * @param locks where its locks are kept. A service passes `keptLocks('…')`; left out, they live and die with this
   *              object, which is what a unit test wants.
   */
  constructor(
    private readonly words: TriesWords = PASSWORD_WORDS,
    private readonly locks: Map<string, KeptLock> = new Map(),
  ) {}

  private static key(typed: string | undefined): string {
    return (typed ?? '').trim().toLowerCase().slice(0, 254);
  }

  private locked(until: number, now: number): GlosError {
    const left = until - now;
    return new GlosError('PASSWORD_LOCKED', `Too many wrong ${this.words.what}. This sign-in is locked: try again in ${lockWords(left)}${this.words.wayBack}.`, { retryAfterSec: Math.ceil(left / 1000) });
  }

  /** Until when this address is locked — undefined when it is not. */
  lockedUntil(typed: string | undefined, now: number = Date.now()): number | undefined {
    const until = this.locks.get(PasswordTries.key(typed))?.until;
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
    const recent = (this.wrongTries.get(key) ?? []).filter((at) => now - at < PASSWORD_TRY_WINDOW_MS);
    recent.push(now);
    if (recent.length < MAX_PASSWORD_TRIES) {
      this.wrongTries.set(key, recent);
      if (this.wrongTries.size > MAX_KEYS) this.sweepTries(now);
      return { error: new GlosError('AUTH_FAILED', this.words.wrong) };
    }
    // Which rung: the one after the last lock, unless that lock ended long enough ago to be forgotten.
    const last = this.locks.get(key);
    const rung = last && now - last.until <= PASSWORD_LADDER_MEMORY_MS ? last.locks : 0;
    const until = now + PASSWORD_LOCK_LADDER_MS[Math.min(rung, PASSWORD_LOCK_LADDER_MS.length - 1)];
    this.wrongTries.delete(key);
    this.sweepLocks(now);
    this.locks.set(key, { until, locks: rung + 1 });
    return { error: this.locked(until, now), locked: { until } };
  }

  /**
   * The right password — or a reset by a code sent to the address, which is the holder's own way back and opens a
   * locked sign-in at once. The wrong tries are forgotten; so is the lock, and the ladder.
   */
  forget(typed: string | undefined): void {
    const key = PasswordTries.key(typed);
    this.wrongTries.delete(key);
    // Asked first: nearly every sign-in has no lock to lift, and lifting one is a write to the durable store.
    if (this.locks.has(key)) this.locks.delete(key);
  }

  private sweepTries(now: number): void {
    for (const [k, tries] of this.wrongTries) if (!tries.some((at) => now - at < PASSWORD_TRY_WINDOW_MS)) this.wrongTries.delete(k);
  }

  /** Locks that ended long enough ago to matter to nobody are taken out — when a new one is being written anyway. */
  private sweepLocks(now: number): void {
    const stale = [...this.locks].filter(([, lock]) => now - lock.until > PASSWORD_LADDER_MEMORY_MS).map(([k]) => k);
    for (const k of stale) this.locks.delete(k);
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
