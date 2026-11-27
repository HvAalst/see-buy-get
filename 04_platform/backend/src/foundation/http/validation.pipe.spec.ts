import { ArgumentsHost } from '@nestjs/common';
import { readFileSync } from 'fs';
import { join } from 'path';
import { Type } from 'class-transformer';
import { IsEmail, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { GlosValidationPipe } from './validation.pipe';
import { ProblemFilter } from './problem.filter';
import { GlosError } from './glos-error';
import { NOTICE_TRANSLATIONS } from '../../modules/pudo/notice-words/catalog';
import { codeSaid } from '../../modules/pudo/notice-words/codes';
import { sayEnglish, sayIn, type Said } from '../../modules/pudo/notice-words/say';

/*
 * 2026-11-27 — A FORM THE SERVER REFUSES, SAID PLAINLY (the owner: "continue"). The refusal is Nest's own as before — 400,
 * VALIDATION_FAILED, the validator's English, every violation — and an app asking in another language is told its first problem
 * in a plain sentence of its language. And a code said back in a refusal is said in words.
 */
class ItemDto {
  @IsString() name!: string;
}
class FormDto {
  @IsOptional() @IsEmail() receiverEmail?: string;
  @IsOptional() @MaxLength(5) receiverName?: string;
  @IsOptional() @IsIn(['S', 'M']) size?: string;
  @IsOptional() @ValidateNested({ each: true }) @Type(() => ItemDto) items?: ItemDto[];
}

const pipe = new GlosValidationPipe({ whitelist: true, transform: true });
const refusalOf = async (body: unknown): Promise<GlosError> => {
  try {
    await pipe.transform(body, { type: 'body', metatype: FormDto });
  } catch (e) {
    return e as GlosError;
  }
  throw new Error('not refused');
};
const rendered = (e: unknown, headers: Record<string, string> = {}) => {
  const sent: { status: number; body: Record<string, unknown> } = { status: 0, body: {} };
  const res = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    json(body: Record<string, unknown>) {
      sent.body = body;
    },
  };
  new ProblemFilter().catch(e, { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ url: '/v1/x', headers }) }) } as unknown as ArgumentsHost);
  return sent;
};

describe('a form the server refuses', () => {
  it('is refused as before: 400, VALIDATION_FAILED, the validator’s English and every violation', async () => {
    const e = await refusalOf({ receiverEmail: 'not-an-email', receiverName: 'Achieng Otieno' });
    expect(e).toBeInstanceOf(GlosError);
    const { status, body } = rendered(e);
    expect(status).toBe(400);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.detail).toBe('receiverEmail must be an email; receiverName must be shorter than or equal to 5 characters');
    expect(body.params).toEqual({ violations: ['receiverEmail must be an email', 'receiverName must be shorter than or equal to 5 characters'] });
  });

  it('an app asking in another language is told its first problem plainly, the field named as the form names it', async () => {
    const e = await refusalOf({ receiverEmail: 'not-an-email' });
    expect((e.said as Said).key).toBe('refuse.form.email');
    expect(rendered(e, { 'x-sbg-lang': 'nl' }).body.detail).toBe(NOTICE_TRANSLATIONS.nl['refuse.form.email']!.replace('{field}', 'receiverEmail'));
    expect(((await refusalOf({ size: 'XL' })).said as Said).key).toBe('refuse.form.choice');
    expect(((await refusalOf({ receiverName: 'Achieng Otieno' })).said as Said).key).toBe('refuse.form.tooLong');
    // A field inside a list: its path.
    expect(sayEnglish((await refusalOf({ items: [{ name: 3 }] })).said as Said)).toContain('items.0.name');
  });

  it('is the pipe the server checks every request with', () => {
    expect(readFileSync(join(__dirname, '..', '..', 'main.ts'), 'utf8')).toMatch(/useGlobalPipes\(new GlosValidationPipe\(/);
  });
});

describe('a code said back in a refusal', () => {
  it('is the code itself in English, and words in another language; a code with no words is said as it is', () => {
    expect(sayEnglish({ key: 'refuse.loadPay.loadIs', vars: { status: codeSaid('freight', 'in_transit') } } as Said)).toBe('The load is in_transit');
    expect(sayIn('nl', { key: 'refuse.loadPay.loadIs', vars: { status: codeSaid('freight', 'in_transit') } } as Said)).not.toContain('in_transit');
    expect(codeSaid('freight', 'teleported')).toBe('teleported');
    expect(codeSaid('payout', undefined)).toBeUndefined();
  });
});
