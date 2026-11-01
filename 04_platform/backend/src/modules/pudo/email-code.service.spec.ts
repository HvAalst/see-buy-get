import { EmailCodeService } from './email-code.service';
import { OtpService } from './otp.service';

/**
 * THE SAME CODE WHILE THE ONE SENT IS STILL GOOD (the owner, 2026-11-01: "when I have to switch apps, from chrome on
 * mobile to mail, to fetch the security code to confirm my email, the sbg page is refreshed and I can't write the code
 * from the earlier email … the code should be reusable for the said 15 minutes").
 */
describe('a code asked for again while the one sent is still good', () => {
  const MIN = 60_000;

  it('is the same email code, with its first expiry — and a new one only once that has run out', () => {
    const codes = new EmailCodeService();
    const t0 = Date.UTC(2026, 10, 1, 9, 0);
    const first = codes.request('Juma@Example.com', t0);
    expect(first.minutes).toBe(15);
    // Back from the inbox, the page reloaded, the code asked for again: the one in the first email is the one sent.
    const again = codes.request('juma@example.com', t0 + 4 * MIN);
    expect(again).toEqual({ code: first.code, minutes: 11 });
    expect(codes.verify('juma@example.com', first.code, t0 + 5 * MIN)).toEqual({ verified: true });

    // Fifteen minutes from the FIRST send, never more: past it, a new code.
    const other = new EmailCodeService();
    const a = other.request('amina@example.com', t0);
    other.request('amina@example.com', t0 + 14 * MIN);
    expect(() => other.verify('amina@example.com', a.code, t0 + 15 * MIN + 1)).toThrow(/Wrong or expired/);
    const b = other.request('amina@example.com', t0 + 16 * MIN);
    expect(b.minutes).toBe(15);
    expect(other.verify('amina@example.com', b.code, t0 + 17 * MIN)).toEqual({ verified: true });
  });

  it('is a new email code when asked for after the first ran out, even if it was never tried', () => {
    const codes = new EmailCodeService();
    const t0 = Date.UTC(2026, 10, 1, 9, 0);
    const first = codes.request('kamau@example.com', t0);
    const later = codes.request('kamau@example.com', t0 + 16 * MIN);
    expect(later.minutes).toBe(15);
    if (later.code !== first.code) expect(() => codes.verify('kamau@example.com', first.code, t0 + 17 * MIN)).toThrow(/Wrong or expired/);
    expect(codes.verify('kamau@example.com', later.code, t0 + 17 * MIN)).toEqual({ verified: true });
  });

  it('is a new email code once the one sent was burned by wrong tries', () => {
    const codes = new EmailCodeService();
    const t0 = Date.UTC(2026, 10, 1, 9, 0);
    const first = codes.request('wanjiru@example.com', t0);
    const wrong = first.code === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i++) expect(() => codes.verify('wanjiru@example.com', wrong, t0 + MIN)).toThrow(/Wrong or expired/);
    expect(() => codes.verify('wanjiru@example.com', wrong, t0 + MIN)).toThrow(/Too many wrong codes/);
    const fresh = codes.request('wanjiru@example.com', t0 + 2 * MIN);
    expect(fresh.minutes).toBe(15);
    // A code burned is gone, whatever comes after: the first one never works again.
    if (fresh.code !== first.code) expect(() => codes.verify('wanjiru@example.com', first.code, t0 + 3 * MIN)).toThrow();
    expect(codes.verify('wanjiru@example.com', fresh.code, t0 + 3 * MIN)).toEqual({ verified: true });
  });

  it('is the same phone code while the text is still good', () => {
    const otp = new OtpService();
    const real = Date.now;
    try {
      const t0 = real();
      const first = otp.request('+254712345678');
      Date.now = () => t0 + 2 * MIN; // past the minute between two asks
      expect(otp.request('+254712345678').code).toBe(first.code);
      expect(otp.verify('+254712345678', first.code).verified).toBe(true);
    } finally {
      Date.now = real;
    }
  });
});
