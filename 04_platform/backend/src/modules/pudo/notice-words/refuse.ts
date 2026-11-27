import { GlosError, type ProblemParams } from '../../../foundation/http/glos-error';
import type { GlosErrorCode } from '../../../foundation/http/error-codes';
import { sayEnglish, type Said } from './say';

/**
 * 2026-11-27 — A REFUSAL IN THE CALLER'S LANGUAGE (the owner: "continue the weak spots"). The apps show the words a refusal
 * comes with; they were English whatever language the app was set to. A refusal made here carries its phrase: its detail is
 * the phrase's English (what a test, a log and an API caller read, word for word as before), and an app that asks in another
 * language is told it in that language, with its country's own words for it (ProblemFilter) — all of it, or the English.
 *
 *   throw refused('PIN_WRONG', said('refuse.person.pinWrong'), { triesLeft });
 */
export function refused(code: GlosErrorCode, s: Said, params?: ProblemParams, opts?: { status?: number; retryable?: boolean }): GlosError {
  return new GlosError(code, sayEnglish(s), params, { ...opts, said: s });
}
