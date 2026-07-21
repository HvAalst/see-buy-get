import { ArgumentsHost, Catch, ExceptionFilter, HttpException, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Request, Response } from 'express';
import { ERROR_CODES, GlosErrorCode, codeForStatus, isRetryable } from './error-codes';
import { GlosError, ProblemParams } from './glos-error';

/** The RFC 9457 problem+json body every failure renders to. */
interface Problem {
  type: string; // a stable URI per code (RFC 9457 `type`)
  title: string; // stable human title for the code
  status: number;
  code: GlosErrorCode; // the machine code a low-literacy UI maps to an icon
  detail: string; // per-occurrence English explanation
  message: string; // alias of detail — legacy clients read `body.message`
  params?: ProblemParams; // structured data for the client (ids, amounts, violations)
  retryable: boolean; // may the client retry this exact request?
  traceId: string; // correlate the response with server logs
  instance: string; // the request path
}

const PROBLEM_BASE = 'https://glos.dev/problems/';

/**
 * ProblemFilter — the single exit for every error, turning any thrown exception into RFC 9457
 * problem+json with a stable machine `code`. It works before the throw-site codemod lands: a plain
 * Nest exception maps to a generic code by status, a GlosError supplies its own, and ValidationPipe's
 * `message: string[]` is normalized into `params.violations`. The HTTP status is always preserved, so
 * existing status-based tests keep passing.
 */
@Catch()
export class ProblemFilter implements ExceptionFilter {
  private readonly logger = new Logger('ProblemFilter');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const traceId = `trc_${randomUUID()}`;

    let status = 500;
    let code: GlosErrorCode = 'INTERNAL';
    let detail = 'Something went wrong';
    let params: ProblemParams | undefined;
    let retryable = true;

    if (exception instanceof GlosError) {
      const payload = exception.getResponse() as { detail?: string };
      status = exception.getStatus();
      code = exception.code;
      detail = payload?.detail ?? exception.message;
      params = exception.params;
      retryable = exception.retryable;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      const norm = normalizeHttpBody(status, body);
      code = norm.code;
      detail = norm.detail;
      params = norm.params;
      retryable = isRetryable(code);
    } else {
      // A non-HTTP exception is a real bug: log it with the trace id, but never leak internals.
      this.logger.error(`Unhandled exception [${traceId}]`, exception instanceof Error ? exception.stack : String(exception));
    }

    const problem: Problem = {
      type: `${PROBLEM_BASE}${code}`,
      title: ERROR_CODES[code].title,
      status,
      code,
      detail,
      message: detail,
      ...(params ? { params } : {}),
      retryable,
      traceId,
      instance: req?.url ?? '',
    };

    res.status(status).json(problem);
  }
}

/** Extract a code + detail from a plain Nest HttpException body (string, `{message}`, or ValidationPipe's `{message: string[]}`). */
function normalizeHttpBody(status: number, body: unknown): { code: GlosErrorCode; detail: string; params?: ProblemParams } {
  if (typeof body === 'string') return { code: codeForStatus(status), detail: body };

  if (body && typeof body === 'object') {
    const rec = body as { message?: unknown; error?: unknown };
    // ValidationPipe reports an array of violations — surface them structurally, not as a blob.
    if (Array.isArray(rec.message)) {
      const violations = rec.message.map(String);
      return { code: 'VALIDATION_FAILED', detail: violations.join('; '), params: { violations } };
    }
    if (typeof rec.message === 'string') return { code: codeForStatus(status), detail: rec.message };
  }

  return { code: codeForStatus(status), detail: ERROR_CODES[codeForStatus(status)].title };
}
