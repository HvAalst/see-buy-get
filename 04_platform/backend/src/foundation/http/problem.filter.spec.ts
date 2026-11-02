import { ArgumentsHost } from '@nestjs/common';
import { ProblemFilter } from './problem.filter';
import { GlosError } from './glos-error';

/** Render one exception the way every failure leaves the server, and keep what was sent. */
function render(exception: unknown): { status: number; body: Record<string, unknown> } {
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
  const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ url: '/v1/sbg/media' }) }) } as unknown as ArgumentsHost;
  new ProblemFilter().catch(exception, host);
  return sent;
}

/**
 * THE BODY PARSER'S OWN REFUSALS (2026-11-02, the owner: "It silently refused"). An error the parser throws is not Nest's:
 * it fell through to "a real bug", left as a 500, and told the phone to send the same too-large body again.
 */
describe('a refusal the body parser makes, as it leaves the server', () => {
  it('a body too large keeps its 413, is MEDIA_TOO_LARGE, and is never "send it again"', () => {
    const tooLarge = Object.assign(new Error('request entity too large'), { status: 413, statusCode: 413, expose: true, type: 'entity.too.large', length: 3_000_000, limit: 2_097_152 });
    const { status, body } = render(tooLarge);
    expect(status).toBe(413);
    expect(body.code).toBe('MEDIA_TOO_LARGE');
    expect(body.retryable).toBe(false);
    expect(body.title).toBe('The file is too large');
  });

  it('a charset it cannot read is UNSUPPORTED_MEDIA, a 415', () => {
    const { status, body } = render(Object.assign(new Error('unsupported charset "UTF-7"'), { status: 415, expose: true, type: 'charset.unsupported' }));
    expect(status).toBe(415);
    expect(body.code).toBe('UNSUPPORTED_MEDIA');
  });

  it('a real bug is still a 500, and says nothing of itself', () => {
    const { status, body } = render(new Error('database on fire'));
    expect(status).toBe(500);
    expect(body.code).toBe('INTERNAL');
    expect(body.detail).toBe('Something went wrong');
  });

  it('our own refusal carries its size and its most to the phone', () => {
    const { status, body } = render(new GlosError('MEDIA_TOO_LARGE', 'That document is larger than 8 MB', { bytes: 9_000_000, maxBytes: 8 * 1024 * 1024 }));
    expect(status).toBe(413);
    expect(body.params).toEqual({ bytes: 9_000_000, maxBytes: 8 * 1024 * 1024 });
  });
});
