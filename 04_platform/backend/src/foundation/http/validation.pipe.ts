import { ValidationError, ValidationPipe, type ValidationPipeOptions } from '@nestjs/common';
import { GlosError } from './glos-error';
import { said, type Said } from '../../modules/pudo/notice-words/say';
import type { NoticeKey } from '../../modules/pudo/notice-words/catalog';

/**
 * 2026-11-27 — A FORM THE SERVER REFUSES, SAID PLAINLY IN THE APP'S LANGUAGE (the owner: "continue"). A field the server could
 * not take was refused in class-validator's words ("receiverEmail must be an email"), English and technical, whatever the app's
 * language. The refusal is the same as before — the same English, code, status and violations — and now carries a plain
 * sentence for its first problem, which an app asking in another language is told instead (ProblemFilter).
 */
const PLAIN: Record<string, NoticeKey> = {
  isEmail: 'refuse.form.email',
  isNotEmpty: 'refuse.form.missing',
  isDefined: 'refuse.form.missing',
  arrayNotEmpty: 'refuse.form.missing',
  maxLength: 'refuse.form.tooLong',
  arrayMaxSize: 'refuse.form.tooMany',
  minLength: 'refuse.form.tooShort',
  arrayMinSize: 'refuse.form.tooFew',
  isInt: 'refuse.form.number',
  isNumber: 'refuse.form.number',
  isNumberString: 'refuse.form.number',
  min: 'refuse.form.tooSmall',
  max: 'refuse.form.tooLarge',
  isIn: 'refuse.form.choice',
  isEnum: 'refuse.form.choice',
  isDateString: 'refuse.form.date',
  isISO8601: 'refuse.form.date',
  matches: 'refuse.form.format',
  isBoolean: 'refuse.form.yesNo',
};

/** The first problem of a refused form: the field (its path, as the form names it) and what was wrong with it. */
function firstProblem(errors: ValidationError[], path = ''): { field: string; constraint: string } | undefined {
  for (const e of errors) {
    const field = path ? `${path}.${e.property}` : e.property;
    const constraint = e.constraints ? Object.keys(e.constraints)[0] : undefined;
    if (constraint) return { field, constraint };
    const deeper = e.children?.length ? firstProblem(e.children, field) : undefined;
    if (deeper) return deeper;
  }
  return undefined;
}

/** That problem as a plain sentence, the field named as the form names it. */
export function formRefusalSaid(errors: ValidationError[]): Said | undefined {
  const p = firstProblem(errors);
  return p ? said(PLAIN[p.constraint] ?? 'refuse.form.other', { field: p.field }) : undefined;
}

export class GlosValidationPipe extends ValidationPipe {
  constructor(options?: ValidationPipeOptions) {
    super(options);
    // The same refusal as Nest's own (400, VALIDATION_FAILED, the violations joined), with its plain sentence beside it.
    this.exceptionFactory = (errors: ValidationError[]) => {
      const violations = this.flattenValidationErrors(errors);
      const plain = formRefusalSaid(errors);
      return new GlosError('VALIDATION_FAILED', violations.join('; '), { violations }, { status: 400, ...(plain ? { said: plain } : {}) });
    };
  }
}
