import { HttpException } from '@nestjs/common';
import { GlosError } from './glos-error';
import { ERROR_CODES } from './error-codes';

describe('GlosError', () => {
  it('is an HttpException carrying the code registry status', () => {
    const err = new GlosError('NOT_FOUND', 'Parcel not found: QR-1');
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(404);
    expect(err.code).toBe('NOT_FOUND');
  });

  it('preserves the English detail as message (keeps .toThrow(/…/) and body.message alive)', () => {
    const err = new GlosError('INVALID_STATE', 'Parcel is On_Bus, expected At_PUDO');
    expect(err.message).toContain('On_Bus');
    const body = err.getResponse() as { code: string; detail: string; message: string };
    expect(body.code).toBe('INVALID_STATE');
    expect(body.detail).toBe('Parcel is On_Bus, expected At_PUDO');
    expect(body.message).toBe(body.detail);
  });

  it('falls back to the registry title when no detail is given', () => {
    const err = new GlosError('WALLET_INSUFFICIENT');
    expect(err.message).toBe(ERROR_CODES.WALLET_INSUFFICIENT.title);
    expect(err.getStatus()).toBe(402);
  });

  it('carries structured params and a retryable flag (false for business rejections)', () => {
    const err = new GlosError('CAPACITY_EXCEEDED', 'Too heavy', { limitKg: 20, actualKg: 25 });
    expect(err.params).toEqual({ limitKg: 20, actualKg: 25 });
    expect(err.retryable).toBe(false);
  });

  it('lets a caller override the status without inventing a new code', () => {
    const err = new GlosError('NOT_FOUND', 'gone', undefined, { status: 410 });
    expect(err.getStatus()).toBe(410);
    expect(err.code).toBe('NOT_FOUND');
  });
});
