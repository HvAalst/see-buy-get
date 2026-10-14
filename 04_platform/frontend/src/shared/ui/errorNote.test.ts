import { describe, expect, it } from 'vitest';
import type { SbgError, SbgErrorCode } from '../../lib/sbg';
import { errorSentence, refusalSentence } from './ErrorNote';

const mk = (code: SbgErrorCode): SbgError => ({ code, status: 400, title: '', detail: '', retryable: false });

const GENERIC = 'Something went wrong. Try again.';

/**
 * Drift guard (S21): a code whose presentation points at a say-key MUST resolve to a real sentence, not
 * the generic fallback. The consumer identity codes were added to errors.ts but their say-keys were
 * missing from the SAY table, so every phone/PIN error rendered as "Something went wrong" — this test
 * pins the fix so the six can never silently fall back again.
 */
describe('errorSentence — identity codes resolve to specific guidance (not the generic fallback)', () => {
  const codes: SbgErrorCode[] = ['AUTH_FAILED', 'DEVICE_NOT_KNOWN', 'PIN_INVALID', 'PIN_LOCKED', 'PIN_WRONG', 'PASSWORD_WRONG', 'SECRET_WRONG', 'PASSWORD_LOCKED', 'PASSWORD_TOO_SHORT', 'PASSWORD_GUESSABLE', 'PIN_GUESSABLE', 'ROLE_NOT_HELD', 'DRIVER_PASS_NEEDED', 'DRIVER_PASS_WRONG', 'PHONE_INVALID', 'PHONE_NOT_SERVED', 'SMS_NOT_SENT', 'PHONE_NOT_VERIFIED'];
  for (const code of codes) {
    it(`${code} has its own sentence`, () => {
      expect(errorSentence(mk(code))).not.toBe(GENERIC);
    });
  }

  it('a refused sign-in names no credential: the same code answers a PIN, a password, a secret and a code', () => {
    const sentence = errorSentence(mk('AUTH_FAILED')).toLowerCase();
    for (const word of ['pin', 'password', 'secret', 'code']) expect(sentence).not.toContain(word);
    // …while the two refusals that ARE about one thing say which.
    expect(errorSentence(mk('PASSWORD_WRONG')).toLowerCase()).toContain('password');
    expect(errorSentence(mk('SECRET_WRONG')).toLowerCase()).toContain('secret');
  });

  it('a code that could not be texted is said once: the app’s sentence is the server’s, and it is not about what the person typed', () => {
    // The sentences the server sends with each (pudo.controller.ts). Equal, so a screen that shows the detail too shows one line.
    const notSent = { ...mk('SMS_NOT_SENT'), status: 503, retryable: true, detail: 'We could not send the code just now. Try again in a little while.' };
    expect(errorSentence(notSent)).toBe(notSent.detail);
    const abroad = { ...mk('PHONE_NOT_SERVED'), status: 400, detail: 'We cannot send a code to a number in that country yet.' };
    expect(errorSentence(abroad)).toBe(abroad.detail);
    for (const said of [errorSentence(notSent), errorSentence(abroad)]) expect(said.toLowerCase()).not.toMatch(/check|not right|wrong/);
  });

  it('a locked password sign-in says how long is left: the server’s sentence is the message, and a bare one still says what to do', () => {
    const locked = { ...mk('PASSWORD_LOCKED'), status: 403, detail: 'Too many wrong passwords. This sign-in is locked: try again in 15 minutes, or reset the password.' };
    expect(errorSentence(locked)).toContain('try again in 15 minutes');
    const bare = errorSentence({ ...mk('PASSWORD_LOCKED'), detail: '' });
    expect(bare).not.toBe(GENERIC);
    expect(bare.toLowerCase()).toContain('locked');
    expect(bare.toLowerCase()).toContain('reset');
    // Nobody else's detail becomes a headline: a refused sign-in keeps the shared sentence.
    expect(errorSentence({ ...mk('AUTH_FAILED'), status: 401, detail: 'Wrong email or password' })).not.toContain('Wrong email');
  });

  it('a password that may not be chosen says why: too short, or what makes it easy to guess', () => {
    expect(errorSentence(mk('PASSWORD_TOO_SHORT'))).toContain('8 characters');
    const guessable = errorSentence(mk('PASSWORD_GUESSABLE')).toLowerCase();
    for (const word of ['common word', 'name', 'digits', '12345678']) expect(guessable).toContain(word);
  });

  it('a PIN is five digits, and a device that is new is told what happens next — not that the PIN was wrong', () => {
    expect(errorSentence(mk('PIN_INVALID'))).toContain('5 digits');
    expect(errorSentence(mk('PIN_GUESSABLE'))).toContain('12345');
    const fresh = errorSentence(mk('DEVICE_NOT_KNOWN')).toLowerCase();
    expect(fresh).toContain('code');
    expect(fresh).not.toContain('wrong');
    expect(fresh).not.toContain('not right');
  });

  it('PIN_LOCKED steers the user to the code recovery, not a dead "try again"', () => {
    const sentence = errorSentence(mk('PIN_LOCKED')).toLowerCase();
    expect(sentence).toContain('pin');
    expect(sentence).toContain('code'); // points at "sign in with a code"
  });

  it('a wrong PIN from somebody signed in says what the next wrong one costs; an easy PIN says what to avoid', () => {
    expect(errorSentence(mk('PIN_WRONG')).toLowerCase()).toContain('lock');
    expect(errorSentence(mk('PIN_GUESSABLE'))).toContain('1234');
  });

  it('the bagging refusals both name the bag — a scanning loop must not say "something went wrong"', () => {
    for (const code of ['WRONG_DESTINATION', 'ALREADY_IN_BAG'] as SbgErrorCode[]) {
      const sentence = errorSentence(mk(code));
      expect(sentence).not.toBe(GENERIC);
      expect(sentence.toLowerCase()).toContain('bag'); // the counter's next move is another bag, and it says so
    }
  });

  it('INCOMPLETE_MANIFEST (S25) resolves to the gate guidance, not the generic fallback', () => {
    const sentence = errorSentence(mk('INCOMPLETE_MANIFEST'));
    expect(sentence).not.toBe(GENERIC);
    expect(sentence.toLowerCase()).toContain('waiting'); // names the parcels still owed to the bus
  });
});

