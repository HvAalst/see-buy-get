import { GlosError } from '../http/glos-error';
import { MAX_PASSWORD_TRIES, PASSWORD_LADDER_MEMORY_MS, PASSWORD_LOCK_LADDER_MS, PASSWORD_TRY_WINDOW_MS, PasswordTries, lockWords } from './password-tries';
import { newResetCode, passwordProblem, readResetCode } from './password-rules';

const MIN = 60_000;
const T0 = Date.parse('2026-10-11T08:00:00Z');
const codeOf = (fn: () => void): string => {
  try {
    fn();
  } catch (e) {
    return (e as GlosError).code;
  }
  return 'let through';
};
/** Type the wrong password `n` times, a second apart, and say what each was answered with. */
const guess = (t: PasswordTries, who: string, n: number, from: number) => Array.from({ length: n }, (_, i) => t.wrong(who, from + i * 1000).error.code);

describe('wrong passwords, counted against the account', () => {
  it('lets four wrong tries be wrong, and locks on the fifth — the right password included', () => {
    const t = new PasswordTries();
    expect(guess(t, 'mama@shop.example', MAX_PASSWORD_TRIES - 1, T0)).toEqual(['AUTH_FAILED', 'AUTH_FAILED', 'AUTH_FAILED', 'AUTH_FAILED']);
    expect(codeOf(() => t.check('mama@shop.example', T0 + 5000))).toBe('let through');
    const fifth = t.wrong('mama@shop.example', T0 + 5000);
    expect(fifth.error.code).toBe('PASSWORD_LOCKED');
    expect(fifth.locked).toEqual({ until: T0 + 5000 + 15 * MIN });
    // From here the door answers nobody: `check` is asked before the password is looked at.
    expect(codeOf(() => t.check('mama@shop.example', T0 + 6000))).toBe('PASSWORD_LOCKED');
    expect(codeOf(() => t.check('mama@shop.example', T0 + 5000 + 15 * MIN - 1))).toBe('PASSWORD_LOCKED');
    expect(codeOf(() => t.check('mama@shop.example', T0 + 5000 + 15 * MIN))).toBe('let through');
  });

  it('is a lock that is never a 401, and says how long', () => {
    const t = new PasswordTries();
    guess(t, 'a@b.example', 4, T0);
    const { error } = t.wrong('a@b.example', T0 + 4000);
    // A 401 is what every app reads as "your sign-in ended": this is asked from inside an app too.
    expect(error.getStatus()).toBe(403);
    expect(error.message).toContain('try again in 15 minutes');
    expect(error.params).toEqual({ retryAfterSec: 15 * 60 });
  });

  it('counts the address as it is held — capitals and spaces around it are the same account', () => {
    const t = new PasswordTries();
    guess(t, 'Mama@Shop.example', 2, T0);
    guess(t, '  mama@shop.example ', 2, T0 + 3000);
    expect(t.wrong('MAMA@SHOP.EXAMPLE', T0 + 6000).error.code).toBe('PASSWORD_LOCKED');
    // …and it is nobody else's lock.
    expect(codeOf(() => t.check('baba@shop.example', T0 + 7000))).toBe('let through');
  });

  it('locks an address nobody holds exactly as it locks one somebody does — it knows no difference', () => {
    const t = new PasswordTries();
    expect(guess(t, 'nobody@nowhere.example', 5, T0)).toEqual(['AUTH_FAILED', 'AUTH_FAILED', 'AUTH_FAILED', 'AUTH_FAILED', 'PASSWORD_LOCKED']);
  });

  it('forgets wrong tries that are a quarter of an hour old: a slip now and then never locks anybody', () => {
    const t = new PasswordTries();
    guess(t, 'a@b.example', 4, T0);
    // The fifth, sixteen minutes later, is the first of a new count.
    expect(t.wrong('a@b.example', T0 + PASSWORD_TRY_WINDOW_MS + MIN).error.code).toBe('AUTH_FAILED');
    expect(guess(t, 'a@b.example', 3, T0 + PASSWORD_TRY_WINDOW_MS + 2 * MIN)).toEqual(['AUTH_FAILED', 'AUTH_FAILED', 'AUTH_FAILED']);
    expect(t.wrong('a@b.example', T0 + PASSWORD_TRY_WINDOW_MS + 3 * MIN).error.code).toBe('PASSWORD_LOCKED');
  });

  it('makes each lock in a row longer: a quarter of an hour, an hour, six, then a day — and a day again', () => {
    const t = new PasswordTries();
    let now = T0;
    const lengths: number[] = [];
    for (let round = 0; round < 6; round++) {
      guess(t, 'a@b.example', 4, now);
      const { locked } = t.wrong('a@b.example', now + 4000);
      lengths.push(locked!.until - (now + 4000));
      now = locked!.until + MIN; // back as soon as it opens
    }
    expect(lengths).toEqual([...PASSWORD_LOCK_LADDER_MS, PASSWORD_LOCK_LADDER_MS[3], PASSWORD_LOCK_LADDER_MS[3]]);
    expect(lengths.map(lockWords)).toEqual(['15 minutes', '1 hour', '6 hours', '24 hours', '24 hours', '24 hours']);
    // What is LEFT of a lock is rounded up: nobody is told to come back a minute before it opens.
    expect([lockWords(14 * MIN + 1), lockWords(MIN), lockWords(1), lockWords(59 * MIN + 1), lockWords(5 * 60 * MIN + 1)]).toEqual(['15 minutes', '1 minute', '1 minute', '1 hour', '6 hours']);
  });

  it('starts from the first rung again when a day has passed since the last lock ended', () => {
    const t = new PasswordTries();
    guess(t, 'a@b.example', 4, T0);
    const first = t.wrong('a@b.example', T0 + 4000).locked!;
    const later = first.until + PASSWORD_LADDER_MEMORY_MS + MIN;
    guess(t, 'a@b.example', 4, later);
    expect(t.wrong('a@b.example', later + 4000).locked!.until - (later + 4000)).toBe(PASSWORD_LOCK_LADDER_MS[0]);
  });

  it('is opened at once by the holder’s own way back, and by the right password before a lock', () => {
    const t = new PasswordTries();
    guess(t, 'a@b.example', 5, T0);
    expect(t.lockedUntil('a@b.example', T0 + 6000)).toBeDefined();
    t.forget('a@b.example'); // a reset by a code sent to the address
    expect(t.lockedUntil('a@b.example', T0 + 6000)).toBeUndefined();
    // …and the ladder went with it: the next lock is the short one.
    guess(t, 'a@b.example', 4, T0 + 7000);
    expect(t.wrong('a@b.example', T0 + 12_000).locked!.until - (T0 + 12_000)).toBe(PASSWORD_LOCK_LADDER_MS[0]);
    // The right password forgets the wrong ones before it: four slips, in, four more slips — never locked.
    const u = new PasswordTries();
    guess(u, 'c@d.example', 4, T0);
    u.forget('c@d.example');
    expect(guess(u, 'c@d.example', 4, T0 + 5000)).toEqual(['AUTH_FAILED', 'AUTH_FAILED', 'AUTH_FAILED', 'AUTH_FAILED']);
  });
});

