import { HttpException } from '@nestjs/common';
import { ERROR_CODES, GlosErrorCode, isRetryable } from './error-codes';
import type { Said } from '../../modules/pudo/notice-words/say';

/** Structured, machine-actionable parameters for a failure (e.g. `{ resource: 'parcel', id }`). */
export type ProblemParams = Record<string, unknown>;

/**
 * The one exception type GLOS throws. It carries a stable `code` (from the closed registry) that a
 * low-literacy client turns into an icon + audio, while the English `detail` is a fallback for readers
 * and logs. It extends HttpException so Nest keeps treating it as an HTTP error, and the ProblemFilter
 * reads getResponse() to render RFC 9457.
 *
 * The HttpException response payload deliberately includes both `detail` and a `message` alias: Nest's
 * HttpException.message derives from `response.message`, so keeping it preserves every `.toThrow(/…/)`
 * assertion and every legacy client that still reads `body.message`.
 */
export class GlosError extends HttpException {
  readonly code: GlosErrorCode;
  readonly params?: ProblemParams;
  readonly retryable: boolean;
  /**
   * 2026-11-27 — THE REFUSAL AS A PHRASE (the owner: "continue the weak spots"): its detail is this phrase's English, and the
   * caller is told it in the language its app asks in (ProblemFilter; notice-words/refuse.ts makes one).
   */
  readonly said?: Said;

  constructor(code: GlosErrorCode, detail?: string, params?: ProblemParams, opts?: { status?: number; retryable?: boolean; said?: Said }) {
    const spec = ERROR_CODES[code];
    const status = opts?.status ?? spec.status;
    const message = detail ?? spec.title;
    super({ code, detail: message, message, params }, status);
    this.code = code;
    this.params = params;
    this.retryable = opts?.retryable ?? isRetryable(code);
    if (opts?.said) this.said = opts.said;
  }
}
