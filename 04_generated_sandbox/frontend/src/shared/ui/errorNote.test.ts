import { describe, expect, it } from 'vitest';
import type { SbgError, SbgErrorCode } from '../../lib/sbg';
import { errorSentence } from './ErrorNote';

const mk = (code: SbgErrorCode): SbgError => ({ code, status: 400, title: '', detail: '', retryable: false });

const GENERIC = 'Something went wrong. Try again.';

/**
 * Drift guard (S21): a code whose presentation points at a say-key MUST resolve to a real sentence, not
 * the generic fallback. The consumer identity codes were added to errors.ts but their say-keys were
 * missing from the SAY table, so every phone/PIN error rendered as "Something went wrong" — this test
 * pins the fix so the six can never silently fall back again.
 */
describe('errorSentence — identity codes resolve to specific guidance (not the generic fallback)', () => {
  const codes: SbgErrorCode[] = ['AUTH_FAILED', 'PIN_INVALID', 'PIN_LOCKED', 'ROLE_NOT_HELD', 'PHONE_INVALID', 'PHONE_NOT_VERIFIED'];
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

  it('INCOMPLETE_MANIFEST (S25) resolves to the gate guidance, not the generic fallback', () => {
    const sentence = errorSentence(mk('INCOMPLETE_MANIFEST'));
    expect(sentence).not.toBe(GENERIC);
    expect(sentence.toLowerCase()).toContain('waiting'); // names the parcels still owed to the bus
  });
});