describe('what may be chosen as a password', () => {
  const ok = (p: string, about: string[] = []) => expect([p, passwordProblem(p, about)]).toEqual([p, null]);
  const guessable = (p: string, about: string[] = []) => expect([p, passwordProblem(p, about)]).toEqual([p, 'guessable']);

  it('is eight characters or more', () => {
    expect(passwordProblem('seven-7')).toBe('short');
    expect(passwordProblem('')).toBe('short');
    expect(passwordProblem(undefined)).toBe('short');
    // A door that asks for more says so.
    expect(passwordProblem('nine-char', [], 10)).toBe('short');
  });

  it('takes what people who thought about it choose', () => {
    for (const p of ['maziwa-lala-2026', 'duka-langu-2026', 'chai-na-mandazi-7', 'Correct horse battery', 'kitenge-2026', 'seebuyget-staff', 'xK9#mPq2vL', 'first-pass']) ok(p);
  });

  it('refuses a well-known word with numbers and signs around it', () => {
    for (const p of ['password', 'Password1', 'password123', 'Welcome2026!', 'arsenal2025', 'Nairobi@2026', 'seebuyget', 'SeeBuyGet1', 'qwerty123', 'January2026', '2026arsenal', '!!Kenya2026', 'secret12', 'passwordpassword']) guessable(p);
  });

  it('refuses runs, repeats and nothing-but-digits', () => {
    for (const p of ['12345678', '87654321', '25061990', '0712345678', 'abcdefgh', 'hgfedcba', 'qwertyui', 'asdfghjkl', 'lkjhgfdsa', 'zxcvbnm123', 'aaaaaaaa', '12121212', 'abababab', '1q2w3e4r', 'P@ssw0rd']) guessable(p);
  });

  it('refuses a password made of what a guesser already knows: the address, the name', () => {
    guessable('amina2026', ['amina@example.com']);
    guessable('Amina.Otieno1', ['amina.otieno@example.com']);
    guessable('dukabora123', ['orders@example.com', 'Duka Bora']);
    guessable('Bora@2026', ['Duka Bora']);
    // The same password is nobody else's problem, and a short scrap of a name is not a name.
    ok('amina2026', ['wanjiru@example.com']);
    ok('ali-and-the-goats', ['ali@example.com']);
  });
});

describe('a code that resets a password', () => {
  it('is sixty random bits, in letters and digits that cannot be read as each other', () => {
    const codes = new Set(Array.from({ length: 500 }, () => newResetCode()));
    expect(codes.size).toBe(500);
    for (const code of codes) expect(code).toMatch(/^RST-[0-9A-HJKMNP-TV-Z]{12}$/);
  });

  it('is read as it was issued however it was typed', () => {
    expect(readResetCode(' rst-4f9a 2c1b 7k3m ')).toBe('RST-4F9A2C1B7K3M');
    // O for nought, I and L for one: the alphabet has none of the three, so each can only mean the digit.
    expect(readResetCode('RST-OOIL2C1B7K3M')).toBe('RST-00112C1B7K3M');
    expect(readResetCode(undefined)).toBe('');
  });
});
