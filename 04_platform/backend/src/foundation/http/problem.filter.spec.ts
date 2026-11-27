import { ArgumentsHost } from '@nestjs/common';
import { ProblemFilter } from './problem.filter';
import { GlosError } from './glos-error';
import { useRefusalWords } from './problem.filter';
import { refused } from '../../modules/pudo/notice-words/refuse';
import { said } from '../../modules/pudo/notice-words/say';
import { NOTICE_TRANSLATIONS } from '../../modules/pudo/notice-words/catalog';

/** Render one exception the way every failure leaves the server, and keep what was sent. */
function render(exception: unknown, headers: Record<string, string> = {}): { status: number; body: Record<string, unknown> } {
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
  const host = { switchToHttp: () => ({ getResponse: () => res, getRequest: () => ({ url: '/v1/sbg/media', headers }) }) } as unknown as ArgumentsHost;
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

/*
 * 2026-11-27 — A REFUSAL IN THE APP'S LANGUAGE (the owner: "continue the weak spots"). A refusal made as a phrase leaves with its
 * words in the language the app asks in (x-sbg-lang), with its country's own words for it — all of it, or the English; its
 * English, the code, the status and the params are what they always were.
 */
describe('a refusal, in the language the app asks in', () => {
  const wrong = () => refused('PIN_WRONG', said('refuse.person.wrongPhoneOrPin'), { triesLeft: 2 });
  afterEach(() => useRefusalWords(undefined));

  it('English to a call that asks in none, or in English — word for word as it was thrown', () => {
    expect(wrong().message).toBe('Wrong phone or PIN');
    expect(render(wrong()).body).toMatchObject({ code: 'PIN_WRONG', detail: 'Wrong phone or PIN', message: 'Wrong phone or PIN', params: { triesLeft: 2 } });
    expect(render(wrong(), { 'x-sbg-lang': 'en' }).body.detail).toBe('Wrong phone or PIN');
    expect(render(wrong(), { 'x-sbg-lang': 'fr' }).body.detail).toBe('Wrong phone or PIN');
  });

  it('in the app’s language where it is written there, the code and the status unchanged', () => {
    const { status, body } = render(wrong(), { 'x-sbg-lang': 'sw' });
    expect(body.detail).toBe(NOTICE_TRANSLATIONS.sw['refuse.person.wrongPhoneOrPin']);
    expect(body.message).toBe(body.detail);
    expect(body.code).toBe('PIN_WRONG');
    expect(status).toBe(render(wrong()).status);
  });

  it('with the country’s own words for it, for that country’s readers only', () => {
    useRefusalWords((lang, country) => (lang === 'nl' && country === 'BE' ? { 'refuse.person.wrongPhoneOrPin': 'Verkeerd nummer of PIN' } : undefined));
    expect(render(wrong(), { 'x-sbg-lang': 'nl', 'x-sbg-words-country': 'BE' }).body.detail).toBe('Verkeerd nummer of PIN');
    expect(render(wrong(), { 'x-sbg-lang': 'nl', 'x-sbg-words-country': 'NL' }).body.detail).toBe(NOTICE_TRANSLATIONS.nl['refuse.person.wrongPhoneOrPin']);
  });

  it('a phrase not written in the language, or a refusal that is not a phrase: its English', () => {
    expect(render(refused('INVALID_INPUT', said('no.such.refusal' as never)), { 'x-sbg-lang': 'bg' }).body.detail).toBe('no.such.refusal');
    expect(render(new GlosError('INVALID_INPUT', 'Plain words'), { 'x-sbg-lang': 'bg' }).body.detail).toBe('Plain words');
  });
});
