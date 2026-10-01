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
  const codes: SbgErrorCode[] = ['AUTH_FAILED', 'PIN_INVALID', 'PIN_LOCKED', 'PIN_WRONG', 'PIN_GUESSABLE', 'ROLE_NOT_HELD', 'PHONE_INVALID', 'PHONE_NOT_VERIFIED'];
  for (const code of codes) {
    it(`${code} has its own sentence`, () => {
      expect(errorSentence(mk(code))).not.toBe(GENERIC);
    });
  }

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
