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
});