/**
 * A refusal the server wrote for the person reading it IS the message. The shared line for its code said less, above
 * it: "We could not find that. Check the code." over "No driver signs in with that number" — found in a browser.
 */
describe('refusalSentence — the server’s own sentence, when it wrote one', () => {
  const refused = (code: SbgErrorCode, status: number, detail: string): SbgError => ({ code, status, title: '', detail, retryable: false });

  it('says a 4xx refusal in the server’s words', () => {
    expect(refusalSentence(refused('NOT_FOUND', 404, 'No driver signs in with that number.'))).toBe('No driver signs in with that number.');
    expect(refusalSentence(refused('RATE_LIMITED', 429, 'You have made 20 offers in a day — try again tomorrow'))).toContain('20 offers');
  });

  it('keeps the shared wording for what was not written for a person', () => {
    expect(refusalSentence(refused('INTERNAL', 500, 'TypeError: x is undefined'))).toBe(errorSentence(mk('INTERNAL')));
    expect(refusalSentence(refused('NETWORK', 0, 'Failed to fetch'))).toBe(errorSentence(mk('NETWORK')));
    expect(refusalSentence(refused('UNAUTHORIZED', 401, 'Your sign-in has ended on this phone.'))).toBe(errorSentence(mk('UNAUTHORIZED')));
    expect(refusalSentence(refused('NOT_FOUND', 404, '  '))).toBe(errorSentence(mk('NOT_FOUND')));
  });
});
