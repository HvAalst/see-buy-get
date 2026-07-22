import { describe, expect, it } from 'vitest';
import { clientError, presentationFor, toSbgError, type SbgErrorCode } from './errors';

describe('errors', () => {
  it('parses an RFC 9457 problem+json body into an SbgError', () => {
    const err = toSbgError({ code: 'WALLET_INSUFFICIENT', title: 'Top up to continue', detail: 'Balance 0', retryable: false, traceId: 'trc_1', params: { shortfall: 5 } }, 402);
    expect(err.code).toBe('WALLET_INSUFFICIENT');
    expect(err.status).toBe(402);
    expect(err.retryable).toBe(false);
    expect(err.traceId).toBe('trc_1');
    expect(err.params).toEqual({ shortfall: 5 });
  });

  it('fills defaults + reads the legacy message alias when detail is absent', () => {
    const err = toSbgError({ message: 'legacy text' }, 400);
    expect(err.code).toBe('BAD_REQUEST'); // derived from status
    expect(err.detail).toBe('legacy text');
    expect(err.retryable).toBe(false);
  });

  it('marks 5xx / 429 retryable by default', () => {
    expect(toSbgError({}, 503).retryable).toBe(true);
    expect(toSbgError({}, 429).retryable).toBe(true);
    expect(toSbgError({}, 404).retryable).toBe(false);
  });

  it('maps a code to an icon name + read-aloud key a non-reader can act on', () => {
    expect(presentationFor('WALLET_INSUFFICIENT').say).toBe('error.top_up');
    expect(presentationFor('WALLET_INSUFFICIENT').icon).toBe('wallet');
    expect(presentationFor('OTP_INVALID').icon).toBe('keypad');
    expect(presentationFor('OTP_LOCKED').icon).toBe('lock');
    expect(presentationFor('NETWORK').icon).toBe('offline');
    // Unknown codes degrade gracefully, never throw.
    expect(presentationFor('SOMETHING_NEW').say).toBe('error.generic');
    expect(presentationFor('SOMETHING_NEW').icon).toBe('warning');
  });

  it('never hands the UI an emoji glyph — icons are monoline symbol NAMES', () => {
    // The icon slot is typed, but the table is data: assert the data too, because a glyph
    // here would render as tofu on the cheap Androids this app is built for.
    const codes: SbgErrorCode[] = [
      'WALLET_INSUFFICIENT', 'PAYMENT_REQUIRED', 'AGENT_LOCKED', 'SHIPMENT_NOT_PAID', 'OTP_INVALID',
      'CODE_MISMATCH', 'OTP_LOCKED', 'PHOTO_REQUIRED', 'NOT_FOUND', 'WRONG_PUDO', 'INVALID_STATE',
      'WINDOW_EXPIRED', 'CAPACITY_EXCEEDED', 'FRAGILE_NOT_ALLOWED', 'BAG_FULL', 'SHELF_FULL',
      'RATE_LIMITED', 'UNAUTHORIZED', 'FORBIDDEN', 'VALIDATION_FAILED', 'NETWORK', 'TIMEOUT',
      'CLIENT_OUTDATED', 'INTERNAL',
    ];
    for (const code of codes) {
      expect(presentationFor(code).icon).toMatch(/^[a-z]+$/);
    }
  });

  it('synthesises client-side errors for responseless failures', () => {
    expect(clientError('NETWORK', 'offline').retryable).toBe(true);
    expect(clientError('CLIENT_OUTDATED', 'update').retryable).toBe(false);
    expect(clientError('TIMEOUT', 'slow').status).toBe(0);
  });
});
