import { OtpService } from './otp.service';

describe('OtpService (S0 hardening)', () => {
  let otp: OtpService;
  beforeEach(() => {
    otp = new OtpService();
  });

  it('issues a 6-digit code and verifies it', () => {
    const { code } = otp.request('+254712345678');
    expect(code).toMatch(/^\d{6}$/);
    expect(otp.verify('+254712345678', code).verified).toBe(true);
    expect(otp.isVerified('+254712345678')).toBe(true);
  });

  it('treats national, international and spaced formats as ONE number', () => {
    // Without E.164 normalization the rate limit and the verified set are bypassed by re-typing.
    const { code } = otp.request('0712 345 678');
    expect(otp.verify('+254712345678', code).verified).toBe(true);
    expect(otp.isVerified('254712345678')).toBe(true);
    expect(otp.isVerified('0712-345-678')).toBe(true);
  });

  it('burns the code after 5 wrong attempts', () => {
    const { code } = otp.request('+254712345678');
    const wrong = code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) {
      expect(() => otp.verify('+254712345678', wrong)).toThrow('Wrong or expired code');
    }
    expect(() => otp.verify('+254712345678', wrong)).toThrow('Too many wrong codes');
    // Burned: even the correct code no longer works.
    expect(() => otp.verify('+254712345678', code)).toThrow();
    expect(otp.isVerified('+254712345678')).toBe(false);
  });

  it('enforces a resend cooldown', () => {
    otp.request('+254712345678');
    expect(() => otp.request('+254712345678')).toThrow(/Wait \d+s/);
  });

  it('expires the verified flag', () => {
    const { code } = otp.request('+254712345678');
    otp.verify('+254712345678', code);
    const spy = jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 31 * 60 * 1000);
    try {
      expect(otp.isVerified('+254712345678')).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });

  it('rejects an implausibly short number', () => {
    expect(() => otp.request('123')).toThrow('valid phone number');
  });

  it('says which number a code would go to, however it was typed, without counting anything', () => {
    for (const typed of ['0712 345 678', '+254712345678', '254712345678', '00254-712-345-678']) expect(otp.phoneFor(typed)).toBe('+254712345678');
    expect(() => otp.phoneFor('123')).toThrow('valid phone number');
    // Asked a dozen times, and the first code is still issued: nothing was counted.
    for (let i = 0; i < 12; i++) otp.phoneFor('0712345678');
    expect(otp.request('0712345678').code).toMatch(/^\d{6}$/);
  });

  describe('a code that could not be texted', () => {
    const PHONE = '+254712345678';
    const at = (ms: number) => jest.spyOn(Date, 'now').mockReturnValue(ms);
    afterEach(() => jest.restoreAllMocks());

    it('gives the try back: the person asks again at once, where a code that went makes them wait', () => {
      otp.request(PHONE);
      expect(() => otp.request(PHONE)).toThrow(/Wait \d+s/);
      otp.notSent(PHONE);
      // The number's first request, given back: as if it had never asked.
      expect(otp.request('0712 345 678').code).toMatch(/^\d{6}$/);
      // And that one went: the minute stands.
      expect(() => otp.request(PHONE)).toThrow(/Wait \d+s/);
    });

    it('is not counted against the number’s day — ten of a provider’s bad minutes do not lock a number until tomorrow', () => {
      const start = 1_800_000_000_000;
      // One that went — so that what is given back afterwards is a day already begun, not an empty one.
      at(start);
      otp.request(PHONE);
      for (let i = 1; i <= 25; i++) {
        at(start + i * 61_000);
        otp.request(PHONE);
        otp.notSent(PHONE);
      }
      // Ten that DID go are the day's allowance — that first one and nine more — and the eleventh is refused: what
      // was given back was only what failed.
      for (let i = 0; i < 9; i++) {
        at(start + (30 + i) * 61_000);
        otp.request(PHONE);
      }
      at(start + 41 * 61_000);
      expect(() => otp.request(PHONE)).toThrow('Too many codes requested for this number today');
    });

    it('gives back one try and no more: it cannot be used to wipe the wait a sent code set', () => {
      const start = 1_800_000_000_000;
      at(start);
      otp.request(PHONE);
      at(start + 61_000);
      otp.request(PHONE);
      otp.notSent(PHONE);
      // Back to how it stood after the FIRST, which went — at its own time. Giving back again changes nothing.
      otp.notSent(PHONE);
      otp.notSent(PHONE);
      at(start + 30_000);
      expect(() => otp.request(PHONE)).toThrow(/Wait 30s/);
      // And with nothing asked for, there is nothing to give back.
      otp.notSent('+254700000009');
      expect(otp.request('+254700000009').code).toMatch(/^\d{6}$/);
    });

    it('leaves the code good: a text that only seemed to fail may still arrive, and then it works', () => {
      const { code } = otp.request(PHONE);
      otp.notSent(PHONE);
      expect(otp.verify(PHONE, code)).toEqual({ verified: true });
    });
  });
});
